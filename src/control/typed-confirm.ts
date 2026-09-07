/**
 * XR Phase 8 — Headless Tier-2 second factor (typed confirmation).
 *
 * Interactive surfaces (CLI/TUI/dashboard) keep the existing approval flow.
 * Headless surfaces (daemon / schedule / cron / webhook / api) MUST NOT
 * silently approve Tier-2 work:
 *
 *   (a) a typed confirmation phrase, hashed, matching a stored grant, or
 *   (b) a pre-authorized phrase hash the operator already stored.
 *
 * Without either, the action is refused. Audited as `approval.typed_confirm`.
 */

import { createHash } from "node:crypto";
import type { WorkspaceStore } from "../state/workspace-store.ts";

export const HEADLESS_SURFACES: ReadonlySet<string> = new Set([
  "daemon",
  "schedule",
  "scheduler",
  "cron",
  "webhook",
  "api",
  "headless",
]);

const TIER2_TOOLS = new Set(["shell", "delete", "exec"]);

export function isHeadlessSurface(surface?: string | null): boolean {
  if (!surface) return false;
  return HEADLESS_SURFACES.has(surface.trim().toLowerCase());
}

export function isTier2Risk(tool: string, riskTier?: string | null): boolean {
  const t = (riskTier ?? "").toLowerCase();
  if (t === "tier2" || t === "high" || t === "destructive" || t === "blocked") return true;
  const name = tool.toLowerCase();
  if (TIER2_TOOLS.has(name)) return true;
  if (name === "shell" || name.endsWith(".shell") || name.includes(":shell")) return true;
  return false;
}

export function phraseHash(phrase: string): string {
  return createHash("sha256").update(phrase.trim().toLowerCase(), "utf8").digest("hex");
}

export interface TypedConfirmRow {
  capability: string;
  surface: string;
  phraseHash: string;
  createdAt: number;
  createdBy: string | null;
}

function tableReady(store: WorkspaceStore): boolean {
  try {
    const row = store
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='typed_confirm'`)
      .get();
    return Boolean(row);
  } catch {
    return false;
  }
}

export function getTypedConfirm(
  store: WorkspaceStore,
  capability: string,
  surface: string,
): TypedConfirmRow | null {
  if (!tableReady(store)) return null;
  try {
    const row = store
      .prepare(
        `SELECT capability, surface, phrase_hash AS phraseHash, created_at AS createdAt, created_by AS createdBy
         FROM typed_confirm WHERE capability = ? AND surface = ?`,
      )
      .get(capability, surface) as
      | { capability: string; surface: string; phraseHash: string; createdAt: number; createdBy: string | null }
      | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

export function setTypedConfirm(
  store: WorkspaceStore,
  input: { capability: string; surface: string; phrase: string; createdBy?: string },
): void {
  const hash = phraseHash(input.phrase);
  const now = Date.now();
  store.write(() => {
    store.exec(`
      CREATE TABLE IF NOT EXISTS typed_confirm (
        capability TEXT NOT NULL,
        surface TEXT NOT NULL,
        phrase_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        created_by TEXT,
        PRIMARY KEY (capability, surface)
      );
    `);
    store
      .prepare(
        `INSERT INTO typed_confirm (capability, surface, phrase_hash, created_at, created_by)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(capability, surface) DO UPDATE SET
           phrase_hash = excluded.phrase_hash,
           created_at = excluded.created_at,
           created_by = excluded.created_by`,
      )
      .run(input.capability, input.surface, hash, now, input.createdBy ?? "operator");
  });
}

export function clearTypedConfirm(store: WorkspaceStore, capability: string, surface: string): void {
  if (!tableReady(store)) return;
  try {
    store.prepare(`DELETE FROM typed_confirm WHERE capability = ? AND surface = ?`).run(capability, surface);
  } catch {
    /* ignore */
  }
}

export type TypedConfirmGate =
  | { ok: true; preauthorized: boolean }
  | { ok: false; reason: string };

/**
 * Headless + Tier-2 gate.
 *
 *  - Not headless or not Tier-2 → ok (the normal approval flow applies).
 *  - No stored phrase hash → refuse.
 *  - Stored hash + matching `phrase` → ok (typed confirm).
 *  - Stored hash + no phrase → ok preauthorized (operator standing grant).
 *  - Stored hash + wrong phrase → refuse.
 */
export function gateHeadlessTier2(input: {
  store: WorkspaceStore;
  surface: string;
  tool: string;
  riskTier?: string | null;
  phrase?: string | null;
}): TypedConfirmGate {
  if (!isHeadlessSurface(input.surface) || !isTier2Risk(input.tool, input.riskTier)) {
    return { ok: true, preauthorized: false };
  }
  const row = getTypedConfirm(input.store, input.tool, input.surface);
  if (!row) {
    return {
      ok: false,
      reason:
        `headless Tier-2 action "${input.tool}" on surface "${input.surface}" requires a typed confirmation phrase ` +
        `(no pre-authorized phrase hash is stored)`,
    };
  }
  if (input.phrase && input.phrase.trim() !== "") {
    if (phraseHash(input.phrase) !== row.phraseHash) {
      return { ok: false, reason: `typed confirmation phrase does not match the stored hash for "${input.tool}"` };
    }
    return { ok: true, preauthorized: false };
  }
  // Standing pre-authorization: the operator stored the hash already.
  return { ok: true, preauthorized: true };
}
