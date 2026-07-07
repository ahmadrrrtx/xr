"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Search,
  ShieldCheck,
  Download,
  Star,
  Boxes,
  Sparkles,
  KeyRound,
  RefreshCcw,
  BadgeCheck,
  Terminal,
  Layers3,
  GitBranch,
  BookOpen,
  Workflow,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Github,
  X,
} from "lucide-react";
import { marketplaceSkills, marketplaceStats, type MarketplaceSkill } from "../../lib/marketplace-data";

const categoryLabels: Record<string, string> = {
  developer: "Developer",
  security: "Security",
  research: "Research",
  business: "Business",
  creative: "Creative",
  productivity: "Productivity",
  workflow: "Workflow",
  agent: "Agent",
  mcp: "MCP",
  voice: "Voice",
  data: "Data",
  operations: "Operations",
};

const categoryIcons: Record<string, string> = {
  developer: "⌘",
  security: "🛡",
  research: "🔬",
  business: "📈",
  creative: "🎨",
  productivity: "⚡",
  workflow: "◆",
  agent: "🤖",
  mcp: "🔌",
  voice: "🎤",
  data: "▦",
  operations: "⚙",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("") || "XR";
}

function trustClass(trust: string) {
  if (["official", "verified"].includes(trust)) return "border-emerald-300/30 bg-emerald-300/10 text-emerald-200";
  if (trust === "reviewed") return "border-cyan-300/30 bg-cyan-300/10 text-cyan-200";
  return "border-amber-300/30 bg-amber-300/10 text-amber-200";
}

function riskCount(skill: MarketplaceSkill) {
  return skill.permissions.filter((p) => p.dangerous).length;
}

function skillSearchText(skill: MarketplaceSkill) {
  return [
    skill.id,
    skill.name,
    skill.description,
    skill.longDescription ?? "",
    skill.publisher,
    skill.kind,
    skill.verification,
    ...skill.categories,
    ...skill.tags,
    ...skill.keywords,
    ...skill.permissions.map((p) => `${p.scope} ${p.reason ?? ""}`),
    ...skill.commands.map((c) => `${c.name} ${c.title ?? ""} ${c.description ?? ""}`),
  ].join(" ").toLowerCase();
}

