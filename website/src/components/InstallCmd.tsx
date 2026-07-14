"use client";

import { site } from "@/lib/site";
import { CopyButton } from "./CopyButton";

export function InstallCmd() {
  return (
    <div className="group flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 backdrop-blur px-4 py-3 max-w-md shadow-[0_10px_40px_-10px_rgba(124,92,255,0.3)]">
      <span className="text-violet-300 font-mono text-sm select-none">$</span>
      <code className="flex-1 font-mono text-sm text-zinc-100 tracking-tight truncate">
        {site.installCmd}
      </code>
      <CopyButton text={site.installCmd} />
    </div>
  );
}
