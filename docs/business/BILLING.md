# BILLING

Everything about money: the tiers, the trial, seats and proration, what happens
when a card fails, and what cancelling does and does not do.

- Implementation: `cloud/src/services/subscriptions.ts`, `cloud/src/services/stripe.ts`, `cloud/src/routes/billing.ts`.
- Desktop surface: Settings → **Billing & Account**.
- Console page: `/dashboard/billing`.

## 1. The tiers

| | **Personal** | **Business** | **Enterprise** |
| --- | --- | --- | --- |
| Price | $0, forever | **$15 per user / month** · $144 per user / year ($12 / month equivalent) | Quoted per contract |
| Account required | No | Yes | Yes |
| Sign-in required | No | Yes | Yes |
| Every local feature — voice, local memory, themes, CLI, bots, VS Code, mobile PWA, multi-window, research, agents, skills, MCP | Included | Included | Included |
| Team management, shared workspaces, pooled billing | — | Included | Included |
| SSO (OIDC + SAML) administration | — | Included | Included |
| Managed cloud models (pooled, with per-user caps) | — | Included | Included |
| Team memory sync, audit log + signed export, cloud relay, admin console | — | Included | Included |
| BYOK (your own provider keys) | Included, direct to the provider | Included, direct to the provider unless an admin disables it | Included |
| Invoicing | — | Card via Stripe, self-serve | Manual, NET 30 |

**Personal is not a trial and is not limited.** There is no seat count, no time
limit, no feature that stops working, no watermark, and no nag screen. Nothing in
the local product phones home, whether or not a licence is present: the licence is
verified offline against a key built into the binary (`src/cloud/license.ts`),
and the exact list of things a licence can gate is the eight hosted surfaces in
`BUSINESS_FEATURES` — every one of them a server-side feature.

## 2. Why the price is per user

The costs that scale are the ones a hosted service creates: seats in a database,
mail for invitations, an audit log that has to be retained and exported, a relay
that routes other people's encrypted frames, and managed-model tokens. The price
tracks those. It is not a licence for the software, which stays MIT whether or not
anyone pays.

Annual is $144 per user, which is 12 monthly payments for the price of 9.6 — the
"save 20%" on the pricing page is that arithmetic and nothing more.

## 3. Trial

- **30 days** (`TRIAL_DAYS`), **no card required** (`checkout` is not involved in
  starting a trial).
- **Capped at 5 seats** (`TRIAL_MAX_SEATS`). A sixth invitation during a trial
  returns a clear message rather than silently truncating: a trial that quietly
  drops a colleague is worse than one that says no.
- Converting to a paid subscription requires a card, and is a single click from
  the console or from Settings → Billing & Account.
- **If the trial ends with no conversion, nothing is charged and nothing is
  deleted.** Team features stop; local XR keeps working exactly as it did. An
  organization that never pays is not locked out of its own machines, and no
  remote switch exists that could do so.
- One trial per organization. Starting a second is refused with that sentence.

## 4. Enterprise

Enterprise exists for buyers who cannot pay by card: a purchase order, a security
review, a data-processing addendum, or an invoice. It is quoted per contract and
**invoiced manually, NET 30**, and the sales conversation happens by email — the
"Contact sales" link opens a mail draft, and that is the whole of the flow.

There is **no self-serve Enterprise checkout**, and **no support SLA, uptime
guarantee or dedicated engineer is offered on any tier**. Availability targets and
response times are stated in `docs/business/SELF-HOST.md` for operators running
their own control plane; they are not a contractual promise from us.

## 5. Managed models and BYOK

Managed models are the one thing on this list that costs real money per request,
so the rules are explicit:

- **BYOK is free on every tier** and is not metered, proxied or inspected: a
  personal provider key goes from the machine straight to the provider. XR does not
  sit in the middle and cannot see those requests.
- An organization may disable BYOK (`policies.disableByok`), which forces requests
  through managed models and onto the organization's bill. Only an owner can do it;
  the audit entry names who did.
- Managed requests are metered per user and per organization, in **micro-USD**
  (integer millionths) so a $0.0004 request does not round to nothing.
- The default **included quota is $20 per user per month** (`includedQuotaMicroUsd`
  = 20,000,000, pooled across the organization), with no default per-user daily or
  monthly budget on top. A request that would take the organization past its ceiling
  is refused with a **402 `budget_exceeded`** naming the scope (`daily`, `monthly`,
  `team`) and the counter that stopped it. Going over is not a surprise invoice; it
  is a refusal, and the console shows the number that caused it. An organization can
  set its own daily, monthly and team budgets — including to `null`, meaning no limit
  — and every one of them is a ceiling, never a floor.
