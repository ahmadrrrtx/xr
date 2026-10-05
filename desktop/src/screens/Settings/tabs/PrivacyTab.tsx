/*
 * Settings → Privacy & Data (Phase 8) — local-first storage facts, opt-in
 * telemetry, PII redaction, network posture and the destructive flows.
 * Privacy-first defaults: telemetry OFF, encryption locked ON, everything
 * local until the user says otherwise.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/settings/dialogs';
import { Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { chatDb } from '@/lib/chat-db';
import { isTauri } from '@/lib/tauri';
import {
  resetApp,
  storageStats,
  type StorageStats,
} from '@/lib/settingsApi';
import { useSettingsStore } from '@/stores/settingsStore';

function mb(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 10_000) / 100)} MB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function PrivacyTab() {
  const privacy = useSettingsStore((state) => state.settings.privacy);
  const update = useSettingsStore((state) => state.update);
  const navigate = useNavigate();

  const [stats, setStats] = useState<StorageStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [deleteChatsOpen, setDeleteChatsOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void storageStats().then((result) => {
      if (!alive) return;
      setStats(result);
      setLoadingStats(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refreshStats = (): void => {
    setLoadingStats(true);
    void storageStats().then((result) => {
      setStats(result);
      setLoadingStats(false);
    });
  };

  return (
    <div>
      {/* ── Storage ── */}
      <SettingsSection title="Storage">
        <SettingRow
          label="Store conversations locally"
          locked
          lockedNote="In Personal, all data stays on-device. Cloud sync is an opt-in Pro feature."
        >
          <Toggle checked onCheckedChange={() => undefined} disabled />
        </SettingRow>
        <SettingRow
          label="Encrypt data at rest"
          locked
          lockedNote="Always enabled — the database rides your OS user account encryption."
        >
          <Toggle checked onCheckedChange={() => undefined} disabled />
        </SettingRow>
        <SettingRow
          label="On-disk usage"
          description={
            loadingStats || !stats
              ? 'Measuring…'
              : `Conversations ${mb(stats.conversations)} · Models ${mb(stats.models)} · Attachments ${mb(stats.attachments)} · Cache ${mb(stats.cache)}`
          }
        >
          <Button variant="ghost" size="sm" onClick={refreshStats} disabled={loadingStats}>
            Refresh
          </Button>
        </SettingRow>
      </SettingsSection>

      {/* ── Telemetry ── */}
      <SettingsSection title="Telemetry">
        <SettingRow
          label="Send anonymous usage statistics"
          htmlFor="xr-telemetry"
          description="Helps us improve XR. No prompts, no messages, no personal data. Off unless you turn it on."
        >
          <Toggle
            id="xr-telemetry"
            checked={privacy.telemetry}
            onCheckedChange={(v) => update('privacy', { telemetry: v })}
          />
        </SettingRow>
        <SettingRow
          label="Send crash reports"
          htmlFor="xr-crash-reports"
          description="Stack traces only — never message content."
        >
          <Toggle
            id="xr-crash-reports"
            checked={privacy.crashReports}
            onCheckedChange={(v) => update('privacy', { crashReports: v })}
          />
        </SettingRow>
      </SettingsSection>

      {/* ── PII redaction ── */}
      <SettingsSection title="PII Redaction">
        <SettingRow
          label="Redact personal info before cloud calls"
          htmlFor="xr-redact-pii"
          description="Emails, phone numbers, card numbers and API keys become placeholders before any provider sees your text."
        >
          <Toggle
            id="xr-redact-pii"
            checked={privacy.redactPii}
            onCheckedChange={(v) => update('privacy', { redactPii: v })}
          />
        </SettingRow>
        <div className="px-3.5 py-3">
          <label
            htmlFor="xr-redact-patterns"
            className="text-text-tertiary mb-1.5 block text-xs"
          >
            Additional patterns (one regular expression per line)
          </label>
          <textarea
            id="xr-redact-patterns"
            value={privacy.redactPatterns.join('\n')}
            onChange={(event) =>
              update('privacy', {
                redactPatterns: event.target.value.split('\n').filter((line) => line.trim().length > 0),
              })
            }
            spellCheck={false}
            rows={5}
            className="border-border-subtle bg-bg-raised text-text-secondary focus-visible:border-accent w-full rounded-md border p-2.5 font-mono text-xs leading-relaxed outline-none"
          />
        </div>
      </SettingsSection>

      {/* ── Network ── */}
      <SettingsSection title="Network">
        <SettingRow
          label="Egress proxy (Shield)"
          description="Every outbound request, proxied and logged. Planned — the allow/block lists live in Shield."
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/shield?tab=security')}
          >
            Configure…
          </Button>
        </SettingRow>
        <SettingRow
          label="Advanced security controls"
          description="Approval policy, shell execution, quarantine, audit log and emergency revoke."
        >
          <Button
            variant="ghost"
            size="sm"
            data-testid="privacy-shield-link"
            onClick={() => navigate('/shield?tab=security')}
          >
            Advanced security controls →
          </Button>
        </SettingRow>
        <SettingRow
          label="Outbound traffic"
          locked
          lockedNote="XR phones home to no one beyond the providers you configure."
        >
          <Toggle checked onCheckedChange={() => undefined} disabled />
        </SettingRow>
      </SettingsSection>

      {/* ── Destructive ── */}
      <SettingsSection title="Destructive">
        <SettingRow
          label="Delete all conversations"
          danger
          description="Sessions and messages. Settings and remembered rules survive."
        >
          <Button variant="ghost" size="sm" onClick={() => setDeleteChatsOpen(true)}>
            Delete…
          </Button>
        </SettingRow>
        <SettingRow
          label="Delete all data and reset"
          danger
          description="Everything goes — settings, rules, conversations — then XR restarts."
        >
          <Button variant="ghost" size="sm" onClick={() => setWipeOpen(true)}>
            Reset…
          </Button>
        </SettingRow>
      </SettingsSection>

      <ConfirmDialog
        open={deleteChatsOpen}
        onOpenChange={setDeleteChatsOpen}
        title="Delete all conversations"
        body="Every session and message is removed permanently. Settings and remembered approval rules survive."
        confirmLabel="Delete conversations"
        requireText="DELETE"
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            if (!isTauri()) {
              toast('Deleting conversations needs the desktop app');
              return;
            }
            const sessions = await chatDb.listSessions();
            for (const session of sessions) {
              await chatDb.deleteSession(session.id);
            }
            toast.success('Conversations deleted', {
              description: `${sessions.length} sessions removed.`,
            });
            setDeleteChatsOpen(false);
          } catch {
            toast.error('Could not delete conversations');
          } finally {
            setBusy(false);
          }
        }}
      />
      <ConfirmDialog
        open={wipeOpen}
        onOpenChange={setWipeOpen}
        title="Delete all data and reset"
        body="This erases all settings, remembered approval rules and conversations, then restarts the app. There is no undo."
        confirmLabel="Delete and reset"
        requireText="DELETE"
        busy={busy}
        onConfirm={() => {
          setBusy(true);
          void resetApp(true);
        }}
      />
    </div>
  );
}
