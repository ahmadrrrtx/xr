import Link from "next/link";
import { Metadata } from "next";
import { ArrowRight, Star, Check, Terminal as TermIcon, BookOpen, Package, Cpu, ShieldCheck, Zap } from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { Avatar3D } from "@/components/Avatar3D";
import { Terminal } from "@/components/Terminal";
import { DashboardPreview } from "@/components/DashboardPreview";
import { features, stats, logos, faqs } from "@/lib/data";
import { site } from "@/lib/site";
import { InstallCmd } from "@/components/InstallCmd";

export const metadata: Metadata = {
  title: "XR — The Agentic Runtime for Software",
  description: site.description,
};

export default function Home() {
  return (
    <>
      <Hero />
      <Logos />
      <Stats />
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
    <section className="relative pt-36 pb-24 md:pt-44 md:pb-32 overflow-hidden">
      <div className="absolute inset-0 grid-bg" aria-hidden />
      <div className="mx-auto max-w-7xl px-6 relative">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-12 lg:gap-16 items-center">
          <div>
            <Link
              href="/changelog"
              className="inline-flex items-center gap-2 text-xs text-zinc-300 glass px-3 py-1.5 rounded-full hover:border-white/20 transition-colors"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              XR 3.1 G is now available
              <ArrowRight className="h-3 w-3 text-zinc-400" />
            </Link>
            <h1 className="mt-6 text-[44px] sm:text-6xl lg:text-[76px] leading-[1.02] font-semibold tracking-tight text-gradient">
              The agentic runtime<br />
              <span className="text-gradient-violet">for building software.</span>
            </h1>
            <p className="mt-6 text-lg text-zinc-400 max-w-xl leading-relaxed">
              XR turns your terminal, editor, and workflow into an AI-native development
              environment. Plan, execute, and ship — with 12,000+ skills, any model,
              and security built in from the core.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/downloads" className="btn btn-primary">
                Download XR <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/docs" className="btn btn-ghost">
                <BookOpen className="h-4 w-4" /> Read the docs
              </Link>
              <a href={site.github} target="_blank" rel="noreferrer" className="btn btn-ghost">
                <GithubIcon className="h-4 w-4" /> GitHub
                <span className="ml-1 inline-flex items-center gap-1 text-zinc-400">
                  <Star className="h-3.5 w-3.5 fill-amber-300 text-amber-300" /> 74k
                </span>
              </a>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-6 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> MIT-licensed core</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> Local-first</span>
              <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-emerald-400" /> SOC 2 Type II</span>
            </div>

            <div className="mt-10">
              <InstallCmd />
            </div>
          </div>

          <div className="relative h-[420px] lg:h-[520px]">
            <Avatar3D />
          </div>
        </div>

        {/* Terminal + Dashboard previews */}
        <div className="mt-20 grid lg:grid-cols-5 gap-6">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-3 text-xs text-zinc-400">
              <TermIcon className="h-3.5 w-3.5" /> Live Shell
            </div>
            <Terminal />
          </div>
          <div className="lg:col-span-3">
            <div className="flex items-center gap-2 mb-3 text-xs text-zinc-400">
              <Cpu className="h-3.5 w-3.5" /> Runtime Dashboard
            </div>
            <DashboardPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

function Logos() {
  return (
    <section className="py-14 border-y border-white/5 bg-white/[0.01]">
      <div className="mx-auto max-w-7xl px-6">
        <p className="text-center text-xs uppercase tracking-[0.2em] text-zinc-500 mb-8">
          Trusted by teams building the future
        </p>
        <div className="relative overflow-hidden">
          <div className="marquee-track flex gap-14 whitespace-nowrap will-change-transform">
            {[...logos, ...logos].map((l, i) => (
              <span
                key={i}
                className="text-xl md:text-2xl text-zinc-500 hover:text-zinc-200 transition-colors font-medium tracking-tight"
              >
                {l}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0a0a0b] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0a0a0b] to-transparent" />
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="card p-6">
              <div className="text-3xl md:text-4xl font-semibold tracking-tight text-white tabular-nums">
                {s.value}
              </div>
              <div className="mt-1.5 text-sm text-zinc-400">{s.label}</div>
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
          eyebrow="The runtime"
          title="One runtime. Every surface."
          subtitle="From the terminal you live in to the editor you ship from — XR is a coherent system, not a Frankenstein of plugins."
        />
        <div className="mt-14 grid lg:grid-cols-3 gap-6">
          <LargeCard
            icon={TermIcon}
            title="Shell-native"
            desc="A real terminal. Real pipes. Real tools. Sub-10ms cold start, with streaming agents that respond like a teammate."
          >
            <Terminal className="mt-6" />
          </LargeCard>
          <LargeCard
            icon={Package}
            title="Marketplace"
            desc="12,000+ verified skills and extensions. Type-safe, versioned, and signed. Compose them in seconds."
          >
            <div className="mt-6 space-y-2">
              {["pr-reviewer", "deep-research", "smart-refactor", "live-preview"].map((n) => (
                <div key={n} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5 text-sm">
                  <span className="font-mono text-zinc-200">{n}</span>
                  <span className="text-xs text-zinc-500 flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> verified
                  </span>
                </div>
              ))}
              <Link href="/marketplace" className="inline-flex items-center gap-1 text-sm text-zinc-300 hover:text-white mt-2">
                Browse marketplace <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </LargeCard>
          <LargeCard
            icon={ShieldCheck}
            title="Secure by default"
            desc="Capability-based security, human-in-the-loop confirmations, signed skills, and end-to-end audit."
          >
            <ul className="mt-6 space-y-3 text-sm text-zinc-300">
              {[
                "Sandboxed execution per skill",
                "Granular capability tokens",
                "Signed, verifiable skills",
                "SOC 2 Type II & HIPAA ready",
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
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Features"
          title="Built for how developers actually work."
          subtitle="XR is a unified system — not a wrapper around a chatbot. Every part is designed to be composed, extended, and trusted."
        />
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {features.map((f) => (
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
  );
}

function Architecture() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Architecture"
          title="Designed like a modern kernel."
          subtitle="XR has a Rust core, a typed skill layer, and a model router — with a permission boundary between every component."
        />
        <div className="mt-14 rounded-3xl border border-white/10 p-2 bg-gradient-to-b from-white/[0.04] to-transparent">
          <div className="rounded-2xl bg-[#0c0c0f] p-8 md:p-12">
            <StackLayer name="Apps" desc="CLI · Editor extensions · Dashboard · API" tone="from-violet-500/20 to-transparent" />
            <StackConnector />
            <StackLayer name="Skill Graph" desc="12,000+ typed, versioned, composable units of work" tone="from-sky-500/20 to-transparent" />
            <StackConnector />
            <StackLayer name="Agent Runtime" desc="Planner · Executor · Memory · Replay · Audit" tone="from-emerald-500/15 to-transparent" />
            <StackConnector />
            <StackLayer name="Model Gateway" desc="XR Core · Claude · GPT · Gemini · Open-weight · Local" tone="from-amber-500/15 to-transparent" />
            <StackConnector />
            <StackLayer name="Security Core" desc="Capabilities · Sandbox · Signing · Policies · IAM" tone="from-rose-500/15 to-transparent" last />
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
}: {
  name: string;
  desc: string;
  tone: string;
  last?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-white/10 bg-gradient-to-r ${tone} px-5 py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-2`}>
      <div className="text-white font-medium">{name}</div>
      <div className="text-sm text-zinc-400">{desc}</div>
    </div>
  );
}
function StackConnector() {
  return <div className="h-5 w-px mx-auto bg-white/10" />;
}

function Workflow() {
  const steps = [
    { n: "01", title: "Install", desc: "One command. Works on macOS, Linux, and Windows (WSL)." },
    { n: "02", title: "Add skills", desc: "Pick from 12,000+ skills in the marketplace — or write your own." },
    { n: "03", title: "Pick a model", desc: "Use any major model, route by task, or run open-weight locally." },
    { n: "04", title: "Ship", desc: "Stream replays, share sessions, and deploy straight from XR." },
  ];
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Get started"
          title="From zero to shipping in minutes."
          subtitle="No containers. No API gymnastics. A real runtime you can use today."
        />
        <div className="mt-14 grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {steps.map((s, i) => (
            <div key={s.n} className="card p-6 relative">
              <div className="text-xs font-mono text-zinc-500">{s.n}</div>
              <div className="mt-3 text-white font-semibold">{s.title}</div>
              <div className="mt-2 text-sm text-zinc-400">{s.desc}</div>
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-3 w-6 h-px bg-white/10" />
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
        <div className="relative overflow-hidden rounded-3xl border border-white/10 p-10 md:p-16 text-center">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(600px 300px at 50% 0%, rgba(124,92,255,0.25), transparent 70%)",
            }}
          />
          <div className="relative">
            <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-gradient">
              Start building with XR today.
            </h2>
            <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
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
    <section className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <SectionHeader
          eyebrow="FAQ"
          title="Answers to common questions."
          centered
        />
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
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{eyebrow}</div>
      <h2 className="mt-3 text-3xl md:text-5xl font-semibold tracking-tight text-gradient">
        {title}
      </h2>
      {subtitle && <p className="mt-4 text-zinc-400 leading-relaxed">{subtitle}</p>}
    </div>
  );
}

function LargeCard({
  icon: Icon,
  title,
  desc,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="card p-6 md:p-7 flex flex-col">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-violet-300" />
        <h3 className="text-white font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{desc}</p>
      <div className="flex-1">{children}</div>
    </div>
  );
}
