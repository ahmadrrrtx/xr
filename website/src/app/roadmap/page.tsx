import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CheckCircle2, Loader2, GitBranch, XCircle, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import { XrMark } from "@/components/Logo";

export const metadata: Metadata = { title: "Roadmap" };

/**
 * Roadmap — grounded in the repository itself:
 *  · what is already shipped (CHANGELOG.md),
 *  · what main is working on right now (the Unreleased section),
 *  · adopted design directions (docs/adr/),
 *  · what is explicitly NOT planned (honesty surface).
 */
const columns = [
  {
    title: "Shipped",
    icon: CheckCircle2,
    tone: "text-emerald-400",
    items: [
      { t: "1.0.0 (Truth) — first stable line, single release manifest", s: "done" },
      { t: "Tamper-evidence race fixed; audit chain verified offline", s: "done" },
      { t: "Honest dashboard — fake panels deleted, real routes wired", s: "done" },
      { t: "Approvals queue rendered on every surface", s: "done" },
      { t: "One execution engine, one context store, one routing authority", s: "done" },
      { t: "Memory & context engine with consent + provenance", s: "done" },
      { t: "65 bundled skills · plugins · MCP client (default-deny)", s: "done" },
      { t: "26 provider presets — 10 local runtimes + 16 BYOK", s: "done" },
      { t: "Research, voice, Telegram, automation triggers", s: "done" },
    ],
  },
  {
    title: "In progress on main",
    icon: Loader2,
    tone: "text-amber-400",
    items: [
      { t: "Phase 12 — honesty pass across remaining dashboard panels", s: "active" },
      { t: "MCP surface parity: manage the same registry from every UI", s: "active" },
      { t: "Agents & automation panels backed by live stores", s: "active" },
      { t: "Audit rendering fixes (timestamps, args previews)", s: "active" },
    ],
  },
  {
    title: "Adopted directions (ADR register)",
    icon: GitBranch,
    tone: "text-cyan-400",
    note: "Recorded in docs/adr/ — adopted, not promised dates.",
    items: [
      { t: "Gated remote execution (ADR-0025)", s: "planned" },
      { t: "Enterprise operability as an explicit gate (ADR-0024)", s: "planned" },
      { t: "Satellite extraction (ADR-0028)", s: "planned" },
      { t: "Sustainability governance path (ADR-0026)", s: "planned" },
      { t: "Privacy-first observability (ADR-0018)", s: "planned" },
    ],
  },
  {
    title: "Explicitly not planned",
    icon: XCircle,
    tone: "text-rose-400",
    items: [
      { t: "A hosted XR cloud or SaaS product", s: "out" },
      { t: "Telemetry, accounts or sign-in walls", s: "out" },
      { t: "An in-house trained foundation model", s: "out" },
      { t: "Certifications (SOC 2 / ISO / HIPAA) without a real audit", s: "out" },
      { t: "Proprietary extensions or paid tiers", s: "out" },
    ],
  },
];

export default function RoadmapPage() {
  return (
    <>
      <PageHeader
        eyebrow="Roadmap"
        title="Shipped, shipping, and honest about the rest."
        subtitle="This page is compiled from the repository itself — CHANGELOG.md for what exists, the ADR register for direction, and explicit non-goals. No dates we cannot keep."
      />
      <section className="pb-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-5 md:grid-cols-2">
            {columns.map((q) => (
              <div key={q.title} className="card card-hover flex flex-col p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <q.icon className={cn("h-4.5 w-4.5 h-5 w-5", q.tone)} />
                    <div className="text-lg font-semibold text-white">{q.title}</div>
                  </div>
                  <XrMark size={14} className="opacity-40" />
                </div>
                {q.note && <div className="mt-1 text-xs text-zinc-500">{q.note}</div>}
                <ul className="mt-5 space-y-2.5">
                  {q.items.map((i) => (
                    <li key={i.t} className="flex items-start gap-2.5 text-sm text-zinc-300">
                      <span className="mt-1.5 shrink-0">
                        {i.s === "done" ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        ) : i.s === "active" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                        ) : i.s === "out" ? (
                          <XCircle className="h-3.5 w-3.5 text-rose-400/80" />
                        ) : (
                          <GitBranch className="h-3.5 w-3.5 text-cyan-400/80" />
                        )}
                      </span>
                      <span className={i.s === "done" || i.s === "out" ? "text-zinc-400" : ""}>
                        {i.t}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-10 text-center">
            <a
              href={`${site.github}/blob/main/CHANGELOG.md`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-cyan-300"
            >
              Read the full changelog in the repository <ArrowRight className="arrow-nudge h-4 w-4" />
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
