import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "Every cookie and browser storage entry XR uses — essential only, no tracking.",
};

/**
 * `/cookies` (Phase 31 · Bucket B · B3). The honest inventory: this site is
 * static and sets nothing; the entries below exist only once you sign in to
 * the Business dashboard or check out. If the inventory grows, this page
 * grows in the same pull request — a cookie we set but do not list here
 * would be a bug, not a marketing choice.
 */
export default function CookiesPage() {
  return (
    <>
      <PageHeader eyebrow="Legal" title="Cookie Policy" subtitle="Last updated: October 13, 2026" />
      <section className="pb-24">
        <article className="mx-auto max-w-3xl px-6 text-zinc-300 leading-relaxed space-y-5">
          <h2 className="text-xl font-semibold text-white pt-4">What cookies are</h2>
          <p>
            A cookie is a small piece of text a website asks your browser to store and send back on later
            visits. Cookies can remember a sign-in, or they can follow you across the web. We only use the
            first kind. Some preferences below live in <em>localStorage</em> instead — those never leave
            your browser at all, and we list them anyway, because the point of this page is the whole
            inventory, not a narrow legal reading.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">What we set</h2>
          <p>
            <strong className="text-white">xr_session</strong> — a cookie, HttpOnly, Secure, SameSite=Lax.
            Essential. Set only after you sign in to the Business web dashboard; it keeps you signed in and
            binds the session to your account. It contains no tracking identifier and is deleted on
            sign-out or expiry.
          </p>
          <p>
            <strong className="text-white">__stripe_*</strong> — cookies set by Stripe, on checkout pages
            only. They are part of payment processing (fraud prevention and remembering where you were in
            the checkout). We never see their values and do not set them ourselves.
          </p>
          <p>
            <strong className="text-white">xr_cookie_ack</strong> — localStorage, not a cookie. Remembers
            that you dismissed the cookie banner at the bottom of this site, so it does not return on every
            page. It holds the single value &ldquo;1&rdquo;.
          </p>
          <p>
            <strong className="text-white">Interface preferences</strong> — localStorage, not cookies.
            Theme, density, and sidebar choices, where you set them, so the interface looks the way you
            left it. Nothing about them leaves the device.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">What we do not use</h2>
          <p>
            We do <strong className="text-white">not</strong> use analytics cookies, advertising cookies,
            third-party tracking cookies, or session-replay tools. There is no Google Analytics, no Tag
            Manager, no Hotjar, no FullStory, no PostHog on this site or in the app. The{" "}
            <Link className="text-violet-300 hover:underline" href="/legal/privacy">
              privacy policy
            </Link>{" "}
            explains the wider rule: XR Personal collects nothing, and Business collects only what
            billing, accounts, and team sync need.
          </p>

          <h2 className="text-xl font-semibold text-white pt-4">Controlling cookies</h2>
          <p>
            Your browser lets you block or delete cookies and localStorage at any time (Settings → Privacy
            in every major browser). Deleting them signs you out and resets interface preferences — nothing
            else; your XR data lives on your machine or in your Business account, not in cookies. Blocking
            the essential cookies above will prevent sign-in and checkout from working, which is precisely
            what they are for.
          </p>
        </article>
      </section>
    </>
  );
}
