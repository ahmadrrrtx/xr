"use client";

import { motion } from "framer-motion";
import {
  Home as HomeIcon,
  MessageSquare,
  History,
  Bot,
  Cpu,
  Puzzle,
  Brain,
  ShieldCheck,
  Settings,
  Plus,
  Lock,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Control Center preview — mirrors the real XR dashboard shell
 * (9-area IA: Home, Chat, Runs, Agents, Models, Extensions, Memory,
 * Guardrails, Settings) and its honest first-class surfaces: local-first
 * status, real approval flow (what / allow once / deny / details).
 * No invented telemetry counters.
 */
export function DashboardPreview() {
  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0e15]/90 backdrop-blur shadow-[var(--shadow-card),0_40px_90px_-30px_rgba(0,0,0,0.7)] transition-all duration-300 hover:shadow-[var(--shadow-card-hover)]"
      role="img"
      aria-label="XR Control Center preview"
    >
      {/* Chrome */}
      <div className="flex items-center gap-2 border-b border-white/6 px-4 py-3 bg-white/[0.02]">
        <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
        <div className="ml-4 flex items-center gap-1.5 text-[11px] text-zinc-400 font-mono">
          <Lock className="h-3 w-3 text-emerald-400" />
          127.0.0.1:3141 — Control Center
        </div>
        <div className="ml-auto flex items-center gap-1.5 text-[11px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" />
          Local · XR 1.0.0
        </div>
      </div>

      <div className="grid grid-cols-12">
        {/* Sidebar — real 9-area IA */}
        <aside className="col-span-3 hidden border-r border-white/5 p-3 md:block">
          <SidebarItem icon={HomeIcon} label="Home" active />
          <SidebarItem icon={MessageSquare} label="Chat" />
          <SidebarItem icon={History} label="Runs" />
          <SidebarItem icon={Bot} label="Agents" />
          <SidebarItem icon={Cpu} label="Models" />
          <SidebarItem icon={Puzzle} label="Extensions" />
          <SidebarItem icon={Brain} label="Memory" />
          <SidebarItem icon={ShieldCheck} label="Guardrails" />
          <SidebarItem icon={Settings} label="Settings" />
        </aside>

        {/* Main */}
        <main className="col-span-12 space-y-3 p-4 md:col-span-9 md:p-5">
          {/* Row 1: heading */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium text-white">Home</div>
              <div className="text-[11px] text-zinc-500">What would you like XR to do?</div>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-black shadow-[0_8px_20px_-8px_rgba(255,255,255,0.4)]">
              <Plus className="h-3.5 w-3.5" /> New task
            </div>
          </div>

          {/* Row 2: local-first status strip (honest states) */}
          <div className="grid grid-cols-3 gap-2">
            <StatusCell dot="emerald" title="Runtime" value="ready · local" />
            <StatusCell dot="emerald" title="Provider" value="Ollama · qwen2.5:7b" mono />
            <StatusCell dot="cyan" title="Audit" value="chain verified" />
          </div>

          {/* Row 3: task card with approval */}
          <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3.5 transition-colors hover:border-cyan-400/20">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-200">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                <span className="truncate">summarize open TODOs in this repo</span>
              </div>
              <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-zinc-400">
                Agent mode
              </span>
            </div>
            <div className="mt-3 space-y-1.5 font-mono text-[11px] text-zinc-400">
              <LogLine status="ok" text="Plan ready — 3 steps" />
              <LogLine status="ok" text="Found 12 TODO comments across src/ and docs/" />
              <LogLine status="pending" text="Asking permission to write docs/todos-summary.md…" />
            </div>

            {/* Approval surface */}
            <div className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-3">
              <div className="flex items-start gap-2.5">
                <div className="mt-0.5 rounded-md bg-amber-400/15 p-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-medium text-zinc-100">Approval required</div>
                  <div className="mt-0.5 text-[11px] text-zinc-400">
                    <span className="font-mono text-cyan-300">write_file</span> docs/todos-summary.md
                    <span className="text-zinc-500"> · 14 lines · workspace scope</span>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                  <Eye className="h-3 w-3" /> Details
                </span>
              </div>
              <div className="mt-2.5 flex gap-1.5">
                <button className="rounded-md border border-white/12 bg-white/[0.03] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-rose-400/40 hover:text-rose-300">
                  Deny
                </button>
                <motion.button
                  whileHover={{ y: -1 }}
                  className="rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-black shadow-[0_6px_16px_-6px_rgba(255,255,255,0.35)]"
                >
                  Allow once
                </motion.button>
              </div>
            </div>
          </div>

          {/* Row 4: memories / quick links */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Memory</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-300">
                <Brain className="h-3.5 w-3.5 text-cyan-400" /> Empty — learning from your first runs
              </div>
            </div>
            <div className="rounded-xl border border-white/6 bg-white/[0.02] p-3">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">Recent runs</div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-300">
                <History className="h-3.5 w-3.5 text-violet-400" /> This session is your first — try a task
              </div>
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
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors",
        active
          ? "bg-white/10 font-medium text-white shadow-[inset_0_0_0_1px_rgba(0,212,255,0.15)]"
          : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </div>
  );
}

function StatusCell({
  dot,
  title,
  value,
  mono,
}: {
  dot: "emerald" | "cyan";
  title: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-white/12">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{title}</div>
      <div
        className={cn(
          "mt-1 flex items-center gap-1.5 text-[11.5px] text-zinc-200",
          mono && "font-mono"
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            dot === "emerald" ? "bg-emerald-400 pulse-dot" : "bg-cyan-400"
          )}
        />
        {value}
      </div>
    </div>
  );
}

function LogLine({ status, text }: { status: "ok" | "pending"; text: string }) {
  const color =
    status === "ok" ? "text-emerald-300/90" : status === "pending" ? "text-amber-300/90" : "text-zinc-400";
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          "h-1 w-1 shrink-0 rounded-full",
          status === "ok" ? "bg-emerald-400" : "bg-amber-400 animate-pulse"
        )}
      />
      <span className={color}>{text}</span>
    </div>
  );
}
