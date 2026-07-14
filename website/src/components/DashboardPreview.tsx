"use client";

import { motion } from "framer-motion";
import { Activity, Bot, Cpu, Play, Shield, Sparkles, Terminal as TermIcon } from "lucide-react";

export function DashboardPreview() {
  return (
    <div
      className="relative rounded-2xl overflow-hidden glass shadow-[0_40px_100px_-20px_rgba(124,92,255,0.35)]"
      role="img"
      aria-label="XR Dashboard preview"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <div className="ml-4 flex items-center gap-1 text-[11px] text-zinc-400 font-mono">
          <TermIcon className="h-3 w-3" /> dashboard.xr.dev / runtime
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Live
        </div>
      </div>
      <div className="grid grid-cols-12 gap-0 min-h-[360px]">
        {/* Sidebar */}
        <aside className="col-span-3 border-r border-white/5 p-3 hidden md:block">
          <SidebarItem icon={Sparkles} label="Agents" active />
          <SidebarItem icon={Cpu} label="Runs" />
          <SidebarItem icon={Bot} label="Skills" badge="214" />
          <SidebarItem icon={Shield} label="Policies" />
          <SidebarItem icon={Activity} label="Telemetry" />
          <div className="mt-6 rounded-xl p-3 bg-gradient-to-br from-violet-500/15 to-sky-500/5 border border-white/5">
            <div className="text-xs text-violet-200 font-medium">XR Core 1</div>
            <div className="text-[11px] text-zinc-400 mt-1">Active model · 1M ctx</div>
            <div className="mt-2 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-violet-400 to-sky-400"
                initial={{ width: 0 }}
                animate={{ width: "72%" }}
                transition={{ duration: 1.4, ease: "easeOut" }}
              />
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="col-span-12 md:col-span-9 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-zinc-300 font-medium">Agents</div>
              <div className="text-[11px] text-zinc-500">3 running · 12 today</div>
            </div>
            <button className="text-xs px-3 py-1.5 rounded-lg bg-white text-black font-medium flex items-center gap-1">
              <Play className="h-3 w-3 fill-black" /> New run
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Runs" value="1,284" delta="+12%" />
            <Stat label="Tokens" value="48.2M" delta="+3.1%" />
            <Stat label="Success" value="98.7%" delta="+0.4%" />
          </div>

          <div className="rounded-xl border border-white/5 bg-black/30 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-zinc-300 font-medium flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400 animate-pulse" />
                refactor/auth-ts
              </div>
              <div className="text-[11px] text-zinc-500">running · 12s</div>
            </div>
            <div className="space-y-2 font-mono text-[11.5px]">
              <LogLine status="ok" text="Planned 8 transforms" />
              <LogLine status="ok" text="Migrated JWT helpers (3 files)" />
              <LogLine status="ok" text="Removed deprecated middleware" />
              <LogLine status="pending" text="Opening pull request…" />
            </div>
          </div>

          {/* Sparkline */}
          <div className="rounded-xl border border-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-zinc-300 font-medium">Tokens / sec</div>
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
      className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-[12.5px] cursor-pointer transition-colors ${
        active ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white hover:bg-white/5"
      }`}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="text-[10px] text-zinc-400 bg-white/5 rounded px-1.5 py-0.5">
          {badge}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-xl border border-white/5 p-3 bg-white/[0.02]">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-white mt-0.5 tabular-nums">{value}</div>
      <div className="text-[11px] text-emerald-400 mt-0.5">{delta}</div>
    </div>
  );
}

function LogLine({ status, text }: { status: "ok" | "pending" | "err"; text: string }) {
  const dot =
    status === "ok" ? "bg-emerald-400" : status === "pending" ? "bg-amber-400 animate-pulse" : "bg-rose-400";
  return (
    <div className="flex items-center gap-2 text-zinc-300">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
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
          <stop offset="0" stopColor="#a892ff" stopOpacity="0.6" />
          <stop offset="1" stopColor="#a892ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill="url(#spark)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
      />
      <motion.path
        d={path}
        fill="none"
        stroke="#a892ff"
        strokeWidth="1.2"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.4, ease: "easeOut" }}
      />
    </svg>
  );
}
