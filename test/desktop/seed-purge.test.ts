/**
 * XR-LAUNCH-009 — demo data is development-only, and the one-time cleanup
 * removes exactly the rows earlier builds seeded (never a real row).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { seedEvents } from "../../desktop/src/budget/seed.ts";
import * as core from "../../desktop/src/shield/core.ts";
import { sha256Hex } from "../../desktop/src/shield/hash.ts";
import { buildSeedChain, seedQuarantine } from "../../desktop/src/shield/seed.ts";
import type { AuditEntry, QuarantinedSkill } from "../../desktop/src/shield/types.ts";
import {
  PURGE_AUDIT_ACTION,
  isSeedAuditId,
  isSeedSpendId,
  purgeSeedQuarantine,
  purgeSeedSpend,
  rechainWithoutSeed,
} from "../../desktop/src/lib/seedPurge.ts";
import { SEED_PROBES } from "../../scripts/desktop-seed-gate.ts";

const ROOT = join(import.meta.dir, "..", "..");
const NOW = Date.UTC(2026, 9, 22, 12);
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("markers match every seeded row and no live id", () => {
  test("spend: all seeded ids match, live ids do not", () => {
    const seeded = seedEvents(NOW, 0);
    expect(seeded.length).toBeGreaterThan(100);
    expect(seeded.every((e) => isSeedSpendId(e.id))).toBe(true);
    for (const live of ["sp_1a2b3c4d", "sp_seed_12345", "sp_seed_", "x_sp_seed_0001"]) expect(isSeedSpendId(live)).toBe(false);
  });

  test("audit: all seeded ids match; `newAuditId()` never does", async () => {
    const chain = await buildSeedChain(NOW, sha256Hex);
    expect(chain.every((e) => isSeedAuditId(e.id))).toBe(true);
    for (let i = 0; i < 2000; i++) expect(isSeedAuditId(core.newAuditId())).toBe(false);
  });

  test("quarantine: the three demo skills match; a real skill with the same id does not", () => {
    const demo = seedQuarantine(NOW);
    expect(purgeSeedQuarantine(demo)).toEqual({ kept: [], removed: 3 });
    const real: QuarantinedSkill = { ...demo[0]!, version: "0.4.0", source: "Skills Store · signed" };
    expect(purgeSeedQuarantine([...demo, real]).kept).toEqual([real]);
  });
});

describe("one-time cleanup", () => {
  test("spend purge keeps real events in order", () => {
    const real = [{ id: "sp_aaaa1111", ts: NOW }, { id: "sp_bbbb2222", ts: NOW + 1 }];
    const r = purgeSeedSpend([...seedEvents(NOW, 0), ...real]);
    expect(r.kept).toEqual(real);
    expect(r.removed).toBeGreaterThan(100);
  });

  async function liveAppend(chain: AuditEntry[], n: number): Promise<AuditEntry[]> {
    const out = [...chain];
    for (let i = 0; i < n; i++) {
      out.push(
        await core.chainEntry(
          { id: core.newAuditId(), ts: NOW + i, actor: "user", skill: "fs-skill", action: `real ${i}`, resource: "~/w", decision: "allowed", ruleId: null, risk: "low", costUsd: null, detail: null },
          out.at(-1) ?? null,
          sha256Hex,
        ),
      );
    }
    return out;
  }

  test("audit: seed removed, real entries kept and re-chained, the removal is itself recorded, chain verifies", async () => {
    const mixed = await liveAppend(await buildSeedChain(NOW - 1000, sha256Hex), 5);
    const r = await rechainWithoutSeed(mixed, sha256Hex, NOW + 100);
    expect(r.removed).toBe(mixed.length - 5);
    expect(r.entries).toHaveLength(6);
    expect(r.entries.slice(0, 5).map((e) => e.action)).toEqual(["real 0", "real 1", "real 2", "real 3", "real 4"]);
    expect(r.entries[0]!.prevHash).toBeNull();
    expect(r.entries[5]!.action).toBe(PURGE_AUDIT_ACTION);
    expect(r.entries[5]!.detail).toContain(`${r.removed} demo entries`);
    expect((await core.verifyChain(r.entries, sha256Hex, NOW)).valid).toBe(true);
  });

  test("audit: a seed-only install ends with just the removal record; a clean chain is untouched", async () => {
    const onlySeed = await rechainWithoutSeed(await buildSeedChain(NOW, sha256Hex), sha256Hex, NOW);
    expect(onlySeed.entries.map((e) => e.action)).toEqual([PURGE_AUDIT_ACTION]);
    const clean = await liveAppend([], 3);
    const r = await rechainWithoutSeed(clean, sha256Hex, NOW);
    expect(r).toEqual({ entries: clean, removed: 0 });
  });
});

describe("production path wiring", () => {
  test("no store/backend imports a seed module statically", () => {
    for (const f of ["desktop/src/stores/runsStore.ts", "desktop/src/budget/api.ts", "desktop/src/shield/api.ts"]) {
      const src = read(f);
      expect(src).not.toMatch(/^import [^;]*from ['"](@\/(runs|budget|shield)\/seed|\.\/seed)['"]/m);
    }
  });

  test("every seed import is a dynamic import inside an import.meta.env.DEV branch", () => {
    for (const f of ["desktop/src/stores/runsStore.ts", "desktop/src/budget/api.ts", "desktop/src/shield/api.ts"]) {
      const src = read(f);
      const idx = [...src.matchAll(/await import\(['"](@\/(runs|budget|shield)\/seed|\.\/seed)['"]\)/g)].map((m) => m.index!);
      expect(idx.length).toBeGreaterThan(0);
      for (const i of idx) expect(src.slice(Math.max(0, i - 700), i)).toContain("import.meta.env.DEV");
    }
  });

  test("the purge module carries markers only, never seed content (it ships in production)", () => {
    const src = read("desktop/src/lib/seedPurge.ts");
    for (const [, probe] of SEED_PROBES) expect(src).not.toContain(probe);
  });

  test("the desktop CI workflow builds the renderer and runs the seed gate", () => {
    const wf = read(".github/workflows/desktop-app.yml");
    expect(wf).toContain("scripts/desktop-seed-gate.ts");
  });
});
