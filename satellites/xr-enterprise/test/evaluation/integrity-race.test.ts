/**
 * XR — regression guard: run integrity must not depend on clock timing.
 *
 * Defect (found during 1.0.0 release hardening, reproduced deterministically):
 * `EvaluationRunner.run()` read `Date.now()` twice — once to build the stored
 * provenance and once to build the digest input. Those two reads are separated
 * by an object spread, so when a millisecond boundary landed between them the
 * persisted digest covered a `finishedAt` that was one millisecond off from the
 * `finishedAt` actually persisted. Reading the run back then recomputed a
 * DIFFERENT hash and reported `integrityValid: false` for a run nobody had
 * touched.
 *
 * Why this mattered enough to gate: a tamper-evidence mechanism that cries
 * tamper on untampered data is worse than none — it trains operators to ignore
 * the signal. It also surfaced only under load (the millisecond boundary has to
 * fall in a ~microsecond window), so it presented as an unreproducible flake in
 * the full suite while passing in isolation.
 *
 * The test does not try to win a race. It advances the clock by 1ms on EVERY
 * read, which is exactly what a real millisecond boundary does between two
 * adjacent `Date.now()` calls — deterministic, no sleeps, no flake. With a
 * single clock read the digest and the body agree no matter how the clock
 * behaves; with two reads this fails 100% of the time.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_SUITES,
  EvaluationRepository,
  EvaluationRunner,
  adaptStoreForEvaluation,
} from "../../src/enterprise/evaluation/index.ts";
import { verifyIntegrity } from "../../src/enterprise/evaluation/provenance.ts";

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

/** Make every clock read land on a new millisecond. */
function useTickingClock(): void {
  let t = realNow.call(Date);
  Date.now = () => ++t;
}

function makeRepo(): { repo: EvaluationRepository; dispose: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "xr-eval-race-"));
  const db = new Database(join(dir, "eval.db"), { create: true });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  const repo = new EvaluationRepository(
    adaptStoreForEvaluation({
      exec: (s: string) => db.exec(s),
      prepare: (s: string) => db.prepare(s) as never,
    }),
  );
  return {
    repo,
    dispose: () => {
      try {
        db.close();
      } catch {
        /* noop */
      }
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* noop */
      }
    },
  };
}

describe("evaluation run integrity is clock-independent", () => {
  test("digest verifies even when the clock ticks between every read", async () => {
    useTickingClock();
    const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
    Date.now = realNow;

    const check = verifyIntegrity(run);
    expect(check.valid).toBe(true);
    expect(check.actual).toBe(check.expected);
  }, 120_000);

  test("the digest covers the SAME finishedAt that is stored", async () => {
    useTickingClock();
    const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
    Date.now = realNow;

    // Recomputing over the stored body must reproduce the stored digest.
    // If the runner hashed a different clock read, these diverge.
    const recomputed = verifyIntegrity({
      provenance: run.provenance,
      suites: run.suites,
      integrity: run.integrity,
    });
    expect(recomputed.valid).toBe(true);
    expect(typeof run.provenance.finishedAt).toBe("number");
  }, 120_000);

  test("a stored run reads back with valid integrity under a ticking clock", async () => {
    const h = makeRepo();
    try {
      useTickingClock();
      const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true });
      h.repo.save(run);
      Date.now = realNow;

      const stored = h.repo.get(run.provenance.runId);
      expect(stored).not.toBeNull();
      expect(stored!.integrityValid).toBe(true);
      expect(stored!.integrityDetail).not.toContain("INTEGRITY MISMATCH");
    } finally {
      h.dispose();
    }
  }, 120_000);

  test("an explicit `now` is honoured exactly (no second clock read)", async () => {
    const pinned = 1_700_000_000_000;
    const run = await new EvaluationRunner(ALL_SUITES).run({ offline: true, now: pinned });
    expect(run.provenance.finishedAt).toBe(pinned);
    expect(verifyIntegrity(run).valid).toBe(true);
  }, 120_000);
});
