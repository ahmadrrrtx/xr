"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Search, ShieldCheck, Download, Star, Boxes, Sparkles, KeyRound, RefreshCcw, BadgeCheck, Terminal, Layers3 } from "lucide-react";

const skills = [
  { name: "React Expert", id: "react_expert", cat: "Developer", trust: "Official", installs: "12.8k", color: "cyan" },
  { name: "Incident Response", id: "incident_response", cat: "Security", trust: "Verified", installs: "9.4k", color: "violet" },
  { name: "Deep Research", id: "deep_research", cat: "Research", trust: "Official", installs: "18.1k", color: "green" },
  { name: "Startup Advisor", id: "startup_advisor", cat: "Business", trust: "Reviewed", installs: "7.2k", color: "amber" },
  { name: "UI Designer", id: "ui_designer", cat: "Creative", trust: "Official", installs: "10.6k", color: "cyan" },
  { name: "Secure Code Auditor", id: "code_auditor", cat: "Security", trust: "Verified", installs: "8.9k", color: "violet" },
];

const categories = ["Developer", "Security", "Research", "Business", "Creative", "MCP", "Voice", "Workflow"];

export default function MarketplacePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#05070d] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-60" style={{ background: "radial-gradient(circle at 10% 10%,rgba(0,212,255,.22),transparent 28%),radial-gradient(circle at 85% 12%,rgba(168,85,247,.20),transparent 30%),radial-gradient(circle at 50% 95%,rgba(0,255,136,.10),transparent 28%)" }} />
      <div className="relative mx-auto max-w-7xl px-6 py-8">
        <nav className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.035] px-5 py-3 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <img src="/logo.png" className="h-10 w-10 rounded-xl shadow-[0_0_28px_rgba(0,212,255,.35)]" alt="XR" />
            <div>
              <div className="text-sm font-black tracking-tight">XR Skills Marketplace</div>
              <div className="text-[10px] uppercase tracking-[.25em] text-cyan-300/70">AI Operating System</div>
            </div>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Pill icon={<ShieldCheck size={14} />} text="Permissioned" />
            <Pill icon={<BadgeCheck size={14} />} text="Verified" />
            <Pill icon={<KeyRound size={14} />} text="Signed" />
          </div>
        </nav>

        <section className="grid gap-8 py-14 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[.18em] text-cyan-200">
              <Sparkles size={14} /> App Store for AI Skills
            </div>
            <h1 className="max-w-4xl text-5xl font-black leading-[.95] tracking-[-.06em] md:text-7xl">
              Make XR smarter by installing <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">professional expertise</span>.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
              Browse, verify, install, update, and rollback Skills that declare permissions, dependencies, examples, workflows, memory templates, commands, docs, changelogs, and publisher trust before they ever touch your runtime.
            </p>
            <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-cyan-300/20 bg-black/40 p-2 shadow-[0_0_80px_rgba(0,212,255,.08)] md:flex-row">
              <div className="flex flex-1 items-center gap-3 px-4 text-slate-400"><Search size={18} /> Search React, incident response, market research…</div>
              <button className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-black text-black">Explore Skills</button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">{categories.map(c => <span key={c} className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs text-slate-300">{c}</span>)}</div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .8 }} className="relative mx-auto h-[520px] w-full max-w-[520px]">
            <div className="absolute inset-8 animate-spin rounded-full bg-[conic-gradient(from_90deg,rgba(0,212,255,.22),rgba(168,85,247,.36),rgba(0,255,136,.14),rgba(0,212,255,.22))] blur-sm [animation-duration:22s]" />
            <div className="absolute inset-16 rounded-full border border-cyan-300/20 bg-black/70 backdrop-blur-xl" />
            <img src="/avatar.png" alt="XR avatar" className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-cyan-300/20 object-cover shadow-[0_0_90px_rgba(0,212,255,.22)]" />
            <FloatCard className="left-0 top-14" icon={<Download />} title="One-command install" text="xr skill install-online" />
            <FloatCard className="right-0 top-28" icon={<ShieldCheck />} title="Auditable permissions" text="No hidden behavior" />
            <FloatCard className="bottom-12 left-10" icon={<RefreshCcw />} title="Rollback ready" text="Pinned versions" />
            <FloatCard className="bottom-24 right-0" icon={<Boxes />} title="Dependencies" text="Resolved safely" />
          </motion.div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <Stat label="Official Skills" value="54+" icon={<BadgeCheck />} />
          <Stat label="Runtime Records" value="79+" icon={<Layers3 />} />
          <Stat label="Permission Scopes" value="20+" icon={<ShieldCheck />} />
          <Stat label="CLI Commands" value="30+" icon={<Terminal />} />
        </section>

        <section className="mt-10 rounded-3xl border border-white/10 bg-white/[.035] p-5 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight">Featured Skills</h2>
              <p className="text-sm text-slate-400">Designed like an App Store, enforced like a security platform.</p>
            </div>
            <button className="rounded-xl border border-white/10 px-4 py-2 text-sm text-cyan-200">View all</button>
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {skills.map(skill => <SkillCard key={skill.id} skill={skill} />)}
          </div>
        </section>
      </div>
    </main>
  );
}

function Pill({ icon, text }: { icon: ReactNode; text: string }) { return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs text-slate-300">{icon}{text}</span>; }
function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="rounded-3xl border border-white/10 bg-white/[.04] p-5 backdrop-blur-xl"><div className="mb-3 text-cyan-300">{icon}</div><div className="text-3xl font-black">{value}</div><div className="text-sm text-slate-400">{label}</div></div>; }
function FloatCard({ className, icon, title, text }: { className: string; icon: ReactNode; title: string; text: string }) { return <div className={`absolute rounded-2xl border border-cyan-300/20 bg-black/70 p-4 shadow-[0_0_40px_rgba(0,212,255,.12)] backdrop-blur-xl ${className}`}><div className="mb-2 text-cyan-300">{icon}</div><div className="text-sm font-black">{title}</div><div className="text-xs text-slate-400">{text}</div></div>; }
function SkillCard({ skill }: { skill: typeof skills[number] }) { return <article className="group overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-b from-slate-900/90 to-black/70 p-5 transition hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-[0_24px_80px_rgba(0,212,255,.10)]"><div className="mb-4 h-28 rounded-2xl border border-cyan-300/10 bg-[radial-gradient(circle_at_20%_20%,rgba(0,212,255,.28),transparent_32%),radial-gradient(circle_at_80%_30%,rgba(168,85,247,.25),transparent_30%),linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.01))]" /><div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black">{skill.name}</h3><p className="font-mono text-xs text-slate-500">{skill.id}</p></div><span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs text-cyan-200">{skill.trust}</span></div><p className="mt-3 text-sm leading-6 text-slate-400">Professional {skill.cat.toLowerCase()} capability with workflows, commands, memory templates, examples, tests, docs, permissions, and dependencies.</p><div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span className="inline-flex items-center gap-1"><Star size={14} className="text-amber-300" /> 4.9</span><span>{skill.installs} installs</span><span>{skill.cat}</span></div></article>; }
