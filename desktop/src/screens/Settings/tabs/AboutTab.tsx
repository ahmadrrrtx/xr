/*
 * Settings → About XR (Phase 8) — logo, tagline, links, licenses, credits,
 * and the developer-tools advanced card.
 */
import { useState } from 'react';

import { Logo } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { THIRD_PARTY_LICENSES } from '@/data/licenses';
import { APP_REPO_URL, APP_TAGLINE, APP_VERSION } from '@/lib/appMeta';
import {
  getDataDir,
  openUrl,
  revealPath,
  setDevtoolsEnabled,
} from '@/lib/settingsApi';
import { useSettingsStore } from '@/stores/settingsStore';

const LINKS: Array<{ label: string; url: string }> = [
  { label: 'Website', url: `${APP_REPO_URL}#readme` },
  { label: 'Source code (GitHub)', url: APP_REPO_URL },
  { label: 'Documentation', url: `${APP_REPO_URL}/tree/main/docs` },
  { label: 'Privacy policy', url: `${APP_REPO_URL}#privacy` },
  { label: 'Terms of service', url: `${APP_REPO_URL}#terms` },
  { label: 'Report a bug', url: `${APP_REPO_URL}/issues/new` },
];

export function AboutTab() {
  const about = useSettingsStore((state) => state.settings.about);
  const update = useSettingsStore((state) => state.update);
  const [licensesOpen, setLicensesOpen] = useState(false);

  const openConfigFile = (): void => {
    void getDataDir().then((dir) => {
      if (dir) void revealPath(`${dir}/settings.json`);
    });
  };

  return (
    <div>
      {/* ── Identity ── */}
      <div className="mb-8 flex flex-col items-center pt-4 pb-2 text-center">
        <Logo variant="full" size={120} decorative={false} />
        <p className="text-text-tertiary mt-4 text-xs">
          Version {APP_VERSION} · ai.rrrtx.xr
        </p>
        <p className="text-text-secondary mt-1.5 text-sm">{APP_TAGLINE}</p>
      </div>

      {/* ── Links ── */}
      <SettingsSection title="Links">
        {LINKS.map((link) => (
          <SettingRow key={link.label} label={link.label}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void openUrl(link.url)}
            >
              Open
            </Button>
          </SettingRow>
        ))}
        <SettingRow
          label="Third-party licenses"
          description={`${THIRD_PARTY_LICENSES.length} open-source packages make XR possible.`}
        >
          <Button variant="ghost" size="sm" onClick={() => setLicensesOpen(true)}>
            View
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Credits ── */}
      <SettingsSection title="Credits">
        <div className="px-3.5 py-3.5">
          <p className="text-text-secondary text-[13px] leading-relaxed">
            Built by Ahmad &amp; contributors. Special thanks to the open
            source community — Tauri, React, Rust, and everyone who ships
            careful software.
          </p>
        </div>
      </SettingsSection>

      {/* ── Advanced ── */}
      <SettingsSection title="Advanced">
        <SettingRow
          label="Enable developer tools"
          htmlFor="xr-devtools"
          description="For debugging and bug reports. Off by default."
        >
          <Toggle
            id="xr-devtools"
            checked={about.devtools}
            onCheckedChange={(v) => {
              update('about', { devtools: v });
              void setDevtoolsEnabled(v);
            }}
          />
        </SettingRow>
        <SettingRow
          label="Open data folder"
          description="Settings, conversations and rules live here."
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              void import('@/lib/settingsApi').then((m) => m.revealDataFolder())
            }
          >
            Open
          </Button>
        </SettingRow>
        <SettingRow
          label="Open config file"
          description="settings.json — every preference XR persists."
        >
          <Button variant="ghost" size="sm" onClick={openConfigFile}>
            Open
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Licenses dialog ── */}
      <Dialog open={licensesOpen} onOpenChange={setLicensesOpen}>
        <DialogContent className="border-border-subtle bg-bg-ink sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-text-primary text-base font-semibold">
              Third-party licenses
            </DialogTitle>
            <DialogDescription className="text-text-tertiary text-xs">
              {THIRD_PARTY_LICENSES.length} packages, generated from the
              installed dependency tree.
            </DialogDescription>
          </DialogHeader>
          <div className="border-border-subtle max-h-80 overflow-y-auto rounded-md border">
            {THIRD_PARTY_LICENSES.map((entry) => (
              <div
                key={entry.name}
                className="border-border-subtle flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="text-text-primary truncate text-[13px]">
                    {entry.name}
                    <span className="text-text-tertiary ml-1.5 font-mono text-[11px]">
                      {entry.version}
                    </span>
                  </p>
                  {entry.homepage ? (
                    <p className="text-text-tertiary truncate text-[11px]">
                      {entry.homepage}
                    </p>
                  ) : null}
                </div>
                <span className="text-text-secondary shrink-0 font-mono text-[11px]">
                  {entry.license}
                </span>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
