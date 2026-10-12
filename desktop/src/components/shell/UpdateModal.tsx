/*
 * Release-notes / update modal (Phase 27).
 *
 * Opened from the Settings → Updates card, from the pending-update banner, or
 * by a check that finds a new version. It is the only place an update can be
 * applied, which is what keeps "auto-install" honest: the toggle downloads, the
 * modal installs.
 *
 * What it shows, in order: the version and channel, the release notes rendered
 * as markdown (capped at 8000 characters by the host, with a link to the full
 * notes on the release page when it was cut), the download progress while bytes
 * arrive, and the three answers — Install & restart, Later, Skip this version.
 *
 * Nothing here talks to the update server directly: it drives the store, which
 * drives the Rust commands, so the signature check and the byte handling stay in
 * one place.
 */
import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/lib/markdown';
import { useUpdateStore } from '@/stores/updateStore';
import { invokeShell } from '@/lib/shellApi';

export function UpdateModal() {
  const open = useUpdateStore((state) => state.modalOpen);
  const close = useUpdateStore((state) => state.closeModal);
  const state = useUpdateStore((s) => s.state);
  const busy = useUpdateStore((s) => s.busy);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);
  const skip = useUpdateStore((s) => s.skipVersion);
  const [installing, setInstalling] = useState(false);

  // Esc closes — a modal that traps the user is worse than the update itself.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const update = state.available;
  const percent = state.progress?.percent ?? null;
  const ready = state.readyToInstall;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      role="dialog"
      aria-modal="true"
      aria-label="XR update"
    >
      <div className="bg-bg-ink border-border-subtle flex max-h-[80vh] w-full max-w-[620px] flex-col rounded-xl border">
        <div className="border-border-subtle flex items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0">
            <p className="text-text-primary text-[14px] font-semibold">
              {update ? `XR ${update.version}` : 'XR updates'}
            </p>
            <p className="text-text-tertiary mt-0.5 text-xs">
              You are on {state.currentVersion}
              {update?.date ? ` · released ${update.date}` : ''}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0 text-[10px] uppercase tracking-wider">
            {state.channel}
          </Badge>
        </div>

        {/* Release notes */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {update ? (
            update.notes.trim() ? (
              <div className="text-text-secondary text-[13px] leading-relaxed">
                <MarkdownRenderer content={update.notes} />
                {update.notesTruncated ? (
                  <div className="border-border-subtle mt-3 border-t pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void invokeShell('open_url', { url: update.releaseUrl });
                      }}
                    >
                      View full release notes
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-text-tertiary text-xs">
                This release did not include notes. The full changelog lives in the repository.
              </p>
            )
          ) : (
            <p className="text-text-tertiary text-xs">
              {state.reason ?? 'No update is available right now.'}
            </p>
          )}
        </div>

        {/* Progress */}
        {state.downloading || ready ? (
          <div className="border-border-subtle border-t px-4 py-3">
            <div className="flex items-center gap-2">
              {ready ? (
                <Download size={13} strokeWidth={1.8} className="text-success" />
              ) : (
                <Loader2 size={13} strokeWidth={1.8} className="text-accent animate-spin" />
              )}
              <span className="text-text-secondary text-xs">
                {ready
                  ? 'Downloaded and signature-verified.'
                  : percent === null
                    ? 'Downloading…'
                    : `Downloading… ${Math.round(percent)}%`}
              </span>
            </div>
            {!ready ? (
              <div className="bg-bg-void mt-2 h-1 w-full overflow-hidden rounded-full">
                <div
                  className="bg-accent h-full transition-[width] duration-200"
                  style={{ width: `${percent ?? 8}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {state.error ? (
          <div className="border-border-subtle border-t px-4 py-2">
            <p className="text-text-secondary text-xs">{state.error}</p>
          </div>
        ) : null}

        {/* Actions */}
        <div className="border-border-subtle flex items-center justify-between gap-2 border-t px-4 py-3">
          <span className="text-text-tertiary min-w-0 flex-1 truncate text-[11px]">
            Updates are signed (Ed25519) and verified before they can be installed.
          </span>
          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="ghost" onClick={close}>
              Later
            </Button>
            {update && state.skippedVersion !== update.version ? (
              <Button size="sm" variant="ghost" onClick={() => void skip(update.version)}>
                Skip this version
              </Button>
            ) : null}
            {update ? (
              ready ? (
                <Button
                  size="sm"
                  disabled={installing}
                  onClick={() => {
                    setInstalling(true);
                    void install();
                  }}
                >
                  {installing ? 'Restarting…' : 'Install and restart'}
                </Button>
              ) : (
                <Button size="sm" disabled={busy !== null || state.downloading} onClick={() => void download()}>
                  {state.downloading ? 'Downloading…' : 'Download'}
                </Button>
              )
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
