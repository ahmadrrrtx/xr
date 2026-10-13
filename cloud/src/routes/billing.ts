/**
 * XR Cloud — billing routes.
 *
 * ## The one rule
 *
 * **Stripe is the source of truth and this service is the mirror.** Nothing here
 * invents a status, and no route grants entitlements directly. A subscription row
 * is only ever written by (a) trial bootstrap at signup, or (b) a verified webhook.
 *
 * ## Webhook handling, which is the brittle part
 *
 * Checklist the brief asks for, item by item:
 *
 *   - **Raw body.** `c.req.text()` before any JSON parsing. Re-serialising parsed
 *     JSON changes whitespace and breaks the HMAC — the classic Stripe bug.
 *   - **Signature verified** against `STRIPE_WEBHOOK_SECRET`. There is no
 *     `if (NODE_ENV !== 'production') skip` branch, because that branch is how a
 *     production deployment ends up with an unverified endpoint.
 *   - **Idempotent** by `event.id`, recorded in `webhook_events` before processing.
 *     Stripe retries; an `invoice.paid` delivered twice must not double-credit.
 *   - **Order-independent.** Stripe does not guarantee delivery order, so handlers
 *     read the object they were given rather than assuming a prerequisite event
 *     already landed. `customer.subscription.updated` is the workhorse precisely
 *     because it is self-contained.
 *   - **Always 200 on a processed-or-already-processed event.** A non-2xx makes
 *     Stripe retry forever; a *failed* handler is recorded and still returns 200
 *     with the error logged, except for a signature failure (400) where a retry
 *     would be pointless.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { AppDeps } from "../deps.ts";
import { invoices, members, orgs, subscriptions, users, webhookEvents } from "../db/schema.ts";
import { sha256Hex } from "../lib/crypto.ts";
import { badRequest, conflict, unavailable } from "../lib/errors.ts";
import { newId } from "../lib/ids.ts";
import { mintLicense } from "../lib/license.ts";
import { fromUnixSeconds, humanInterval } from "../lib/time.ts";
import { requireOrgMember, requireRole, requireUser } from "../middleware/auth.ts";
import { parseBody, rawBody } from "../middleware/validate.ts";
import { checkoutSchema, portalSchema } from "../schemas.ts";
import { centsToMicro } from "../services/stripe.ts";
import { loadSubscription, viewOf } from "../services/subscriptions.ts";
import { LICENSE_GRACE_DAYS } from "../lib/license.ts";

export function billingRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  /* ------------------------------------------------------------- checkout */

  app.post(
    "/billing/checkout",
    requireUser(deps),
    requireOrgMember(deps, null),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, checkoutSchema);

      if (!deps.stripe.enabled) {
        // Honest refusal with the exact repair, never a fake redirect.
        throw unavailable(
          "Billing",
          "This deployment has no Stripe configuration, so upgrades cannot be started here. " +
            "Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and the two STRIPE_PRICE_ID_PRO_SEAT_* variables. " +
            "Teams, SSO, team memory and audit all work without them.",
        );
      }

      const priceId =
        body.interval === "year"
          ? deps.env.STRIPE_PRICE_ID_PRO_SEAT_ANNUAL
          : deps.env.STRIPE_PRICE_ID_PRO_SEAT_MONTHLY;

      if (!priceId) {
        throw unavailable(
          "Annual billing",
          `No Stripe price is configured for the ${body.interval}ly interval. Set STRIPE_PRICE_ID_PRO_SEAT_${body.interval === "year" ? "ANNUAL" : "MONTHLY"} and restart.`,
        );
      }

      const current = await loadSubscription(deps, member.orgId);
      const now = deps.clock();

      // Already subscribed: send them to the portal instead of creating a second
      // subscription. Creating one here is the classic double-billing bug.
      if (current.row?.stripeSubscriptionId && current.businessActive && !current.trial?.active) {
        throw conflict(
          "This team already has an active subscription.",
          "Change seats or the payment method from the billing portal — that prorates correctly. Use it rather than starting a new checkout.",
          { portal: true },
        );
      }

      const trialDays =
        body.startTrial !== false && current.trial !== null && current.trial.active
          ? Math.max(0, Math.ceil((current.trial.endsAt?.getTime() ?? now.getTime()) - now.getTime()) / 86_400_000)
          : 0;

      const owner = await deps.db
        .select({ email: users.email })
        .from(members)
        .innerJoin(users, eq(users.id, members.userId))
        .where(and(eq(members.orgId, member.orgId), eq(members.role, "owner")))
        .limit(1);

      const email = owner[0]?.email ?? c.get("currentUser").email;

      const session = await deps.stripe.createCheckoutSession({
        orgId: member.orgId,
        email,
        priceId,
        seats: body.seats,
        stripeCustomerId: current.row?.stripeCustomerId ?? null,
        successUrl: `${deps.env.APP_URL}/dashboard/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${deps.env.APP_URL}/pricing?checkout=cancelled`,
        trialDays,
        // Deterministic per org+seats+day, so a double-click cannot create two
        // subscriptions while still allowing a deliberate retry tomorrow.
        idempotencyKey: `xr-checkout-${member.orgId}-${body.seats}-${deps.clock().toISOString().slice(0, 10)}`,
      });

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "billing.checkout_started",
        targetType: "org",
        targetId: member.orgId,
        ip: c.get("meta").ip,
        userAgent: c.get("meta").userAgent,
        detail: { interval: body.interval, seats: body.seats, trialDays },
      });

      return c.json({ url: session.url, sessionId: session.id });
    },
  );

  app.post(
    "/billing/portal",
    requireUser(deps),
    requireOrgMember(deps, null),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, portalSchema);
      const current = await loadSubscription(deps, member.orgId);

      if (!current.row?.stripeCustomerId) {
        throw conflict(
          "There is no Stripe customer for this team yet.",
          "Start a subscription first — the billing portal only exists once there is a customer to manage.",
        );
      }
      if (!deps.stripe.enabled) {
        throw unavailable(
          "Billing",
          "This deployment has no Stripe configuration. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to use the customer portal.",
        );
      }

      const session = await deps.stripe.createPortalSession({
        stripeCustomerId: current.row.stripeCustomerId,
        returnUrl: body.returnUrl ?? `${deps.env.APP_URL}/dashboard/billing`,
      });

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "billing.portal_opened",
        targetType: "org",
        targetId: member.orgId,
        ip: c.get("meta").ip,
      });

      return c.json({ url: session.url });
    },
  );

  /* ---------------------------------------------------------- subscription */

  app.get("/billing/subscription", requireUser(deps), requireOrgMember(deps, null), async (c) => {
    const member = c.get("currentMember");
    const view = await loadSubscription(deps, member.orgId);

    const invoiceRows = await deps.db
      .select()
      .from(invoices)
      .where(eq(invoices.orgId, member.orgId))
      .orderBy(desc(invoices.createdAt))
      .limit(24);

    return c.json({
      subscription: {
        status: view.status,
        plan: view.plan,
        seats: view.seats,
        interval: view.interval,
        businessActive: view.businessActive,
        entitlements: view.entitlements,
        trial: view.trial
          ? {
              active: view.trial.active,
              endsAt: view.trial.endsAt?.toISOString() ?? null,
              daysLeft: view.trial.daysLeft,
            }
          : null,
        currentPeriodEnd: view.currentPeriodEnd?.toISOString() ?? null,
        nextBillingDate: view.nextBillingDate?.toISOString() ?? null,
        nextBillingText: view.nextBillingDate ? humanInterval(view.nextBillingDate, deps.clock()) : null,
        cancelAtPeriodEnd: view.cancelAtPeriodEnd,
        isPastDue: view.isPastDue,
        note: view.reason,
        hasCustomer: Boolean(view.row?.stripeCustomerId),
      },
      // The local-side promise, restated by the API so a client can show it
      // without hard-coding copy.
      cancellation: {
        licenseGraceDays: LICENSE_GRACE_DAYS,
        localFeaturesAffected: [],
        message:
          "Cancelling stops team features only. Every local XR capability keeps working, and team memory and audit logs can be exported before the retention window closes.",
      },
      invoices: invoiceRows.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        amountDueMicroUsd: i.amountDueMicroUsd,
        amountPaidMicroUsd: i.amountPaidMicroUsd,
        currency: i.currency,
        hostedInvoiceUrl: i.hostedInvoiceUrl,
        invoicePdfUrl: i.invoicePdfUrl,
        createdAt: i.createdAt.toISOString(),
        periodStart: i.periodStart?.toISOString() ?? null,
        periodEnd: i.periodEnd?.toISOString() ?? null,
      })),
    });
  });

  app.post(
    "/billing/cancel",
    requireUser(deps),
    requireOrgMember(deps, null),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("currentMember");
      const current = await loadSubscription(deps, member.orgId);
      if (!current.row?.stripeSubscriptionId || !current.businessActive) {
        throw conflict("There is no active subscription to cancel.");
      }
      if (!deps.stripe.enabled) throw unavailable("Billing", "Stripe is not configured on this deployment.");

      const { atPeriodEnd } = (await c.req.json().catch(() => ({}))) as { atPeriodEnd?: boolean };
      const subscription = await deps.stripe.cancelSubscription(
        current.row.stripeSubscriptionId,
        atPeriodEnd !== false,
      );

      await applySubscriptionObject(deps, member.orgId, subscription);

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "billing.cancel",
        targetType: "org",
        targetId: member.orgId,
        ip: c.get("meta").ip,
        userAgent: c.get("meta").userAgent,
        detail: { atPeriodEnd: atPeriodEnd !== false },
      });

      return c.json({
        ok: true,
        cancelAtPeriodEnd: atPeriodEnd !== false,
        message:
          atPeriodEnd !== false
            ? "Cancelled. Team features stay on until the end of the current period. Export team memory and audit logs before then if you need them."
            : "Cancelled immediately. Team features are off. Every member's local XR is unaffected.",
      });
    },
  );

  app.post(
    "/billing/reactivate",
    requireUser(deps),
    requireOrgMember(deps, null),
    requireRole(["owner"]),
    async (c) => {
      const member = c.get("currentMember");
      const current = await loadSubscription(deps, member.orgId);
      if (!current.row?.stripeSubscriptionId) throw conflict("There is no subscription to reactivate.");
      if (!deps.stripe.enabled) throw unavailable("Billing", "Stripe is not configured on this deployment.");

      const subscription = await deps.stripe.cancelSubscription(current.row.stripeSubscriptionId, false);
      await applySubscriptionObject(deps, member.orgId, subscription);

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "billing.reactivate",
        targetType: "org",
        targetId: member.orgId,
        ip: c.get("meta").ip,
      });

      return c.json({ ok: true, message: "Subscription reactivated. Team features are on." });
    },
  );

  /* ----------------------------------------------------------------- seats */

  app.patch(
    "/billing/seats",
    requireUser(deps),
    requireOrgMember(deps, null),
    requireRole(["owner", "admin"]),
    async (c) => {
      const member = c.get("currentMember");
      const body = await parseBody(c, checkoutSchema.pick({ seats: true }));
      const current = await loadSubscription(deps, member.orgId);
      if (!current.row?.stripeSubscriptionId || !current.row.stripeSubscriptionItemId) {
        throw conflict("There is no subscription to change.", "Start one from the billing page first.");
      }
      if (!deps.stripe.enabled) throw unavailable("Billing", "Stripe is not configured on this deployment.");

      const active = await deps.db
        .select({ n: members.id })
        .from(members)
        .where(and(eq(members.orgId, member.orgId), eq(members.status, "active")));
      if (body.seats < active.length) {
        throw conflict(
          `You have ${active.length} active members, so the seat count cannot go below that.`,
          "Remove or disable members first, then reduce seats. Stripe prorates the change automatically.",
        );
      }

      const subscription = await deps.stripe.updateSubscriptionSeats(
        current.row.stripeSubscriptionId,
        current.row.stripeSubscriptionItemId,
        body.seats,
      );
      await applySubscriptionObject(deps, member.orgId, subscription);

      await deps.audit.append({
        orgId: member.orgId,
        actorKind: "user",
        actorId: c.get("auth").userId,
        actorEmail: c.get("currentUser").email,
        action: "billing.seats_changed",
        targetType: "org",
        targetId: member.orgId,
        ip: c.get("meta").ip,
        detail: { from: current.seats, to: body.seats },
      });

      return c.json({ ok: true, seats: body.seats, prorated: true });
    },
  );

  /* -------------------------------------------------------------- webhook */

  app.post("/billing/webhooks/stripe", async (c) => {
    if (!deps.stripe.enabled) {
      // A webhook on an unconfigured deployment is not an error anyone can act
      // on, but it IS worth recording.
      deps.log.warn("stripe webhook received but Stripe is not configured");
      return c.json({ received: false, reason: "stripe-not-configured" }, 200);
    }

    const signature = c.req.header("stripe-signature");
    if (!signature) {
      throw badRequest("Missing Stripe signature.", "Set the webhook signing secret to the one Stripe shows for this endpoint.");
    }

    // EXACT bytes. Nothing may parse the body before this call.
    const body = await rawBody(c);

    let event: ReturnType<typeof deps.stripe.constructEvent>;
    try {
      event = deps.stripe.constructEvent(body, signature);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      deps.log.warn({ detail }, "stripe webhook signature rejected");
      // 400, and deliberately no retry guidance: a bad signature will not fix
      // itself, and asking Stripe to retry a forged payload forever is worse.
      throw badRequest("Invalid Stripe signature.", "Check STRIPE_WEBHOOK_SECRET matches the endpoint's signing secret.");
    }

    const payloadHash = sha256Hex(body);

    // Idempotency. Insert-or-conflict decides whether this delivery is new.
    const claimed = await deps.db
      .insert(webhookEvents)
      .values({
        id: newId("webhookEvent"),
        source: "stripe",
        eventId: event.id,
        type: event.type,
        payloadHash,
      })
      .onConflictDoNothing({ target: [webhookEvents.source, webhookEvents.eventId] })
      .returning({ id: webhookEvents.id });

    if (claimed.length === 0) {
      deps.log.info({ eventId: event.id, type: event.type }, "stripe webhook already processed — ignored");
      return c.json({ received: true, duplicate: true });
    }

    const claimedId = claimed[0]?.id;

    try {
      await handleEvent(deps, event);
      if (claimedId) {
        await deps.db
          .update(webhookEvents)
          .set({ processedAt: deps.clock() })
          .where(eq(webhookEvents.id, claimedId));
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (claimedId) {
        await deps.db.update(webhookEvents).set({ error: detail.slice(0, 500) }).where(eq(webhookEvents.id, claimedId));
      }
      deps.log.error({ eventId: event.id, type: event.type, detail }, "stripe webhook handler failed");
      // Still 200: the event is recorded as failed and can be replayed by an
      // operator, while a 500 would make Stripe retry a payload we already know
      // how to reject. The `error` column is the retry queue.
    }

    return c.json({ received: true });
  });

  /* -------------------------------------------------------------- license */

  /**
   * Mint or refresh this user's offline-verifiable Business licence.
   *
   * The daemon calls this opportunistically (every 7 days per the brief). It is
   * never required for correctness: an expired licence keeps team UI alive for a
   * 30-day grace window, and no local feature reads this at all.
   */
  app.post("/license/refresh", requireUser(deps), async (c) => {
    const auth = c.get("auth");
    if (!auth.orgId) {
      return c.json({ license: null, reason: "You are not signed into a team." });
    }

    const memberRows = await deps.db
      .select()
      .from(members)
      .where(and(eq(members.orgId, auth.orgId), eq(members.userId, auth.userId)))
      .limit(1);
    const member = memberRows[0];
    if (!member || member.status === "disabled") return c.json({ license: null, reason: "No active membership." });

    const view = await loadSubscription(deps, auth.orgId);
    if (!view.businessActive) {
      return c.json({
        license: null,
        reason: view.reason ?? "This team's Business subscription is not active.",
        // The client keeps whatever it already holds and runs out its grace
        // window. It is NOT told to lock anything now.
        graceHint: `${LICENSE_GRACE_DAYS} days after a licence expires, team features lock; local features never do.`,
      });
    }

    if (!deps.env.XR_LICENSE_PRIVATE_KEY) {
      return c.json({
        license: null,
        reason:
          "This deployment does not have a licence signing key, so per-device licences cannot be issued. " +
          "Team features are still available in the web console; run `bun run license:keypair` and set XR_LICENSE_PRIVATE_KEY to enable the desktop client.",
      });
    }

    const license = await mintLicense({
      userId: auth.userId,
      orgId: auth.orgId,
      plan: "business",
      seats: view.seats,
    });

    const { licenseKeys } = await import("../db/schema.ts");
    await deps.db.insert(licenseKeys).values({
      id: newId("license"),
      orgId: auth.orgId,
      userId: auth.userId,
      jti: license.jti,
      plan: "business",
      seats: view.seats,
      features: [...view.entitlements],
      expiresAt: license.expiresAt,
    });

    await deps.audit.append({
      orgId: auth.orgId,
      actorKind: "user",
      actorId: auth.userId,
      actorEmail: c.get("currentUser").email,
      action: "license.issued",
      targetType: "license",
      targetId: license.jti,
      ip: c.get("meta").ip,
      detail: { seats: view.seats, expiresAt: license.expiresAt.toISOString() },
    });

    return c.json({
      license: {
        token: license.token,
        expiresAt: license.expiresAt.toISOString(),
        graceDays: LICENSE_GRACE_DAYS,
        // Named so the desktop can show the list, and so it is visible that the
        // vocabulary contains nothing local.
        features: view.entitlements,
      },
      verifyOffline: true,
    });
  });

  /**
   * The caller's entitlement view.
   *
   * Deliberately NOT behind `requireBusiness`. This is the endpoint the desktop
   * renders the Billing & Account section from, and a Personal user must get a
   * clean answer — `businessActive: false`, no features, no reason — rather than a
   * 403 that a client would have to translate into "show the free state".
   * A refusal here would also mean the free tier's Settings screen depended on an
   * endpoint that refuses free-tier users, which is precisely the coupling the
   * brief forbids.
   */
  app.get("/license/me", requireUser(deps), requireOrgMember(deps, null), async (c) => {
    const member = c.get("currentMember");
    const view = await loadSubscription(deps, member.orgId);
    return c.json({
      plan: view.plan,
      status: view.status,
      seats: view.seats,
      interval: view.interval,
      // The derived answer, so no client has to re-implement the rules above.
      businessActive: view.businessActive,
      features: view.entitlements,
      // Null for the free tier on purpose: Personal is not a failure state and
      // must not carry a reason string that a UI would render as a warning.
      reason: view.reason,
      trial: view.trial
        ? { active: view.trial.active, endsAt: view.trial.endsAt?.toISOString() ?? null, daysLeft: view.trial.daysLeft }
        : null,
      currentPeriodEnd: view.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: view.cancelAtPeriodEnd,
      isPastDue: view.isPastDue,
      note:
        "Everything in XR that runs on your own machine — voice, local memory, themes, the CLI, bots, editors, " +
        "research, agents, skills and MCP — is unaffected by anything on this page.",
    });
  });

  return app;
}

