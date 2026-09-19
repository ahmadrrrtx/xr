/**
 * Phase 4 · Control Room — durable pause/stop semantics.
 *
 * Proves:
 *   • setControlPause persists + isControlPaused round-trips (HOME-scoped)
 *   • runAction honors the pause BEFORE permissions/execution: the action is
 *     skipped, audited, and never reaches the OS executor
 *   • resume clears the gate
 *
 * No real OS actions are taken; HOME points at a scratch dir.
 */
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratch = mkdtempSync(join(tmpdir(), "xr-pause-test-"));
process.env.XR_CONTROL_PAUSE_PATH = join(scratch, "control-pause.json");

const { setControlPause, isControlPaused, getControlPause } = await import("../../src/control/pause.ts");
const { runAction } = await import("../../src/control/service.ts");
const { Store } = await import("../../src/state/workspace-store.ts");
const { approvals, bindApprovals } = await import("../../src/control/approvals.ts");

describe("control pause / stop", () => {
  let store: InstanceType<typeof Store>;

  beforeAll(() => {
    store = new Store(join(scratch, "xr.db"));
    bindApprovals(store);
  });
  afterAll(() => {
    try { (store as unknown as { close?: () => void }).close?.(); } catch { /* noop */ }
    rmSync(scratch, { recursive: true, force: true });
  });

  it("round-trips the durable pause flag under HOME", () => {
    expect(isControlPaused().paused).toBe(false);
    setControlPause(true, "test pause");
    expect(isControlPaused().paused).toBe(true);
    expect(getControlPause().reason).toBe("test pause");
    expect(existsSync(join(scratch, "control-pause.json"))).toBe(true);
    setControlPause(false);
    expect(isControlPaused().paused).toBe(false);
  });

  it("runAction skips + audits while paused — never reaches the executor", async () => {
    setControlPause(true, "phase-4 test");
    const audits: string[] = [];
    const spy = { audit: (e: string) => audits.push(e) } as unknown as InstanceType<typeof Store>;
    const res = await runAction(
      spy,
      { type: "focus", name: "Firefox" },
      { mode: "dry-run", autoApproveSensitive: false, delayMs: 0 },
    );
    expect(res.result.ok).toBe(false);
    expect(res.result.skipped).toBe(true);
    expect(String(res.result.message)).toContain("paused");
    expect(audits).toContain("control.action_paused");
    setControlPause(false);
  });

  it("resume re-opens the gate (dry-run then executes the governed path)", async () => {
    setControlPause(false);
    const res = await runAction(
      store,
      { type: "focus", name: "Firefox" },
      { mode: "dry-run", autoApproveSensitive: true, delayMs: 0 },
    );
    // not paused anymore — the dry-run governed path proceeds past the pause gate
    expect(String(res.result.message ?? "")).not.toContain("paused");
  });

  it("stop verb semantics: pending approvals are deny-answerable through the durable store", () => {
    // create a durable pending record, then answer it denied exactly like the
    // /control/pause stop branch does.
    const rec = approvals.request(
      { type: "focus", name: "Firefox" },
      { level: "sensitive", reason: "phase-4 stop test", reversible: true },
      "focus window Firefox",
    );
    expect(approvals.listRecords().some((r) => r.id === rec.id)).toBe(true);
    const denied = approvals.answer(rec.id, false);
    expect(denied).toBe(true);
    expect(approvals.listRecords().some((r) => r.id === rec.id)).toBe(false);
  });
});