export default function MarketplacePage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState<"all" | "official" | "legacy" | "risky" | "safe">("all");
  const [sort, setSort] = useState<"recommended" | "name" | "workflows" | "permissions">("recommended");
  const [selectedId, setSelectedId] = useState(marketplaceSkills[0]?.id ?? "");
  const [copied, setCopied] = useState<string | null>(null);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of marketplaceSkills) for (const c of skill.categories) counts.set(c, (counts.get(c) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, []);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/[^a-z0-9+#._-]+/).filter(Boolean);
    let rows = marketplaceSkills.filter((skill) => {
      if (category !== "all" && !skill.categories.includes(category)) return false;
      if (filter === "official" && skill.verification !== "official") return false;
      if (filter === "legacy" && skill.kind !== "legacy") return false;
      if (filter === "risky" && riskCount(skill) === 0) return false;
      if (filter === "safe" && riskCount(skill) > 0) return false;
      if (!terms.length) return true;
      const text = skillSearchText(skill);
      return terms.every((term) => text.includes(term));
    });
    rows = rows.map((skill) => ({
      skill,
      score: terms.reduce((sum, term) => sum + (skill.id.includes(term) ? 8 : 0) + (skill.name.toLowerCase().includes(term) ? 6 : 0) + (skillSearchText(skill).includes(term) ? 2 : 0), 0) + (skill.verification === "official" ? 3 : 0) + skill.workflows.length,
    })).sort((a, b) => {
      if (sort === "name") return a.skill.name.localeCompare(b.skill.name);
      if (sort === "workflows") return b.skill.workflows.length - a.skill.workflows.length || a.skill.name.localeCompare(b.skill.name);
      if (sort === "permissions") return riskCount(a.skill) - riskCount(b.skill) || a.skill.name.localeCompare(b.skill.name);
      return b.score - a.score || a.skill.name.localeCompare(b.skill.name);
    }).map((row) => row.skill);
    return rows;
  }, [query, category, filter, sort]);

  const selected = marketplaceSkills.find((skill) => skill.id === selectedId) ?? filtered[0] ?? marketplaceSkills[0];

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#05070d] text-white">
      <div className="pointer-events-none fixed inset-0 opacity-70" style={{ background: "radial-gradient(circle at 10% 10%,rgba(0,212,255,.22),transparent 28%),radial-gradient(circle at 85% 12%,rgba(168,85,247,.20),transparent 30%),radial-gradient(circle at 50% 95%,rgba(0,255,136,.10),transparent 28%)" }} />
      <div className="relative mx-auto max-w-[1500px] px-6 py-8">
        <nav className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/[.035] px-5 py-3 backdrop-blur-xl">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.png" className="h-10 w-10 rounded-xl shadow-[0_0_28px_rgba(0,212,255,.35)]" alt="XR" />
            <div>
              <div className="text-sm font-black tracking-tight">XR Skills Marketplace</div>
              <div className="text-[10px] uppercase tracking-[.25em] text-cyan-300/70">AI Operating System</div>
            </div>
          </a>
          <div className="hidden items-center gap-2 md:flex">
            <a href="/" className="rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs text-slate-300 hover:text-cyan-200">Home</a>
            <Pill icon={<ShieldCheck size={14} />} text="Permissioned" />
            <Pill icon={<BadgeCheck size={14} />} text={`${marketplaceStats.official} Official`} />
            <Pill icon={<KeyRound size={14} />} text="Signed packages ready" />
          </div>
        </nav>

        <section className="grid gap-8 py-12 lg:grid-cols-[1.08fr_.92fr] lg:items-center">
          <motion.div initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .7 }}>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold uppercase tracking-[.18em] text-cyan-200">
              <Sparkles size={14} /> {marketplaceStats.total} Skills Live · Runtime Ready
            </div>
            <h1 className="max-w-5xl text-5xl font-black leading-[.95] tracking-[-.06em] md:text-7xl">
              Browse every XR Skill. Install <span className="bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 bg-clip-text text-transparent">professional expertise</span> into your AI OS.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-300">
              A complete App Store-style catalog for agent capabilities: official Skills, legacy adapters, permissions, workflows, memory templates, commands, tests, examples, docs, categories, and CLI install commands.
            </p>
            <div className="mt-8 flex flex-col gap-3 rounded-2xl border border-cyan-300/20 bg-black/40 p-2 shadow-[0_0_80px_rgba(0,212,255,.08)] md:flex-row">
              <div className="flex flex-1 items-center gap-3 px-4 text-slate-400"><Search size={18} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search React, incident response, patents, SEO, brand…" className="w-full bg-transparent py-3 text-white outline-none placeholder:text-slate-500" />
              </div>
              <button onClick={() => setQuery("")} className="rounded-xl border border-white/10 px-5 py-3 text-sm font-bold text-slate-300 hover:border-cyan-300/40 hover:text-cyan-200">Clear</button>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {(["all", "official", "legacy", "risky", "safe"] as const).map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-xs transition ${filter === f ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-white/[.04] text-slate-300 hover:text-cyan-200"}`}>{f}</button>
              ))}
            </div>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .8 }} className="relative mx-auto h-[520px] w-full max-w-[520px]">
            <div className="absolute inset-8 animate-spin rounded-full bg-[conic-gradient(from_90deg,rgba(0,212,255,.22),rgba(168,85,247,.36),rgba(0,255,136,.14),rgba(0,212,255,.22))] blur-sm [animation-duration:22s]" />
            <div className="absolute inset-16 rounded-full border border-cyan-300/20 bg-black/70 backdrop-blur-xl" />
            <img src="/avatar.png" alt="XR avatar" className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-cyan-300/20 object-cover shadow-[0_0_90px_rgba(0,212,255,.22)]" />
            <FloatCard className="left-0 top-14" icon={<Download />} title="One-command install" text="xr skill install <id>" />
            <FloatCard className="right-0 top-28" icon={<ShieldCheck />} title="Auditable permissions" text={`${marketplaceSkills.reduce((n, s) => n + s.permissions.length, 0)} declarations`} />
            <FloatCard className="bottom-12 left-10" icon={<Workflow />} title="Workflows" text={`${marketplaceSkills.reduce((n, s) => n + s.workflows.length, 0)} templates`} />
            <FloatCard className="bottom-24 right-0" icon={<Boxes />} title="Categories" text={`${marketplaceStats.categories.length} domains`} />
          </motion.div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          <Stat label="Available Skills" value={`${marketplaceStats.total}`} icon={<Layers3 />} />
          <Stat label="Official Skills" value={`${marketplaceStats.official}`} icon={<BadgeCheck />} />
          <Stat label="Legacy Adapters" value={`${marketplaceStats.legacy}`} icon={<GitBranch />} />
          <Stat label="Categories" value={`${marketplaceStats.categories.length}`} icon={<Boxes />} />
        </section>

        <section className="mt-8 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)_390px]">
          <aside className="rounded-3xl border border-white/10 bg-white/[.035] p-5 backdrop-blur-xl">
            <h2 className="mb-4 text-xs font-black uppercase tracking-[.22em] text-slate-500">Categories</h2>
            <button onClick={() => setCategory("all")} className={`mb-2 flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm ${category === "all" ? "bg-cyan-300/10 text-cyan-100" : "text-slate-300 hover:bg-white/[.04]"}`}><span>◇ All Skills</span><span className="font-mono text-xs text-slate-500">{marketplaceStats.total}</span></button>
            {categoryCounts.map(([cat, count]) => (
              <button key={cat} onClick={() => setCategory(cat)} className={`mb-2 flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm capitalize ${category === cat ? "bg-cyan-300/10 text-cyan-100" : "text-slate-300 hover:bg-white/[.04]"}`}>
                <span>{categoryIcons[cat] ?? "◇"} {categoryLabels[cat] ?? cat}</span><span className="font-mono text-xs text-slate-500">{count}</span>
              </button>
            ))}
            <h2 className="mb-3 mt-6 text-xs font-black uppercase tracking-[.22em] text-slate-500">Sort</h2>
            {(["recommended", "name", "workflows", "permissions"] as const).map((s) => <button key={s} onClick={() => setSort(s)} className={`mb-2 block w-full rounded-2xl px-3 py-2 text-left text-sm capitalize ${sort === s ? "bg-violet-300/10 text-violet-100" : "text-slate-300 hover:bg-white/[.04]"}`}>{s}</button>)}
          </aside>

          <section className="rounded-3xl border border-white/10 bg-white/[.035] p-5 backdrop-blur-xl">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="text-2xl font-black tracking-tight">All Available Skills</h2><p className="text-sm text-slate-400">Showing {filtered.length} of {marketplaceStats.total} Skills from this repository.</p></div>
              <a href="https://github.com/ahmadrrrtx/xr/tree/main/skills" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm text-cyan-200 hover:border-cyan-300/40"><Github size={16}/> Skills source</a>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((skill) => <SkillCard key={skill.id} skill={skill} selected={selected?.id === skill.id} onSelect={() => setSelectedId(skill.id)} onCopy={() => copy(skill.installCommand, skill.id)} copied={copied === skill.id} />)}
            </div>
            {!filtered.length && <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-slate-400">No Skills match this query. Try clearing filters.</div>}
          </section>

          <aside className="sticky top-6 h-fit rounded-3xl border border-white/10 bg-white/[.035] p-5 backdrop-blur-xl">
            {selected && <SkillInspector skill={selected} onCopy={() => copy(selected.installCommand, `inspect-${selected.id}`)} copied={copied === `inspect-${selected.id}`} />}
          </aside>
        </section>
      </div>
    </main>
  );
}

