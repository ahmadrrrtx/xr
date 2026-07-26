/**
 * XR 5.1 — Browser environment provider.
 *
 * Owns governed isolated browser sessions (one Playwright browser+context per
 * environment session) on top of the hardened launch path in control/browser.
 * No new browser harness: launch flags, sandbox behavior, and secure defaults
 * all come from the existing implementation.
 */
import type { Action, ActionResult } from "../../control/types.ts";
import {
  openBrowserSession,
  closeBrowserSession,
  executeSessionBrowserAction,
  getBrowserObservation,
  browserSessionSecurityState,
  type BrowserSessionHandle,
} from "../../control/browser.ts";
import { ENVIRONMENT_BOUNDS, type EnvironmentObservation, type EnvironmentSession } from "../types.ts";

const handles = new Map<string, BrowserSessionHandle>();

export async function provisionBrowser(
  session: EnvironmentSession,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await openBrowserSession(session.sessionId, {
    allowedDomains: session.policy.allowedDomains,
    blockedDomains: session.policy.blockedDomains,
    blockPrivateNetworks: session.policy.blockPrivateNetworks,
    downloadsRoot: session.policy.downloadsRoot,
    maxDownloadBytes: session.policy.maxDownloadBytes,
  });
  if (!res.ok) return { ok: false, error: res.error };
  handles.set(session.sessionId, res.handle);
  session.resources.downloadsRoot = res.handle.policy.downloadsRoot;
  session.resources.blockPrivateNetworks = res.handle.policy.blockPrivateNetworks;
  return { ok: true };
}

export function browserHandle(sessionId: string): BrowserSessionHandle | undefined {
  return handles.get(sessionId);
}

export async function runBrowserOp(session: EnvironmentSession, action: Action): Promise<ActionResult> {
  const handle = handles.get(session.sessionId);
  if (!handle) return { ok: false, message: "browser session is not provisioned" };
  if (action.type !== "browser") return { ok: false, message: "not a browser action" };

  // Tab bound (declared tabIndex must stay inside the per-session limit).
  if ((action.tabIndex ?? 0) >= ENVIRONMENT_BOUNDS.MAX_TABS_PER_SESSION) {
    return { ok: false, message: `tab index exceeds per-session limit of ${ENVIRONMENT_BOUNDS.MAX_TABS_PER_SESSION}` };
  }
  const res = await executeSessionBrowserAction(handle, action);
  session.resources.tabs = handle.pages.filter((p: any) => {
    try {
      return !p.isClosed();
    } catch {
      return false;
    }
  }).length;
  if (handle.crashed) {
    return { ok: false, message: `browser session crashed: ${handle.crashReason ?? "unknown"}` };
  }
  return res;
}

export async function observeBrowser(session: EnvironmentSession): Promise<EnvironmentObservation | null> {
  const handle = handles.get(session.sessionId);
  if (!handle) return null;
  const obs = await getBrowserObservation(handle);
  if (!obs) return null;
  return {
    observationId: `obs_${session.sessionId}_${obs.at}`,
    sessionId: session.sessionId,
    source: "browser",
    summary: `page: ${obs.title || "(untitled)"} @ ${obs.url}`.slice(0, ENVIRONMENT_BOUNDS.MAX_OBSERVATION_SUMMARY_CHARS),
    confidence: "high", // direct from the browser engine, not inferred
    provenance: "direct",
    sensitivity: "unknown",
    capturedAt: obs.at,
    staleAfterMs: ENVIRONMENT_BOUNDS.DEFAULT_STALE_OBSERVATION_MS,
  };
}

export function browserSessionReport(session: EnvironmentSession): Record<string, unknown> {
  const handle = handles.get(session.sessionId);
  if (!handle) return { provisioned: false };
  return { provisioned: true, ...browserSessionSecurityState(handle) };
}

export async function cleanupBrowser(session: EnvironmentSession): Promise<{ ok: boolean; note?: string }> {
  const handle = handles.get(session.sessionId);
  handles.delete(session.sessionId);
  if (!handle) return { ok: true };
  const res = await closeBrowserSession(handle);
  const oversized = handle.downloads.filter((d) => d.oversized).length;
  const note = [res.note, oversized ? `${oversized} oversized download(s) deleted by policy` : null]
    .filter(Boolean)
    .join("; ");
  return { ok: res.ok, note: note || undefined };
}

/** Test hook — drop all handles without launching browsers. */
export function _resetBrowserProviders(): void {
  handles.clear();
}
