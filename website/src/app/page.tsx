import Link from "next/link";
import { Metadata } from "next";
import {
  ArrowRight,
  Check,
  Terminal as TermIcon,
  BookOpen,
  Package,
  Cpu,
  ShieldCheck,
  Zap,
  Globe,
  Bot,
  Code2,
  Search,
  Settings,
  MemoryStick,
  Workflow as WorkflowIcon,
  Rocket,
  Brain,
  Lock,
} from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { AvatarHero } from "@/components/Avatar";
import { Terminal } from "@/components/Terminal";
import { DashboardPreview } from "@/components/DashboardPreview";
import { features, stats, logos, faqs } from "@/lib/data";
import { site } from "@/lib/site";
import { InstallCmd } from "@/components/InstallCmd";

export const metadata: Metadata = {
  title: "XR — Your AI Operating System",
  description: site.description,
};

export default function Home() {
  return (
    <>
      <Hero />
      <Capabilities />
      <Showcase />
      <Features />
      <Architecture />
      <Workflow />
      <CTA />
      <FAQ />
    </>
  );
}

function Hero() {
  return (
    <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 overflow-hidden">
      <div className="absolute inset-0 grid-bg" aria-hidden />

      {/* Ambient glow */}
      <div
        aria-hidden
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse 700px 500px at 50% 0%, rgba(56,189,248,0.10), transparent 70%)",
        }}
      />

      <div className="mx-auto max-w-7xl px-6 relative">
        {/* Top badge */}
        <div className="flex justify-center mb-10">
          <Link
            href="/changelog"
            className="inline-flex items-center gap-2 text-xs text-slate-400 px-4 py-2 rounded-full border border-slate-700/50 bg-slate-800/30 hover:border-slate-600 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
            XR {site.version} — {site.codename}
            <ArrowRight className="h-3 w-3 text-slate-500" />
          </Link>
        </div>

        {/* Main grid */}
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <h1 className="text-[44px] sm:text-5xl lg:text-[68px] leading-[1.05] font-semibold tracking-tight text-gradient">
              One system.<br />
              <span className="text-gradient-accent">Infinite possibilities.</span>
            </h1>
            <p className="mt-6 text-lg text-slate-400 max-w-xl leading-relaxed">
              XR is a powerful, local-first AI operating system for developers, creators, and teams.
              It brings together AI agents, tools, memory, MCP, plugins, and more — into a single,
              beautiful experience.
            </p>

            {/* Trust badges */}
            <div className="mt-8 flex flex-wrap gap-4">
              <TrustBadge icon={<Lock className="h-4 w-4" />} label="Local First" sub="Your data. Your control." />
              <TrustBadge icon={<Code2 className="h-4 w-4" />} label="BYOK" sub="Bring your own keys." />
              <TrustBadge icon={<Globe className="h-4 w-4" />} label="Open Source" sub="Build. Extend. Own." />
            </div>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/downloads" className="btn btn-primary">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/docs" className="btn btn-ghost">
                <BookOpen className="h-4 w-4" /> Read the docs
              </Link>
              <a href={site.github} target="_blank" rel="noreferrer" className="btn btn-ghost">
                <GithubIcon className="h-4 w-4" /> GitHub
              </a>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-6 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> MIT-licensed
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Local-first
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> No telemetry
              </span>
            </div>
          </div>

          {/* Right: Avatar / Visual */}
          <div className="relative h-[380px] lg:h-[460px]">
            <AvatarHero className="w-full h-full" />
          </div>
        </div>

        {/* Tagline */}
        <div className="mt-16 text-center">
          <p className="text-xl md:text-2xl font-medium text-slate-300 tracking-tight">
            More than a tool. <span className="text-cyan-400">Your AI companion.</span>
          </p>
        </div>

        {/* Terminal + Dashboard previews */}
        <div className="mt-16 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
              <TermIcon className="h-3.5 w-3.5" /> Live Shell
            </div>
            <Terminal />
          </div>
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
              <Cpu className="h-3.5 w-3.5" /> Runtime Dashboard
            </div>
            <DashboardPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function TrustBadge({
  icon,
  label,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-slate-700/40 bg-slate-800/20">
      <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
        {icon}
      </div>
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-[11px] text-slate-500">{sub}</div>
      </div>
    </div>
  );
}

