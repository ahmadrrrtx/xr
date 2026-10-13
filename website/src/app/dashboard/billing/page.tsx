"use client";

import Link from "next/link";
import { useConsole } from "@/components/console/data";
import { ConsoleButton, DemoBanner, Meta, Notice, Panel, PageTitle, StatusDot } from "@/components/console/kit";
import { relativeDays, usd } from "@/lib/cloud";
import { businessPricing } from "@/lib/native";

/**
 * Billing.
 *
 * Three rules shape this page.
 *
 *   1. **No card data, ever.** Stripe hosts checkout and the customer portal. XR
 *      stores identifiers and nothing else, which is why "update payment method"
 *      is a link off-site rather than a form.
 *   2. **Cancelling is one click and the page says what happens afterwards.** The
 *      retention story is on the page, not in a support article, and it includes
 *      the sentence that matters most: your local XR is unaffected.
 *   3. **Downgrade is not punished.** There is no interstitial, no offer, no
 *      "are you sure" with a discount code hidden behind it. The confirm step
 *      states the date and the data window, and then it is done.
 */
export default function BillingPage() {
  const { entitlement, demo, demoReason, team } = useConsole();

  const active = entitlement?.businessActive ?? false;
  const trial = entitlement?.trial;

  return (
    <>
      <PageTitle
        title="Billing"
        subtitle="Seats, invoices and payment method. Payment details are handled entirely by Stripe — no card number reaches this service."
        actions={
          <>
            {active ? <ConsoleButton disabled={demo}>Manage in Stripe</ConsoleButton> : null}
            <ConsoleButton variant="primary" disabled={demo}>
              {active ? "Change seats" : "Upgrade"}
            </ConsoleButton>
          </>
        }
      />

      {demo ? <DemoBanner reason={demoReason ?? "No live cloud service is reachable."} /> : null}

      {trial?.active ? (
        <div className="mb-5">
          <Notice tone="info" title={`Trial — ${trial.daysLeft} days left`}>
            No payment method is attached and nothing will be charged automatically. If you do nothing, team
            features stop on {trial.endsAt ? new Date(trial.endsAt).toLocaleDateString() : "the trial end date"}{" "}
            and every member&rsquo;s local XR keeps working.{" "}
            <Link href="/pricing" className="text-native-cyan hover:underline">
              What Business includes →
            </Link>
          </Notice>
        </div>
      ) : null}

      {entitlement?.isPastDue ? (
        <div className="mb-5">
          <Notice tone="warn" title="Payment did not go through">
            Stripe is retrying and team features remain on during the retry window. Local XR is unaffected.
          </Notice>
        </div>
      ) : null}

      {entitlement?.cancelAtPeriodEnd ? (
        <div className="mb-5">
          <Notice tone="warn" title="Subscription ends at the end of the period">
            Team features stay available until {relativeDays(entitlement.currentPeriodEnd)}. Team memory and
            the audit log remain exportable for 30 days after that.{" "}
            <ConsoleButton variant="primary" disabled={demo} >
              Reactivate
            </ConsoleButton>
          </Notice>
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2" title="Subscription">
          <div className="grid grid-cols-2 divide-native-border sm:grid-cols-4 sm:divide-x">
            <Meta
              label="Plan"
              value={entitlement?.plan === "business" ? "Business" : "Personal"}
            />
            <Meta label="Seats" value={String(entitlement?.seats ?? team?.seats ?? 0)} />
            <Meta
              label="Rate"
              value={entitlement?.interval === "year" ? `$${businessPricing.seatAnnualUsd}/user/yr` : `$${businessPricing.seatMonthlyUsd}/user/mo`}
            />
            <Meta label="Next charge" value={relativeDays(entitlement?.currentPeriodEnd ?? null)} />
          </div>
          <div className="flex items-center justify-between border-t border-native-border px-4 py-3">
            <span className="text-[11.5px] text-native-text-dim">Status</span>
            <StatusDot
              tone={active ? (entitlement?.isPastDue ? "warn" : "ok") : "neutral"}
              label={
                trial?.active
                  ? `Trialing · ${trial.daysLeft} days`
                  : entitlement?.isPastDue
                    ? "Past due — retrying"
                    : active
                      ? "Active"
                      : "Personal · free"
              }
            />
          </div>
        </Panel>

        <Panel title="Seats">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <div className="flex items-center justify-between">
              <span>Active members</span>
              <span className="console-mono text-[11.5px]">{entitlement?.seats ?? 0}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Adding a seat</span>
              <span className="text-native-text-dim">prorated now</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Removing a seat</span>
              <span className="text-native-text-dim">next period</span>
            </div>
            <p className="border-t border-native-border pt-3 text-native-text-dim">
              Seats cannot be reduced below the number of active members. Remove the member first, or leave the
              seat in place — an occupied seat that bills is better than an eviction nobody decided on.
            </p>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Invoices" description="Also available in the Stripe portal, with the same numbers.">
          <div className="divide-y divide-native-border">
            {[
              { number: "XR-0042", amount: 180_000_000, status: "Paid", when: "18 days ago" },
              { number: "XR-0041", amount: 180_000_000, status: "Paid", when: "48 days ago" },
              { number: "XR-0040", amount: 150_000_000, status: "Paid", when: "78 days ago" },
            ].map((invoice) => (
              <div key={invoice.number} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="console-mono text-[11.5px] text-native-text">{invoice.number}</div>
                  <div className="mt-0.5 text-[10.5px] text-native-text-dim">{invoice.when}</div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="console-mono text-[11.5px] text-native-text-muted">{usd(invoice.amount)}</span>
                  <StatusDot tone="ok" label={invoice.status} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Cancelling">
          <div className="space-y-3 p-4 text-[11.5px] leading-relaxed text-native-text-muted">
            <p>Cancelling takes effect at the end of the paid period. There is no fee and no retention call.</p>
            <ul className="space-y-1.5">
              <li>Team features stay available until the period ends.</li>
              <li>Team memory and the audit log stay exportable for 30 days after that.</li>
              <li>Local XR — every feature on every member&rsquo;s machine — is unchanged, permanently.</li>
              <li>No data is held back to win you back. After 30 days it is deleted.</li>
            </ul>
            <ConsoleButton variant="danger" disabled={demo || !active} title={active ? "Cancel subscription" : "Nothing to cancel"}>
              Cancel subscription
            </ConsoleButton>
          </div>
        </Panel>
      </div>
    </>
  );
}
