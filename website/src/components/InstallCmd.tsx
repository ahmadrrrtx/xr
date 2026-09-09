"use client";

import { site } from "@/lib/site";
import { CopyButton } from "./CopyButton";

export function InstallCmd() {
  return (
    <div className="group flex items-center gap-2 rounded-xl border border-slate-700/40 bg-slate-900/50 backdrop-blur px-4 py-3 max-w-md shadow-[0_10px_40px_-10px_rgba(56,189,248,0.15)]">
      <span className="text-cyan-400 font-mono text-sm select-none">$</span>
      <code className="flex-1 font-mono text-sm text-slate-100 tracking-tight truncate">
        {site.installCmd}
      </code>
      <CopyButton text={site.installCmd} />
    </div>
  );
}