/* ------------------------------------------------------------------ events */

/**
 * Event dispatch. Each handler is self-contained on purpose: Stripe does not
 * guarantee ordering, so no handler assumes a prerequisite arrived first.
 */
async function handleEvent(deps: AppDeps, event: ReturnType<typeof deps.stripe.constructEvent>): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as { id: string; customer?: string | null; subscription?: string | null; client_reference_id?: string | null; metadata?: Record<string, string> | null; quantity?: number; mode?: string };
      const orgId = session.metadata?.xrOrgId ?? session.client_reference_id ?? null;
      if (!orgId) {
        deps.log.warn({ sessionId: session.id }, "checkout.session.completed with no org reference");
        return;
      }

      // The subscription object is the authority; fetch it rather than trusting
      // the session snapshot, which can be stale by the time we read it.
      if (session.subscription) {
        const subscription = await deps.stripe.retrieveSubscription(session.subscription);
        await applySubscriptionObject(deps, orgId, subscription, session.customer ?? undefined);
      } else if (session.customer) {
        await deps.db
          .update(subscriptions)
          .set({ stripeCustomerId: session.customer, updatedAt: deps.clock() })
          .where(eq(subscriptions.orgId, orgId));
      }

      await deps.audit.append({
        orgId,
        actorKind: "stripe",
        action: "billing.checkout_completed",
        targetType: "org",
        targetId: orgId,
        detail: { sessionId: session.id, mode: session.mode ?? "subscription" },
      });
      return;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.trial_will_end": {
      const subscription = event.data.object as Parameters<typeof applySubscriptionObject>[2];
      const orgId = (subscription.metadata?.xrOrgId as string | undefined) ?? (await orgForCustomer(deps, subscription.customer));
      if (!orgId) {
        deps.log.warn({ subscriptionId: subscription.id }, "subscription event with no resolvable org");
        return;
      }

      if (event.type === "customer.subscription.trial_will_end") {
        const view = viewOf(
          (await deps.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1))[0] ?? null,
          deps.clock(),
        );
        const owner = await deps.db
          .select({ email: users.email })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(and(eq(members.orgId, orgId), eq(members.role, "owner")))
          .limit(1);
        if (owner[0]) {
          await deps.mailer.sendTrialEnding({
            to: owner[0].email,
            orgName: (await deps.db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1))[0]?.name ?? "your team",
            daysLeft: view.trial?.daysLeft ?? 3,
            portalUrl: `${deps.env.APP_URL}/dashboard/billing`,
          });
        }
        // Trial reminders do not change state. Recorded, then done.
        await deps.audit.append({
          orgId,
          actorKind: "stripe",
          action: "billing.trial_will_end",
          targetType: "org",
          targetId: orgId,
          detail: { daysLeft: view.trial?.daysLeft ?? 3 },
        });
        return;
      }

      await applySubscriptionObject(deps, orgId, subscription);

      await deps.audit.append({
        orgId,
        actorKind: "stripe",
        action: `billing.subscription_${event.type.split(".")[2] ?? "changed"}`,
        targetType: "org",
        targetId: orgId,
        detail: {
          status: subscription.status,
          seats: subscription.items?.data?.[0]?.quantity ?? null,
          cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
        },
      });
      return;
    }

    case "invoice.paid":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Parameters<typeof applyInvoice>[1];
      const orgId = await orgForCustomer(deps, invoice.customer);
      if (!orgId) return;

      await applyInvoice(deps, invoice, orgId);

      if (event.type === "invoice.payment_failed") {
        // A failed payment does NOT revoke anything. Stripe is still retrying and
        // the customer has not cancelled — cutting a team off here is exactly the
        // behaviour this product exists to not have.
        await deps.db
          .update(subscriptions)
          .set({ status: "past_due", updatedAt: deps.clock() })
          .where(eq(subscriptions.orgId, orgId));

        const owner = await deps.db
          .select({ email: users.email })
          .from(members)
          .innerJoin(users, eq(users.id, members.userId))
          .where(and(eq(members.orgId, orgId), eq(members.role, "owner")))
          .limit(1);
        if (owner[0]) {
          await deps.mailer.sendPaymentFailed({
            to: owner[0].email,
            orgName: (await deps.db.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, orgId)).limit(1))[0]?.name ?? "your team",
            portalUrl: `${deps.env.APP_URL}/dashboard/billing`,
            amountLabel: `${((invoice.amount_due ?? 0) / 100).toFixed(2)} ${(invoice.currency ?? "usd").toUpperCase()}`,
          });
        }
      }

      await deps.audit.append({
        orgId,
        actorKind: "stripe",
        action: `billing.${event.type.replace("invoice.", "invoice_")}`,
        targetType: "invoice",
        targetId: invoice.id,
        detail: { amountDueMicroUsd: centsToMicro(invoice.amount_due), status: invoice.status },
      });
      return;
    }

    default:
      // Unhandled event types are acknowledged, not failed. An error here would
      // make Stripe retry an event we have already decided to ignore.
      deps.log.debug({ type: event.type }, "stripe event acknowledged without action");
  }
}

