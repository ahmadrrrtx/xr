/* Phase 4 · native bridge stubs.
   Inside the Tauri package these hook into @tauri-apps/plugin-notification
   action buttons, tray `xr-tray-action` events, and tauri-plugin-deep-link
   `xr://<area>` URIs. Outside of Tauri (web dev server, preview) each call
   is a no-op that logs a one-time hint so Control/Voice/Trust can always
   call into this file without try/catch at every site. */

export type TrayAction = "new-task" | "pending-approvals";
export type DeepLink = `xr://${string}`;
export type NotificationAction = "confirm" | "deny";

type TrayListener = (action: TrayAction) => void;
type DeepLinkListener = (path: string) => void;
type NotificationActionListener = (action: NotificationAction, tag: string) => void;

const trayListeners = new Set<TrayListener>();
const deepLinkListeners = new Set<DeepLinkListener>();
const notifActionListeners = new Set<NotificationActionListener>();
let warned = false;
const hint = () => {
  if (warned) return;
  warned = true;
  console.info("[xr/native] running outside Tauri — tray / deep-link / notification action stubs active");
};

type TauriApi = { invoke?: (cmd: string, args?: unknown) => Promise<unknown>; listen?: (ev: string, cb: (p: { payload: unknown }) => void) => Promise<() => void> };
let tauri: TauriApi | null = null;
try {
  // @ts-expect-error __TAURI__ is injected at runtime by Tauri only; in web it is absent
  tauri = window.__TAURI__ ?? null;
} catch { tauri = null; }

export const native = {
  get inTauri() { return !!tauri; },

  async notification(opts: { title: string; body?: string; tag?: string; actions?: { id: NotificationAction; title: string }[] }) {
    if (tauri?.invoke) {
      try { await tauri.invoke("plugin:notification|notify", { options: { title: opts.title, body: opts.body ?? "", tag: opts.tag, actions: opts.actions } }); return; } catch { /* fall through */ }
    }
    hint();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(opts.title, { body: opts.body, tag: opts.tag }); } catch { /* ignore */ }
    }
  },

  requestNotificationPermission(): Promise<NotificationPermission> {
    if (tauri) return Promise.resolve("granted");
    hint();
    if (typeof Notification === "undefined") return Promise.resolve("default");
    return Notification.requestPermission();
  },

  onTrayAction(l: TrayListener): () => void {
    trayListeners.add(l);
    hint();
    if (tauri?.listen) {
      void tauri.listen("xr-tray-action", (e) => {
        const a = (e.payload as { action?: TrayAction } | undefined)?.action;
        if (a === "new-task" || a === "pending-approvals") trayListeners.forEach((fn) => fn(a));
      });
    }
    return () => trayListeners.delete(l);
  },

  onDeepLink(l: DeepLinkListener): () => void {
    deepLinkListeners.add(l);
    hint();
    if (tauri?.listen) {
      void tauri.listen("deep-link://new-url", (e) => {
        const url = (e.payload as { urls?: string[] } | undefined)?.urls?.[0] ?? "";
        if (url.startsWith("xr://")) deepLinkListeners.forEach((fn) => fn(url.slice("xr://".length)));
      });
    }
    return () => deepLinkListeners.delete(l);
  },

  onNotificationAction(l: NotificationActionListener): () => void {
    notifActionListeners.add(l);
    hint();
    if (tauri?.listen) {
      void tauri.listen("notification://action", (e) => {
        const p = e.payload as { action?: NotificationAction; tag?: string } | undefined;
        if (p?.action) notifActionListeners.forEach((fn) => fn(p.action!, p.tag ?? ""));
      });
    }
    return () => notifActionListeners.delete(l);
  },

  // Autostart opt-in (Phase 5 onboarding). Tauri plugin-autostart exposes
  // enable()/disable(); outside Tauri this is a no-op so the onboarding
  // checkbox still renders harmlessly. We route through tauri-bridge when
  // available rather than re-implementing invoke here.
  _autostart: {
    async set(on: boolean): Promise<boolean | null> {
      hint();
      try {
        const mod = await import("./tauri-bridge");
        if (mod.isTauri()) return await mod.nativeSetAutostart(on);
      } catch { /* bridge not loaded or not in Tauri */ }
      return null;
    },
    async status(): Promise<boolean | null> {
      hint();
      try {
        const mod = await import("./tauri-bridge");
        if (mod.isTauri()) return await mod.nativeAutostartStatus();
      } catch { /* ignore */ }
      return null;
    },
  },

  // Test helper for dev server / stories — simulate a tray click / deep link.
  _simulateTray(a: TrayAction) { trayListeners.forEach((fn) => fn(a)); },
  _simulateDeepLink(path: string) { deepLinkListeners.forEach((fn) => fn(path)); },
};
