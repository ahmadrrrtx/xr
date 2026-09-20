/**
 * PtyTerminal — a REAL terminal pane bound to the engine's PTY route.
 *
 * Every state shown here is an engine event (src/daemon/pty-sessions.ts):
 *   approval_required → the human decides (countdown is the engine's TTL);
 *   open              → shell pid/cwd from the engine, keystrokes flow;
 *   output_dropped    → the engine dropped bytes because we fell behind;
 *   exit              → code/signal from the process, not a guess.
 * Keystrokes go straight to the engine (xterm onData → POST …/input) and
 * output goes straight to xterm (no client-side echo, no fake prompt).
 * Closing the pane aborts the stream; the engine kills the shell on
 * disconnect — the client has no kill path the engine does not own.
 *
 * Motion doctrine: nothing here animates on keyboard input; the only
 * transition is the status line's colour. xterm is loaded with this module,
 * which is itself lazy — the Workspace chunk pays nothing until a shell opens.
 */

import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { api, pty, ptyOpen, type PtyEvent } from "../api/client";
import { ApprovalCountdown } from "./ApprovalCountdown";

type Phase =
  | { kind: "connecting" }
  | { kind: "approval"; approvalId: string; shell?: string; cwd?: string; riskTier?: string; requestedAt: number; ttlMs?: number }
  | { kind: "open"; sessionId: string; pid?: number; shell?: string; cwd?: string }
  | { kind: "denied"; decision: string }
  | { kind: "exited"; code: number | null; signal?: string | null }
  | { kind: "error"; message: string };

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function PtyTerminal({ cwd, onExit }: { cwd?: string; onExit?: (exit: { code: number | null; signal?: string | null }) => void }) {
  const host = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" });
  const [dropped, setDropped] = useState<number>(0);
  const sessionRef = useRef<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: false, // a blinking cursor is an animation nobody asked for
      fontFamily: cssVar("--xr-font-mono", "ui-monospace, monospace"),
      fontSize: 12.5,
      lineHeight: 1.2,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: cssVar("--xr-surface-1", "#101018"),
        foreground: cssVar("--xr-text", "#ececf1"),
        cursor: cssVar("--xr-cyan", "#5ad1ff"),
        selectionBackground: "rgba(90, 209, 255, 0.28)",
        black: "#1a1a24",
        brightBlack: "#6c6c7a",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

    const ac = new AbortController();
    let disposed = false;
    const pendingInput: string[] = [];

    // Keystrokes → engine. Coalesce within a frame so a paste is one request.
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      const id = sessionRef.current;
      if (!id || pendingInput.length === 0) return;
      const data = pendingInput.join("");
      pendingInput.length = 0;
      void pty.input(id, data).catch((e: unknown) => {
        if (!disposed) setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      });
    };
    const onData = term.onData((d) => {
      pendingInput.push(d);
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flush);
      }
    });

    // Size → engine (debounced; the child sees the new size via SIGWINCH/ConPTY).
    let resizeTimer: number | null = null;
    const pushSize = () => {
      const id = sessionRef.current;
      if (!id) return;
      void pty.resize(id, term.cols, term.rows).catch(() => undefined);
    };
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* not laid out yet */ }
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(pushSize, 120);
    });
    ro.observe(el);

    ptyOpen({ cwd, cols: term.cols, rows: term.rows }, (e: PtyEvent) => {
      if (disposed) return;
      if (e.type === "output") {
        term.write(e.data);
      } else if (e.type === "status") {
        if (e.status === "approval_required") {
          setPhase({ kind: "approval", approvalId: e.approvalId, shell: e.shell, cwd: e.cwd, riskTier: e.riskTier, requestedAt: Date.now(), ttlMs: e.ttlMs });
        } else if (e.status === "open") {
          sessionRef.current = e.sessionId;
          setPhase({ kind: "open", sessionId: e.sessionId, pid: e.pid, shell: e.shell, cwd: e.cwd });
          term.focus();
          pushSize(); // the layout may have changed while the approval was pending
        } else if (e.status === "denied" || e.status === "timed_out") {
          setPhase({ kind: "denied", decision: e.status === "timed_out" ? "timed out — denied by policy" : (e.decision ?? "denied") });
        } else if (e.status === "output_dropped") {
          setDropped(e.bytes);
        } else if (e.status === "error") {
          setPhase({ kind: "error", message: e.error ?? "unknown engine error" });
        }
      } else if (e.type === "exit") {
        sessionRef.current = null;
        setPhase({ kind: "exited", code: e.code, signal: e.signal ?? null });
        onExit?.({ code: e.code, signal: e.signal ?? null });
      }
    }, ac.signal).catch((e: unknown) => {
      if (disposed || ac.signal.aborted) return;
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    });

    return () => {
      disposed = true;
      ac.abort(); // the engine kills the shell on disconnect
      onData.dispose();
      ro.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      term.dispose();
    };
    // cwd/onExit are fixed for the life of a pane; a new cwd is a new pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pty" data-phase={phase.kind}>
      {phase.kind === "connecting" && <div className="pty-status faint mono">opening a shell through the engine…</div>}
      {phase.kind === "approval" && (
        <div className="approval-mini" role="group" aria-label="Terminal approval">
          <span className="mono">
            open <b>{phase.shell ?? "shell"}</b> in <b>{phase.cwd === "." || !phase.cwd ? "project root" : phase.cwd}</b> — keystrokes run as you, not policy-inspected
          </span>
          <span className="row-gap">
            <ApprovalCountdown deadline={{ requestedAt: phase.requestedAt, ttlMs: phase.ttlMs }} compact />
            <button className="btn btn-ok" onClick={() => { void api.decide(phase.approvalId, true).catch(() => undefined); }}>Approve</button>
            <button className="btn btn-bad" onClick={() => { void api.decide(phase.approvalId, false).catch(() => undefined); }}>Deny</button>
            {phase.riskTier && <span className="chip">risk {phase.riskTier}</span>}
          </span>
        </div>
      )}
      {phase.kind === "denied" && <div className="approval-mini errline"><span className="mono">✗ {phase.decision} — no shell was started</span></div>}
      {phase.kind === "error" && <div className="approval-mini errline"><span className="mono">{phase.message}</span></div>}
      {dropped > 0 && (
        <div className="approval-mini errline" role="status">
          <span className="mono">output dropped: {dropped.toLocaleString()} bytes — the pane fell behind the 4 MB high-water mark; the shell kept running</span>
        </div>
      )}
      <div className="pty-host" ref={host} aria-label="Interactive terminal" />
      <div className="pty-foot mono faint">
        {phase.kind === "open" && <>pty · pid {phase.pid ?? "?"} · {phase.shell ?? "shell"} · {phase.cwd === "." || !phase.cwd ? "project root" : phase.cwd}</>}
        {phase.kind === "exited" && <>process exited{phase.signal ? ` (${phase.signal})` : phase.code !== null ? ` with code ${phase.code}` : ""} — close the tab or open a new shell</>}
        {phase.kind === "approval" && <>waiting for your decision — nothing has been spawned</>}
        {phase.kind === "connecting" && <>engine · /terminal/pty</>}
      </div>
    </div>
  );
}