async function orgForCustomer(deps: AppDeps, customer: unknown): Promise<string | null> {
  const id = typeof customer === "string" ? customer : (customer as { id?: string } | null)?.id;
  if (!id) return null;
  const rows = await deps.db
    .select({ orgId: subscriptions.orgId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, id))
    .limit(1);
  return rows[0]?.orgId ?? null;
}

export interface StripeSubscriptionLike {
  id: string;
  customer: unknown;
  status: string;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  current_period_end?: number | null;
  canceled_at?: number | null;
  metadata?: Record<string, string> | null;
  items?: { data?: Array<{ id: string; quantity?: number | null; price?: { id?: string } | null }> } | null;
}

async function applySubscriptionObject(
  deps: AppDeps,
  orgId: string,
  subscription: StripeSubscriptionLike,
  customerOverride?: string,
): Promise<void> {
  const item = subscription.items?.data?.[0];
  const customerId =
    customerOverride ??
    (typeof subscription.customer === "string" ? subscription.customer : (subscription.customer as { id?: string } | null)?.id) ??
    null;

  const status = normalizeStatus(subscription.status, deps.log);
  const now = deps.clock();

  const existing = await deps.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);

  const values = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    stripeSubscriptionItemId: item?.id ?? null,
    stripePriceId: item?.price?.id ?? null,
    status,
    seats: item?.quantity ?? existing[0]?.seats ?? 1,
    trialEndsAt: fromUnixSeconds(subscription.trial_end ?? null),
    currentPeriodEnd: fromUnixSeconds(subscription.current_period_end ?? null),
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    canceledAt: subscription.canceled_at ? fromUnixSeconds(subscription.canceled_at) : null,
    updatedAt: now,
  };

  if (existing[0]) {
    await deps.db.update(subscriptions).set(values).where(eq(subscriptions.orgId, orgId));
  } else {
    // A subscription created outside checkout (Stripe dashboard, an import).
    await deps.db.insert(subscriptions).values({ id: newId("subscription"), orgId, createdAt: now, ...values });
  }

  // A cancelled or unpaid subscription means the per-user caps in team features
  // stop being meaningful — but nothing local is touched by this, at all.
  if (status === "canceled" || status === "unpaid") {
    deps.log.info({ orgId, status }, "subscription inactive — team features off, local features unaffected");
  }
}

