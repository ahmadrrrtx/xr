/**
 * XR Cloud — Stripe gateway.
 *
 * ## Why this is an interface with two implementations
 *
 * The brief asks for Stripe as the billing engine. It also asks — repeatedly, and
 * in the constitutional voice — for a service that degrades honestly when a
 * capability is absent. A self-hosted Enterprise install may legitimately have no
 * Stripe account; a dev loop certainly does not. So:
 *
 *   - `LiveStripeGateway` — real SDK calls, real webhook signature verification.
 *   - `DisabledStripeGateway` — every method throws `unavailable(...)` with a
 *     repair string naming the exact environment variables to set. It does **not**
 *     return a fake success, and it does **not** make the process refuse to boot.
 *
 * ## Card data
 *
 * No card number, CVC, or expiry ever reaches this process. Everything is Stripe
 * Checkout (hosted) and the Stripe Customer Portal (hosted). This service only
 * ever sees ids, amounts and statuses. That is both the PCI-scope minimisation
 * the brief asks for and, more practically, the reason there is no
 * `pan`-shaped field anywhere in the schema.
 *
 * ## Money
 *
 * Stripe speaks integer minor units (cents). This service speaks integer
 * micro-USD. The conversion lives here and nowhere else, and it is exact:
 * `cents * 10_000 === microUsd`. No float in the path.
 */

import Stripe from "stripe";

import type { CloudEnv } from "../env.ts";
import { unavailable } from "../lib/errors.ts";
import type { Logger } from "../lib/logger.ts";

export interface CheckoutSessionInput {
  orgId: string;
  /** Org owner's email, pre-filled so checkout is one fewer field. */
  email: string;
  priceId: string;
  seats: number;
  /** Stripe customer to reuse, if the org already has one. */
  stripeCustomerId: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Trial days. 0 = no trial (converting an existing trial). */
  trialDays: number;
  /** Deterministic guard against double-clicks creating two subscriptions. */
  idempotencyKey: string;
}

export interface PortalSessionInput {
  stripeCustomerId: string;
  returnUrl: string;
}

export interface StripeGateway {
  readonly enabled: boolean;
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string; id: string }>;
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  /** Verifies the signature against the raw body. Throws on any mismatch. */
  constructEvent(rawBody: string, signature: string): Stripe.Event;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  updateSubscriptionSeats(
    subscriptionId: string,
    itemId: string,
    seats: number,
  ): Promise<Stripe.Subscription>;
  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<Stripe.Subscription>;
  retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice>;
  /** Used by the enterprise manual-invoice placeholder. */
  createCustomer(input: { orgId: string; name: string; email: string }): Promise<{ id: string }>;
}

class DisabledStripeGateway implements StripeGateway {
  readonly enabled = false;
  constructor(private readonly reason: string) {}
  private deny(): never {
    throw unavailable(
      "Billing",
      `${this.reason} Set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and STRIPE_PRICE_ID_PRO_SEAT_MONTHLY ` +
        `(plus STRIPE_PRICE_ID_PRO_SEAT_ANNUAL for annual billing) and restart. ` +
        `Nothing else in this service is blocked by their absence — teams, SSO, memory and audit all work without Stripe.`,
    );
  }
  async createCheckoutSession(): Promise<never> {
    this.deny();
  }
  async createPortalSession(): Promise<never> {
    this.deny();
  }
  constructEvent(): never {
    this.deny();
  }
  async retrieveSubscription(): Promise<never> {
    this.deny();
  }
  async updateSubscriptionSeats(): Promise<never> {
    this.deny();
  }
  async cancelSubscription(): Promise<never> {
    this.deny();
  }
  async retrieveInvoice(): Promise<never> {
    this.deny();
  }
  async createCustomer(): Promise<never> {
    this.deny();
  }
}

class LiveStripeGateway implements StripeGateway {
  readonly enabled = true;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    webhookSecret: string | undefined,
    private readonly log: Logger,
  ) {
    // `apiVersion` is deliberately omitted: the SDK pins the version its own
    // types were generated against, which is the only combination guaranteed to
    // typecheck. Hard-coding a date string is how an upgrade breaks silently.
    this.stripe = new Stripe(secretKey, {
      // Bounded retries — a Stripe blip must not turn into a request storm.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "XR Cloud", version: "1.0.0" },
    });
    this.webhookSecret = webhookSecret;
  }
  private readonly webhookSecret: string | undefined;

  async createCheckoutSession(input: CheckoutSessionInput): Promise<{ url: string; id: string }> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: "subscription",
        line_items: [{ price: input.priceId, quantity: input.seats }],
        // Per-seat: quantity on a licensed price IS the seat count.
        subscription_data: {
          ...(input.trialDays > 0 ? { trial_period_days: input.trialDays } : {}),
          metadata: { xrOrgId: input.orgId },
        },
        customer: input.stripeCustomerId ?? undefined,
        customer_email: input.stripeCustomerId ? undefined : input.email,
        // Creates the Customer at checkout when we do not have one yet, which is
        // what makes the trial-then-convert path work without a card up front.
        customer_creation: input.stripeCustomerId ? undefined : "always",
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: input.orgId,
        metadata: { xrOrgId: input.orgId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    if (!session.url) {
      // Stripe can return a session without a URL for non-redirect flows. This
      // service only ever uses redirect flows, so an absent URL is an error.
      throw new Error("Stripe returned a checkout session with no redirect URL");
    }
    return { url: session.url, id: session.id };
  }

  async createPortalSession(input: PortalSessionInput): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.stripeCustomerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  constructEvent(rawBody: string, signature: string): Stripe.Event {
    if (!this.webhookSecret) {
      throw unavailable(
        "Stripe webhooks",
        "STRIPE_WEBHOOK_SECRET is not set, so webhook signatures cannot be verified. " +
          "An unverifiable webhook is refused rather than trusted — set the secret from `stripe listen` or the Dashboard.",
      );
    }
    // Throws on mismatch. The caller maps it to a 400. This is the one place a
    // production Stripe integration is most often quietly wrong, so it always
    // verifies and never has a "skip in dev" branch.
    return this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
  }

  retrieveSubscription(id: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.retrieve(id);
  }

  async updateSubscriptionSeats(
    subscriptionId: string,
    itemId: string,
    seats: number,
  ): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, quantity: seats }],
      // Stripe's default: prorate the difference immediately.
      proration_behavior: "create_prorations",
    });
  }

  cancelSubscription(subscriptionId: string, atPeriodEnd: boolean): Promise<Stripe.Subscription> {
    if (atPeriodEnd) {
      return this.stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    }
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  retrieveInvoice(invoiceId: string): Promise<Stripe.Invoice> {
    return this.stripe.invoices.retrieve(invoiceId);
  }

  async createCustomer(input: { orgId: string; name: string; email: string }): Promise<{ id: string }> {
    const customer = await this.stripe.customers.create({
      name: input.name,
      email: input.email,
      metadata: { xrOrgId: input.orgId },
    });
    this.log.info({ orgId: input.orgId }, "stripe customer created");
    return { id: customer.id };
  }
}

export function createStripeGateway(env: CloudEnv, log: Logger): StripeGateway {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return new DisabledStripeGateway("Billing is not configured on this deployment.");
  }
  return new LiveStripeGateway(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SECRET, log);
}

/** Exact cents → micro-USD. Kept next to the gateway because they are one concern. */
export function centsToMicro(cents: number | null | undefined): number {
  if (!cents || !Number.isFinite(cents)) return 0;
  return Math.round(cents) * 10_000;
}
