/*
 * Settings → Diagnostics (Phase 14) — the Engine card: link state, version,
 * uptime, provider health, last error, restart, and (packaged) the sidecar's
 * recent stderr. Everything here is read from the engine or the shell; no
 * figure is invented when the link is down.
 */
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { isTauri } from '@/lib/tauri';
import { copyEngineDiagnostics } from '@/engine/diagnostics';
import { engineVersion, isEngineUsable, useEngineStore } from '@/stores/engineStore';

function fmtUptime(since: number | null, now: number): string {
  if (!since) return '—';
  const s = Math.max(0, Math.floor((now - since) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

const STATUS_LABEL: Record<string, string> = {
  starting: 'Starting…',
  ready: 'Connected',
  degraded: 'Connected — contract unverified (legacy engine)',
  disconnected: 'Not running',
  failed: 'Failed',
};

export function DiagnosticsTab() {
  const status = useEngineStore((s) => s.status);
  const endpoint = useEngineStore((s) => s.endpoint);
  const latency = useEngineStore((s) => s.latencyMs);
  const lastChecked = useEngineStore((s) => s.lastChecked);
  const lastError = useEngineStore((s) => s.lastError);
  const upSince = useEngineStore((s) => s.upSince);
  const providers = useEngineStore((s) => s.providers);
  const restarting = useEngineStore((s) => s.restarting);
  const failureReason = useEngineStore((s) => s.failureReason);
  const handshake = useEngineStore((s) => s.handshake);
  const [now, setNow] = useState(() => Date.now());
  const [logs, setLogs] = useState<string[] | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  useEffect(() => {
    const stop = useEngineStore.getState().startPolling();
    void useEngineStore.getState().loadCatalog();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      window.clearInterval(t);
    };
  }, []);

  const loadLogs = async (): Promise<void> => {
    if (!isTauri()) {
      setLogsError('In development the engine runs in your terminal — its output is there.');
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const lines = await invoke<string[]>('engine_logs_tail', { lines: 40 });
      setLogs(lines);
      setLogsError(null);
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e));
    }
  };

  const [bundleText, setBundleText] = useState<string | null>(null);
  const copyDiagnostics = async (): Promise<void> => {
    const r = await copyEngineDiagnostics();
    if (r.ok) {
      toast(r.message);
      setBundleText(null);
    } else {
      // Honest fallback: show the bundle for manual copy instead of
      // pretending the clipboard worked.
      setBundleText(r.text);
      toast.error(r.message);
    }
  };

  const restart = async (): Promise<void> => {
    const r = await useEngineStore.getState().startOrRestart();
    if (r.ok) toast(r.message);
    else toast.error(r.message);
  };

  const version = engineVersion();
  const healthy = providers?.providers.filter((p) => p.healthy && (p.kind === 'local' || p.hasKey)) ?? [];
  // `hasKey` is the engine's view: a stored key OR environment credentials
  // (e.g. bedrock via AWS env). Label it as credentials, not "API keys".
  const keyed = providers?.providers.filter((p) => p.kind === 'hosted' && p.hasKey) ?? [];

  return (
    <div data-testid="settings-diagnostics">
      <SettingsSection title="Engine" description="The XR engine runs the agent loop, tools, approvals and the audit chain. The app talks to it over a local, token-protected link.">
        <SettingRow label="Link" description={endpoint ? `${endpoint.via === 'dev-proxy' ? 'Vite dev proxy' : `127.0.0.1:${endpoint.port ?? '?'}`} · ${endpoint.base}` : 'No endpoint resolved yet.'}>
          <span
            className="flex items-center gap-1.5 text-[13px]"
            data-testid="diag-engine-status"
            data-status={status}
          >
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${status === 'ready' ? 'bg-success' : status === 'degraded' ? 'bg-warning' : status === 'starting' ? 'bg-text-tertiary' : 'bg-danger'}`}
            />
            {status === 'failed'
              ? `Failed (${failureReason ?? 'unreachable'})`
              : (STATUS_LABEL[status] ?? status)}
          </span>
        </SettingRow>
        <SettingRow label="Version" description="From the session-gated contract handshake (GET /api/v1/meta/version); /health reports liveness only.">
          <span className="font-mono text-[12.5px]">{version ?? '—'}</span>
        </SettingRow>
        <SettingRow label="Contract" description="The engine contract this desktop negotiated (XR-P01). A legacy engine reports none and runs degraded.">
          <span className="font-mono text-[12.5px]" data-testid="diag-contract-version">
            {handshake?.kind === 'ok'
              ? `v${handshake.contractVersion}`
              : handshake?.kind === 'legacy'
                ? 'not reported (legacy)'
                : '—'}
          </span>
        </SettingRow>
        <SettingRow label="Uptime" description="Since this window first reached the engine.">
          <span className="font-mono text-[12.5px] tabular-nums">{isEngineUsable(status) ? fmtUptime(upSince, now) : '—'}</span>
        </SettingRow>
        <SettingRow label="Latency" description={lastChecked ? `Last health check ${Math.max(0, Math.round((now - lastChecked) / 1000))}s ago.` : 'No health check yet.'}>
          <span className="font-mono text-[12.5px] tabular-nums">{latency != null && isEngineUsable(status) ? `${latency} ms` : '—'}</span>
        </SettingRow>
        <SettingRow
          label="Providers"
          description={
            providers
              ? `${healthy.length} ready${keyed.length ? ` · ${keyed.length} cloud with credentials` : ''} · default ${providers.primary}${providers.model ? ` / ${providers.model}` : ''}`
              : 'Loads when the engine is up.'
          }
        >
          <span className="text-text-secondary max-w-[260px] truncate font-mono text-[12px]" title={healthy.map((p) => p.id).join(', ')}>
            {healthy.length ? healthy.map((p) => p.id).join(', ') : '—'}
          </span>
        </SettingRow>
        <SettingRow label="Last error" description="The most recent failure on the link, if any.">
          <span className="text-text-secondary max-w-[320px] truncate font-mono text-[12px]" title={lastError ?? undefined} data-testid="diag-last-error">
            {lastError ?? 'none'}
          </span>
        </SettingRow>
        {isTauri() || !isEngineUsable(status) ? (
          <SettingRow
            label={isTauri() ? 'Restart engine' : 'Start engine'}
            description={
              isTauri()
                ? 'Stops the sidecar and spawns a fresh one; open chats reconnect.'
                : 'Development: asks the Vite dev server to launch `bun run src/index.ts serve`.'
            }
          >
            <Button variant="outline" size="sm" onClick={() => void restart()} disabled={restarting} data-testid="diag-engine-restart">
              <RefreshCw size={13} strokeWidth={1.75} aria-hidden="true" className={restarting ? 'animate-spin' : undefined} />
              {restarting ? 'Working…' : isTauri() ? 'Restart' : 'Start'}
            </Button>
          </SettingRow>
        ) : (
          <SettingRow label="Restart engine" description="Development: the engine runs in your terminal — stop and start it there.">
            <span className="text-text-tertiary text-[12.5px]">not from here</span>
          </SettingRow>
        )}
      </SettingsSection>

      <SettingsSection title="Engine logs" description="The last lines the engine wrote to stderr (packaged app). 'Copy diagnostics' bundles link state, versions and this tail — allow-listed fields only, redacted; the token is never included.">
        <div className="flex items-center gap-2 px-1 pb-2">
          <Button variant="outline" size="sm" onClick={() => void loadLogs()} data-testid="diag-logs-load">
            {logs ? 'Refresh' : 'Show last 40 lines'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void copyDiagnostics()} data-testid="diag-copy-diagnostics">
            Copy diagnostics
          </Button>
          {logsError && <span className="text-text-tertiary text-[12.5px]">{logsError}</span>}
        </div>
        {bundleText && (
          <pre className="border-border-subtle bg-bg-ink text-text-secondary max-h-[280px] overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap" data-testid="diag-bundle-text">
            {bundleText}
          </pre>
        )}
        {logs && (
          <pre className="border-border-subtle bg-bg-ink text-text-secondary max-h-[280px] overflow-auto rounded-lg border p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {logs.length ? logs.join('\n') : '(no output yet)'}
          </pre>
        )}
      </SettingsSection>
    </div>
  );
}
