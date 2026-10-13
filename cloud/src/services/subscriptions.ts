/**
 * XR Cloud — subscription state.
 *
 * ## Stripe is the source of truth; this is the mirror
 *
 * The `subscriptions` row exists so a cap check does not call Stripe. It is
 * written only by webhook handlers (and by the trial bootstrap at org creation).
 * A route never fabricates a status.
 *
 * ## Trial expiry is DERIVED, not stored
 *
 * This is the one place where the mirror is smarter than a naive read. A trial
 * that ended yesterday but whose `subscription.updated` webhook has not arrived
 * (Stripe retries for days; a webhook endpoint can be down) would otherwise keep
 * granting Business features forever. So `businessActive` consults
 * `trialEndsAt` as well as `status`:
 *
 *   trialing AND now < trialEndsAt   → active
 *   trialing AND now >= trialEndsAt  → not active, with an explanatory reason
 *
 * Expiry at trial end is the *documented* behaviour and the local daemon already
 * has a 30-day grace window, so a team never loses access because of clock skew
 * between this service and a laptop. What it does lose, at the end of an
 * unconverted trial, is the ability to spend XR's money — which is the point.
 */

import { eq } from "drizzle-orm";

import type { AppDeps } from "../deps.ts";
import { subscriptions, type SubscriptionRow } from "../db/schema.ts";
import { featuresForStatus, type BusinessFeature } from "../lib/license.ts";
import { daysUntil, humanInterval } from "../lib/time.ts";

export interface SubscriptionView {
  readonly row: SubscriptionRow | null;
  readonly status: SubscriptionRow["status"];
  readonly plan: string;
  readonly seats: number;
  readonly interval: "month" | "year";
  /** The derived answer. This is what every gate uses. */
  readonly businessActive: boolean;
  /** Why not, when `businessActive` is false. User-facing, actionable. */
  readonly reason: string | null;
  readonly entitlements: readonly BusinessFeature[];
  readonly trial: { active: boolean; endsAt: Date | null; daysLeft: number } | null;
  readonly currentPeriodEnd: Date | null;
  readonly cancelAtPeriodEnd: boolean;
  readonly nextBillingDate: Date | null;
  readonly isPastDue: boolean;
}

/** Orgs with no subscription row at all: a personal org that never bought in. */
const NO_SUBSCRIPTION: SubscriptionView = {
  row: null,
  status: "canceled",
  plan: "personal",
  seats: 1,
  interval: "month",
  businessActive: false,
  // Deliberately NOT framed as a failure. This is the normal state of the free
  // tier, and the copy must never read like an error.
  reason: null,
  entitlements: [],
  trial: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  nextBillingDate: null,
  isPastDue: false,
};

export function viewOf(row: SubscriptionRow | null, now = new Date()): SubscriptionView {
  if (!row) return NO_SUBSCRIPTION;

  const trialEndsAt = row.trialEndsAt;
  const trialExpired =
    row.status === "trialing" && trialEndsAt !== null && trialEndsAt.getTime() <= now.getTime();

  let businessActive: boolean;
  let reason: string | null = null;

  if (trialExpired) {
    businessActive = false;
    reason =
      "Your team's 30-day Business trial has ended. Add a payment method to restore team features. " +
      "Every member's local XR keeps working exactly as before — team features are the only thing that stopped.";
  } else if (row.status === "canceled") {
    businessActive = false;
    reason =
      "Your team's Business subscription was cancelled. Team features are off. " +
      "Your local data and workspaces are untouched, and you can export team memory and audit logs before they are purged.";
  } else if (row.status === "unpaid") {
    businessActive = false;
    reason =
      "Stripe gave up retrying your payment. Update the payment method to restore team features. " +
      "Local XR is unaffected.";
  } else if (row.status === "incomplete") {
    businessActive = false;
    reason =
      "Checkout was not completed, so there is no active subscription yet. " +
      "Restart checkout from the Billing page — your organization and members are already set up and nothing was lost.";
  } else {
    businessActive = true;
    if (row.status === "past_due") {
      reason =
        "Your last payment did not go through. Team features stay on while Stripe retries — update your payment method to stop the retries.";
    }
  }

  const entitlements = businessActive ? featuresForStatus(row.status) : [];

  return {
    row,
    status: row.status,
    plan: row.plan,
    seats: row.seats,
    interval: row.interval,
    businessActive,
    reason,
    entitlements,
    trial:
      row.status === "trialing" && trialEndsAt
        ? { active: !trialExpired, endsAt: trialEndsAt, daysLeft: daysUntil(trialEndsAt, now) }
        : null,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    // While trialing there is no next charge; the period end is the trial end.
    nextBillingDate:
      row.status === "trialing"
        ? trialExpired
          ? null
          : trialEndsAt
        : row.cancelAtPeriodEnd
          ? null
          : row.currentPeriodEnd,
    isPastDue: row.status === "past_due",
  };
}

export async function loadSubscription(deps: AppDeps, orgId: string): Promise<SubscriptionView> {
  const rows = await deps.db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
  return viewOf(rows[0] ?? null, deps.clock());
}

/** One-line status for the desktop header. Never used to gate anything. */
export function describe(view: SubscriptionView): string {
  if (!view.row) return "Personal — free forever, local-first";
  if (view.trial?.active) {
    return `Business Pro · trial — ${view.trial.daysLeft} day${view.trial.daysLeft === 1 ? "" : "s"} left`;
  }
  switch (view.status) {
    case "active":
      return view.cancelAtPeriodEnd && view.currentPeriodEnd
        ? `Business Pro · cancels ${humanInterval(view.currentPeriodEnd)}`
        : `Business Pro · renews ${view.currentPeriodEnd ? humanInterval(view.currentPeriodEnd) : "automatically"}`;
    case "past_due":
      return "Business Pro · payment failed, retrying";
    case "trialing":
      return "Business Pro · trial ended";
    case "canceled":
      return "Personal — Business subscription cancelled";
    default:
      return "Personal — Business subscription inactive";
  }
}
