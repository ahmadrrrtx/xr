/*
 * Notification policy (Phase 8) — the gate Phase 7's emit path now consults.
 *
 * The bell feed is ALWAYS written (in-app channel, "Managed by XR"); this
 * policy decides toasts, OS notifications and sounds:
 *   master toggle → per-event toggle → quiet hours (approval/error pass).
 * Sounds are a single WebAudio chime — no asset files, default OFF
 * (Phase 7 shipped silent; the user opts in here).
 */
import type { NotificationEventKind, XRSettings } from '@/stores/settingsStore';

export type PolicyKind = NotificationEventKind;

/** True when `now` falls inside the quiet-hours window (handles midnight). */
export function inQuietHours(
  from: string,
  to: string,
  now: Date = new Date()
): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (hhmm: string): number => {
    const [h, m] = hhmm.split(':').map((part) => Number.parseInt(part, 10));
    if (Number.isNaN(h) || Number.isNaN(m)) return -1;
    return h * 60 + m;
  };
  const start = parse(from);
  const end = parse(to);
  if (start < 0 || end < 0 || start === end) return false;
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end; // wraps midnight (22:00 → 07:00)
}

/** May XR surface a notification of this kind right now? */
export function canNotify(
  kind: PolicyKind,
  settings: XRSettings,
  now: Date = new Date()
): boolean {
  const notifications = settings.notifications;
  if (!notifications.enabled) return false;
  if (notifications.events[kind] === false) return false;
  if (
    notifications.quietHours.enabled &&
    inQuietHours(notifications.quietHours.from, notifications.quietHours.to, now)
  ) {
    // Only critical channels pierce quiet hours.
    return kind === 'approval' || kind === 'errors';
  }
  return true;
}

/** Feed NotificationType → policy event kind. */
export function notificationKindFor(
  type: 'approval-request' | 'approval-decided' | 'success' | 'error' | 'warning' | 'info'
): PolicyKind {
  switch (type) {
    case 'approval-request':
    case 'approval-decided':
      return 'approval';
    case 'success':
      return 'agentComplete';
    case 'error':
      return 'errors';
    case 'warning':
      return 'budget';
    default:
      return 'updates';
  }
}

/** May XR raise an OS-level notification for this kind right now? */
export function shouldOsNotify(
  kind: PolicyKind,
  settings: XRSettings,
  now: Date = new Date()
): boolean {
  if (!settings.notifications.osEnabled) return false;
  return canNotify(kind, settings, now);
}

/** Toast lifetime by style: banner 4s, alert sticky, none suppressed. */
export function toastDurationMs(style: XRSettings['notifications']['style']): number {
  if (style === 'banner') return 4000;
  if (style === 'alert') return Number.POSITIVE_INFINITY;
  return 0;
}

/** Should the chime play for this kind? (sounds opt-in + not muted) */
export function shouldSound(kind: PolicyKind, settings: XRSettings): boolean {
  return (
    settings.notifications.sounds &&
    !settings.voice.muted &&
    canNotify(kind, settings)
  );
}

let audioCtx: AudioContext | null = null;

/**
 * Synthesized two-note chime (E5 → A5), volume-scaled, ~180ms. Guarded so a
 * missing AudioContext never throws in the notification path.
 */
export function playNotificationSound(volume: number): void {
  try {
    if (typeof window === 'undefined') return;
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const gain = Math.min(1, Math.max(0, volume / 100)) * 0.12;
    const note = (freq: number, start: number, duration: number): void => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, ctx.currentTime + start);
      env.gain.linearRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
      env.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + start + duration
      );
      osc.connect(env).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration + 0.02);
    };
    note(659.25, 0, 0.12); // E5
    note(880.0, 0.09, 0.16); // A5
  } catch {
    /* audio is a nicety, never a requirement */
  }
}
