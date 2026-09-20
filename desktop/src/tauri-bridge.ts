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

/**
 * Phase 4 · notification ACTIONS for approvals (Confirm / Deny straight from
 * the OS notification). Plugin-JS route, only under the packaged app; the
 * decision still lands in the engine's durable store via /approvals/:id/decision.
 */
let approvalActionsRegistered = false;
export async function nativeNotifyApproval(
  id: string,
  tool: string,
  onDecision: (id: string, approved: boolean) => void,
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const mod = await import("@tauri-apps/plugin-notification");
    if (!approvalActionsRegistered) {
      await mod.registerActionTypes([
        {
          id: "xr-approval",
          actions: [
            { id: "confirm", title: "Confirm" },
            { id: "deny", title: "Deny" },
          ],
        },
      ]);
      void mod.onAction((n) => {
        const act = (n as { actionId?: string }).actionId;
        const nid = (n as { extra?: Record<string, string> }).extra?.approvalId ?? "";
        if ((act === "confirm" || act === "deny") && nid) onDecision(nid, act === "confirm");
      });
      approvalActionsRegistered = true;
    }
    await mod.sendNotification({
      title: "XR — approval due",
      body: `${tool} is waiting for your decision`,
      actionTypeId: "xr-approval",
      extra: { approvalId: id },
    } as Parameters<typeof mod.sendNotification>[0]);
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
export interface EngineLinkSnapshot {
  reachable: boolean;
  spawned: boolean;
  port: number | null;
  reason: string | null;
  /** W-2: set when the sidecar runs WITHOUT job-object containment (Windows). */
  containment: string | null;
  /**
   * SEC-12: the crash-containment mechanism actually in force for the sidecar
   * — `job-object` (Windows), `pdeathsig+parent-watch` (Linux), `parent-watch`
   * (macOS), `none` (Windows, job unavailable; `containment` says why), or
   * null when this shell spawned no sidecar. A fact from the shell, never a
   * renderer guess.
   */
  containmentMode: string | null;
  /** W-5: the sidecar's last stderr lines — the engine's own explanation. */
  stderr: string[];
  externalDaemonOn3141: boolean;
  /** Present when the command itself could not be invoked. */
  error?: string;
}

/**
 * The Rust shell's `engine_link` answer as facts (never the token). Null in a
 * plain browser, where there is no shell to ask.
 */
export async function engineLinkSnapshot(): Promise<EngineLinkSnapshot | null> {
  if (!isTauri()) return null;
  try {
    const link = (await window.__TAURI_INTERNALS__!.invoke!("engine_link")) as {
      reachable?: boolean;
      spawned?: boolean;
      port?: number | null;
      reason?: string | null;
      containment?: string | null;
      containmentMode?: string | null;
      stderr?: string[];
      externalDaemonOn3141?: boolean;
    };
    return {
      reachable: link?.reachable === true,
      spawned: link?.spawned === true,
      port: typeof link?.port === "number" ? link.port : null,
      reason: link?.reason ?? null,
      containment: link?.containment ?? null,
      containmentMode: typeof link?.containmentMode === "string" ? link.containmentMode : null,
      stderr: Array.isArray(link?.stderr) ? link.stderr.filter((l): l is string => typeof l === "string") : [],
      externalDaemonOn3141: link?.externalDaemonOn3141 === true,
    };
  } catch (e) {
    return {
      reachable: false, spawned: false, port: null, reason: null, containment: null, containmentMode: null, stderr: [], externalDaemonOn3141: false,
      error: `engine_link failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export async function engineLinkReason(): Promise<string | null> {
  const link = await engineLinkSnapshot();
  if (!link) return "browser dev mode — the shell talks to the daemon through the dev proxy";
  if (link.error) return link.error;
  if (link.reachable) return null;
  if (link.reason) return link.reason;
  if (link.externalDaemonOn3141) return "a daemon is running on 3141 but the sidecar did not pair";
  return "the sidecar has not reported a port yet — it may still be starting";
}
