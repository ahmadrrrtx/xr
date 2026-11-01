/*
 * BottomPanel (UI-redesign 2026-10-29) — the VS Code-style panel under the
 * editor: Terminal · Problems · Output · Tests · Ports.
 *
 * One strip replaces the two ad-hoc drawers (terminal drawer + preview
 * console) that previously lived in different corners. Everything real:
 *   Terminal — the same lazy xterm ↔ engine PTY as before;
 *   Problems — live LSP diagnostics for open buffers (engine /diagnostics);
 *   Output  — dev-server console lines (moved out of the preview pane);
 *   Tests   — no fake runner: the project's tests run in the terminal;
 *   Ports   — the engine-managed dev server's port / url / state.
 *
 * Geometry and the active tab live in builderStore and persist across
 * sessions (xr.builder.bottom.tab / .visible / panes.bottom).
 */
import { AlertTriangle, CircleAlert, CircleX, Info, RotateCw, Square, TerminalSquare, Trash2 } from 'lucide-react';
import { lazy, Suspense, useMemo } from 'react';

import { Resizer } from '@/components/Resizer';
import { formatClock, type ConsoleLevel } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { DEFAULT_BOTTOM_H, MIN_BOTTOM_H, useBuilderStore, type BottomTab } from '@/stores/builderStore';

import type { Diagnostic } from '@/engine/builder';

// xterm is only paid for when a terminal tab is shown.
const TerminalPane = lazy(() => import('./TerminalPane').then((m) => ({ default: m.TerminalPane })));

const HEADER_H = 34;

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'tests', label: 'Tests' },
  { id: 'ports', label: 'Ports' },
];

export function BottomPanel({
  projectId,
  cwd,
  bodyH,
}: {
  projectId: string;
  cwd: string;
  bodyH: number;
}) {
  const tab = useBuilderStore((s) => s.bottomTab);
  const setBottomTab = useBuilderStore((s) => s.setBottomTab);
  const setBottomH = useBuilderStore((s) => s.setBottomH);
  const bottomH = useBuilderStore((s) => s.bottomH);
  const diagnostics = useBuilderStore((s) => s.diagnostics);
  const diagnosticsAvailable = useBuilderStore((s) => s.diagnosticsAvailable);
  const consoleLines = useBuilderStore((s) => s.consoleLines);

  const problemCount = useMemo(
    () => Object.values(diagnostics).reduce((n, list) => n + list.length, 0),
    [diagnostics]
  );
  const errorCount = useMemo(
    () => Object.values(diagnostics).reduce((n, list) => n + list.filter((d) => d.severity === 'error').length, 0),
    [diagnostics]
  );
  const bodyHpx = Math.max(MIN_BOTTOM_H - HEADER_H, bottomH - HEADER_H);

  return (
    <>
      <Resizer
        orientation="horizontal"
        storageKey="xr.builder.panes.bottom"
        value={bottomH}
        onChange={setBottomH}
        min={MIN_BOTTOM_H}
        max={Math.max(MIN_BOTTOM_H, Math.round(bodyH * 0.7))}
        defaultValue={DEFAULT_BOTTOM_H}
        invert
        label="Resize bottom panel"
      />
      <section className="xb-bp" data-testid="builder-bottom-panel" aria-label="Panel" style={{ height: bottomH }}>
        {/* The tablist contains ONLY tabs (axe aria-required-children); the
            spacer and the close button are its siblings in the header row. */}
        <div className="xb-bp-head">
          <div className="xb-bp-tabs" role="tablist" aria-label="Panel sections">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                data-testid={`builder-tab-${id}`}
                className={cn('xb-bp-tab', tab === id && 'is-active')}
                onClick={() => setBottomTab(id)}
              >
                {label}
                {id === 'problems' && problemCount > 0 ? (
                  <span className={cn('xb-bp-badge', errorCount > 0 && 'is-error')}>{problemCount}</span>
                ) : null}
                {id === 'output' && consoleLines.length > 0 ? <span className="xb-bp-badge">{consoleLines.length}</span> : null}
              </button>
            ))}
          </div>
          <span className="xb-bp-spacer" />
          <button
            type="button"
            className="xb-icon-btn"
            aria-label="Close panel"
            title="Close panel (⌃`)"
            onClick={() => useBuilderStore.getState().toggleTerminal(false)}
          >
            ×
          </button>
        </div>
        <div className="xb-bp-body" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'terminal' ? (
            <Suspense fallback={<div className="xb-bp-loading" aria-busy="true" />}>
              <TerminalPane
                projectId={projectId}
                cwd={cwd}
                height={bodyHpx}
                onClose={() => useBuilderStore.getState().toggleTerminal(false)}
              />
            </Suspense>
          ) : tab === 'problems' ? (
            <ProblemsTab diagnostics={diagnostics} available={diagnosticsAvailable} />
          ) : tab === 'output' ? (
            <OutputTab />
          ) : tab === 'tests' ? (
            <TestsTab />
          ) : (
            <PortsTab />
          )}
        </div>
      </section>
    </>
  );
}

/* ── Problems ──────────────────────────────────────────────────────────── */

