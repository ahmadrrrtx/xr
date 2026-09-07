/**
 * XR Phase 8 · XR806 — headless Tier-2 typed confirmation.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  gateHeadlessTier2,
  setTypedConfirm,
  phraseHash,
  isHeadlessSurface,
  isTier2Risk,
} from "../../src/control/typed-confirm.ts";

let store: WorkspaceStore;
beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "xr-p8-tc-"));
  store = new WorkspaceStore("w", join(dir, "w.db"));
});

describe("XR806 headless Tier-2 typed confirm", () => {
  test("migration 10 created typed_confirm", () => {
    const row = store
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='typed_confirm'`)
      .get() as { name: string } | null;
    expect(row?.name).toBe("typed_confirm");
  });

  test("interactive surfaces skip the gate", () => {
    expect(isHeadlessSurface("cli")).toBe(false);
    expect(isHeadlessSurface("telegram")).toBe(false);
    const g = gateHeadlessTier2({ store, surface: "cli", tool: "shell", riskTier: "tier2" });
    expect(g.ok).toBe(true);
  });

  test("headless + not Tier-2 skips the gate", () => {
    expect(isHeadlessSurface("daemon")).toBe(true);
    expect(isTier2Risk("read_file")).toBe(false);
    const g = gateHeadlessTier2({ store, surface: "daemon", tool: "read_file" });
    expect(g.ok).toBe(true);
  });

  test("headless Tier-2 without stored phrase ⇒ refused (no silent approve)", () => {
    const g = gateHeadlessTier2({ store, surface: "daemon", tool: "shell", riskTier: "tier2" });
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain("typed confirmation");
  });

  test("stored hash + matching phrase ⇒ ok", () => {
    setTypedConfirm(store, { capability: "shell", surface: "daemon", phrase: "DELETE THE FILE" });
    const g = gateHeadlessTier2({
      store,
      surface: "daemon",
      tool: "shell",
      riskTier: "tier2",
      phrase: "delete the file",
    });
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.preauthorized).toBe(false);
  });

  test("stored hash + wrong phrase ⇒ refused", () => {
    setTypedConfirm(store, { capability: "shell", surface: "daemon", phrase: "correct-phrase" });
    const g = gateHeadlessTier2({
      store,
      surface: "daemon",
      tool: "shell",
      phrase: "wrong-phrase",
    });
    expect(g.ok).toBe(false);
  });

  test("stored hash + no phrase ⇒ preauthorized standing grant", () => {
    setTypedConfirm(store, { capability: "delete", surface: "schedule", phrase: "standing" });
    const g = gateHeadlessTier2({ store, surface: "schedule", tool: "delete" });
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.preauthorized).toBe(true);
  });

  test("phrase hash is case-insensitive and trimmed", () => {
    expect(phraseHash("  AbC  ")).toBe(phraseHash("abc"));
  });
});
