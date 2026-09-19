/**
 * Phase 5 · OS notifications (approval due / run done) — OPT-IN only.
 * Packaged app: real OS notification via the Tauri plugin. Browser:
 * the Notification API when the user grants permission. Neither path
 * fires unless the Settings toggle is on.
 */
import { isTauri, nativeNotify } from "./tauri-bridge";

const KEY = "xr.notifications";

export function notificationsEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "on"; } catch { return false; }
}

export function setNotificationsEnabled(on: boolean): void {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ }
}

export async function notificationChannel(): Promise<"tauri" | "browser" | "none"> {
  if (isTauri()) return "tauri";
  if (typeof Notification !== "undefined" && Notification.permission === "granted") return "browser";
  return "none";
}

export async function requestNotificationPermission(): Promise<"granted" | "denied" | "unsupported"> {
  if (isTauri()) return "granted";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    const r = await Notification.requestPermission();
    return r === "granted" ? "granted" : "denied";
  } catch { return "denied"; }
}

export async function notify(title: string, body: string): Promise<void> {
  if (!notificationsEnabled()) return;
  if (await nativeNotify(title, body)) return;
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try { new Notification(title, { body }); } catch { /* sandboxed iframe */ }
  }
}
