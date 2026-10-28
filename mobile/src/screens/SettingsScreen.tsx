import { useEffect, useState } from 'react';
import {
  ChevronRight,
  Cpu,
  Palette,
  Trash2,
  BellRing,
  Unlink,
  Loader2,
  Info,
  HardDrive,
} from 'lucide-react';
import { Screen } from '../components/Screen';
import { Sheet } from '../components/Sheet';
import { Card, Row, SectionLabel, StatusDot, Toggle, Progress } from '../components/ui';
import { api, isOfflineError } from '../api/client';
import { useSettings } from '../stores/settings';
import { useConnection, connectionCopy } from '../stores/connection';
import { useChats } from '../stores/chats';
import { useApprovals } from '../stores/approvals';
import { THEMES } from '../lib/theme';
import { bytes, money } from '../lib/format';
import { cacheSize, clearCache, readBudget, resetAll } from '../lib/idb';
import { clearPin } from '../lib/certpin';
import { haptic } from '../lib/haptics';
import { toast } from '../stores/toasts';
import {
  currentWireSubscription,
  ensurePushKey,
  pushPermission,
  pushSupported,
  subscribePush,
  unsubscribePush,
} from '../lib/push';
import type { Budget, ThemeId } from '../types';

export function SettingsScreen() {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [modelSheet, setModelSheet] = useState(false);
  const [aboutSheet, setAboutSheet] = useState(false);
  const [advancedSheet, setAdvancedSheet] = useState(false);
  const [busy, setBusy] = useState(false);

  const status = useConnection((s) => s.status);
  const meta = useConnection((s) => s.meta);
  const markUnpaired = useConnection((s) => s.markUnpaired);

  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const models = useSettings((s) => s.models);
  const model = useSettings((s) => s.model);
  const setModel = useSettings((s) => s.setModel);
  const pushEnabled = useSettings((s) => s.pushEnabled);
  const setPushEnabled = useSettings((s) => s.setPushEnabled);
  const deviceName = useSettings((s) => s.deviceName);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const value = await api.budget();
        if (!cancelled) setBudget(value);
      } catch {
        if (!cancelled) setBudget(await readBudget());
      }
      const size = await cacheSize();
      if (!cancelled) setCacheBytes(size);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = connectionCopy(status);
  const dot = status === 'connected' ? 'ok' : status === 'connecting' ? 'warn' : status === 'unpaired' ? 'warn' : 'bad';
  const dailyCapCents = budget?.dailyCapCents ?? 0;
  const todayRatio = budget && dailyCapCents > 0 ? budget.spentTodayCents / dailyCapCents : 0;
  const monthRatio = budget && budget.monthCapCents > 0 ? budget.spentMonthCents / budget.monthCapCents : 0;
  const currentModel = models.find((m) => m.id === model)?.label ?? model ?? 'Default';

  const onPushToggle = async (next: boolean): Promise<void> => {
    if (!pushSupported()) {
      toast.error('Push isn’t supported in this browser');
      return;
    }
    setBusy(true);
    try {
      if (!next) {
        await unsubscribePush();
        try {
          await api.pushUnsubscribe();
        } catch {
          /* daemon may be offline; local unsubscribe already happened */
        }
        setPushEnabled(false);
        toast.info('Push notifications off');
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        toast.error('Enable notifications in your phone settings');
        setPushEnabled(false);
        return;
      }

      const { publicKey } = await api.vapidKey();
      await subscribePush(publicKey);
      const subscription = await currentWireSubscription();
      const pushKey = await ensurePushKey();
      if (!subscription) {
        toast.error('Could not create a push subscription');
        return;
      }
      await api.pushSubscribe(subscription, pushKey);
      setPushEnabled(true);
      haptic('success');
      toast.success('Push notifications on');
    } catch (cause) {
      setPushEnabled(false);
      toast.error(isOfflineError(cause) ? 'XR is offline — try on your home WiFi' : 'Push setup failed');
    } finally {
      setBusy(false);
    }
  };

  const onUnpair = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.unpair();
    } catch {
      /* proceed locally regardless — the user asked to leave */
    }
    await clearPin();
    markUnpaired('You unpaired this device.');
    setBusy(false);
  };

  return (
    <Screen title="Settings">
      <div className="scroll-quiet h-full pb-8">
        {/* ---------------------------------------------------- connection --- */}
        <div className="px-3 pt-2">
          <Card className="p-3.5">
            <div className="flex items-start gap-2.5">
              <span className="mt-[6px]">
                <StatusDot tone={dot} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-medium leading-[1.35]" style={{ color: 'var(--text-primary)' }}>
                  {copy.title}
                </p>
                <p className="mt-0.5 text-[12.5px] leading-[1.4]" style={{ color: 'var(--text-tertiary)' }}>
                  {copy.detail}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
                  <span>{deviceName}</span>
                  {meta?.version ? <span>XR {meta.version}</span> : null}
                  {meta?.lan ? <span>LAN mode</span> : null}
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* ------------------------------------------------------ appearance --- */}
        <SectionLabel>Appearance</SectionLabel>
        <div className="px-3">
          <Card className="p-3">
            <div className="mb-2.5 flex items-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
              <Palette size={14} strokeWidth={1.6} aria-hidden />
              <span className="text-[12.5px]">Theme</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {THEMES.map((option) => {
                const active = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      haptic('light');
                      setTheme(option.id as ThemeId);
                    }}
                    aria-pressed={active}
                    aria-label={option.label}
                    className="flex flex-col items-center gap-1.5 rounded-[11px] p-2"
                    style={{
                      minHeight: 44,
                      border: active ? '1.5px solid var(--accent)' : '1px solid var(--border-subtle)',
                      background: active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent',
                    }}
                  >
                    <span className="flex overflow-hidden rounded-full" style={{ width: 30, height: 30 }}>
                      <span className="h-full w-1/2" style={{ background: option.swatch[0] }} />
                      <span className="flex h-full w-1/2 flex-col">
                        <span className="h-1/2 w-full" style={{ background: option.swatch[1] }} />
                        <span className="h-1/2 w-full" style={{ background: option.swatch[2] }} />
                      </span>
                    </span>
                    <span
                      className="text-[11px] leading-[1.2]"
                      style={{ color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
                    >
                      {option.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        {/* ---------------------------------------------------------- model --- */}
        <SectionLabel>Model</SectionLabel>
        <div className="px-3">
          <Card>
            <Row
              icon={<Cpu size={15} strokeWidth={1.6} />}
              label="Default model"
              value={currentModel}
              onPress={() => setModelSheet(true)}
              right={<ChevronRight size={15} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} aria-hidden />}
            />
          </Card>
        </div>

        {/* --------------------------------------------------------- budget --- */}
        <SectionLabel>Budget</SectionLabel>
        <div className="px-3">
          <Card className="p-3.5">
            {budget ? (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                    Spent today
                  </span>
                  <span className="text-[15px] font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {money(budget.spentTodayCents, budget.currency)}
                  </span>
                </div>
                <div className="mt-2">
                  <Progress value={todayRatio} tone={todayRatio > 0.9 ? 'danger' : todayRatio > 0.7 ? 'warning' : 'accent'} />
                </div>
                <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
                  {budget.dailyCapCents && budget.dailyCapCents > 0
                    ? `of ${money(budget.dailyCapCents, budget.currency)} daily cap`
                    : budget.perTaskCents !== undefined
                      ? `${money(budget.perTaskCents, budget.currency)} cap per task`
                      : 'no daily cap configured'}
                </p>

                <div className="mt-3.5 flex items-baseline justify-between">
                  <span className="text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                    This month
                  </span>
                  <span className="text-[13px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {money(budget.spentMonthCents, budget.currency)} / {money(budget.monthCapCents, budget.currency)}
                  </span>
                </div>
                <div className="mt-2">
                  <Progress value={monthRatio} tone={monthRatio > 0.9 ? 'danger' : 'accent'} />
                </div>
              </>
            ) : (
              <p className="py-2 text-[13.5px]" style={{ color: 'var(--text-tertiary)' }}>
                Budget unavailable — XR isn’t reachable.
              </p>
            )}
          </Card>
        </div>

        {/* -------------------------------------------------- notifications --- */}
        <SectionLabel>Notifications</SectionLabel>
        <div className="px-3">
          <Card className="p-3.5">
            <Toggle
              checked={pushEnabled}
              onChange={(next) => void onPushToggle(next)}
              label="Push notifications"
              description="Approvals reach you even when the app is closed. Push requires your desktop to be online."
              disabled={busy}
            />
            {pushEnabled && pushPermission() !== 'granted' ? (
              <p className="mt-2 text-[12px]" style={{ color: 'var(--danger)' }}>
                Permission denied — enable notifications for XR in your phone settings.
              </p>
            ) : null}
          </Card>
        </div>

        {/* ------------------------------------------------------- pairing --- */}
        <SectionLabel>This device</SectionLabel>
        <div className="px-3">
          <Card>
            <Row
              icon={<Unlink size={15} strokeWidth={1.6} />}
              label="Unpair this device"
              destructive
              onPress={() => void onUnpair()}
            />
          </Card>
        </div>

        {/* --------------------------------------------------------- about --- */}
        <SectionLabel>About</SectionLabel>
        <div className="px-3">
          <Card>
            <Row
              icon={<Info size={15} strokeWidth={1.6} />}
              label="About XR"
              onPress={() => setAboutSheet(true)}
              right={<ChevronRight size={15} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} aria-hidden />}
            />
            <Row
              icon={<HardDrive size={15} strokeWidth={1.6} />}
              label="Advanced"
              value={bytes(cacheBytes)}
              onPress={() => setAdvancedSheet(true)}
              right={<ChevronRight size={15} strokeWidth={1.6} style={{ color: 'var(--text-tertiary)' }} aria-hidden />}
            />
          </Card>
        </div>

        <p className="mt-5 px-6 text-center text-[11.5px] leading-[1.5]" style={{ color: 'var(--text-tertiary)' }}>
          XR is local — your data stays on your devices.
        </p>
      </div>

      {/* Model picker */}
      <Sheet open={modelSheet} onClose={() => setModelSheet(false)} compact title="Default model">
        <div className="px-3 pb-4">
          {models.length === 0 ? (
            <p className="px-1 py-2 text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
              No models available — XR desktop isn’t reachable.
            </p>
          ) : (
            models.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => {
                  setModel(entry.id);
                  haptic('light');
                  setModelSheet(false);
                }}
                className="flex w-full items-center justify-between rounded-[11px] px-3 py-[11px] text-left"
                style={{
                  minHeight: 44,
                  background: entry.id === model ? 'color-mix(in srgb, var(--accent) 12%, transparent)' : 'transparent',
                  color: entry.id === model ? 'var(--accent)' : 'var(--text-primary)',
                }}
              >
                <span className="text-[15px]">{entry.label}</span>
                <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
                  {entry.provider}
                </span>
              </button>
            ))
          )}
        </div>
      </Sheet>

      {/* About */}
      <Sheet open={aboutSheet} onClose={() => setAboutSheet(false)} compact title="About">
        <div className="px-4 pb-5">
          <p className="text-[14.5px] leading-[1.55]" style={{ color: 'var(--text-secondary)' }}>
            XR is a local-first AI companion. Chats, approvals and transcripts live on your own
            machine — this phone talks to your desktop over your own WiFi, and nowhere else.
          </p>
          <ul className="mt-3 space-y-1.5 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
            <li>Version 28.0.0</li>
            {meta?.version ? <li>Daemon {meta.version}</li> : null}
            <li>No telemetry, no analytics, no third-party scripts.</li>
            <li>Push payloads are encrypted twice — Google and Apple can’t read them.</li>
          </ul>
          <a
            href="mailto:feedback@xr.local?subject=XR%20mobile%20feedback"
            className="tap mt-4 flex w-full items-center justify-center rounded-[12px] text-[15px] font-medium"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          >
            Send feedback
          </a>
        </div>
      </Sheet>

      {/* Advanced */}
      <Sheet open={advancedSheet} onClose={() => setAdvancedSheet(false)} compact title="Advanced">
        <div className="px-3 pb-5">
          <div className="px-1 py-2">
            <p className="text-[13.5px]" style={{ color: 'var(--text-secondary)' }}>
              Offline cache: {bytes(cacheBytes)} of 20 MB
            </p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Keeps your last 50 chats, 200 messages each and 200 approvals.
            </p>
          </div>

          <button
            type="button"
            onClick={async () => {
              await clearCache();
              setCacheBytes(await cacheSize());
              toast.success('Cache cleared');
            }}
            className="tap mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] text-[15px]"
            style={{ border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          >
            <Trash2 size={16} strokeWidth={1.6} aria-hidden />
            Clear cache
          </button>

          <button
            type="button"
            onClick={async () => {
              await resetAll();
              useChats.setState({ chats: [], messages: {} });
              useApprovals.setState({ items: [] });
              await clearPin();
              markUnpaired('App reset');
              toast.info('App reset — pair again to continue');
            }}
            className="tap mt-2 flex w-full items-center justify-center gap-2 rounded-[12px] text-[15px]"
            style={{ border: '1px solid var(--danger)', color: 'var(--danger)' }}
          >
            <Trash2 size={16} strokeWidth={1.6} aria-hidden />
            Reset app
          </button>

          <div className="mt-4 flex items-center gap-2 px-1" style={{ color: 'var(--text-tertiary)' }}>
            <BellRing size={13} strokeWidth={1.6} aria-hidden />
            <span className="text-[12px]">
              Push requires XR desktop to be running on your network.
            </span>
          </div>
          {busy ? (
            <div className="mt-3 flex items-center justify-center gap-2" style={{ color: 'var(--text-tertiary)' }}>
              <Loader2 size={14} strokeWidth={1.8} className="spinner" aria-hidden />
              <span className="text-[12.5px]">Working…</span>
            </div>
          ) : null}
        </div>
      </Sheet>
    </Screen>
  );
}