/**
 * "What XR Can Do" — capability grid from reference image 1.
 */
function Capabilities() {
  const caps = [
    {
      icon: <Code2 className="h-5 w-5" />,
      title: "Build & Code",
      desc: "Write, debug, and ship faster with AI.",
    },
    {
      icon: <Search className="h-5 w-5" />,
      title: "Research & Analyze",
      desc: "Discover insights from the web and your data.",
    },
    {
      icon: <WorkflowIcon className="h-5 w-5" />,
      title: "Automate Workflows",
      desc: "Let agents handle the repetitive stuff.",
    },
    {
      icon: <Package className="h-5 w-5" />,
      title: "Use Tools & MCP",
      desc: "Connect to 100+ tools and services.",
    },
    {
      icon: <MemoryStick className="h-5 w-5" />,
      title: "Remember & Learn",
      desc: "Keep context, build knowledge, stay consistent.",
    },
    {
      icon: <Settings className="h-5 w-5" />,
      title: "Work Your Way",
      desc: "Chat, CLI, TUI, or API — you choose.",
    },
  ];

  return (
    <section className="py-20 border-t border-slate-800/60">
      <div className="mx-auto max-w-7xl px-6">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <div className="text-xs uppercase tracking-[0.2em] text-slate-500 mb-3">What XR Can Do</div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-gradient">
            Everything you need. Nothing you don't.
          </h2>
          <p className="mt-4 text-slate-400 leading-relaxed">
            Advanced features when you need them. Simple experience when you don't.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {caps.map((c) => (
            <div key={c.title} className="card p-6 group">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 group-hover:bg-cyan-500/15 transition-colors">
                {c.icon}
              </div>
              <h3 className="mt-4 text-base font-semibold text-slate-100">{c.title}</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{c.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Showcase() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="The Runtime"
          title="One runtime. Every surface."
          subtitle="From the terminal you live in to the editor you ship from — XR is a coherent system, not a Frankenstein of plugins."
        />
        <div className="mt-14 grid lg:grid-cols-3 gap-6">
          <LargeCard
            icon={<TermIcon className="h-4 w-4 text-cyan-400" />}
            title="Shell-native"
            desc="A real terminal. Real pipes. Real tools. Streaming agents that respond like a teammate."
          >
            <Terminal className="mt-6" />
          </LargeCard>
          <LargeCard
            icon={<Package className="h-4 w-4 text-cyan-400" />}
            title="Marketplace"
            desc="Manifest-declared skills plus plugins and MCP servers. Install what you need; nothing is enabled by default."
          >
            <div className="mt-6 space-y-2">
              {["pr-reviewer", "deep-research", "smart-refactor", "live-preview"].map((n) => (
                <div
                  key={n}
                  className="flex items-center justify-between rounded-xl border border-slate-700/40 bg-slate-800/20 px-3 py-2.5 text-sm"
                >
                  <span className="font-mono text-slate-300">{n}</span>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <span className="status-dot active" /> verified
                  </span>
                </div>
              ))}
              <Link href="/marketplace" className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-cyan-400 mt-2 transition-colors">
                Browse marketplace <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </LargeCard>
          <LargeCard
            icon={<ShieldCheck className="h-4 w-4 text-cyan-400" />}
            title="Secure by default"
            desc="Capability-based security, human-in-the-loop confirmations, signed skills, and end-to-end audit."
          >
            <ul className="mt-6 space-y-3 text-sm text-slate-300">
              {[
                "Approval gate on consequential actions",
                "Per-task spend ceilings",
                "Deterministic egress + secret-path policy",
                "Tamper-evident local audit log",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </LargeCard>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="py-24 border-t border-slate-800/60">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Features"
          title="Built for how developers actually work."
          subtitle="XR is a unified system — not a wrapper around a chatbot. Every part is designed to be composed, extended, and trusted."
        />
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
            <div key={f.title} className="card p-6 group">
              <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-cyan-500/10 border border-cyan-500/20 group-hover:bg-cyan-500/15 transition-colors">
                <f.icon className="h-5 w-5 text-cyan-400" />
              </div>
              <h3 className="mt-5 text-base font-semibold text-slate-100">{f.title}</h3>
              <p className="mt-2 text-sm text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Architecture() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Architecture"
          title="Designed like a modern kernel."
          subtitle="XR is TypeScript on Bun: a typed composition kernel, a skill layer, and a model router — with a policy gate between intent and action."
        />
        <div className="mt-14 rounded-2xl border border-slate-700/50 bg-slate-800/20 p-2">
          <div className="rounded-xl bg-[#0B1120] p-8 md:p-12">
            <StackLayer name="Apps" desc="CLI · Editor extensions · Dashboard · API" tone="from-cyan-500/15 to-transparent" />
            <StackConnector />
            <StackLayer name="Skill Layer" desc="Manifest-governed, composable units of work" tone="from-sky-500/12 to-transparent" />
            <StackConnector />
            <StackLayer name="Agent Runtime" desc="Planner · Executor · Memory · Replay · Audit" tone="from-emerald-500/10 to-transparent" />
            <StackConnector />
            <StackLayer name="Model Gateway" desc="XR Core · Claude · GPT · Gemini · Open-weight · Local" tone="from-amber-500/10 to-transparent" />
            <StackConnector />
            <StackLayer name="Security Gate" desc="Policy · Approval · Budget · Audit (in-process)" tone="from-rose-500/10 to-transparent" last />
          </div>
        </div>
      </div>
    </section>
  );
}

function StackLayer({
  name,
  desc,
  tone,
  last,
}: {
  name: string;
  desc: string;
  tone: string;
  last?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-700/40 bg-gradient-to-r ${tone} px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2 ${
        last ? "" : "mb-2"
      }`}
    >
      <div className="text-slate-100 font-medium">{name}</div>
      <div className="text-sm text-slate-400">{desc}</div>
    </div>
  );
}
function StackConnector() {
  return <div className="h-4 w-px mx-auto bg-slate-700/50" />;
}

function Workflow() {
  const steps = [
    { n: "01", title: "Install", desc: "One command. Works on macOS, Linux, and Windows (WSL)." },
    { n: "02", title: "Add skills", desc: "Enable a bundled skill, install a plugin, or connect an MCP server." },
    { n: "03", title: "Pick a model", desc: "Use any major model, route by task, or run open-weight locally." },
    { n: "04", title: "Ship", desc: "Stream replays, share sessions, and deploy straight from XR." },
  ];
  return (
    <section className="py-24 border-t border-slate-800/60">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Get started"
          title="From zero to shipping in minutes."
          subtitle="No containers. No API gymnastics. A real runtime you can use today."
        />
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <div key={s.n} className="card p-6 relative">
              <div className="text-xs font-mono text-slate-500">{s.n}</div>
              <div className="mt-3 text-slate-100 font-semibold">{s.title}</div>
              <div className="mt-2 text-sm text-slate-400">{s.desc}</div>
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-px bg-slate-700/50" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-2xl border border-slate-700/50 bg-slate-800/20 p-10 md:p-16 text-center">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(600px 300px at 50% 0%, rgba(56,189,248,0.12), transparent 70%)",
            }}
          />
          <div className="relative">
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient">
              Start building with XR today.
            </h2>
            <p className="mt-4 text-slate-400 max-w-xl mx-auto">
              Free for individuals. Pro for builders who ship. Enterprise for teams that need control.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/downloads" className="btn btn-primary">
                <Zap className="h-4 w-4" /> Download XR
              </Link>
              <Link href="/pricing" className="btn btn-ghost">
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FAQ() {
  return (
    <section className="py-24 border-t border-slate-800/60">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeader eyebrow="FAQ" title="Answers to common questions." centered />
        <div className="mt-10 divide-y divide-slate-800/60 border-y border-slate-800/60">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex items-center justify-between cursor-pointer list-none">
                <span className="text-slate-200 font-medium">{f.q}</span>
                <span className="ml-4 text-slate-500 transition-transform group-open:rotate-45 text-xl leading-none">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-slate-400 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  centered,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
}) {
  return (
    <div className={centered ? "text-center max-w-2xl mx-auto" : "max-w-2xl"}>
      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{eyebrow}</div>
      <h2 className="mt-3 text-3xl md:text-4xl font-semibold tracking-tight text-gradient">
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-slate-400 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function LargeCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-6 md:p-7 flex flex-col">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-slate-100 font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-slate-400 leading-relaxed">{desc}</p>
      <div className="flex-1">{children}</div>
    </div>
  );
}
