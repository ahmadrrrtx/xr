"use client";

import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Cpu,
  Play,
  Shield,
  Sparkles,
  MessageSquare,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { XrMark } from "./Logo";

/**
 * XR Control Center — product preview.
 *
 * A faithful, calm presentation of the real dashboard surfaces: task input,
 * live execution, system status, and a right-hand activity pane. Mirrors the
 * actual product IA (Home / Chat / Runs / Agents / Extensions / Memory) rather
 * than inventing a generic "admin" screen. Hover-anywhere for a subtle lift.
 */
export function DashboardPreview() {
  return (
    <div
      className="relative group rounded-2xl overflow-hidden border border-white/10"
      style={{ boxShadow: "0 40px 120px -28px rgba(84,111,255,0.42), inset 0 1px 0 rgba(255,255,255,0.05)" }}
      role="img"
      aria-label="XR Control Center preview"
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ background: "radial-gradient(600px 240px at 50% -8%, rgba(40,226,255,0.12), transparent 66%)" }} />

      {/* Window chrome */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/8 bg-white/[0.02]">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <div className="ml-4 flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
          <XrMark size={13} />
          xr serve · control center
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Ready
        </div>
      </div>

      <div className="grid grid-cols-12 gap-0 min-h-[380px]">
        {/* Sidebar */}
        <aside className="col-span-3 border-r border-white/5 p-3 hidden md:block">
          <SidebarItem icon={MessageSquare} label="Home" active />
          <SidebarItem icon={Cpu} label="Chat" />
          <SidebarItem icon={Activity} label="Runs" />
          <SidebarItem icon={Bot} label="Agents" badge="3" />
          <SidebarItem icon={Sparkles} label="Extensions" />
          <SidebarItem icon={Shield} label="Memory" />

          <div className="mt-6 rounded-xl p-3 bg-gradient-to-br from-indigo-500/20 to-cyan-500/10 border border-white/8">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <div className="text-xs text-white font-medium">Agent ready</div>
            </div>
            <div className="text-[11px] text-zinc-400 mt-1">Local model · Phi-3 Mini</div>
            <div className="mt-2.5 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full rounded-full bg-gradient-to-r from-cyan to-indigo"
                initial={{ width: 0 }}
                animate={{ width: "76%" }}
                transition={{ duration: 1.4, ease: "easeOut" }}
              />
            </div>
            <div className="mt-1.5 text-[10px] text-zinc-500">12 tools available</div>
          </div>
        </aside>

        {/* Main */}
        <main className="col-span-12 md:col-span-9 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-200 font-medium">What would you like XR to do?</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">Ask, plan, execute — a real action loop.</div>
            </div>
            <button className="text-xs px-3 py-1.5 rounded-lg bg-white text-black font-medium flex items-center gap-1 transition-transform hover:-translate-y-0.5">
              <Play className="h-3 w-3 fill-black" /> New run
            </button>
          </div>

          {/* Task input */}
          <div className="rounded-xl border border-white/8 bg-black/30 p-3.5 flex items-center gap-2">
            <span className="text-[13px] text-zinc-400">Refactor auth middleware and open a PR…</span>
            <span className="ml-auto h-7 w-7 rounded-lg bg-white text-black flex items-center justify-center">
              <Play className="h-3.5 w-3.5 fill-black" />
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Runs (this session)" value="12" delta="live" />
            <Stat label="Success rate" value="100%" delta="no failures" />
            <Stat label="Active agents" value="3" delta="all healthy" />
          </div>

          {/* Live execution */}
          <div className="rounded-xl border border-white/8 bg-black/30 p-4 transition-colors hover:border-cyan/20">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-zinc-200 font-medium flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-pulse" />
                refactor/auth-ts
              </div>
              <div className="text-[11px] text-zinc-500">running · 12s</div>
            </div>
            <div className="space-y-2 font-mono text-[11.5px]">
              <LogLine status="ok" text="Planned 8 transforms" />
              <LogLine status="ok" text="Migrated JWT helpers (3 files)" />
              <LogLine status="ok" text="Removed deprecated middleware" />
              <LogLine status="pending" text="Approval: creating pull request…" />
            </div>
          </div>

          {/* Sparkline */}
          <div className="rounded-xl border border-white/8 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-zinc-200 font-medium">Tokens / sec</div>
              <div className="text-[11px] text-zinc-500">last 60s</div>
            </div>
            <Sparkline />
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarItem({
  icon: Icon,
  label,
  active,
  badge,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  badge?: string;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12.5px] cursor-pointer transition-all duration-200 ${
        active
          ? "bg-white/10 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
          : "text-zinc-400 hover:text-white hover:bg-white/5 hover:translate-x-0.5"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-[10px] text-zinc-400 bg-white/5 rounded px-1.5 py-0.5">{badge}</span>
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-xl border border-white/8 p-3 bg-white/[0.02] transition-all duration-200 hover:bg-white/[0.04] hover:-translate-y-0.5">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white mt-0.5 tabular-nums">{value}</div>
      <div className="text-[11px] text-emerald-400 mt-0.5">{delta}</div>
    </div>
  );
}

function LogLine({ status, text }: { status: "ok" | "pending" | "err"; text: string }) {
  const dot =
    status === "ok" ? (
      <CheckCircle2 className="h-3 w-3 text-emerald-400" />
    ) : status === "pending" ? (
      <Clock className="h-3 w-3 text-amber-400 animate-pulse" />
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
    );
  return (
    <div className="flex items-center gap-2 text-zinc-300">
      {dot}
      <span>{text}</span>
    </div>
  );
}

function Sparkline() {
  const points = [
    4, 12, 8, 20, 18, 30, 26, 36, 32, 42, 38, 48, 46, 58, 54, 70, 64, 78, 72, 82, 76, 88, 82, 92, 86,
    78, 84, 72, 80, 68, 74, 62,
  ];
  const w = 100;
  const h = 36;
  const max = Math.max(...points);
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - (p / max) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  const area = `${path} L${w},${h} L0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6b7cff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#6b7cff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill="url(#spark)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }} />
      <motion.path
        d={path}
        fill="none"
        stroke="#6b7cff"
        strokeWidth="1.2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
    </svg>
  );
}