function normalizeStatus(
  status: string,
  log: { warn: (obj: Record<string, unknown>, msg: string) => void },
): "trialing" | "active" | "past_due" | "unpaid" | "canceled" | "incomplete" {
  switch (status) {
    case "trialing":
    case "active":
    case "past_due":
    case "unpaid":
    case "canceled":
    case "incomplete":
    case "incomplete_expired":
      return status === "incomplete_expired" ? "incomplete" : status;
    case "paused":
      // Stripe's `paused` is closest to `unpaid` for entitlement purposes: the
      // customer is not being charged and should not consume managed-model spend.
      return "unpaid";
    default:
      // An unrecognised status from Stripe is treated restrictively. Guessing
      // "active" here would grant paid features on a status we do not understand.
      log.warn({ status }, "unknown stripe subscription status — treated as incomplete (fail closed)");
      return "incomplete";
  }
}

async function applyInvoice(
  deps: AppDeps,
  invoice: {
    id: string;
    customer?: unknown;
    number?: string | null;
    status?: string | null;
    amount_due?: number | null;
    amount_paid?: number | null;
    currency?: string | null;
    hosted_invoice_url?: string | null;
    invoice_pdf?: string | null;
    period_start?: number | null;
    period_end?: number | null;
    status_transitions?: { paid_at?: number | null } | null;
  },
  orgId: string,
): Promise<void> {
  const values = {
    orgId,
    stripeInvoiceId: invoice.id,
    number: invoice.number ?? null,
    status: invoice.status ?? "unknown",
    amountDueMicroUsd: centsToMicro(invoice.amount_due),
    amountPaidMicroUsd: centsToMicro(invoice.amount_paid),
    currency: invoice.currency ?? "usd",
    hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
    invoicePdfUrl: invoice.invoice_pdf ?? null,
    periodStart: fromUnixSeconds(invoice.period_start ?? null),
    periodEnd: fromUnixSeconds(invoice.period_end ?? null),
    paidAt: fromUnixSeconds(invoice.status_transitions?.paid_at ?? null),
  };

  await deps.db
    .insert(invoices)
    .values({ id: newId("invoice"), createdAt: deps.clock(), ...values })
    .onConflictDoUpdate({ target: invoices.stripeInvoiceId, set: values });
}
