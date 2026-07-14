import { Metadata } from "next";
import { PageHeader } from "@/components/PageHeader";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Roadmap" };

const quarters = [
  {
    label: "Q3 2026", status: "in-progress", title: "Now",
    items: [
      { t: "XR 3.1 G — stable", s: "done" },
      { t: "Skills 2.0 with typed compositions", s: "done" },
      { t: "MCP-native runtime (stable)", s: "done" },
      { t: "Self-hosted model gateway GA", s: "active" },
      { t: "JetBrains 2.0 extension", s: "active" },
    ],
  },
  {
    label: "Q4 2026", status: "planned", title: "Next",
    items: [
      { t: "Multi-agent orchestration GA", s: "planned" },
      { t: "Team workspaces v1", s: "planned" },
      { t: "XR Core 1.5 (reasoning)", s: "planned" },
      { t: "Mobile companion app", s: "planned" },
    ],
  },
  {
    label: "2027", status: "planned", title: "Later",
    items: [
      { t: "Federated skill discovery", s: "planned" },
      { t: "Verifiable agents (attestation)", s: "planned" },
      { t: "XR Cloud runtimes", s: "planned" },
      { t: "Natural language extensions", s: "planned" },
    ],
  },
];

const iconFor = (s: string) =>
  s === "done" ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> :
  s === "active" ? <Loader2 className="h-4 w-4 text-amber-400 animate-spin" /> :
  <Circle className="h-4 w-4 text-zinc-500" />;

export default function RoadmapPage() {
  return (
    <>
      <PageHeader eyebrow="Roadmap" title="What we're building." subtitle="A public, honest look at what ships next. This roadmap is updated monthly." />
      <section className="pb-24">
        <div className="mx-auto max-w-5xl px-6 grid md:grid-cols-3 gap-6">
          {quarters.map((q) => (
            <div key={q.label} className="card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-widest text-zinc-500">{q.label}</div>
                  <div className="mt-1 text-lg font-semibold text-white">{q.title}</div>
                </div>
                <span className={cn(
                  "text-[10px] uppercase tracking-wider px-2 py-1 rounded-full border",
                  q.status === "in-progress"
                    ? "text-amber-200 bg-amber-500/10 border-amber-400/30"
                    : "text-zinc-400 bg-white/[0.03] border-white/10"
                )}>
                  {q.status === "in-progress" ? "Shipping" : "Planned"}
                </span>
              </div>
              <ul className="mt-6 space-y-3">
                {q.items.map((i) => (
                  <li key={i.t} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="mt-0.5 shrink-0">{iconFor(i.s)}</span>
                    <span className={i.s === "done" ? "text-zinc-400 line-through decoration-zinc-600" : ""}>
                      {i.t}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
