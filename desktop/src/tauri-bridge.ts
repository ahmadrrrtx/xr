/**
 * Phase 5 · native bridge. The desktop web app runs in TWO hosts: a plain
 * browser (vite preview, first-class) and the Tauri webview (packaged).
 * Every native verb here is guarded by a real runtime detection and reports
 * an honest "unavailable" outside the packaged app — the web shell NEVER
 * pretends to have OS primitives.
 */

type TauriInternals = {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export function isTauri(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

export async function nativeNotify(title: string, body: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await window.__TAURI_INTERNALS__!.invoke!("notify_os", { title, body });
    return true;
  } catch {
    return false;
  }
}

export async function nativeAutostartStatus(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    return (await window.__TAURI_INTERNALS__!.invoke!("autostart_status")) as boolean;
  } catch {
    return null;
  }
}

export async function nativeSetAutostart(enable: boolean): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    return (await window.__TAURI_INTERNALS__!.invoke!("set_autostart", { enable })) as boolean;
  } catch {
    return null;
  }
}

export async function nativeCheckUpdate(): Promise<{ available?: boolean; version?: string; error?: string }> {
  if (!isTauri()) return { error: "not in the packaged app" };
  try {
    return (await window.__TAURI_INTERNALS__!.invoke!("check_update")) as { available?: boolean; version?: string };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Phase 1 · audit D-10 — surface WHY the engine link is absent.
 *
 * The Rust shell already computes a human reason (`spawned:false` + `reason`,
 * e.g. "sidecar binary not found (dev build)", "spawn failed: …", "sidecar
 * exited (stdout closed)"), but the renderer consumed it only to break out of
 * the handshake loop and then discarded it — so a user saw a red dot with no
 * explanation. Returns null outside the packaged app or when the link is fine.
 */
export async function engineLinkReason(): Promise<string | null> {
  if (!isTauri()) {
    return "browser dev mode — the shell talks to the daemon through the dev proxy";
  }
  try {
    const link = (await window.__TAURI_INTERNALS__!.invoke!("engine_link")) as {
      reachable?: boolean;
      spawned?: boolean;
      reason?: string | null;
      externalDaemonOn3141?: boolean;
    };
    if (link?.reachable) return null;
    if (link?.reason) return link.reason;
    if (link?.externalDaemonOn3141) return "a daemon is running on 3141 but the sidecar did not pair";
    return "the sidecar has not reported a port yet — it may still be starting";
  } catch (e) {
    return `engine_link failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}
