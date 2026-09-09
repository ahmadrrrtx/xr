"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

function useTypingLineRef() {
  const typingLineRef = useRef<number>(-1);
  return typingLineRef;
}

const LINES: Array<{ prompt?: string; text: string; kind?: "out" | "ok" | "info" | "dim"; delay?: number }> = [
  { prompt: "$", text: "npm i -g @rrrtx/xr" },
  { text: "added 1 package in 2.1s", kind: "dim" },
  { prompt: "$", text: "xr", delay: 300 },
  { text: "XR 4.0.0 — Your AI Operating System — ready.", kind: "ok" },
  { text: "→ Connecting to model: Phi-3 Mini", kind: "info" },
  { text: "→ Skills loaded: 214", kind: "info" },
  { prompt: "λ", text: "refactor src/auth --target ts" },
  { text: "◐ Parsing codebase (412 files)", kind: "dim" },
  { text: "✓ Planned 8 transforms", kind: "ok" },
  { text: "✓ Migrated JWT helpers (3 files)", kind: "ok" },
  { text: "✓ Removed deprecated middleware", kind: "ok" },
  { text: "✓ Opened PR #482: refactor/auth-ts", kind: "ok" },
];

export function Terminal({ className }: { className?: string }) {
  const [visible, setVisible] = useState(0);
  const [typing, setTyping] = useState<string>("");
  const typingLineRef = useTypingLineRef();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;

    const reset = () => {
      if (!cancelled) {
        setVisible(0);
        setTyping("");
        typingLineRef.current = -1;
      }
    };
    const next = () => {
      if (cancelled) return;
      setVisible((v) => v + 1);
    };

    if (visible >= LINES.length) {
      timer = setTimeout(reset, 4000);
      return () => {
        cancelled = true;
        if (timer) clearTimeout(timer);
      };
    }

    const line = LINES[visible];
    const delay =
      line.delay ?? (line.kind === "dim" || line.kind === "ok" || line.kind === "info" ? 480 : 0);

    if (line.prompt && typingLineRef.current !== visible) {
      typingLineRef.current = visible;
      timer = setTimeout(() => {
        if (cancelled) return;
        let i = 0;
        setTyping("");
        interval = setInterval(() => {
          if (cancelled) return;
          i++;
          setTyping(line.text.slice(0, i));
          if (i >= line.text.length) {
            if (interval) clearInterval(interval);
            timer = setTimeout(() => {
              if (!cancelled) {
                setTyping("");
                typingLineRef.current = -1;
                next();
              }
            }, 280);
          }
        }, 35);
      }, 0);
    } else if (!line.prompt) {
      timer = setTimeout(() => {
        if (!cancelled) next();
      }, delay);
    }

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [visible]);

  return (
    <div
      className={cn(
        "terminal group hover:border-cyan-500/15 transition-all duration-500 hover:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7),0_0_0_1px_rgba(56,189,248,0.08)]",
        className
      )}
      role="img"
      aria-label="Animated XR terminal demo"
    >
      <div className="terminal-header">
        <span className="terminal-dot" style={{ background: "#ff5f57" }} />
        <span className="terminal-dot" style={{ background: "#febc2e" }} />
        <span className="terminal-dot" style={{ background: "#28c840" }} />
        <span className="ml-3 text-xs text-slate-500 font-mono">~/projects/acme — zsh — 80×24</span>
      </div>
      <div className="p-5 text-[13px] leading-relaxed font-mono">
        {LINES.slice(0, visible).map((l, i) => (
          <Line key={i} line={l} />
        ))}
        {visible < LINES.length && LINES[visible].prompt && (
          <div className="flex items-start gap-2">
            <span className="text-cyan-400 shrink-0">{LINES[visible].prompt}</span>
            <span className="text-slate-200 caret">{typing}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ line }: { line: (typeof LINES)[number] }) {
  const color =
    line.kind === "ok"
      ? "text-emerald-400"
      : line.kind === "info"
      ? "text-cyan-400"
      : line.kind === "dim"
      ? "text-slate-500"
      : "text-slate-200";
  return (
    <div className="flex items-start gap-2">
      {line.prompt ? (
        <>
          <span className="text-cyan-400 shrink-0">{line.prompt}</span>
          <span className={color}>{line.text}</span>
        </>
      ) : (
        <span className={cn(color, "pl-4")}>{line.text}</span>
      )}
    </div>
  );
}
