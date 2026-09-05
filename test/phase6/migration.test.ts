/**
 * Phase 6 · migration 8 (`phase6_orchestration`) — the three durable planes
 * (budget_partitions, partition_reservations, task_checkpoints) migrate up on
 * existing databases, and DOWN erases them cleanly (release policy: reversible
 * until 1.0 freeze). No half-state survives the round trip.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  currentSchemaVersion,
  LATEST_SCHEMA_VERSION,
  runMigrationsDown,
  runMigrationsUp,
} from "../../src/state/migrations.ts";
import { PartitionRepo } from "../../src/state/repos/partition-repo.ts";
import { CheckpointRepo } from "../../src/state/repos/checkpoint-repo.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-p6-mig-"));
});

const TABLES = ["budget_partitions", "partition_reservations", "task_checkpoints"];

function hasTable(store: WorkspaceStore, name: string): boolean {
  const row = (store.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name) ?? null) as
    | { name: string }
    | null;
  return row !== null;
}

describe("Phase 6 · migration 8 round trip", () => {
  test("a fresh store carries all three Phase-6 tables at the latest version", () => {
    const path = join(tmp, "fresh.db");
    const store = new WorkspaceStore("w", path);
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
    for (const t of TABLES) expect(hasTable(store, t), `${t} missing`).toBe(true);
    // Repos are ENABLED (the gate every repo checks before writing).
    const partitions = new PartitionRepo(store);
    partitions.openTask("wf_mig", { capUsd: 1, capTokens: 10_000 });
    partitions.partition("wf_mig", [{ childId: "t_0", weight: 1 }], { floorUsd: 0.01, floorTokens: 1000 });
    expect(partitions.listPartitions("wf_mig").length).toBe(2); // root + one child
    const ckpt = new CheckpointRepo(store);
    // (enabled-ness is behavioral: a live journal APPENDS.)
    expect(ckpt.append("wf_mig", "run.step", { stepIdx: 0 })).not.toBeNull();
    store.close();
  });

  test("down to 7 drops the Phase-6 tables; up restores them (data-free)", () => {
    const path = join(tmp, "rt.db");
    const store = new WorkspaceStore("w", path);
    const ckpt = new CheckpointRepo(store);
    expect(ckpt.append("wf_rt", "run.step", { hello: "world" })).not.toBeNull();
    expect(ckpt.verifyChain("wf_rt").ok).toBe(true);

    const reverted = runMigrationsDown(store, 7);
    expect(reverted).toContain("phase6_orchestration");
    expect(currentSchemaVersion(store)).toBe(7);
    for (const t of TABLES) expect(hasTable(store, t)).toBe(false);

    // Repos degrade to honest no-ops when their table is gone (never throw).
    const ckptAfterDown = new CheckpointRepo(store);
    expect(ckptAfterDown.append("wf_rt", "run.step", { x: 1 })).toBeNull(); // journal is gone
    expect(ckptAfterDown.verifyChain("wf_rt").ok).toBe(true); // vacuously: no rows, no break
    const partitions = new PartitionRepo(store);
    // Funding REFUSES loudly (a workflow cannot pretend to be partitioned)…
    expect(() => partitions.openTask("wf_rt", { capUsd: 1, capTokens: 1 })).toThrow(/unavailable/);
    // …while read/settle paths degrade to honest empties.
    expect(partitions.listPartitions("wf_rt")).toHaveLength(0);
    expect(partitions.admit("wf_rt", "t_0", 0.01, 10).ok).toBe(false);

    // UP again: tables exist, journaling resumes from seq 0.
    const ran = runMigrationsUp(store);
    expect(ran).toContain("phase6_orchestration");
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
    for (const t of TABLES) expect(hasTable(store, t)).toBe(true);
    const ckpt2 = new CheckpointRepo(store);
    expect(ckpt2.append("wf_rt2", "run.step", { back: true })?.seq).toBe(0); // restored
    // The audit chain survived the schema round trip.
    store.audit("phase6.post-roundtrip", { ok: true });
    expect(store.verifyChain().valid).toBe(true);
    store.close();
  });

  test("a store that SAYS it is at v8 but lost the tables degrades honestly (no re-migration on open)", () => {
    // The auto-migrating constructor means reopening a rolled-back DB simply
    // migrates it up again. The durable-truth hazard is the OTHER direction:
    // schema_migrations at 8 while a table has vanished (manual drop / partial
    // restore). Repos must report DISABLED / REFUSE — never corrupt, never crash.
    const path = join(tmp, "half.db");
    const store = new WorkspaceStore("w", path);
    expect(currentSchemaVersion(store)).toBe(LATEST_SCHEMA_VERSION);
    store.prepare("DROP TABLE task_checkpoints").run();
    store.close();
    const reopened = new WorkspaceStore("w", path); // version is still 8 → no re-apply
    expect(currentSchemaVersion(reopened)).toBe(LATEST_SCHEMA_VERSION);
    const ckpt = new CheckpointRepo(reopened);
    expect(ckpt.verifyChain("s_whatever").ok).toBe(true); // vacuous, not corrupt
    expect(ckpt.list("s_whatever")).toHaveLength(0);
    expect(ckpt.append("s_gone", "run.step", { x: 1 })).toBeNull(); // honest no-op
    // …and the run itself continues: checkpoints are observational; a journal
    // with nowhere to write must not abort live work (append → null — asserted
    // above against a distinct task key so the list/verify reads stay clean).
    reopened.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});
