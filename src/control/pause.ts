/** XR — computer-control pause/stop (Phase 4 · Control Room).
 *
 * Durable pause state persisted at ~/.xr/control-pause.json (same discipline
 * as trust-mode.json / control permissions). The service facade consults it
 * on EVERY action (runAction), so every entry point — agent tool, planning
 * service, CLI — honors one engine-owned flag. The shell renders it and
 * forwards pause/resume/stop; it never derives policy itself.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ControlPauseState {
  paused: boolean;
  since: number | null;
  reason: string | null;
}

// env override mirrors the XR_CONTROL_DISABLED discipline; defaults to the
// same ~/.xr location as trust-mode.json. Tests point it at a scratch file.
function pausePath(): string {
  return process.env.XR_CONTROL_PAUSE_PATH ?? join(homedir(), ".xr", "control-pause.json");
}

export function getControlPause(): ControlPauseState {
  try {
    const raw = readFileSync(pausePath(), "utf8");
    const p = JSON.parse(raw) as Partial<ControlPauseState>;
    return {
      paused: p.paused === true,
      since: typeof p.since === "number" ? p.since : null,
      reason: typeof p.reason === "string" ? p.reason : null,
    };
  } catch {
    return { paused: false, since: null, reason: null };
  }
}

export function setControlPause(paused: boolean, reason?: string): ControlPauseState {
  const next: ControlPauseState = {
    paused,
    since: paused ? Date.now() : null,
    reason: paused ? (reason?.trim() || "paused from Control Room") : null,
  };
  mkdirSync(join(homedir(), ".xr"), { recursive: true });
  writeFileSync(pausePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function isControlPaused(): ControlPauseState {
  return getControlPause();
}
