import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Imprint",
  description:
    "Imprint and legal notice: who publishes this website, the registered office, how to reach us, and the grievance officer named under India's DPDP Act.",
};

/**
 * `/imprint` (fix-program Phase 1.4 · P2-10) — the second live 404 in the
 * finding. Every value on this page is reused verbatim from the identity
 * Phase 1.1 published on the privacy page and the footer (entity, office,
 * contacts, DPDP grievance officer); the new-page test asserts that equality
 * cross-file. No new legal facts are stated here — no registration numbers,
 * VAT IDs, jurisdiction clauses or representative claims beyond what the
 * site already publishes. The page answers "who are you and how do I reach
 * you"; it is not a legal submission.
 */
export default function ImprintPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Imprint and legal notice
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-native-text-muted">
          Who publishes this site, and how to reach us. The values below are the same ones printed in the
          privacy policy and every page footer.
        </p>

        <div className="mt-12 space-y-px overflow-hidden rounded-xl border border-native-border bg-native-border">
          <div className="bg-native-bg px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-native-text-dim">Publisher</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-native-text">
              Published by Muhammad Ahmad · XR RRRTX Labs
            </p>
          </div>
          <div className="bg-native-bg px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-native-text-dim">Registered office</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-native-text">
              Remote-first · Chiniot, Punjab, Pakistan
            </p>
          </div>
          <div className="bg-native-bg px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-native-text-dim">Contact</div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-native-text-muted">
              General and support:{" "}
              <a href="mailto:support@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
                support@xr.rrrtx.ai
              </a>
              <br />
              Privacy and data rights:{" "}
              <a href="mailto:privacy@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
                privacy@xr.rrrtx.ai
              </a>{" "}
              (for &ldquo;Data Rights Request&rdquo; matters, see the{" "}
              <Link href="/legal/privacy" className="text-native-cyan hover:underline">privacy policy</Link>)
            </p>
          </div>
          <div className="bg-native-bg px-5 py-4">
            <div className="text-[12px] uppercase tracking-[0.12em] text-native-text-dim">
              Grievance officer — India (DPDP)
            </div>
            <p className="mt-1.5 text-[14px] leading-relaxed text-native-text-muted">
              Grievance officer: Muhammad Ahmad, ahmadrrrtx333@gmail.com, Remote-first · Chiniot, Punjab,
              Pakistan, available 24 hr.
            </p>
          </div>
        </div>

        <p className="mt-8 text-[12.5px] leading-relaxed text-native-text-muted">
          The documents that govern the hosted service:{" "}
          <Link href="/legal/privacy" className="text-native-cyan hover:underline">privacy policy</Link>
          {" "}· <Link href="/legal/terms" className="text-native-cyan hover:underline">terms of service</Link>
          {" "}· <Link href="/legal/notices" className="text-native-cyan hover:underline">third-party notices</Link>.
          This page adds nothing beyond them; it states who we are and how to reach us.
        </p>
      </div>
    </div>
  );
}
