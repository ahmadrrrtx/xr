/*
 * PreviewPane (Phase 17) — the right column: 32px bar, sandboxed iframe of
 * the engine-managed dev server, placeholder / starting / port-closed states
 * and the Console (dev-server output) under a horizontal resizer.
 *
 * Sandbox: `allow-scripts allow-forms allow-popups allow-modals
 * allow-same-origin`. The frame's origin is the dev server's (http://
 * localhost:<port>), never the app's — "same-origin" lets Vite HMR,
 * localStorage and module workers run inside that origin only. The app's
 * CSP keeps `frame-src` to localhost/127.0.0.1.
 */
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Monitor, Play, RotateCw, Smartphone, Square, Tablet, Terminal, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { Resizer } from '@/components/Resizer';
import { openExternal } from '@/lib/detect';
import { DEVICE_WIDTHS, formatClock, formatReady, type ConsoleLevel, type PreviewDevice } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/stores/builderStore';

const DEVICES: Array<{ id: PreviewDevice; label: string; Icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop · 1280', Icon: Monitor },
  { id: 'tablet', label: 'Tablet · 768', Icon: Tablet },
  { id: 'mobile', label: 'Mobile · 375', Icon: Smartphone },
];

export function PreviewPane({ consoleHeight, onConsoleHeight, paneHeight }: { consoleHeight: number; onConsoleHeight: (px: number) => void; paneHeight: number }) {
  const status = useBuilderStore((s) => s.devServer);
  const detected = useBuilderStore((s) => s.detected);
  const busy = useBuilderStore((s) => s.busy);
  const device = useBuilderStore((s) => s.previewDevice);
  const nonce = useBuilderStore((s) => s.previewNonce);
  const override = useBuilderStore((s) => s.previewUrlOverride);
  const lines = useBuilderStore((s) => s.consoleLines);
  const [history, setHistory] = useState<{ urls: string[]; at: number; seen: string | null }>({ urls: [], at: -1, seen: null });

  const running = status?.state === 'running' && !!status.url;
  const starting = busy === 'starting' || status?.state === 'starting' || busy === 'installing';
  const exited = status?.state === 'exited';
  const url = override ?? status?.url ?? null;
  const width = DEVICE_WIDTHS[device];
  const consoleOpen = consoleHeight > 0;

  // Our own URL history (the frame is cross-origin; its history is not ours to
  // read). Adjusted during render when the URL prop changes — React's
  // documented pattern for derived state, no effect round-trip.
  if (url && history.seen !== url) {
    const same = history.urls[history.at] === url;
    const urls = same ? history.urls : [...history.urls.slice(0, history.at + 1), url];
    setHistory({ urls, at: same ? history.at : urls.length - 1, seen: url });
  }

  const go = (delta: number) => {
    const at = history.at + delta;
    const target = history.urls[at];
    if (!target) return;
    setHistory({ ...history, at });
    useBuilderStore.getState().setPreviewUrlOverride(target === status?.url ? null : target);
  };

  const copyUrl = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL copied');
    } catch {
      toast('Could not copy');
    }
  };

  const chip = running ? (
    <span className="xb-chip is-ready" data-testid="builder-dev-chip">
      <span className="xb-dot is-ok" /> {status?.readyMs != null ? formatReady(status.readyMs) : 'Running'}
    </span>
  ) : starting ? (
    <span className="xb-chip is-starting" data-testid="builder-dev-chip">
      <Loader2 size={11} className="xb-spin" /> {busy === 'installing' ? 'Installing…' : 'Starting…'}
    </span>
  ) : (
    <span className="xb-chip" data-testid="builder-dev-chip">
      <span className="xb-dot is-muted" /> {exited ? 'Exited' : 'Stopped'}
    </span>
  );

  const st = useBuilderStore.getState;
  const tail = useMemo(() => lines.slice(-2), [lines]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="builder-preview">
      <div className="xb-preview-bar">
        <button type="button" className="xb-icon-btn" aria-label="Back" disabled={history.at <= 0} onClick={() => go(-1)}>
          <ArrowLeft size={13} />
        </button>
        <button type="button" className="xb-icon-btn" aria-label="Forward" disabled={history.at >= history.urls.length - 1} onClick={() => go(1)}>
          <ArrowRight size={13} />
        </button>
        <button type="button" className="xb-icon-btn" aria-label="Reload preview" disabled={!running} onClick={() => st().reloadPreview()}>
          <RotateCw size={13} />
        </button>
        <button type="button" className="xb-url" onClick={() => void copyUrl()} title={url ? 'Click to copy' : 'No preview URL yet'} disabled={!url} aria-label={url ? `Preview URL ${url}, click to copy` : 'No preview URL'}>
          {url ?? 'Dev server not running'}
        </button>
        <button type="button" className="xb-icon-btn" aria-label="Open in browser" disabled={!url} onClick={() => url && void openExternal(url)}>
          <ExternalLink size={13} />
        </button>
        <span className="xb-device-group" role="radiogroup" aria-label="Preview width">
          {DEVICES.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="radio" aria-checked={device === id} aria-label={label} title={label} className="xb-icon-btn" onClick={() => st().setPreviewDevice(id)}>
              <Icon size={12} />
            </button>
          ))}
        </span>
        <button type="button" className="xb-icon-btn" aria-pressed={consoleOpen} aria-label="Toggle console" title="Console" onClick={() => onConsoleHeight(consoleOpen ? 0 : Math.round(paneHeight * 0.3))}>
          <Terminal size={13} />
        </button>
        {chip}
      </div>

      <div className="xb-preview-body">
        <div className={cn('xb-preview-stage', width && 'is-device')}>
          {running && url ? (
            <iframe
              key={`${url}#${nonce}`}
              title="Live preview"
              src={url}
              className="xb-frame"
              style={width ? { width, maxWidth: '100%' } : undefined}
              sandbox="allow-scripts allow-forms allow-popups allow-modals allow-same-origin"
              referrerPolicy="no-referrer"
              data-testid="builder-preview-frame"
            />
          ) : starting ? (
            <div className="xb-placeholder" aria-busy="true">
              <Loader2 size={20} className="xb-spin text-warning" aria-hidden="true" />
              <div>{busy === 'installing' ? 'Installing dependencies…' : `Starting ${detected?.label ?? 'dev server'}…`}</div>
              {tail.length ? <pre className="xb-log-tail">{tail.map((l) => l.text).join('\n')}</pre> : null}
            </div>
          ) : exited ? (
            <div className="xb-placeholder" data-testid="builder-preview-error">
              <div className="text-text-primary font-medium">The dev server stopped</div>
              <div className="hint">
                {status?.exit?.code != null ? `exit code ${status.exit.code}` : status?.exit?.signal ? `signal ${status.exit.signal}` : 'port closed'}
                {status?.port ? ` · port ${status.port}` : ''}
              </div>
              {tail.length ? <pre className="xb-log-tail">{tail.map((l) => l.text).join('\n')}</pre> : null}
              <button type="button" className="xb-primary" onClick={() => void st().startDev()}>
                <RotateCw size={12} /> Retry
              </button>
            </div>
          ) : detected?.needsInstall ? (
            <div className="xb-placeholder" data-testid="builder-install-prompt">
              <div className="text-text-primary font-medium">Install dependencies?</div>
              <div className="hint">{detected.installArgv?.join(' ') ?? `${detected.pm} install`}</div>
              <div className="text-text-tertiary text-[12px]">{detected.label} needs node_modules before it can start.</div>
              <div className="flex gap-2">
                <button type="button" className="xb-primary" onClick={() => void st().install()}>
                  Yes, install
                </button>
                <button type="button" className="xb-ghost" onClick={() => void st().startDev()}>
                  No, try anyway
                </button>
              </div>
            </div>
          ) : (
            <div className="xb-placeholder" data-testid="builder-preview-placeholder">
              <button type="button" className="xb-primary" onClick={() => void st().startDev()} disabled={!detected}>
                <Play size={12} /> Start dev server
              </button>
              <div>Start the dev server to preview your app.</div>
              {detected ? <div className="hint">{detected.cmd ? `detected: ${detected.label} · ${detected.cmd}` : `detected: ${detected.label}`}</div> : null}
              {detected?.hint && detected.kind === 'unknown' ? <div className="text-text-tertiary max-w-[320px] text-[11.5px]">{detected.hint}</div> : null}
            </div>
          )}
        </div>
        {running ? (
          <div className="border-border-subtle flex h-7 flex-none items-center gap-2 border-t px-2 text-[11px]">
            <span className="text-text-tertiary">
              {status?.kind ?? 'server'} · pid {status?.pid ?? '—'} · port {status?.port ?? '—'}
            </span>
            <span className="ml-auto" />
            <button type="button" className="xb-ghost h-5! px-2 text-[11px]" onClick={() => void st().stopDev()} disabled={busy === 'stopping'}>
              <Square size={10} /> Stop
            </button>
          </div>
        ) : null}
        {consoleOpen ? (
          <>
            <Resizer orientation="horizontal" storageKey="xr.builder.panes.console" value={consoleHeight} onChange={onConsoleHeight} min={80} max={Math.max(80, Math.round(paneHeight * 0.5))} defaultValue={Math.round(paneHeight * 0.3)} invert label="Resize console" />
            <Console height={consoleHeight} onClose={() => onConsoleHeight(0)} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function Console({ height, onClose }: { height: number; onClose: () => void }) {
  const lines = useBuilderStore((s) => s.consoleLines);
  const filter = useBuilderStore((s) => s.consoleFilter);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const shown = useMemo(() => (filter === 'all' ? lines : lines.filter((l) => l.level === filter)), [lines, filter]);

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [shown.length]);

  return (
    <div className="xb-console" style={{ height }} data-testid="builder-console">
      <div className="xb-console-head">
        <span className="xb-pane-title">Console</span>
        <span className="text-text-tertiary text-[11px]">dev server output</span>
        <span className="xb-top-spacer" />
        <select className="xb-console-filter" aria-label="Filter console" value={filter} onChange={(e) => useBuilderStore.getState().setConsoleFilter(e.target.value as ConsoleLevel | 'all')}>
          <option value="all">All</option>
          <option value="log">Log</option>
          <option value="info">Info</option>
          <option value="warn">Warn</option>
          <option value="error">Error</option>
        </select>
        <button type="button" className="xb-icon-btn" aria-label="Clear console" onClick={() => useBuilderStore.getState().clearConsole()}>
          <Trash2 size={12} />
        </button>
        <button type="button" className="xb-icon-btn" aria-label="Close console" onClick={onClose}>
          ×
        </button>
      </div>
      <div
        ref={listRef}
        className="xb-console-list"
        role="log"
        aria-live="off"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {shown.length === 0 ? <div className="xb-console-row text-text-tertiary">{lines.length ? 'Nothing at this level.' : 'No output yet.'}</div> : null}
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
