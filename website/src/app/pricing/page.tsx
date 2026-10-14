import { Metadata } from "next";
import Link from "next/link";
import { Check, ArrowRight, Minus } from "lucide-react";

import { businessAdds, businessPricing, personalIncludes } from "@/lib/native";
import { PricingPlans } from "@/components/PricingPlans";
import { faqs, pricingPlans } from "@/lib/data";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "XR is free forever, fully functional, no account required. Business is $15/user/month for team admin, managed models, SSO, relay and audit export.",
};

/**
 * `/pricing`.
 *
 * Structure follows the claim. The free tier is presented first and at full
 * width because it is the honest default — most people who land here should
 * conclude they owe nothing. Business is one card. Enterprise is a sentence.
 *
 * The "what is actually different" table exists because the single most common
 * misunderstanding about a free tier is that it is a soft-crippled version of the
 * paid one. A table that lists six hosted services, each of which is a *thing a
 * server does*, makes that impossible to misread. There is deliberately no row
 * with a cross in the Personal column.
 */
export default function PricingPage() {
  return (
    <div className="native-bg min-h-screen">
      <div className="mx-auto max-w-6xl px-6 pt-36 pb-24">
        {/* ── header ─────────────────────────────────────────────────────── */}
        <div className="text-center">
          <div className="mx-auto h-16 w-16 orb" aria-hidden />
          <p className="mt-8 text-[11px] uppercase tracking-[0.2em] text-native-cyan/80">Pricing</p>
          <h1 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-native-text">
            Free forever. Paid only if you have a team.
          </h1>
          <p className="mt-5 mx-auto max-w-2xl text-[15px] leading-relaxed text-native-text-muted">
            XR is a local-first agent runtime. Everything it does on your own machine is free, with no
            account, no seat count and no feature gates. The Business tier exists because running a
            control plane for somebody else costs money — not because we held something back.
          </p>
        </div>

        {/* ── plans (client island: billing toggle, Phase 31 · C13) ─────────── */}
        <PricingPlans />

        {/* ── the six things ─────────────────────────────────────────────── */}
        <div className="mt-24">
          <h2 className="text-2xl font-semibold tracking-tight text-native-text">
            What Business actually adds
          </h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-native-text-muted">
            Six things. Every one is a service that runs on our infrastructure, which is why it shows up on
            a bill. None of them is a switch we could have flipped in the free build.
          </p>

          <div className="mt-8 grid gap-px overflow-hidden rounded-xl border border-native-border bg-native-border md:grid-cols-3">
            {businessAdds.map((item) => (
              <div key={item.name} className="bg-native-bg-elevated p-6">
                <div className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-native-cyan" />
                  <span className="text-[13px] font-medium text-native-text">{item.name}</span>
                </div>
                <p className="mt-2.5 text-[12.5px] leading-relaxed text-native-text-muted">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── what stays free ────────────────────────────────────────────── */}
        <div className="mt-20 rounded-xl border border-native-border bg-native-bg-elevated/50 p-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-lg font-semibold text-native-text">Included in Personal, forever</h2>
            <span className="text-[11px] uppercase tracking-wider text-native-text-dim">
              no account required
            </span>
          </div>
          <ul className="mt-6 grid gap-x-8 gap-y-3 md:grid-cols-2">
            {personalIncludes.map((item) => (
              <li key={item} className="flex items-start gap-2.5 text-[13px] leading-snug text-native-text-muted">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-native-cyan/70" />
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-7 flex items-start gap-2.5 border-t border-native-border pt-6 text-[12.5px] leading-relaxed text-native-text-dim">
            <Minus className="mt-0.5 h-4 w-4 shrink-0 text-native-text-dim" />
            <p>
              There is no row missing from this list. If you are looking for the feature we gated to make
              you pay, there is not one — a functional local XR that only worked while it could reach our
              servers would be worth less than the one you already have.
            </p>
          </div>
        </div>

        {/* ── compare (Phase 31 · C13) ─────────────────────────────────────── */}
        <div className="mt-20">
          <h2 className="text-2xl font-semibold tracking-tight text-native-text">Compare plans</h2>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-native-text-muted">
            The Personal column has no missing rows. Business adds team services; it never unlocks local
            features.
          </p>
          <div className="mt-8 overflow-hidden rounded-xl border border-native-border">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-native-bg-elevated/70">
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-native-text-dim">Feature</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-native-text-dim">Personal</th>
                  <th className="px-4 py-3 text-[11px] font-medium uppercase tracking-wider text-native-text-dim">Business</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Every model — BYOK or local runtimes", "Included", "Included"],
                  ["Memory, workspaces, knowledge store", "Included", "Included"],
                  ["Voice, agents, skills, plugins, MCP", "Included", "Included"],
                  ["Desktop, CLI, editors, mobile PWA", "Included", "Included"],
                  ["Spend caps and audit log", "Local", "Local + team export"],
                  ["Team workspaces, roles, member caps", "—", "Included"],
                  ["Managed models (no keys to hand out)", "—", "Included"],
                  ["SSO (Google, Okta, Azure, OIDC/SAML)", "—", "Included"],
                  ["Cloud relay + team memory", "—", "Included"],
                ].map(([feature, personal, business]) => (
                  <tr key={feature} className="border-t border-native-border">
                    <td className="px-4 py-3 text-[12.5px] text-native-text">{feature}</td>
                    <td className="px-4 py-3 text-[12.5px] text-native-text-muted">
                      {personal === "—" ? <Minus className="h-3.5 w-3.5 text-native-text-dim" aria-label="Not included" /> : personal}
                    </td>
                    <td className="px-4 py-3 text-[12.5px] text-native-text-muted">
                      {business === "—" ? <Minus className="h-3.5 w-3.5 text-native-text-dim" aria-label="Not included" /> : business}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── mechanics ──────────────────────────────────────────────────── */}
        <div className="mt-20 grid gap-px overflow-hidden rounded-xl border border-native-border bg-native-border md:grid-cols-3">
          {[
            {
              t: `${businessPricing.trialDays}-day trial, no card`,
              d: `Start with up to ${businessPricing.trialMaxSeats} seats and no payment method. A card is only needed to keep it after the trial ends.`,
            },
            {
              t: `$${businessPricing.seatAnnualUsd} per user per year`,
              d: `Billed annually that is $${businessPricing.annualPerMonthUsd}/month per user — ${businessPricing.annualSavingPercent}% less than monthly. Change seats up or down at any time.`,
            },
            {
              t: "Cancel and keep everything",
              d: "Cancelling stops the team services. Your local data, workspaces and memory are untouched, and team memory and audit logs stay exportable until the retention window closes.",
            },
          ].map((c) => (
            <div key={c.t} className="bg-native-bg p-6">
              <div className="text-[13px] font-medium text-native-text">{c.t}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-native-text-muted">{c.d}</p>
            </div>
          ))}
        </div>

        {/* ── faq ────────────────────────────────────────────────────────── */}
        <div className="mt-24">
          <h2 className="text-2xl font-semibold tracking-tight text-native-text">Questions</h2>
          <div className="mt-8 divide-y divide-native-border border-y border-native-border">
            {[
              {
                q: "Does Personal expire, or turn into something paid?",
                a: "No. It has no expiry, no seat limit and no feature that turns off. It is the same binary as Business; Business adds team services that run on our side.",
              },
              {
                q: "Does XR phone home to check my licence?",
                a: "No. A Business licence is a signed token verified against a public key compiled into the app, so verification is entirely offline. There is no periodic check-in, no heartbeat and no kill switch, and uninstalling the network would not change how XR behaves.",
              },
              {
                q: "What happens to my team's data if we stop paying?",
                a: "It stops being synchronised and starts a 30-day retention window. You can export team memory and the audit log at any point in that window. After it closes, the data is purged — we do not keep a copy to win you back.",
              },
              {
                q: "Do you use my data to train anything?",
                a: "No. Managed model calls are proxied to the provider you chose and metered; the prompt is not stored and there is no training set. The audit log records which model was used and how many tokens it cost — never what you asked.",
              },
              {
                q: "Can I self-host the control plane?",
                a: "Yes. The cloud service ships as a container with a docker-compose file and a documented Postgres schema. Our hosted instance is the same code. It is a real deployment, not a toy — but it is your burden, and the docs say so plainly.",
              },
              {
                q: "Is there analytics on this website?",
                a: "No. No third-party scripts, no pixels, no cookie banner, because there is nothing to consent to. We read server logs.",
              },
              ...faqs.slice(0, 2),
            ].map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between">
                  <span className="text-[14px] font-medium text-native-text">{f.q}</span>
                  <span className="ml-4 text-lg leading-none text-native-text-dim transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-3xl text-[13px] leading-relaxed text-native-text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        <p className="mt-14 text-center text-[12.5px] text-native-text-dim">
          Prices in USD, excluding tax. Not sure which you need?{" "}
          <Link href="/contact" className="text-native-cyan hover:underline">
            Ask us
          </Link>{" "}
          — we will tell you if the answer is &ldquo;neither&rdquo;.
        </p>
      </div>
    </div>
  );
}
