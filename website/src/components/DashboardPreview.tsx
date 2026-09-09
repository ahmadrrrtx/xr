"use client";

import { motion } from "framer-motion";
import {
  Activity,
  Bot,
  Cpu,
  Play,
  Shield,
  Sparkles,
  Terminal as TermIcon,
} from "lucide-react";

export function DashboardPreview() {
  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-slate-700/40 bg-slate-800/20 shadow-[0_40px_100px_-20px_rgba(56,189,248,0.15)]"
      role="img"
      aria-label="XR Dashboard preview"
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700/40 bg-slate-900/50">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <div className="ml-4 flex items-center gap-1 text-[11px] text-slate-400 font-mono">
          <TermIcon className="h-3 w-3" /> dashboard.xr.dev / runtime
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-400">
          <span className="status-dot active" />
          Live
        </div>
      </div>
      <div className="grid grid-cols-12 gap-0 min-h-[340px]">
        {/* Sidebar */}
        <aside className="col-span-3 border-r border-slate-700/40 p-3 hidden md:block">
          <SidebarItem icon={Sparkles} label="Agents" active />
          <SidebarItem icon={Cpu} label="Runs" />
          <SidebarItem icon={Bot} label="Skills" badge="214" />
          <SidebarItem icon={Shield} label="Policies" />
          <SidebarItem icon={Activity} label="Telemetry" />
          <div className="mt-6 rounded-xl p-3 bg-slate-800/40 border border-slate-700/40">
            <div className="text-xs text-cyan-300 font-medium">XR Core 1</div>
            <div className="text-[11px] text-slate-400 mt-1">Active model · 1M ctx</div>
            <div className="mt-2 progress-track">
              <motion.div
                className="progress-fill"
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
              <div className="text-sm text-slate-200 font-medium">Agents</div>
              <div className="text-[11px] text-slate-500">3 running · 12 today</div>
            </div>
            <button className="text-xs px-3 py-1.5 rounded-lg bg-cyan-500 text-slate-900 font-medium flex items-center gap-1">
              <Play className="h-3 w-3 fill-slate-900" /> New run
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Stat label="Runs" value="1,284" delta="+12%" />
            <Stat label="Tokens" value="48.2M" delta="+3.1%" />
            <Stat label="Success" value="98.7%" delta="+0.4%" />
          </div>

          <div className="rounded-xl border border-slate-700/40 bg-slate-900/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-slate-300 font-medium flex items-center gap-2">
                <span className="status-dot processing" />
                refactor/auth-ts
              </div>
              <div className="text-[11px] text-slate-500">running · 12s</div>
            </div>
            <div className="space-y-2 font-mono text-[11.5px]">
              <LogLine status="ok" text="Planned 8 transforms" />
              <LogLine status="ok" text="Migrated JWT helpers (3 files)" />
              <LogLine status="ok" text="Removed deprecated middleware" />
              <LogLine status="pending" text="Opening pull request…" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Approvals</div>
              <div className="text-lg font-semibold text-slate-100">2</div>
              <div className="text-[11px] text-amber-400 mt-0.5">pending review</div>
            </div>
            <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3">
              <div className="text-[11px] text-slate-500 mb-1">Budget used</div>
              <div className="text-lg font-semibold text-slate-100">$4.21</div>
              <div className="text-[11px] text-emerald-400 mt-0.5">of $20.00</div>
            </div>
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
      className={`nav-item ${active ? "active" : ""}`}
      style={{ fontSize: 12, padding: "6px 10px", marginBottom: 2 }}
    >
      <Icon className={`h-3.5 w-3.5 ${active ? "text-cyan-400" : "text-slate-500"}`} />
      <span>{label}</span>
      {badge && (
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-slate-700/50 text-slate-400">
          {badge}
        </span>
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta: string }) {
  return (
    <div className="rounded-xl border border-slate-700/40 bg-slate-800/20 p-3">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-100 tabular-nums">{value}</div>
      <div className="text-[11px] text-emerald-400">{delta}</div>
    </div>
  );
}

function LogLine({ status, text }: { status: "ok" | "pending" | "error"; text: string }) {
  const color =
    status === "ok"
      ? "text-emerald-400"
      : status === "error"
      ? "text-red-400"
      : "text-slate-500";
  const icon = status === "ok" ? "✓" : status === "error" ? "✗" : "○";
  return (
    <div className={`${color} flex items-center gap-2`}>
      <span>{icon}</span>
      <span>{text}</span>
    </div>
  );
}
