import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Terms of Service" subtitle="Last updated: July 8, 2026" />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl px-6 text-zinc-300 leading-relaxed space-y-5">
          <p>These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of XR websites, products, and services.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Your account</h2>
          <p>You are responsible for safeguarding your account and for any activity under your account. You must be at least 13 years old to use XR.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Acceptable use</h2>
          <p>You agree not to misuse XR, interfere with the service, or violate applicable laws. Do not attempt to circumvent security, rate limits, or access controls.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Intellectual property</h2>
          <p>The XR core runtime is open-source under the MIT license. Cloud services, hosted models, and XR trademarks are proprietary. You retain rights to the code and content you create using XR.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Subscriptions &amp; billing</h2>
          <p>Paid plans renew automatically until canceled. Cancel anytime from your account settings. Fees are non-refundable except as required by law.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Disclaimers</h2>
          <p>XR is provided &ldquo;as is&rdquo; without warranties of any kind. AI-generated output can be incorrect; review all code and actions before use in production.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Contact</h2>
          <p>Questions? Email <a className="text-violet-300 hover:underline" href="mailto:legal@xr.dev">legal@xr.dev</a>.</p>
        </article>
      </section>
    </>
  );
}
