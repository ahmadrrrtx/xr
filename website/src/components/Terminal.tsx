"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Terminal demo — an honest walkthrough of a real XR session:
 * install, first run, one task, an approval, a done state.
 * No invented versions, packages, model names or counters.
 */

type Line = { kind: "cmd" | "dim" | "ok" | "info" | "warn" | "ask" | "out"; text: string; delay?: number; typeout?: boolean };

const LINES: Line[] = [
  { kind: "cmd", text: "npm i -g @rrrtx/xr", typeout: true },
  { kind: "dim", text: "added 1 package in 2.4s", delay: 650 },
  { kind: "cmd", text: "xr", delay: 350, typeout: true },
  { kind: "ok", text: "XR 1.0.0 (Truth) — ready.", delay: 700 },
  { kind: "dim", text: "· 65 bundled skills · memory: empty · audit: chain intact", delay: 550 },
  { kind: "dim", text: "· no provider configured — run `xr onboarding` to connect a model", delay: 600 },
  { kind: "cmd", text: 'xr "summarize the open TODOs in this repo"', typeout: true },
  { kind: "info", text: "⟳ planning: scanning repo index…", delay: 700 },
  { kind: "ok", text: "✓ plan ready — 3 steps", delay: 550 },
  { kind: "info", text: "⟳ reading TODO comments across src/ and docs/…", delay: 800 },
  { kind: "ok", text: "✓ found 12 TODO comments · grouped by area", delay: 700 },
  { kind: "ask", text: "? write docs/todos-summary.md (14 lines) — approve?  [y/n]", delay: 800 },
  { kind: "cmd", text: "y", delay: 400, typeout: true },
  { kind: "ok", text: "✓ approved · wrote docs/todos-summary.md", delay: 700 },
  { kind: "ok", text: "✓ task finished in 6.1s · session #0042 · audit verified", delay: 900 },
];

export function Terminal({ className }: { className?: string }) {
  const [idx, setIdx] = useState(0);
  const [typing, setTyping] = useState("");
  const typingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let to: ReturnType<typeof setTimeout> | undefined;
    let iv: ReturnType<typeof setInterval> | undefined;

    if (idx >= LINES.length) {
      to = setTimeout(() => {
        if (!cancelled) setIdx(0);
      }, 8000);
      return () => {
        cancelled = true;
        if (to) clearTimeout(to);
      };
    }

    const line = LINES[idx];
    if (line.typeout && !typingRef.current) {
      typingRef.current = true;
      let i = 0;
      setTyping("");
      iv = setInterval(() => {
        i++;
        setTyping(line.text.slice(0, i));
        if (i >= line.text.length) {
          if (iv) clearInterval(iv);
          to = setTimeout(() => {
            if (!cancelled) {
              typingRef.current = false;
              setIdx((v) => v + 1);
            }
          }, 350);
        }
      }, 26);
    } else if (!line.typeout) {
      to = setTimeout(() => {
        if (!cancelled) setIdx((v) => v + 1);
      }, line.delay ?? 600);
    }

    return () => {
      cancelled = true;
      if (to) clearTimeout(to);
      if (iv) clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  return (
    <div className={cn("terminal", className)} role="img" aria-label="Animated XR terminal walkthrough">
      <div className="terminal-header">
        <span className="terminal-dot" style={{ background: "#ff5f57" }} />
        <span className="terminal-dot" style={{ background: "#febc2e" }} />
        <span className="terminal-dot" style={{ background: "#28c840" }} />
        <span className="ml-3 text-xs text-zinc-500 font-mono">xr — local shell</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" /> local
        </span>
      </div>
      <div className="p-5 text-[13px] leading-relaxed font-mono">
        {LINES.slice(0, idx).map((l, i) => (
          <LineView key={i} line={l} />
        ))}
        {idx < LINES.length && LINES[idx].typeout && (
          <div className="flex items-start gap-2">
            <Prompt kind="cmd" />
            <span className="text-zinc-100 caret">{typing}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Prompt({ kind }: { kind: Line["kind"] }) {
  if (kind === "cmd") return <span className="text-cyan-300 shrink-0 select-none">λ</span>;
  if (kind === "ask") return <span className="text-amber-300 shrink-0 select-none">?</span>;
  return <span className="text-zinc-600 shrink-0 select-none">·</span>;
}

function LineView({ line }: { line: Line }) {
  const color =
    line.kind === "ok"
      ? "text-emerald-300"
      : line.kind === "info"
      ? "text-cyan-200"
      : line.kind === "warn"
      ? "text-amber-300"
      : line.kind === "ask"
      ? "text-amber-200"
      : line.kind === "dim"
      ? "text-zinc-500"
      : "text-zinc-100";
  if (line.kind === "cmd" || line.kind === "ask") {
    return (
      <div className="flex items-start gap-2">
        <Prompt kind={line.kind} />
        <span className={color}>{line.text}</span>
      </div>
    );
  }
  return <div className={cn(color, "pl-4")}>{line.text}</div>;
}
