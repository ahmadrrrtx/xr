/*
 * TerminalPane (Phase 17) — xterm.js ↔ engine PTY (Phase 6 terminal routes,
 * now with `projectId` so the shell starts in the workspace root).
 *
 * Opening a shell is a Shield-approved action: the PTY open stream raises
 * `status: approval_required` which we bridge into the Phase 7 modal. The
 * last 40 lines are mirrored to the store for chat context.
 */
import '@xterm/xterm/css/xterm.css';

import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { bridgeEngineApproval } from '@/engine/approvals';
import { openPty, ptyApprovalFromFrame, ptyClose, ptyInput, ptyResize, type PtyFrame } from '@/engine/builder';
import { readSse } from '@/engine/sse';
import { EngineDown, EngineHttpError } from '@/engine/transport';
import { useBuilderStore } from '@/stores/builderStore';

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function themeFor(): Record<string, string> {
  return {
    background: cssVar('--editor-bg', '#070b14'),
    foreground: cssVar('--syn-fg', '#e6f0f8'),
    cursor: cssVar('--accent', '#00e5ff'),
    selectionBackground: cssVar('--syn-selection', 'rgba(0,229,255,0.18)'),
    black: '#1f2937',
    brightBlack: '#6b7280',
  };
}

export function TerminalPane({ projectId, cwd, onClose, height }: { projectId: string; cwd: string; onClose: () => void; height: number }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<'opening' | 'approval' | 'open' | 'exited' | 'error'>('opening');
  const [note, setNote] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new XTerm({
      fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 12.5,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 2_000,
      theme: themeFor(),
      convertEol: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      /* host not laid out yet */
    }
    const controller = new AbortController();
    let sessionId: string | null = null;
    let closed = false;
    const tail: string[] = [];
    let line = '';
    const pushTail = (data: string) => {
      for (const ch of data) {
        if (ch === '\n') {
          // eslint-disable-next-line no-control-regex -- strip ANSI CSI sequences
          tail.push(line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trimEnd());
          if (tail.length > 40) tail.shift();
          line = '';
        } else if (ch !== '\r') line += ch;
      }
      useBuilderStore.getState().setTerminalTail(tail);
    };

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
      if (sessionId) void ptyResize(sessionId, term.cols, term.rows).catch(() => undefined);
    });
    ro.observe(host);

    const inputDisposable = term.onData((data) => {
      if (sessionId) void ptyInput(sessionId, data).catch(() => undefined);
    });

    let blockedReason: string | null = null;
    let deniedSeen = false;
    void (async () => {
      try {
        setState('opening');
        const res = await openPty(projectId, term.cols || 80, term.rows || 24, controller.signal);
        await readSse(
          res,
          (payload) => {
            if (payload === '[DONE]') return;
            let frame: PtyFrame;
            try {
              frame = JSON.parse(payload) as PtyFrame;
            } catch {
              return;
            }
            if (frame.type === 'output') {
              term.write(frame.data);
              pushTail(frame.data);
              return;
            }
            if (frame.type === 'exit') {
              setState('exited');
              setNote(frame.code !== null ? `Shell exited with code ${frame.code}` : `Shell exited (${frame.signal ?? 'signal'})`);
              return;
            }
            switch (frame.status) {
              case 'approval_required':
                setState('approval');
                setNote('Waiting for approval to open a shell…');
                void bridgeEngineApproval(ptyApprovalFromFrame(frame, cwd), controller.signal).then((o) => {
                  // A policy block never showed a modal — say why, and where to
                  // change it. The engine's `denied` frame can land first.
                  if (!o.blocked || closed) return;
                  blockedReason = `${o.reason ?? 'Blocked by XR Shield.'} (Shield › Security)`;
                  if (deniedSeen) setNote(blockedReason);
                });
                return;
              case 'open':
                sessionId = frame.sessionId ?? null;
                setState('open');
                setNote(null);
                try {
                  fit.fit();
                } catch {
                  /* ignore */
                }
                if (sessionId) void ptyResize(sessionId, term.cols, term.rows).catch(() => undefined);
                term.focus();
                return;
              case 'denied':
                deniedSeen = true;
                setState('error');
                setNote(blockedReason ?? 'Not approved — the shell was not opened.');
                return;
              case 'timed_out':
                setState('error');
                setNote('Approval timed out — the shell was not opened.');
                return;
              case 'output_dropped':
                term.write(`\r\n\x1b[2m[${frame.bytes ?? '?'} bytes of output dropped]\x1b[0m\r\n`);
                return;
              case 'error':
                setState('error');
                setNote(frame.error ?? 'The terminal could not start.');
                return;
              default:
                return;
            }
          },
          controller.signal,
        );
        if (!closed) setState((s) => (s === 'open' ? 'exited' : s));
      } catch (e) {
        if (controller.signal.aborted) return;
        setState('error');
        setNote(e instanceof EngineDown ? 'Engine unreachable.' : e instanceof EngineHttpError ? e.message : 'The terminal could not start.');
      }
    })();

    return () => {
      closed = true;
      controller.abort();
      ro.disconnect();
      inputDisposable.dispose();
      if (sessionId) void ptyClose(sessionId).catch(() => undefined);
      term.dispose();
    };
  }, [projectId, cwd, generation]);

  return (
    <div className="xb-term" style={{ height }} data-testid="builder-terminal">
      <div className="xb-term-head">
        <span className="xb-pane-title">Terminal</span>
        <span className="text-text-tertiary xb-mono text-[11px]">{cwd}</span>
        <span className="xb-top-spacer" />
        {state === 'exited' || state === 'error' ? (
          <button type="button" className="xb-icon-btn" aria-label="New shell" title="New shell" onClick={() => setGeneration((g) => g + 1)}>
            <Plus size={13} />
          </button>
        ) : null}
        <button type="button" className="xb-icon-btn" aria-label="Close terminal" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {note ? <div className="xb-term-note">{note}</div> : null}
      <div ref={hostRef} className="xb-term-body" />
    </div>
  );
}
