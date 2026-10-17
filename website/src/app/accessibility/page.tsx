import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Accessibility",
  description:
    "Accessibility statement: what XR checks automatically in CI on every change, which human passes are still pending, and how to report a problem.",
};

const REPO = "https://github.com/ahmadrrrtx/xr/blob/main";

/**
 * `/accessibility` (fix-program Phase 1.4 · P2-10) — this route was linked in
 * spirit by the product's Art.-X honesty rule but returned a live 404.
 *
 * Content decision: this is a scoped statement (option i) describing the
 * Control Center surfaces that the CI record in `docs/a11y/CONFORMANCE.md`
 * actually covers, with the human passes stated as pending. A site-wide
 * WCAG conformance claim (option ii) was rejected: no such evidence exists
 * for this marketing site or the desktop app, and Constitution Art. X —
 * plus CONFORMANCE.md's own words — forbid a claim automation alone cannot
 * carry. W3C/WAI statement components followed: scope, conformance status,
 * assessment approach, feedback route.
 */
export default function AccessibilityPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Accessibility</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Accessibility statement
        </h1>
        <p className="mt-5 text-[14px] leading-relaxed text-native-text-muted">
          XR targets <strong className="text-native-text">WCAG 2.2 Level AA</strong> for the product&rsquo;s
          Control Center. Today&rsquo;s status, in the register&rsquo;s own words, is{" "}
          <span className="console-mono text-native-cyan">automated-verified · manual-pass-pending-human</span>.
          The governing record is{" "}
          <a
            href={`${REPO}/docs/a11y/CONFORMANCE.md`}
            target="_blank"
            rel="noreferrer"
            className="text-native-cyan hover:underline"
          >
            docs/a11y/CONFORMANCE.md
          </a>{" "}
          in the public repository: nothing there or here claims conformance from automation alone, and no human
          result was synthesized by an agent. This page states what is verified, what is pending, and how to
          reach us — it is a status report, not a conformance claim.
        </p>

        <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.14em] text-native-text">
          Scope of this statement
        </h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-native-text-muted">
          The evidence covers the product&rsquo;s <strong className="text-native-text">Control Center</strong>
          {" "}— the dashboard shell, every panel, the command palette, toasts, and the sign-in page served by
          your self-hosted daemon. This marketing website and the desktop application are{" "}
          <strong className="text-native-text">not</strong> covered by that record; no equivalent verified
          result exists for them, and none is claimed here.
        </p>

        <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.14em] text-native-text">
          What is verified — automatically, in CI, on every change
        </h2>
        <ul className="mt-2.5 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-native-text-muted">
          <li>
            An <a href={`${REPO}/test/a11y/browser-axe.test.ts`} target="_blank" rel="noreferrer" className="console-mono text-native-cyan hover:underline">axe-core sweep</a>{" "}
            with zero violations (tags <span className="console-mono">wcag2a</span>,{" "}
            <span className="console-mono">wcag2aa</span>, <span className="console-mono">wcag21aa</span>,{" "}
            <span className="console-mono">wcag22aa</span>) over the sign-in page, the dashboard shell, and
            every panel.
          </li>
          <li>
            <a href={`${REPO}/test/a11y/contrast.test.ts`} target="_blank" rel="noreferrer" className="console-mono text-native-cyan hover:underline">Computed-contrast checks</a>{" "}
            — every text token at least 4.5:1 against its surface, UI boundaries at least 3:1.
          </li>
          <li>
            <a href={`${REPO}/test/a11y/static.test.ts`} target="_blank" rel="noreferrer" className="console-mono text-native-cyan hover:underline">Structural contracts</a>{" "}
            — skip link first, one <span className="console-mono">&lt;main&gt;</span>, labelled navigation and
            inputs, dialog semantics, live regions, 24px targets, reduced-motion handling.
          </li>
          <li>
            The{" "}
            <a href={`${REPO}/test/a11y/auth-server.test.ts`} target="_blank" rel="noreferrer" className="console-mono text-native-cyan hover:underline">server auth contract</a>{" "}
            (browsers get an accessible page; API callers get JSON).
          </li>
          <li>Real keyboard flows driven through a real browser — skip-to-main, focus sync, palette trap and escape.</li>
        </ul>

        <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.14em] text-native-text">
          What is pending — stated as pending
        </h2>
        <ul className="mt-2.5 list-disc space-y-2 pl-5 text-[14px] leading-relaxed text-native-text-muted">
          <li>
            A human <strong className="text-native-text">screen-reader pass</strong> (NVDA / VoiceOver / Orca):
            no human assistive-technology pass has been performed on the current build and none is claimed. The
            procedure is written and ready in{" "}
            <a href={`${REPO}/docs/a11y/MANUAL-TESTING.md`} target="_blank" rel="noreferrer" className="text-native-cyan hover:underline">MANUAL-TESTING.md</a>
            , and a human re-walk is prescribed per release.
          </li>
          <li>
            Human passes for <strong className="text-native-text">200% zoom, text-spacing, and forced-colors</strong>{" "}
            (the reduced-motion rule itself is machine-verified present).
          </li>
        </ul>

        <h2 className="mt-12 text-[13px] font-semibold uppercase tracking-[0.14em] text-native-text">
          Report an accessibility problem
        </h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-native-text-muted">
          Email{" "}
          <a href="mailto:support@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
            support@xr.rrrtx.ai
          </a>{" "}
          with the page or screen, what you tried, and what happened. Accessibility reports go to the same
          place as everything else — there is no separate mailbox to keep honest.
        </p>

        <div className="mt-12 rounded-xl border border-native-border bg-native-bg-elevated/50 p-6">
          <p className="text-[12.5px] leading-relaxed text-native-text-muted">
            If you also need the legal documents: <Link href="/legal/privacy" className="text-native-cyan hover:underline">privacy policy</Link>
            {" "}· <Link href="/legal/terms" className="text-native-cyan hover:underline">terms</Link>
            {" "}· <Link href="/imprint" className="text-native-cyan hover:underline">imprint</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
