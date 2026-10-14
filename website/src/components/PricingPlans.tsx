"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { pricingPlans } from "@/lib/data";
import { businessPricing } from "@/lib/native";
import { cn } from "@/lib/utils";

/**
 * The three plan cards with the monthly/annual toggle (Phase 31 · C13).
 * Prices come from `businessPricing` — the toggle never hardcodes a number:
 * monthly is seatMonthlyUsd, annual shows annualPerMonthUsd with the yearly
 * total in the cadence line. No countdown timers, no scarcity badges; the
 * honest line under the cards is part of the component so it cannot drift
 * away from the prices it describes.
 */
export function PricingPlans() {
  const [annual, setAnnual] = useState(false);

  return (
    <>
      <div className="mt-10 flex justify-center">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex rounded-full border border-native-border bg-native-bg-elevated/60 p-1"
        >
          {(
            [
              { label: "Monthly", value: false },
              { label: `Annual · save ${businessPricing.annualSavingPercent}%`, value: true },
            ] as const
          ).map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={annual === opt.value}
              onClick={() => setAnnual(opt.value)}
              className={cn(
                "min-h-10 rounded-full px-4 text-[12.5px] font-medium transition",
                annual === opt.value
                  ? "bg-native-cyan text-[#02222a]"
                  : "text-native-text-muted hover:text-native-text",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {pricingPlans.map((plan) => {
          const isBusiness = plan.name === "Business";
          const price = isBusiness
            ? `$${annual ? businessPricing.annualPerMonthUsd : businessPricing.seatMonthlyUsd}`
            : plan.price;
          const cadence = isBusiness
            ? annual
              ? `per user / month · billed annually ($${businessPricing.seatAnnualUsd}/yr)`
              : plan.cadence
            : plan.cadence;
          return (
            <div
              key={plan.name}
              className={cn(
                "relative flex flex-col rounded-2xl border p-7",
                plan.featured
                  ? "border-native-cyan/35 bg-native-bg-elevated/80 native-ring"
                  : "border-native-border bg-native-bg-elevated/50",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-native-text">{plan.name}</span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider",
                    plan.featured ? "bg-native-cyan/15 text-native-cyan" : "bg-white/5 text-native-text-dim",
                  )}
                >
                  {plan.badge}
                </span>
              </div>

              <div className="mt-5 flex items-end gap-1.5">
                <span className="text-4xl font-semibold tracking-tight text-native-text">{price}</span>
                <span className="pb-1.5 text-xs text-native-text-dim">{cadence}</span>
              </div>

              <p className="mt-4 text-[13px] leading-relaxed text-native-text-muted">{plan.description}</p>

              <Link
                href={plan.href}
                className={cn(
                  "mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg text-[13px] font-medium transition",
                  plan.featured
                    ? "bg-native-cyan text-[#02222a] hover:bg-native-cyan-soft"
                    : "border border-native-border-strong text-native-text hover:border-native-cyan/50 hover:text-native-cyan",
                )}
              >
                {plan.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>

              <ul className="mt-6 space-y-2.5">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-[13px] leading-snug text-native-text-muted">
                    <Check
                      className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", plan.featured ? "text-native-cyan" : "text-native-text-dim")}
                    />
                    {f}
                  </li>
                ))}
              </ul>

              {plan.footnote ? (
                <p className="mt-6 border-t border-native-border pt-4 text-[12px] leading-relaxed text-native-text-dim">
                  {plan.footnote}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="mt-6 text-center text-[12.5px] text-native-text-dim">
        No credit card required for trial. Cancel anytime.
      </p>
    </>
  );
}