function Pill({ icon, text }: { icon: ReactNode; text: string }) { return <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[.04] px-3 py-1 text-xs text-slate-300">{icon}{text}</span>; }
function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <div className="rounded-3xl border border-white/10 bg-white/[.04] p-5 backdrop-blur-xl"><div className="mb-3 text-cyan-300">{icon}</div><div className="text-3xl font-black">{value}</div><div className="text-sm text-slate-400">{label}</div></div>; }
function FloatCard({ className, icon, title, text }: { className: string; icon: ReactNode; title: string; text: string }) { return <div className={`absolute rounded-2xl border border-cyan-300/20 bg-black/70 p-4 shadow-[0_0_40px_rgba(0,212,255,.12)] backdrop-blur-xl ${className}`}><div className="mb-2 text-cyan-300">{icon}</div><div className="text-sm font-black">{title}</div><div className="text-xs text-slate-400">{text}</div></div>; }

function SkillCard({ skill, selected, onSelect, onCopy, copied }: { skill: MarketplaceSkill; selected: boolean; onSelect: () => void; onCopy: () => void; copied: boolean }) {
  const risk = riskCount(skill);
  return <article onClick={onSelect} className={`group cursor-pointer overflow-hidden rounded-3xl border bg-gradient-to-b from-slate-900/90 to-black/70 p-5 transition hover:-translate-y-1 hover:border-cyan-300/40 hover:shadow-[0_24px_80px_rgba(0,212,255,.10)] ${selected ? "border-cyan-300/60 shadow-[0_0_0_1px_rgba(0,212,255,.35)]" : "border-white/10"}`}>
    <div className="mb-4 h-24 rounded-2xl border border-cyan-300/10 bg-[radial-gradient(circle_at_20%_20%,rgba(0,212,255,.28),transparent_32%),radial-gradient(circle_at_80%_30%,rgba(168,85,247,.25),transparent_30%),linear-gradient(135deg,rgba(255,255,255,.04),rgba(255,255,255,.01))] p-4"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-300/20 bg-black/40 font-mono font-black text-cyan-200">{initials(skill.name)}</div></div>
    <div className="flex items-start justify-between gap-4"><div><h3 className="text-lg font-black leading-tight">{skill.name}</h3><p className="font-mono text-xs text-slate-500">{skill.id}</p></div><span className={`rounded-full border px-2 py-1 text-[10px] font-bold uppercase ${trustClass(skill.verification)}`}>{skill.verification}</span></div>
    <p className="mt-3 line-clamp-3 min-h-[4.5rem] text-sm leading-6 text-slate-400">{skill.description}</p>
    <div className="mt-4 flex flex-wrap gap-2 text-[11px]"><Badge>{skill.categories[0] ?? "skill"}</Badge><Badge>{skill.workflows.length} workflows</Badge><Badge>{skill.commands.length} commands</Badge><Badge tone={risk ? "warn" : "ok"}>{risk ? `${risk} risky perms` : "safe perms"}</Badge></div>
    <div className="mt-4 flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); onCopy(); }} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-3 py-2 text-xs font-black text-black">{copied ? <CheckCircle2 size={14}/> : <Copy size={14}/>} {copied ? "Copied" : "Install"}</button><button className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300">Details</button></div>
  </article>;
}

