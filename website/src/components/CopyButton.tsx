"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Copy-to-clipboard button with honest feedback (Phase 31 · C8/C10):
 * a transient toast says "Copied to clipboard" on success and
 * "Copy failed — press Ctrl+C" when the Clipboard API refuses (insecure
 * context, denied permission), instead of silently doing nothing. The
 * check icon stays as the inline confirmation for 1.5s.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const flash = (message: string) => {
    setToast(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 1500);
  };

  return (
    <>
      <button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            flash("Copied to clipboard");
            setTimeout(() => setCopied(false), 1500);
          } catch {
            flash("Copy failed — press Ctrl+C");
          }
        }}
        aria-label="Copy to clipboard"
        className={`p-1.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors ${className ?? ""}`}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
      </button>
      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-900 px-3.5 py-2 text-[13px] text-zinc-100 shadow-2xl"
        >
          {toast}
        </div>
      )}
    </>
  );
}
