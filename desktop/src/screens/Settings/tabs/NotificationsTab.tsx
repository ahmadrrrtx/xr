/*
 * Settings → Notifications (Phase 8) — master toggle, per-event switches,
 * quiet hours, channels. The Phase 7 emit path consults these preferences
 * through lib/notificationPolicy.ts before any toast, OS ping or sound.
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { TimeInput } from '@/components/settings/dialogs';
import { LabeledSlider, Segmented, Toggle } from '@/components/settings/controls';
import { SettingRow, SettingsSection } from '@/components/settings/primitives';
import { useT } from '@/lib/i18n';
import { isTauri } from '@/lib/tauri';
import {
  useSettingsStore,
  type NotificationEventKind,
} from '@/stores/settingsStore';
import { cn } from '@/lib/utils';

const EVENT_ROWS: Array<{
  kind: NotificationEventKind;
  label: string;
  description: string;
}> = [
  { kind: 'approval', label: 'Approval needed', description: 'An action is waiting on you.' },
  { kind: 'agentComplete', label: 'Agent completes a task', description: 'A run finishes while you are elsewhere.' },
  { kind: 'budget', label: 'Budget reaches 80%', description: 'Early warning before the spend cap.' },
  { kind: 'errors', label: 'Errors and failures', description: 'Something did not work.' },
  { kind: 'voiceActivation', label: 'Voice activation triggered', description: 'The mic hears the wake phrase.' },
  { kind: 'memorySaved', label: 'Memory saved', description: 'XR wrote a durable memory.' },
  { kind: 'updates', label: 'Updates available', description: 'A new version is ready.' },
];

export function NotificationsTab() {
  const t = useT();
  const notifications = useSettingsStore((state) => state.settings.notifications);
  const update = useSettingsStore((state) => state.update);
  const [testing, setTesting] = useState(false);

  const setEvent = (kind: NotificationEventKind, enabled: boolean): void => {
    update('notifications', {
      events: { ...notifications.events, [kind]: enabled },
    });
  };

  const testOsNotification = (): void => {
    if (!isTauri()) {
      toast('Desktop notifications need the desktop app');
      return;
    }
    setTesting(true);
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core');
      try {
        await invoke('send_os_notification', {
          title: 'XR',
          body: 'This is how desktop notifications look.',
          notificationId: 'settings-test',
        });
      } catch {
        toast.error('Could not send', {
          description: 'Notification permission may be off for XR in System Settings.',
        });
      } finally {
        setTesting(false);
      }
    })();
  };

  return (
    <div>
      {/* ── Master ── */}
      <SettingsSection title="Master">
        <SettingRow
          label={t('row.enableNotifications')}
          htmlFor="xr-notifications-enabled"
          description="The bell feed always records events; this governs toasts, OS pings and sounds."
        >
          <Toggle
            id="xr-notifications-enabled"
            checked={notifications.enabled}
            onCheckedChange={(v) => update('notifications', { enabled: v })}
          />
        </SettingRow>
        <div
          aria-disabled={!notifications.enabled}
          className={cn(
            'transition-opacity duration-150',
            !notifications.enabled && 'pointer-events-none opacity-50'
          )}
        >
          <SettingRow label="Notification style" htmlFor="xr-notify-style">
            <Segmented
              ariaLabel="Notification style"
              value={notifications.style}
              options={[
                { value: 'banner', label: 'Banner' },
                { value: 'alert', label: 'Alert' },
                { value: 'none', label: 'None' },
              ]}
              onChange={(value) =>
                update('notifications', {
                  style: value as typeof notifications.style,
                })
              }
            />
          </SettingRow>
          <SettingRow
            label="Play sounds"
            htmlFor="xr-notify-sounds"
            description="A soft two-note chime. Off by default — XR is quiet unless you ask."
          >
            <Toggle
              id="xr-notify-sounds"
              checked={notifications.sounds}
              onCheckedChange={(v) => update('notifications', { sounds: v })}
            />
          </SettingRow>
        </div>
      </SettingsSection>

      {/* ── When to notify ── */}
      <SettingsSection title="When to notify">
        {EVENT_ROWS.map((row) => (
          <SettingRow
            key={row.kind}
            label={row.label}
            description={row.description}
            htmlFor={`xr-notify-${row.kind}`}
          >
            <Toggle
              id={`xr-notify-${row.kind}`}
              checked={notifications.events[row.kind]}
              onCheckedChange={(v) => setEvent(row.kind, v)}
            />
          </SettingRow>
        ))}
      </SettingsSection>

      {/* ── Quiet hours ── */}
      <SettingsSection title={t('row.quietHours')}>
        <SettingRow
          label="Enable quiet hours"
          htmlFor="xr-quiet-enabled"
          description="During quiet hours, only critical notifications (approvals and errors) surface."
        >
          <Toggle
            id="xr-quiet-enabled"
            checked={notifications.quietHours.enabled}
            onCheckedChange={(v) =>
              update('notifications', {
                quietHours: { ...notifications.quietHours, enabled: v },
              })
            }
          />
        </SettingRow>
        <SettingRow label="From" htmlFor="xr-quiet-from">
          <TimeInput
            id="xr-quiet-from"
            ariaLabel="Quiet hours start"
            value={notifications.quietHours.from}
            disabled={!notifications.quietHours.enabled}
            onChange={(value) =>
              update('notifications', {
                quietHours: { ...notifications.quietHours, from: value },
              })
            }
          />
        </SettingRow>
        <SettingRow label="To" htmlFor="xr-quiet-to">
          <TimeInput
            id="xr-quiet-to"
            ariaLabel="Quiet hours end"
            value={notifications.quietHours.to}
            disabled={!notifications.quietHours.enabled}
            onChange={(value) =>
              update('notifications', {
                quietHours: { ...notifications.quietHours, to: value },
              })
            }
          />
        </SettingRow>
      </SettingsSection>

      {/* ── Channels ── */}
      <SettingsSection title="Channels">
        <SettingRow
          label="In-app (bell popover)"
          description="Managed by XR — the feed keeps every event for review."
        >
          <span className="text-text-tertiary text-xs">Always on</span>
        </SettingRow>
        <SettingRow
          label="Desktop (OS) notifications"
          htmlFor="xr-os-notifications"
          description="Sent by the Rust host whenever the window is unfocused."
        >
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={testing} onClick={testOsNotification}>
              {testing ? 'Sending…' : t('common.test')}
            </Button>
            <Toggle
              id="xr-os-notifications"
              checked={notifications.osEnabled}
              onCheckedChange={(v) => update('notifications', { osEnabled: v })}
            />
          </div>
        </SettingRow>
        <SettingRow label="Sound volume" htmlFor="xr-notify-volume">
          <LabeledSlider
            label="Notification sound volume"
            min={0}
            max={100}
            value={notifications.volume}
            onChange={(value) => update('notifications', { volume: value })}
            format={(value) => `${value}%`}
          />
        </SettingRow>
      </SettingsSection>
    </div>
  );
}