function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" }) {
  const cls = tone === "ok" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : tone === "warn" ? "border-amber-300/20 bg-amber-300/10 text-amber-200" : "border-white/10 bg-white/[.04] text-slate-300";
  return <span className={`rounded-full border px-2 py-1 ${cls}`}>{children}</span>;
}

function SkillInspector({ skill, onCopy, copied }: { skill: MarketplaceSkill; onCopy: () => void; copied: boolean }) {
  const risk = riskCount(skill);
  return <div>
    <button onClick={() => {}} className="absolute right-4 top-4 hidden text-slate-500"><X size={16}/></button>
    <div className="mb-4 flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/20 bg-cyan-300/10 font-mono text-lg font-black text-cyan-200">{initials(skill.name)}</div><div><h2 className="text-xl font-black leading-tight">{skill.name}</h2><p className="font-mono text-xs text-slate-500">{skill.id} · v{skill.version}</p></div></div>
    <p className="mb-4 text-sm leading-6 text-slate-300">{skill.longDescription || skill.description}</p>
    <button onClick={onCopy} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-black">{copied ? <CheckCircle2 size={16}/> : <Terminal size={16}/>} {copied ? "Copied" : skill.installCommand}</button>
    <Section title="Trust"><Row label="Publisher" value={skill.publisher}/><Row label="Verification" value={skill.verification}/><Row label="Kind" value={skill.kind}/><Row label="License" value={skill.license}/></Section>
    <Section title="Permissions"><div className="space-y-2">{skill.permissions.length ? skill.permissions.map((p) => <div key={`${p.scope}-${p.reason}`} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between text-sm"><b>{p.scope}</b>{p.dangerous ? <span className="text-amber-300">approval</span> : <span className="text-emerald-300">safe</span>}</div><p className="mt-1 text-xs leading-5 text-slate-500">{p.reason ?? "Declared by Skill manifest."}</p></div>) : <p className="text-sm text-slate-500">No permissions declared.</p>}</div>{risk > 0 && <div className="mt-3 flex gap-2 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-3 text-xs text-amber-100"><AlertTriangle size={16}/> Dangerous permissions still require XR approval.</div>}</Section>
    <Section title="Dependencies"><div className="space-y-2">{skill.dependencies.length ? skill.dependencies.map((d) => <Row key={`${d.kind}-${d.id}`} label={`${d.kind}:${d.id}`} value={d.version ?? (d.optional ? "optional" : "required")}/>) : <p className="text-sm text-slate-500">No dependencies declared.</p>}</div></Section>
    <Section title="Workflows"><div className="space-y-2">{skill.workflows.slice(0, 4).map((w) => <div key={w.id} className="rounded-2xl border border-white/10 p-3"><div className="font-bold text-sm">{w.title}</div><div className="text-xs text-slate-500">{w.steps?.length ?? 0} steps · {w.description}</div></div>)}</div></Section>
    <Section title="Assets"><Row label="Docs" value={`${skill.docs.length}`}/><Row label="Examples" value={`${skill.examples.length}`}/><Row label="Tests" value={`${skill.tests.length}`}/><Row label="Memory templates" value={`${skill.memoryTemplates.length}`}/></Section>
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) { return <section className="mb-5"><h3 className="mb-2 text-xs font-black uppercase tracking-[.22em] text-slate-500">{title}</h3>{children}</section>; }
function Row({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between border-b border-white/5 py-2 text-sm"><span className="text-slate-500">{label}</span><span className="font-medium text-slate-200">{value}</span></div>; }
