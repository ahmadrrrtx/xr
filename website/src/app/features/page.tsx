import { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { features } from "@/lib/data";
import {
  Blocks,
  Brain,
  GitBranch,
  Layers,
  Lock,
  Radar,
  Share2,
  Sparkles,
  Terminal as Term,
  Workflow,
  Zap,
  Cpu,
} from "lucide-react";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = { title: "Features" };

const extraFeatures = [
  { icon: Brain, title: "Planning & reasoning", desc: "Multi-step planning with explicit reasoning traces you can inspect, replay, and diff." },
  { icon: Layers, title: "Multi-agent orchestration", desc: "Compose specialist agents — researcher, coder, reviewer — with typed handoffs." },
  { icon: GitBranch, title: "Replay & time travel", desc: "Every run is a trace. Rewind, fork, and resume sessions like git branches." },
  { icon: Share2, title: "Shareable sessions", desc: "Send a link to a run and anyone can inspect every tool call, diff, and decision." },
  { icon: Radar, title: "Observation hooks", desc: "Stream events to OpenTelemetry, Datadog, Honeycomb, or your own endpoint." },
  { icon: Blocks, title: "MCP servers", desc: "Drop in any Model Context Protocol server. XR adds typing, state, and capabilities." },
  { icon: Lock, title: "Secret management", desc: "Encrypted vault, per-skill scoping, and just-in-time approval for sensitive operations." },
  { icon: Zap, title: "Parallel tool calls", desc: "Fan out independent calls concurrently. XR schedules, cancels, and retries automatically." },
  { icon: Workflow, title: "Triggers & cron", desc: "Run agents on schedule, on webhooks, or when files change — locally or in the cloud." },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Features"
        title="Everything you need to build with agents."
        subtitle="XR is a complete runtime: a shell, an editor layer, a skill graph, a model gateway, and a security core — all working together."
      />
      <section className="py-12">
        <div className="mx-auto max-w-7xl px-6">
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...features, ...extraFeatures].map((f) => (
              <div key={f.title} className="card p-6 group">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10 group-hover:border-violet-400/30 transition-colors">
                  <f.icon className="h-5 w-5 text-violet-300" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-white">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <FeatureBlock
        icon={Term}
        title="A shell you'll actually live in."
        desc="XR is not a web app pretending to be a terminal. It is a real terminal that runs alongside your existing tools. Bash, zsh, fish, nushell — wrap them or run XR directly."
        points={["Real pipes and redirection", "Sub-10ms cold start", "Native SSH & tmux support", "Rich inline widgets"]}
        reverse
      />
      <FeatureBlock
        icon={Cpu}
        title="The smartest model router."
        desc="XR picks the right model for each step — cheap & fast for parsing, frontier for reasoning — and falls back gracefully. Route by cost, latency, or policy."
        points={["Model-agnostic tool protocol", "Local & remote in one graph", "Cost & latency budgets", "Fine-grained fallbacks"]}
      />
      <FeatureBlock
        icon={Sparkles}
        title="Skills, not prompts."
        desc="Skills are typed, versioned, signed, and capability-scoped units of work. Compose them like functions. Publish to the marketplace. Ship with confidence."
        points={["Schema-validated I/O", "Semantic versioning", "Signed & verified", "Per-skill permissions"]}
        reverse
      />

      <section className="py-24">
        <div className="mx-auto max-w-6xl px-6">
          <div className="rounded-3xl border border-white/10 p-10 md:p-16 text-center relative overflow-hidden">
            <div
              aria-hidden
              className="absolute inset-0"
              style={{
                background:
                  "radial-gradient(600px 300px at 50% 0%, rgba(124,92,255,0.25), transparent 70%)",
              }}
            />
            <div className="relative">
              <h2 className="text-3xl md:text-5xl font-semibold tracking-tight text-gradient">
                Try XR for yourself.
              </h2>
              <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
                Free for individuals. No credit card. Works locally in under a minute.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/downloads" className="btn btn-primary">
                  Download XR <ArrowRight className="h-4 w-4" />
                </Link>
                <Link href="/docs" className="btn btn-ghost">Read the docs</Link>
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
  reverse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  points: string[];
  reverse?: boolean;
}) {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className={`grid lg:grid-cols-2 gap-12 items-center ${reverse ? "lg:[&>*:first-child]:order-2" : ""}`}>
          <div>
            <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-violet-500/20 to-sky-500/10 border border-white/10">
              <Icon className="h-5 w-5 text-violet-300" />
            </div>
            <h2 className="mt-5 text-3xl md:text-4xl font-semibold tracking-tight text-gradient">{title}</h2>
            <p className="mt-4 text-zinc-400 leading-relaxed">{desc}</p>
            <ul className="mt-6 space-y-2.5">
              {points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-sm text-zinc-300">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="card p-8 min-h-[280px] relative overflow-hidden">
            <div
              aria-hidden
              className="absolute -top-20 -right-20 h-64 w-64 rounded-full blur-3xl opacity-60"
              style={{ background: "radial-gradient(closest-side, rgba(124,92,255,0.45), transparent)" }}
            />
            <div className="relative font-mono text-xs text-zinc-300 space-y-2 leading-relaxed">
              {points.map((p, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-violet-300">✓</span> {p}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
