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
        title="Pricing that scales with you."
        subtitle="Free for individuals. Pro for builders. Team and Enterprise for organizations that need security and scale."
      />
      <section className="pb-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
            {pricingPlans.map((p) => (
              <div
                key={p.name}
                className={cn(
                  "card p-7 flex flex-col relative",
                  p.featured && "border-violet-400/30 shadow-[0_20px_80px_-20px_rgba(124,92,255,0.35)]"
                )}
              >
                {p.featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-wider text-violet-100 bg-violet-500/90 rounded-full px-2.5 py-1 font-medium">
                    Most popular
                  </span>
                )}
                <div className="text-sm text-zinc-300 font-medium">{p.name}</div>
                <div className="mt-4 flex items-end gap-1">
                  <div className="text-4xl font-semibold text-white tracking-tight">{p.price}</div>
                  <div className="text-xs text-zinc-500 pb-1.5">/{p.cadence}</div>
                </div>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{p.description}</p>
                <Link
                  href={p.href}
                  className={cn("btn mt-6 w-full", p.featured ? "btn-primary" : "btn-ghost")}
                >
                  {p.cta} <ArrowRight className="h-4 w-4" />
                </Link>
                <ul className="mt-6 space-y-2.5 text-sm text-zinc-300">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-gradient text-center">
            Frequently asked
          </h2>
          <div className="mt-10 divide-y divide-white/5 border-y border-white/5">
            {faqs.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex items-center justify-between cursor-pointer list-none">
                  <span className="text-white font-medium">{f.q}</span>
                  <span className="ml-4 text-zinc-500 transition-transform group-open:rotate-45 text-xl leading-none">+</span>
                </summary>
                <p className="mt-3 text-sm text-zinc-400 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
