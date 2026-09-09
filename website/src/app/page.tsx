import Link from "next/link";
import { Metadata } from "next";
import {
  ArrowRight,
  Check,
  Terminal as TermIcon,
  BookOpen,
  Package,
  ShieldCheck,
  Cpu,
  Play,
} from "lucide-react";
import { GithubIcon } from "@/components/icons";
import { AvatarShowcase } from "@/components/AvatarShowcase";
import { Terminal } from "@/components/Terminal";
import { DashboardPreview } from "@/components/DashboardPreview";
import { features, stats, logos, faqs } from "@/lib/data";
import { site } from "@/lib/site";
import { InstallCmd } from "@/components/InstallCmd";
import { XrMark } from "@/components/Logo";

export const metadata: Metadata = {
  title: "XR — An AI agent runtime you can actually audit",
  description: site.description,
};

export default function Home() {
  return (
    <>
      <Hero />
      <Logos />
      <Stats />
      <WhatXrIsAndIsNot />
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
    <section className="relative overflow-hidden pb-20 pt-36 md:pb-28 md:pt-44">
      <div className="absolute inset-0 grid-bg" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-6">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <Link
              href="/changelog"
              className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-zinc-300 transition-all hover:border-cyan-400/40 hover:shadow-[0_0_24px_-6px_rgba(0,212,255,0.4)]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 pulse-dot" />
              XR {site.version} ({site.codename}) is available
              <ArrowRight className="arrow-nudge h-3 w-3 text-zinc-400" />
            </Link>
            <h1 className="mt-6 text-[42px] font-semibold leading-[1.03] tracking-tight sm:text-6xl lg:text-[72px]">
              <span className="text-gradient">An AI agent runtime</span>
              <br />
              <span className="text-gradient-brand">you can actually audit.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-400">
              Give XR a task. It plans, uses tools, and changes real things on your machine —
              under an approval gate, your budget ceiling, and a hash-chained audit log you can
              verify offline.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/downloads" className="btn btn-primary">
                Download XR <ArrowRight className="arrow-nudge h-4 w-4" />
              </Link>
              <Link href="/docs" className="btn btn-ghost">
                <BookOpen className="h-4 w-4" /> Read the docs
              </Link>
              <a href={site.github} target="_blank" rel="noreferrer" className="btn btn-ghost">
                <GithubIcon className="h-4 w-4" /> GitHub
              </a>
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-zinc-500">
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> MIT-licensed core
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Local-first — no telemetry
              </span>
              <span className="flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-emerald-400" /> BYOK — keys never leave your machine
              </span>
            </div>

            <div className="mt-9">
              <InstallCmd />
            </div>
          </div>

          <div className="relative h-[380px] sm:h-[460px] lg:h-[540px]">
            <AvatarShowcase />
          </div>
        </div>

        {/* Shell + Control Center previews */}
        <div className="mt-20 grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
              <TermIcon className="h-3.5 w-3.5 text-cyan-400" /> The terminal — <code className="font-mono text-zinc-300">xr</code>
            </div>
            <Terminal />
          </div>
          <div className="lg:col-span-3">
            <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
              <Cpu className="h-3.5 w-3.5 text-violet-400" /> The Control Center — <code className="font-mono text-zinc-300">xr serve</code>
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
    <section className="border-y border-white/5 bg-white/[0.01] py-14">
      <div className="mx-auto max-w-7xl px-6">
        <p className="mb-8 text-center text-xs uppercase tracking-[0.2em] text-zinc-500">
          One runtime · every model you already use
        </p>
        <div className="relative overflow-hidden">
          <div className="marquee-track flex gap-14 whitespace-nowrap will-change-transform">
            {[...logos, ...logos].map((l, i) => (
              <span
                key={i}
                className="text-xl font-medium tracking-tight text-zinc-500 transition-colors hover:text-cyan-300 md:text-2xl"
              >
                {l}
              </span>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#0a0a0f] to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#0a0a0f] to-transparent" />
        </div>
      </div>
    </section>
  );
}

function Stats() {
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="card card-hover p-6">
              <div className="text-3xl font-semibold tracking-tight text-white tabular-nums md:text-4xl">
                {s.value}
              </div>
              <div className="mt-1.5 text-sm text-zinc-300">{s.label}</div>
              <div className="mt-1 text-xs leading-relaxed text-zinc-500">{s.note}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * "What XR is / is not" — the public honesty surface. Stated as plainly as
 * the features, and deliberately placed above the marketing.
 */
function WhatXrIsAndIsNot() {
  const is = [
    "A local-first CLI agent runtime you self-host",
    "Provider-neutral — 26 presets: cloud APIs or fully local models",
    "Governed: approval prompts, spend ceilings, deterministic policy gate, audit log",
    "Extensible through 65 bundled skills, plugins and MCP servers",
    "MIT-licensed and readable end to end — 3,191 tests across 240 files",
  ];
  const isNot = [
    "Not certified against SOC 2, ISO 27001 or HIPAA — no third-party audit exists",
    "Not a sandbox: it enforces in-process policy, not kernel or VM isolation",
    "Not a hosted product — there is no XR cloud and no telemetry",
    "Not a drop-in replacement for a human reviewing consequential actions",
    "Not finished — see the known-limitations register in the repository",
  ];
  return (
    <section className="py-20">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Honest scope"
          title="What XR is — and what it is not."
          subtitle="Every capability claim on this site is backed by evidence in the repository. Here are the boundaries, stated as plainly as the features."
        />
        <div className="mt-12 grid gap-5 md:grid-cols-2">
          <div className="card card-hover p-7">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <span className="icon-tile h-7 w-7">
                <Check className="h-4 w-4 text-emerald-400" />
              </span>
              What XR is
            </h3>
            <ul className="mt-5 space-y-3 text-sm text-zinc-300">
              {is.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="card card-hover p-7">
            <h3 className="flex items-center gap-2 font-semibold text-white">
              <span className="icon-tile h-7 w-7">
                <span className="text-rose-400 font-bold leading-none">—</span>
              </span>
              What XR is not
            </h3>
            <ul className="mt-5 space-y-3 text-sm text-zinc-400">
              {isNot.map((t) => (
                <li key={t} className="flex items-start gap-2.5">
                  <span className="mt-0.5 shrink-0 text-rose-400/80">—</span> {t}
                </li>
              ))}
            </ul>
          </div>
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
          subtitle="The terminal you live in, a local web Control Center, and an optional Telegram channel — one governed engine underneath."
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <LargeCard
            icon={TermIcon}
            title="Shell-native"
            desc="A real terminal with a full-screen TUI. Type a task, watch it plan and act, approve what matters."
            href="/features"
            cta="Explore the shell"
          >
            <Terminal className="mt-6 !rounded-xl" />
          </LargeCard>
          <LargeCard
            icon={Package}
            title="Extend with skills"
            desc="65 bundled, manifest-declared skills plus plugins and MCP servers. Nothing loads until you enable it."
            href="/marketplace"
            cta="Browse the marketplace"
          >
            <div className="mt-6 space-y-2">
              {["code_auditor", "deep_research", "refactor_clean", "security_audit"].map((n) => (
                <div
                  key={n}
                  className="flex items-center justify-between rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5 text-sm transition-colors hover:border-cyan-400/25 hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-zinc-200">{n}</span>
                  <span className="flex items-center gap-1 text-xs text-zinc-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> bundled
                  </span>
                </div>
              ))}
              <Link href="/marketplace" className="mt-2 inline-flex items-center gap-1 text-sm text-zinc-300 transition-colors hover:text-cyan-300">
                Browse all skills <ArrowRight className="arrow-nudge h-3.5 w-3.5" />
              </Link>
            </div>
          </LargeCard>
          <LargeCard
            icon={ShieldCheck}
            title="Secure by default"
            desc="Approval gate on consequential actions, per-task spend ceilings, and a hash-chained audit log."
            href="/security"
            cta="Read the security model"
          >
            <ul className="mt-6 space-y-3 text-sm text-zinc-300">
              {[
                "Approval prompts before consequential actions",
                "Per-task spend ceilings, checked during the loop",
                "Deterministic egress + secret-path policy",
                "Tamper-evident local audit — `xr audit verify`",
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /> {t}
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
          title="Built for work, not chat."
          subtitle="A unified system — agent runtime, skills, model presets, memory and a trust plane — designed to be composed, extended and trusted."
        />
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <Link key={f.title} href="/features" className="card card-hover p-6 group block">
              <div className="icon-tile h-11 w-11 rounded-xl">
                <f.icon className="h-5 w-5 text-cyan-300" />
              </div>
              <h3 className="mt-5 flex items-center gap-1.5 text-base font-semibold text-white">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.desc}</p>
            </Link>
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
          subtitle="TypeScript on Bun: a composition kernel, a skill layer, a provider gateway and a policy gate between intent and action."
        />
        <div className="mt-14 rounded-3xl border border-white/8 p-2 bg-gradient-to-b from-white/[0.04] to-transparent shadow-[var(--shadow-card)]">
          <div className="rounded-2xl bg-[#0b0e14] p-8 md:p-12">
            <StackLayer name="Surfaces" desc="Terminal shell · TUI · Control Center (local web) · Telegram · API" tone="from-cyan-500/10 to-transparent" />
            <StackConnector />
            <StackLayer name="Skill layer" desc="65 bundled skills — manifest-declared, permission-scoped" tone="from-cyan-500/8 to-transparent" />
            <StackConnector />
            <StackLayer name="Agent runtime" desc="Plan / ask / agent · tools · memory · runs & sessions · audit" tone="from-violet-500/12 to-transparent" />
            <StackConnector />
            <StackLayer name="Model gateway" desc="10 local runtimes · 16 hosted APIs (BYOK) · explainable routing · fallbacks" tone="from-violet-500/10 to-transparent" />
            <StackConnector />
            <StackLayer name="Trust plane" desc="Approvals · spend ceilings · policy gate · hash-chained audit" tone="from-emerald-500/8 to-transparent" last />
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
      className={`flex flex-col gap-2 rounded-xl border border-white/10 bg-gradient-to-r ${tone} px-5 py-4 transition-colors md:flex-row md:items-center md:justify-between hover:border-white/20`}
    >
      <div className="flex items-center gap-2 font-medium text-white">
        <XrMark size={14} />
        {name}
      </div>
      <div className="text-sm text-zinc-400">{desc}</div>
    </div>
  );
}
function StackConnector() {
  return <div className="mx-auto h-5 w-px bg-white/10" />;
}

function Workflow() {
  const steps = [
    { n: "01", title: "Install", desc: "npm, a native binary or Docker — macOS, Linux, Windows.", href: "/downloads" },
    { n: "02", title: "Connect a model", desc: "Local runtime or your own key — `xr onboarding` walks you through it.", href: "/models" },
    { n: "03", title: "Give it a task", desc: "xr \"…\" plans, asks when it matters, and reports what it did.", href: "/docs" },
    { n: "04", title: "Verify the trail", desc: "Every run is inspectable; the audit chain is verifiable offline.", href: "/security" },
  ];
  return (
    <section className="py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionHeader
          eyebrow="Get started"
          title="From zero to your first task in minutes."
          subtitle="No containers required, no hosted account, no credit card."
        />
        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Link key={s.n} href={s.href} className="card card-hover relative block p-6">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono text-zinc-500">{s.n}</div>
                {i < steps.length - 1 && (
                  <ArrowRight className="arrow-nudge hidden h-4 w-4 text-zinc-600 lg:block" />
                )}
              </div>
              <div className="mt-3 font-semibold text-white">{s.title}</div>
              <div className="mt-2 text-sm leading-relaxed text-zinc-400">{s.desc}</div>
            </Link>
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
        <div className="relative overflow-hidden rounded-3xl border border-white/8 p-10 text-center shadow-[var(--shadow-card)] md:p-16">
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(640px 320px at 50% 0%, rgba(0,212,255,0.14), transparent 70%), radial-gradient(500px 260px at 80% 100%, rgba(96,72,248,0.14), transparent 70%)",
            }}
          />
          <div className="relative">
            <XrMark size={40} className="mx-auto drop-shadow-[0_0_20px_rgba(0,212,255,0.5)]" />
            <h2 className="mt-6 text-4xl font-semibold tracking-tight text-gradient md:text-5xl">
              Run XR on your machine today.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-zinc-400">
              Free, MIT-licensed and local-first. There is no hosted product, no paid tier and no
              telemetry — just the runtime, on your hardware.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/downloads" className="btn btn-primary">
                <Play className="h-4 w-4" /> Get started
              </Link>
              <Link href="/pricing" className="btn btn-ghost">
                See what's included
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
        <SectionHeader eyebrow="FAQ" title="Answers to common questions." centered />
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
    <div className={centered ? "mx-auto max-w-2xl text-center" : "max-w-2xl"}>
      <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">{eyebrow}</div>
      <h2 className="mt-3 text-3xl font-semibold tracking-tight text-gradient md:text-5xl">{title}</h2>
      {subtitle && <p className="mt-4 leading-relaxed text-zinc-400">{subtitle}</p>}
    </div>
  );
}

function LargeCard({
  icon: Icon,
  title,
  desc,
  children,
  href,
  cta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  children?: React.ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <Link href={href} className="card card-hover group flex flex-col p-6 md:p-7">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-cyan-400" />
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">{desc}</p>
      <div className="flex-1">{children}</div>
      <div className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-zinc-300 transition-colors group-hover:text-cyan-300">
        {cta} <ArrowRight className="arrow-nudge h-3.5 w-3.5" />
      </div>
    </Link>
  );
}
