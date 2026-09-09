import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { features } from "@/lib/data";
import { Terminal as Term, Cpu, Sparkles, ArrowRight, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "Features",
  description:
    "XR is a local-first agent runtime: plan / ask / agent execution, 65 bundled skills, 26 provider presets, approvals, budgets and a tamper-evident audit log.",
};

export default function FeaturesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Features"
        title="A governed runtime for real work."
        subtitle="Not a chat wrapper. A runtime: you give it a task, it plans, acts under an approval gate, and writes everything to an audit log you can verify."
      />
      <section className="py-10">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="card card-hover p-6 group">
                <div className="icon-tile h-11 w-11 rounded-xl">
                  <f.icon className="h-5 w-5 text-cyan-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FeatureBlock
        icon={Term}
        title="A shell you can live in — and a TUI."
        desc="XR's default surface is a full-screen terminal shell, not a web app pretending to be one. Fast path cold start is measured at ~36 ms p95 in the repository benchmarks; `xr serve` adds the local browser Control Center when you want it."
        points={[
          "`xr` — full-screen shell; `xr \"task\"` — one-shot agent run",
          "Ask (read-only) and Plan modes: `xr ask …`, `xr plan …`",
          "Inspect and export any past run: `xr session list|show|export`",
          "Works in any editor; a VS Code extension ships in the repo",
        ]}
        cmd={'xr "summarize the open TODOs in this repo"'}
        reverse
      />
      <FeatureBlock
        icon={Cpu}
        title="Explainable model routing."
        desc="XR picks a model per task — capability, cost, latency and locality are all inputs — and explains why. Local-first routing means sensitive work never silently goes to the cloud, and fallback chains keep working when a provider is down."
        points={[
          "26 presets: 10 local runtimes + 16 hosted APIs (BYOK)",
          "`xr providers set ollama qwen2.5:7b` — one-line model switch",
          "`xr models recommend` — best local model for this machine",
          "Health checks: `xr providers test`, `xr doctor`",
        ]}
        cmd="xr providers status"
      />
      <FeatureBlock
        icon={Sparkles}
        title="Skills — packaged capability, not prompts."
        desc="Each of the 65 bundled skills declares its id, version, publisher, permissions and description in a manifest, executes through the same envelope as everything else, and lands in the same audit log."
        points={[
          "Inspect before you trust: `xr skills inspect code_auditor`",
          "Enable/disable per workspace: `xr skills enable <id>`",
          "Plugins add commands and tools with declared permissions",
          "MCP servers connect through a default-deny allowlist",
        ]}
        cmd="xr skills list"
        reverse
      />

      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/8 p-10 text-center shadow-[var(--shadow-card)] md:p-16">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(640px 320px at 50% 0%, rgba(96,72,248,0.16), transparent 70%)",
              }}
            />
            <div className="relative">
              <ShieldCheck className="mx-auto h-8 w-8 text-emerald-400" />
              <h2 className="mt-4 text-3xl font-semibold tracking-tight text-gradient md:text-5xl">
                Everything an agent does is written down.
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-zinc-400">
                Free for everyone. No credit card, no account — it runs locally and the audit
                trail is yours to verify.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/downloads" className="btn btn-primary">
                  Download XR <ArrowRight className="arrow-nudge h-4 w-4" />
                </Link>
                <Link href="/security" className="btn btn-ghost">
                  Read the security model
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function FeatureBlock({
  icon: Icon,
  title,
  desc,
  points,
  cmd,
  reverse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  points: string[];
  cmd: string;
  reverse?: boolean;
}) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div
          className={`grid items-center gap-12 lg:grid-cols-2 ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}
        >
          <div>
            <div className="icon-tile h-11 w-11 rounded-xl">
              <Icon className="h-5 w-5 text-violet-300" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold tracking-tight text-gradient md:text-4xl">
              {title}
            </h2>
            <p className="mt-4 leading-relaxed text-zinc-400">{desc}</p>
            <ul className="mt-6 space-y-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-sm text-zinc-300">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                  <span className="font-mono text-[13px] leading-relaxed text-zinc-300 [&_*]:font-mono">{p}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card card-hover relative min-h-[240px] overflow-hidden p-8">
            <div
              aria-hidden
              className="absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-60 blur-3xl"
              style={{ background: "radial-gradient(closest-side, rgba(0,212,255,0.28), transparent)" }}
            />
            <div className="relative flex min-h-[176px] flex-col items-center justify-center text-center">
              <code className="code-line w-full !justify-start text-[13px]">
                <span className="select-none text-cyan-300">λ</span>
                <span className="flex-1 truncate text-left text-zinc-100">{cmd}</span>
              </code>
              <p className="mt-4 text-xs text-zinc-500">
                Real command — the CLI reference documents every flag
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
