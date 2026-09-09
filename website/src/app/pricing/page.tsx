import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { pricingPlans, faqs } from "@/lib/data";
import { Check, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <>
      <PageHeader
        eyebrow="Pricing"
        title="Free and open source. That's the plan."
        subtitle="XR is MIT-licensed, self-hosted software. There is no paid tier, no hosted cloud and no billing — the same runtime runs for individuals and organizations."
      />
      <section className="pb-12">
        <div className="mx-auto max-w-4xl px-6">
          <div className="grid gap-6 md:grid-cols-2">
            {pricingPlans.map((p) => (
              <div
                key={p.name}
                className={cn(
                  "card relative flex flex-col p-7",
                  p.featured &&
                    "border-violet-400/25 shadow-[var(--shadow-card),0_0_60px_-18px_rgba(96,72,248,0.45)]"
                )}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-violet-500 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white shadow-[0_4px_16px_-4px_rgba(96,72,248,0.7)]">
                    The one and only tier
                  </span>
                )}
                <div className="text-sm font-medium text-zinc-300">{p.name}</div>
                <div className="mt-4 flex items-end gap-1">
                  <div className="text-5xl font-semibold tracking-tight text-white">{p.price}</div>
                  <div className="pb-1.5 text-xs text-zinc-500">/{p.cadence}</div>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{p.description}</p>
                <Link
                  href={p.href}
                  className={cn("btn mt-6 w-full", p.featured ? "btn-primary" : "btn-ghost")}
                >
                  {p.cta} <ArrowRight className="arrow-nudge h-4 w-4" />
                </Link>
                <ul className="mt-6 space-y-2.5 text-sm text-zinc-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mx-auto mt-8 max-w-2xl text-center text-sm leading-relaxed text-zinc-500">
            What you pay for is what you bring: model tokens (your own keys or your own hardware)
            and your time. XR itself costs nothing — no seats, no usage tiers, no enterprise
            upsell. If you need guarantees beyond the MIT license, fork it or sponsor development.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight text-gradient md:text-4xl">
            Frequently asked
          </h2>
          <div className="mt-10 divide-y divide-white/5 border-y border-white/5">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between">
                  <span className="font-medium text-white">{f.q}</span>
                  <span className="ml-4 text-xl leading-none text-zinc-500 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-zinc-400">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
