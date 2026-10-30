/*
 * PreviewPane (Phase 17) — the right column: 32px bar, sandboxed iframe of
 * the engine-managed dev server, placeholder / starting / port-closed states.
 *
 * UI-redesign 2026-10-29: the dev-server Console moved to the Builder's
 * bottom panel (Output tab); this pane is purely the preview surface. The
 * pane itself is mounted only while the workbench's preview is open
 * (builderStore.previewVisible — see TopBar / palette).
 *
 * Sandbox: `allow-scripts allow-forms allow-popups allow-modals
 * allow-same-origin`. The frame's origin is the dev server's (http://
 * localhost:<port>), never the app's — "same-origin" lets Vite HMR,
 * localStorage and module workers run inside that origin only. The app's
 * CSP keeps `frame-src` to localhost/127.0.0.1.
 */
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, Monitor, Play, RotateCw, Smartphone, Square, Tablet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { openExternal } from '@/lib/detect';
import { DEVICE_WIDTHS, formatReady, type PreviewDevice } from '@/lib/builderCore';
import { cn } from '@/lib/utils';
import { useBuilderStore } from '@/stores/builderStore';

const DEVICES: Array<{ id: PreviewDevice; label: string; Icon: typeof Monitor }> = [
  { id: 'desktop', label: 'Desktop · 1280', Icon: Monitor },
  { id: 'tablet', label: 'Tablet · 768', Icon: Tablet },
  { id: 'mobile', label: 'Mobile · 375', Icon: Smartphone },
];

export function PreviewPane() {
  const status = useBuilderStore((s) => s.devServer);
  const detected = useBuilderStore((s) => s.detected);
  const busy = useBuilderStore((s) => s.busy);
  const device = useBuilderStore((s) => s.previewDevice);
  const nonce = useBuilderStore((s) => s.previewNonce);
  const override = useBuilderStore((s) => s.previewUrlOverride);
  const [history, setHistory] = useState<{ urls: string[]; at: number; seen: string | null }>({ urls: [], at: -1, seen: null });

  const running = status?.state === 'running' && !!status.url;
  const starting = busy === 'starting' || status?.state === 'starting' || busy === 'installing';
  const exited = status?.state === 'exited';
  const url = override ?? status?.url ?? null;
  const width = DEVICE_WIDTHS[device];

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
  // Last two dev-server lines, shown inside the starting/stopped placeholders
  // (the full log lives in the bottom panel's Output tab).
  const lines = useBuilderStore((s) => s.consoleLines);
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
      </div>
    </div>
  );
}