- An organization ceiling sits above the per-user budgets. The **more restrictive
  of the two always wins**: a team policy can lower a member's budget and can never
  raise it (`cloud/src/services/policy.ts`).
- Token counts come from the provider's own `usage` field when it sends one. When
  it does not, tokens are estimated at `characters / 4` and the response is marked
  `x-xr-usage-estimated: true`, so an estimate is never presented as a measurement.

## 6. Seats, proration and changing plans

| Action | Effect |
| --- | --- |
| Add a seat | Prorated charge for the remainder of the period, applied immediately |
| Remove a seat | Takes effect at the **end of the period**; no credit is issued mid-period |
| Remove below the active member count | Refused. Remove the member first, or leave the seat in place |
| Switch monthly → annual | Prorated at the annual rate; the period resets to a year |
| Switch annual → monthly | Takes effect at the end of the annual period |

Proration is Stripe's, with `proration_behavior: "create_prorations"`. We store
the resulting invoice rows and never compute money ourselves; the amount on
`/dashboard/billing` is the amount Stripe will charge.

## 7. What a failed payment does

`invoice.payment_failed` moves the subscription to **`past_due`** and:

- sends the organization owner an email naming the invoice and the retry schedule;
- **keeps every entitlement on** during the retry window. A declined card is a
  billing problem, not a reason to disable someone's team mid-week;
- revokes nothing, deletes nothing, and does not touch any local install.

After the retry window is exhausted, Stripe marks the subscription `unpaid` and
entitlements stop. Everything remains exportable for 30 days (§8).

## 8. Cancelling

Cancelling is a single request — `POST /billing/cancel` — and takes effect at the
end of the period already paid for. There is no retention call, no interstitial, no
"are you sure" with a discount behind it, and no fee.

After the period ends:

| | |
| --- | --- |
| Team features | Stop |
| Team memory and audit log | **Exportable for 30 days**, then purged |
| Members' local XR | **Unchanged, permanently.** No data is removed from any machine |
| Local caches of shared facts | Become read-only, then are discarded — never left as an orphan that looks like data loss |
| The licence | Becomes invalid at its own expiry, which does not require us to be reachable to enforce |

`POST /billing/reactivate` reverses a cancellation until the period ends.

## 9. Data retention and deletion

- Subscription data (organization, seats, invoices, webhook events) is retained for
  the life of the account plus 30 days.
- Team memory facts and the audit log are purged 30 days after cancellation
  (`policies.dataRetentionDays`, default 30, minimum 30).
- A human can request immediate deletion of an organization by email; the request is
  answered within two business days and the deletion is recorded in our own log.
- Deleting an organization never reaches into a member's machine. There is no
  mechanism for that and there will not be one.

## 10. Tax, currency and refunds

- All prices are in **US dollars**, billed by Stripe. Stripe Tax is enabled when the
  deployment configures it; `STRIPE_SECRET_KEY` and the two price IDs are the only
  billing configuration a self-hosted control plane needs.
- **No card data ever reaches this service.** Checkout and the Customer Portal are
  Stripe-hosted. XR stores a customer id, a subscription id and price ids, and
  nothing else.
- Refunds: a first-month refund on request, no questions, for anyone who upgraded
  and changed their mind. After that, refunds are prorated by hand and the request
  is answered either way.

## 11. Webhooks we consume

Signature is verified against the raw body with `STRIPE_WEBHOOK_SECRET` before
anything is parsed; a bad signature is a 400, and an event we have already seen is
ignored by `(source, event_id)` uniqueness. **A handler failure returns 200** so
Stripe stops retrying a bug rather than amplifying it, and the failure is logged
with its event id.

| Event | Effect |
| --- | --- |
| `checkout.session.completed` | Link the Stripe customer to the organization; start the paid period |
| `customer.subscription.created` | Create or update the subscription row |
| `customer.subscription.updated` | Seats, interval, status, `cancel_at_period_end` |
| `customer.subscription.deleted` | End entitlements; start the 30-day retention window |
| `invoice.paid` | Record the invoice; clear `past_due` |
| `invoice.payment_failed` | Move to `past_due`; email the owner; revoke nothing |
| `customer.subscription.trial_will_end` | Email the owner 3 days before the trial ends |

## 12. Self-hosting the billing half

A self-hosted control plane can run with `STRIPE_SECRET_KEY` unset. In that state
`/billing/*` answers `available: false` with a repair message naming the variable,
`/license/me` still answers for free organizations, and everything else works. That
is how the integration test suite runs, and it is the honest way to test a paid
product without a payment provider attached.
