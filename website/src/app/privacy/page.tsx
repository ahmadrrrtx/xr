import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Privacy Policy" subtitle="Last updated: July 8, 2026" />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl px-6 text-zinc-300 leading-relaxed space-y-5">
          <p>This Privacy Policy describes how XR Labs, Inc. (&ldquo;XR&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and shares information when you use our website, products, and services.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Information we collect</h2>
          <p>We collect information you provide directly &mdash; such as your name, email, and payment information when you sign up. We also collect limited technical data to operate the service: version, platform, and crash reports.</p>
          <h2 className="text-xl font-semibold text-white pt-4">How we use information</h2>
          <p>To provide, maintain, and improve XR; to process payments; to send product updates; to detect abuse and security incidents; and to comply with legal obligations.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Your code and content</h2>
          <p>Your code, prompts, and session content are not used to train our models or third-party models unless you explicitly opt in. Enterprise customers can enforce data residency and zero-retention policies.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Sharing</h2>
          <p>We do not sell personal information. We share data with vendors that help us operate (hosting, billing, support) under strict contractual obligations.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Your rights</h2>
          <p>You can access, correct, or delete your data at any time. Contact privacy@xr.dev to exercise these rights.</p>
          <h2 className="text-xl font-semibold text-white pt-4">Contact</h2>
          <p>Questions? Email <a className="text-violet-300 hover:underline" href="mailto:privacy@xr.dev">privacy@xr.dev</a>.</p>
        </article>
      </section>
    </>
  );
}
