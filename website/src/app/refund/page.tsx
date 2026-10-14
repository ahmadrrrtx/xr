import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Refund Policy",
  description: "14-day money-back guarantee on new XR Business subscriptions, and how to ask.",
};

/**
 * `/refund` (Phase 31 · Bucket B · B4). Referenced from the terms of service;
 * the short version there and the full version here must never disagree.
 * XR Personal is free — there is nothing to refund — so this page is about
 * Business subscriptions only.
 */
export default function RefundPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Refund Policy" subtitle="Last updated: October 13, 2026" />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl px-6 text-zinc-300 leading-relaxed space-y-5">
          <h2 className="text-xl font-semibold text-white pt-4">The short version</h2>
          <p>
            New Business subscriptions carry a <strong className="text-white">14-day money-back
            guarantee</strong> on the first charge. If XR is not for you, email us within 14 days of that
            first payment and we refund it in full — no exit interview, no retention flow.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Trials</h2>
          <p>
            Business starts with a 30-day free trial with no credit card required up front. A card is only
            needed if you choose to convert to a paid plan. If you do nothing, the trial simply ends and
            no charge exists to refund.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Annual plans and renewals</h2>
          <p>
            Annual subscriptions can be refunded on a prorated basis within 30 days of a renewal charge.
            After that window the current period is not refundable. Partial months are not refunded on
            monthly plans; cancelling stops the next charge and the plan runs to the end of the billing
            cycle you already paid for.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">How to request a refund</h2>
          <p>
            Email{" "}
            <a className="text-violet-300 hover:underline" href="mailto:billing@xr.rrrtx.ai">
              billing@xr.rrrtx.ai
            </a>{" "}
            from the email address registered on the account, and include your organization name and the
            reason — the reason helps us fix things, but it does not decide whether the guarantee applies.
            We respond within 7 business days, and approved refunds go back to the original payment method
            via Stripe.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Exceptions</h2>
          <p>
            We do not refund accounts terminated for violating the{" "}
            <Link className="text-violet-300 hover:underline" href="/legal/terms">
              terms of service
            </Link>
            . If a charge looks wrong, contact us before disputing it with your bank: a chargeback costs
            everyone a fee and usually takes longer than an email. Fraudulent chargebacks will result in
            account suspension.
          </p>
        </article>
      </section>
    </>
  );
}
