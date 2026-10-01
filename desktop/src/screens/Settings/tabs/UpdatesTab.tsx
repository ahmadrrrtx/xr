/*
 * Settings → Updates (Phase 8) — version card, real Tauri updater check with
 * a graceful dev-build fallback, auto-update preferences.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { APP_VERSION } from '@/lib/appMeta';
import { isTauri } from '@/lib/tauri';
import { useSettingsStore } from '@/stores/settingsStore';

type CheckState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'current'; note?: string }
  | { status: 'available'; version: string; notes: string };

/**
 * "2 minutes ago" — the clock ticks via an interval subscription (never
 * Date.now() directly in render); the label itself is derived per render.
 */
function RelativeTime({ at }: { at: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (at === null) return <span>Never</span>;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  const label =
    seconds < 30
      ? 'Just now'
      : seconds < 90
        ? '1 minute ago'
        : seconds < 3600
          ? `${Math.round(seconds / 60)} minutes ago`
          : seconds < 7200
            ? '1 hour ago'
            : `${Math.round(seconds / 3600)} hours ago`;
  return <span>{label}</span>;
}

export function UpdatesTab() {
  const updates = useSettingsStore((state) => state.settings.updates);
  const update = useSettingsStore((state) => state.update);
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const [installing, setInstalling] = useState(false);

  const checkForUpdates = (): void => {
    setState({ status: 'checking' });
    void (async () => {
      try {
        if (!isTauri()) {
          setState({
            status: 'current',
            note: 'Browser preview — updates arrive with the desktop app.',
          });
          return;
        }
        const { check } = await import('@tauri-apps/plugin-updater');
        const result = await check();
        if (result) {
          setState({
            status: 'available',
            version: result.version,
            notes: (result.body ?? 'Release notes were not provided.').slice(0, 1200),
          });
        } else {
          setState({ status: 'current' });
        }
      } catch {
        // No signed update endpoint in dev builds — degrade gracefully.
        setState({
          status: 'current',
          note: 'No update channel is configured for this build.',
        });
      } finally {
        update('updates', { lastChecked: Date.now() });
      }
    })();
  };

  const install = (): void => {
    setInstalling(true);
    void (async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater');
        const result = await check();
        if (result) {
          await result.downloadAndInstall();
          const { relaunch } = await import('@tauri-apps/plugin-process');
          await relaunch();
        } else {
          toast('Already up to date');
        }
      } catch {
        toast.error('Could not install the update', {
          description: 'The download or signature check failed.',
        });
      } finally {
        setInstalling(false);
      }
    })();
  };

  return (
    <div>
      {/* ── Current version ── */}
      <SettingsSection title="Current version">
        <div className="flex items-center gap-4 px-3.5 py-3.5">
          <Logo variant="icon" size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-text-primary text-sm font-semibold">
                XR {APP_VERSION}
              </span>
              <Badge
                variant="outline"
                className={
                  updates.channel === 'stable'
                    ? 'border-border-subtle text-accent text-[10px] uppercase tracking-wider'
                    : 'border-border-subtle text-text-tertiary text-[10px] uppercase tracking-wider'
                }
              >
                {updates.channel}
              </Badge>
            </div>
            <p className="text-text-tertiary mt-0.5 text-xs">
              Last checked: <RelativeTime at={updates.lastChecked} />
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* ── Check ── */}
      <SettingsSection title="Check">
        <SettingRow
          label="Check for updates"
          description="Signature-verified updates through the Tauri updater."
        >
          <Button
            size="sm"
            disabled={state.status === 'checking' || installing}
            onClick={checkForUpdates}
          >
            {state.status === 'checking' ? 'Checking…' : 'Check for updates'}
          </Button>
        </SettingRow>
        {state.status === 'available' ? (
          <div className="border-border-subtle border-t px-3.5 py-3.5">
            <p className="text-text-primary text-[13px] font-medium">
              XR {state.version} is available
            </p>
            <p className="text-text-secondary mt-1 max-w-[52ch] text-xs leading-relaxed whitespace-pre-line">
              {state.notes}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" disabled={installing} onClick={install}>
                {installing ? 'Installing…' : 'Install and restart'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={installing}
                onClick={() => setState({ status: 'idle' })}
              >
                Later
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={installing}
                onClick={() => {
                  update('updates', { skippedVersion: state.version });
                  setState({ status: 'idle' });
                }}
              >
                Skip this version
              </Button>
            </div>
          </div>
        ) : null}
        {state.status === 'current' ? (
          <SettingRow label="Status">
            <span className="text-success text-xs">
              XR is up to date{state.note ? ` — ${state.note}` : ''}
            </span>
          </SettingRow>
        ) : null}
      </SettingsSection>

      {/* ── Auto-update ── */}
      <SettingsSection title="Auto-update">
        <SettingRow
          label="Automatically install updates"
          htmlFor="xr-auto-update"
          description="Downloads in the background and asks before restarting."
        >
          <Toggle
            id="xr-auto-update"
            checked={updates.autoInstall}
            onCheckedChange={(v) => update('updates', { autoInstall: v })}
          />
        </SettingRow>
        <SettingRow label="Update channel" htmlFor="xr-update-channel">
          <Segmented
            ariaLabel="Update channel"
            value={updates.channel}
            options={[
              { value: 'stable', label: 'Stable' },
              { value: 'beta', label: 'Beta' },
              { value: 'nightly', label: 'Nightly' },
            ]}
            onChange={(value) => {
              if (value !== 'stable') {
                toast('Pre-release channel', {
                  description: `${value[0].toUpperCase()}${value.slice(1)} builds may be less stable.`,
                });
              }
              update('updates', { channel: value });
            }}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
