/*
 * Settings → Updates (Phase 8, completed in Phase 27).
 *
 * Before this phase the tab called the JS updater plugin directly, which meant
 * three things were impossible: knowing whether the build is provisioned at all
 * (the answer was an exception every time), switching channels at runtime (the
 * endpoint was baked in at build time), and showing progress (no events). Now it
 * drives the Rust commands through `stores/updateStore`, and every state it can
 * be in has honest copy:
 *
 *   · **unprovisioned** — the operator has not run the keys script. The card
 *     says exactly that, with the command, and lights up by itself on a
 *     provisioned build without any code change.
 *   · **dev build** — the updater never runs there, and says so.
 *   · **checking / downloading / ready / error** — one line each, no spinners
 *     that lie, no "up to date" when the check failed.
 *
 * Auto-download (default ON on Stable, off on Beta/Nightly) fetches and verifies
 * in the background so "Restart to update" is one click. It never installs on its
 * own: the modal is the only place that applies an update.
 */
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { isTauri } from '@/lib/tauri';
import { useUpdateStore, updateStatusLine } from '@/stores/updateStore';

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
  const state = useUpdateStore((store) => store.state);
  const busy = useUpdateStore((store) => store.busy);
  const load = useUpdateStore((store) => store.load);
  const check = useUpdateStore((store) => store.check);
  const download = useUpdateStore((store) => store.download);
  const install = useUpdateStore((store) => store.install);
  const setChannel = useUpdateStore((store) => store.setChannel);
  const setAutoDownload = useUpdateStore((store) => store.setAutoDownload);
  const clearSkip = useUpdateStore((store) => store.clearSkip);
  const openModal = useUpdateStore((store) => store.openModal);

  // Fresh state on mount; the tray's "Check for Updates…" arrives as a query
  // parameter because Rust cannot navigate the router.
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    if (params.get('check') === '1') {
      void check();
      params.delete('check');
      const query = params.toString();
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${query ? `?${query}` : ''}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  const status = updateStatusLine(state);
  const updatable = state.available;
  const skipped = updatable !== null && state.skippedVersion === updatable.version;

  return (
    <div>
      {/* ── Current version ── */}
      <SettingsSection title="Current version">
        <div className="flex items-center gap-4 px-3.5 py-3.5">
          <Logo variant="icon" size={40} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-text-primary text-sm font-semibold">
                XR {state.currentVersion}
              </span>
              <Badge
                variant="outline"
                className={
                  state.channel === 'stable'
                    ? 'border-border-subtle text-accent text-[10px] tracking-wider uppercase'
                    : 'border-border-subtle text-text-tertiary text-[10px] tracking-wider uppercase'
                }
              >
                {state.channel}
              </Badge>
            </div>
            <p className="text-text-tertiary mt-0.5 text-xs">
              Last checked: <RelativeTime at={state.lastCheckMs} />
            </p>
          </div>
        </div>
      </SettingsSection>

      {/* ── Check ── */}
      <SettingsSection title="Check">
        <SettingRow
          label="Check for updates"
          description="Signature-verified updates through XR's own release channel."
        >
          <Button size="sm" disabled={busy !== null || !state.provisioned} onClick={() => void check()}>
            {busy === 'check' ? 'Checking…' : 'Check now'}
          </Button>
        </SettingRow>

        <SettingRow label="Status">
          <span
            className={
              state.error
                ? 'text-text-secondary text-xs'
                : updatable
                  ? 'text-accent text-xs'
                  : 'text-text-secondary text-xs'
            }
          >
            {status}
          </span>
        </SettingRow>

        {/* The one place an update is applied. */}
        {updatable ? (
          <div className="border-border-subtle border-t px-3.5 py-3.5">
            <p className="text-text-primary text-[13px] font-medium">
              XR {updatable.version} is available
              {updatable.date ? ` · released ${updatable.date}` : ''}
            </p>
            <p className="text-text-secondary mt-1 line-clamp-2 max-w-[60ch] text-xs leading-relaxed">
              {updatable.notes.trim().split('\n')[0] || 'Release notes are in the update dialog.'}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={openModal}>
                {state.readyToInstall ? 'Review and install' : 'Review update'}
              </Button>
              {!state.readyToInstall && !state.downloading ? (
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void download()}>
                  Download now
                </Button>
              ) : null}
              {state.readyToInstall ? (
                <Button size="sm" disabled={busy !== null} onClick={() => void install()}>
                  {busy === 'install' ? 'Restarting…' : 'Install and restart'}
                </Button>
              ) : null}
              {skipped ? (
                <Button size="sm" variant="ghost" onClick={() => void clearSkip()}>
                  You skipped this — unskip
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* Progress, when a download is running outside the modal. */}
        {state.downloading && !state.readyToInstall ? (
          <div className="border-border-subtle border-t px-3.5 py-3">
            <div className="bg-bg-void h-1 w-full overflow-hidden rounded-full">
              <div
                className="bg-accent h-full transition-[width] duration-200"
                style={{ width: `${state.progress?.percent ?? 8}%` }}
              />
            </div>
            <p className="text-text-tertiary mt-1.5 text-xs">
              Downloading and verifying…
              {state.progress?.percent != null ? ` ${Math.round(state.progress.percent)}%` : ''}
            </p>
          </div>
        ) : null}
      </SettingsSection>

      {/* ── Auto-update ── */}
      <SettingsSection
        title="Auto-update"
        description="Background downloads are optional; installing is always your click."
      >
        <SettingRow
          label="Download updates automatically"
          htmlFor="xr-auto-update"
          description={
            state.channel === 'stable'
              ? 'On by default for Stable: XR fetches and verifies in the background, then waits for you to restart.'
              : 'Off by default on pre-release channels — you will be told when something is available.'
          }
        >
          <Toggle
            id="xr-auto-update"
            checked={state.autoDownload}
            onCheckedChange={(value) => {
              void setAutoDownload(value);
              toast(value ? 'Background downloads on' : 'Background downloads off', {
                description: value
                  ? 'You still choose when to install.'
                  : 'XR will tell you when an update is available.',
              });
            }}
          />
        </SettingRow>

        <SettingRow
          label="Update channel"
          htmlFor="xr-update-channel"
          description="Where XR looks for releases. Switching channels discards anything already downloaded."
        >
          <Segmented
            ariaLabel="Update channel"
            value={state.channel}
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
              void setChannel(value as 'stable' | 'beta' | 'nightly');
            }}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── How it works ── */}
      <SettingsSection title="How updates are verified">
        <div className="text-text-secondary px-3.5 py-3.5 text-xs leading-relaxed">
          <p>
            Every release artifact is signed with XR's Ed25519 release key, and the signature is
            checked before the download is allowed to install. A build with no public key baked in
            refuses to update rather than updating without verification — which is the state you
            see above if this copy was built before the release keys existed.
          </p>
          {!isTauri() ? (
            <p className="text-text-tertiary mt-2">
              In the browser preview there is no updater at all; this card is what the desktop app
              shows.
            </p>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  );
}
