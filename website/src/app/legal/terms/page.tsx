import { Metadata } from "next";
import Link from "next/link";

import { businessPricing } from "@/lib/native";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms for the XR hosted service: what you may do, what we promise, what we do not, and how cancellation works.",
};

const EFFECTIVE = "14 October 2026";

/**
 * `/legal/terms`.
 *
 * The scope split is the most important thing on this page. XR ships local
 * software under MIT and a hosted service under these terms, and conflating them
 * would let a reader believe the terms reach the software on their disk. They do
 * not, and the first section says so in a sentence rather than a cross-reference.
 */
export default function TermsPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-3xl px-6 pt-36 pb-24">
        <p className="text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Legal</p>
        <h1 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-native-text">
          Terms of service
        </h1>
        <p className="console-mono mt-4 text-[11.5px] text-native-text-dim">
          Effective {EFFECTIVE} · governs the hosted service at api.xr.rrrtx.ai
        </p>

        <div className="mt-10 rounded-xl border border-native-cyan/25 bg-native-bg-elevated/60 p-6">
          <p className="text-[13px] leading-relaxed text-native-text">
            <strong className="font-medium">The short version.</strong> The XR software you download is
            licensed under MIT and these terms do not apply to it — no clause here can restrict what you do
            with software you already have. These terms govern only the hosted service: accounts, teams,
            billing, SSO, the relay and team memory. Use it lawfully, pay for Business seats if you use them,
            and you can leave whenever you like and take your data with you.
          </p>
        </div>

        <Section title="1. Two things, two licences">
          <p>
            <strong>The local software.</strong> XR is released under the MIT licence. You may run it, modify
            it, redistribute it and use it commercially. Nothing in this document narrows that grant, and
            nothing in this document is a condition of it.
          </p>
          <p>
            <strong>The hosted service.</strong> The account, team and billing service that powers the
            Business tier is a service, not software you own, and it is governed by these terms. Self-hosting
            is supported: if you run the control plane yourself, these terms do not apply to your deployment
            either.
          </p>
        </Section>

        <Section title="2. Your account">
          <p>
            You need an account to create a team. You are responsible for what happens under it, including by
            members you invite. Give us accurate information and keep your credentials to yourself; if you
            believe a session has been compromised, revoke it from Settings — the revoke is immediate.
          </p>
          <p>
            By creating an account you confirm that you are at least 13, and at least 18 where the law
            sets the threshold there — in India under the DPDP Act, and everywhere for holding a Business
            account in your own name — or that you have a guardian&rsquo;s consent. One person, one account.
            Service accounts for automation are fine. The hosted service is not offered in jurisdictions
            subject to comprehensive international sanctions.
          </p>
        </Section>

        <Section title="3. Business subscriptions and billing">
          <ul>
            <li>
              <strong>Price.</strong> ${businessPricing.seatMonthlyUsd} per user per month, or $
              {businessPricing.seatAnnualUsd} per user per year. Prices are in USD and exclude tax, which may
              be added at checkout depending on where you are.
            </li>
            <li>
              <strong>Trial.</strong> {businessPricing.trialDays} days, up to {businessPricing.trialMaxSeats}{" "}
              seats, no payment method required. Converting to paid requires a card. We do not ask for one
              during the trial, and we do not auto-charge at the end of it — if you do nothing, the
              subscription simply stops and no invoice exists.
            </li>
            <li>
              <strong>Seats.</strong> You are billed for active members. Removing a member stops the charge
              for them at the next billing period; adding one is prorated immediately. Seats cannot be set
              below your current active member count, because that would mean deciding which of your
              colleagues to evict.
            </li>
            <li>
              <strong>Changes and cancellation.</strong> Upgrade, downgrade or cancel from the console, no
              email required. Cancelling takes effect at the end of the paid period; you keep what you paid
              for and then it stops. There is no cancellation fee and no retention call.
            </li>
            <li>
              <strong>Refunds.</strong> The{" "}
              <Link href="/refund" className="text-native-cyan hover:underline">
                refund policy
              </Link>{" "}
              is part of these terms. In short: a 14-day money-back guarantee on your first charge, and if
              we failed to provide the service we refund the unused portion without an argument. Outside
              those cases the current period is not refunded — but you can cancel and be charged nothing
              more.
            </li>
            <li>
              <strong>Failed payments.</strong> Stripe retries automatically. Team features keep working
              during the retry window rather than switching off on the first failure. Nothing on anyone&rsquo;s
              local machine is affected at any point.
            </li>
            <li>
              <strong>Price changes.</strong> 30 days&rsquo; notice by email to owners, never mid-period, and
              never retroactive. You may cancel before the new price applies.
            </li>
          </ul>
        </Section>

        <Section title="4. Acceptable use">
          <p>Do not use the hosted service to:</p>
          <ul>
            <li>break the law, or to build something whose purpose is to break the law;</li>
            <li>
              send bulk unsolicited mail through our transactional email path — invitations exist to invite
              people, and the rate limits will stop you anyway;
            </li>
            <li>
              attempt to access another organization&rsquo;s data, including by probing endpoints outside your
              role — this is what the audit log records;
            </li>
            <li>
              circumvent the seat count by sharing one account among colleagues. It is cheaper to email us; we
              have never refused a genuinely small team a discount.
            </li>
          </ul>
          <p>
            <strong>Copyright.</strong> If your work appears in the hosted service without permission,
            send a takedown notice under our{" "}
            <Link href="/legal/dmca" className="text-native-cyan hover:underline">
              DMCA policy
            </Link>
            . We act on valid notices and accept counter-notices. Designated agent: to be registered with
            the US Copyright Office at launch; email{" "}
            <a href="mailto:dmca@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              dmca@xr.rrrtx.ai
            </a>
            .
          </p>
          <p>
            Security research is explicitly permitted and encouraged. Report it through{" "}
            <a href="mailto:security@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              security@xr.rrrtx.ai
            </a>{" "}
            and we will treat good-faith testing as authorised, which is a formal statement and not a
            pleasantry.
          </p>
        </Section>

        <Section title="5. Your data, and ours">
          <p>
            <strong>Yours stays yours.</strong> You keep all rights to the content your team puts into the
            service. We claim no licence over it beyond what is needed to operate the service for you — which
            in practice means storing it, encrypting it, syncing it between the devices you authorise, and
            processing it when you ask for an export.
          </p>
          <p>
            <strong>We never train on it.</strong> No exception for &ldquo;aggregated&rdquo; or &ldquo;de-identified&rdquo;
            data, because a clause with that exception in it is how the first sentence becomes false.
          </p>
          <p>
            <strong>Ours.</strong> The XR name, the logo and the hosted service are ours. The MIT licence
            covers the source; it does not grant trademark rights, which is what stops someone selling a
            modified build as XR.
          </p>
        </Section>

        <Section title="6. What we promise, and what we do not">
          <p>
            <strong>We promise:</strong> to keep the service available to a commercially reasonable standard;
            to give 30 days&rsquo; notice before discontinuing it, with a full export path and no data hostage-taking;
            to tell you about a breach affecting your data within 72 hours of confirming it; and to never
            remotely disable or degrade the software on your machine.
          </p>
          <p>
            <strong>We do not promise</strong> that the service will be uninterrupted or error-free, or that
            model output will be accurate. Managed models are provided by third parties and their output is
            theirs — do not rely on it for legal, medical or financial decisions without a human checking it.
          </p>
          <p>
            <strong>Liability.</strong> To the extent the law allows, our total liability is capped at what
            you paid us in the twelve months before the claim. We are not liable for indirect or consequential
            loss. Nothing here limits liability that cannot be limited: death, personal injury, fraud, or
            anything else a jurisdiction refuses to let a contract waive.
          </p>
          <p>
            <strong>Indemnification (Business).</strong> You will indemnify XR against claims, damages and
            reasonable legal costs arising from your content, your users&rsquo; use of the service, or your
            breach of these terms — except where the claim was caused by our own breach.
          </p>
        </Section>

        <Section title="7. Ending it">
          <p>
            You can cancel and delete your account at any time from the console. We may suspend an account for
            a material breach of section 4, and we will tell you which clause and give you a chance to fix it
            unless the breach is actively harming someone. If we terminate your account for our own
            convenience, you get a pro-rata refund of the unused period, automatically.
          </p>
          <p>
            On termination, the retention and purge schedule in the{" "}
            <Link href="/legal/privacy" className="text-native-cyan hover:underline">
              privacy policy
            </Link>{" "}
            applies: 30 days of exportable data, then deletion. The software on your machine is unaffected —
            it was never contingent on the subscription.
          </p>
        </Section>

        <Section title="8. Changes and governing law">
          <p>
            We will give 30 days&rsquo; notice by email before material changes take effect, and the full version
            history lives in the public repository. These terms are governed by the laws of England and Wales,
            and disputes go to the courts of that jurisdiction — a choice made for neutrality rather than
            convenience, since neither party is likely to be located there.
          </p>
        </Section>

        <div className="mt-14 rounded-xl border border-native-border bg-native-bg-elevated/50 p-6">
          <p className="text-[12.5px] leading-relaxed text-native-text-muted">
            Contract questions, DPAs and security questionnaires:{" "}
            <a href="mailto:legal@xr.rrrtx.ai" className="console-mono text-native-cyan hover:underline">
              legal@xr.rrrtx.ai
            </a>
            . {site.name} is open-source software; these terms cover the hosted service it can optionally use.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-[15px] font-semibold text-native-text">{title}</h2>
      <div className="mt-3 space-y-3.5 text-[13px] leading-relaxed text-native-text-muted [&_li]:leading-relaxed [&_strong]:font-medium [&_strong]:text-native-text [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