function ProblemsTab({ diagnostics, available }: { diagnostics: Record<string, Diagnostic[]>; available: boolean | null }) {
  const rows = useMemo(
    () =>
      Object.entries(diagnostics)
        .flatMap(([path, list]) => list.map((d) => ({ path, d })))
        .sort((a, b) => rank(a.d) - rank(b.d) || a.path.localeCompare(b.path)),
    [diagnostics]
  );

  if (rows.length === 0) {
    return (
      <div className="xb-bp-empty">
        {available === false ? (
          <>Diagnostics are unavailable for this buffer type — nothing to report.</>
        ) : (
          <>No problems detected in open buffers.</>
        )}
      </div>
    );
  }

  return (
    <div className="xb-bp-list" data-testid="builder-problems">
      {rows.map(({ path, d }, i) => {
        const Icon = d.severity === 'error' ? CircleX : d.severity === 'warning' ? AlertTriangle : CircleAlert;
        return (
          <button
            key={`${path}:${i}`}
            type="button"
            className={cn('xb-bp-problem', `is-${d.severity}`)}
            onClick={() => useBuilderStore.getState().setActive(path)}
            title={`Open ${path}`}
          >
            <Icon size={13} aria-hidden="true" />
            <span className="msg">{d.message}</span>
            <span className="path">{path}</span>
          </button>
        );
      })}
    </div>
  );
}

function rank(d: Diagnostic): number {
  return d.severity === 'error' ? 0 : d.severity === 'warning' ? 1 : 2;
}

/* ── Output (dev-server console, moved from the preview pane) ──────────── */

const FILTERS: Array<ConsoleLevel | 'all'> = ['all', 'log', 'info', 'warn', 'error'];

function OutputTab() {
  const lines = useBuilderStore((s) => s.consoleLines);
  const filter = useBuilderStore((s) => s.consoleFilter);
  const shown = filter === 'all' ? lines : lines.filter((l) => l.level === filter);

  return (
    <div className="xb-console xb-bp-console" data-testid="builder-console">
      <div className="xb-console-head">
        <span className="text-text-tertiary text-[11px]">dev server output</span>
        <span className="xb-top-spacer" />
        <select
          className="xb-console-filter"
          aria-label="Filter output"
          value={filter}
          onChange={(e) => useBuilderStore.getState().setConsoleFilter(e.target.value as ConsoleLevel | 'all')}
        >
          {FILTERS.map((f) => (
            <option key={f} value={f}>
              {f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
        <button type="button" className="xb-icon-btn" aria-label="Clear output" onClick={() => useBuilderStore.getState().clearConsole()}>
          <Trash2 size={12} />
        </button>
      </div>
      <div className="xb-console-list" role="log" aria-live="off">
        {shown.length === 0 ? (
          <div className="xb-console-row text-text-tertiary">{lines.length ? 'Nothing at this level.' : 'No output yet.'}</div>
        ) : null}
        {shown.map((l) => (
          <div key={l.id} className={cn('xb-console-row', `is-${l.level}`)}>
            <span className="ts">{formatClock(l.ts)}</span>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Tests — honest: no fake runner, tests run in the terminal ─────────── */

function TestsTab() {
  return (
    <div className="xb-bp-empty xb-bp-empty-tall" data-testid="builder-tests">
      <TerminalSquare size={20} className="text-text-tertiary" aria-hidden="true" />
      <p className="text-text-primary text-[13px] font-medium">Run your project's tests in the terminal</p>
      <p className="hint">This panel doesn't run a test runner itself — nothing here would be invented. Open the terminal and run your project's command (e.g. <code>bun test</code> or <code>npm test</code>); ask the chat to run tests and it will use its tools.</p>
      <button
        type="button"
        className="xb-ghost"
        onClick={() => useBuilderStore.getState().setBottomTab('terminal')}
      >
        <TerminalSquare size={12} /> Open terminal
      </button>
    </div>
  );
}

/* ── Ports — the engine-managed dev server ────────────────────────────── */

function PortsTab() {
  const status = useBuilderStore((s) => s.devServer);
  const detected = useBuilderStore((s) => s.detected);
  const busy = useBuilderStore((s) => s.busy);
  const st = useBuilderStore.getState;

  return (
    <div className="xb-bp-empty xb-bp-empty-tall" data-testid="builder-ports">
      <p className="text-text-primary text-[13px] font-medium">Ports</p>
      {status?.state === 'running' && status.url ? (
        <div className="xb-bp-port is-running">
          <span className="dot" aria-hidden="true" />
          <span className="text-text-primary font-medium">{status.url}</span>
          <span className="text-text-tertiary">port {status.port} · pid {status.pid} · {status.kind}</span>
          <span className="xb-top-spacer" />
          <button type="button" className="xb-ghost" onClick={() => st().stopDev()} disabled={busy === 'stopping'}>
            <Square size={10} /> Stop
          </button>
          <button type="button" className="xb-ghost" onClick={() => void st().stopDev().then(() => st().startDev())} disabled={busy !== null}>
            <RotateCw size={10} /> Restart
          </button>
        </div>
      ) : (
        <div className="xb-bp-port">
          <Info size={14} className="text-text-tertiary" aria-hidden="true" />
          <span className="text-text-tertiary">
            No dev server port is open. {detected ? `Detected ${detected.label} — start it from the preview pane or the palette.` : ''}
          </span>
        </div>
      )}
      <p className="hint">The engine owns this process; the app never binds ports directly.</p>
    </div>
  );
}
