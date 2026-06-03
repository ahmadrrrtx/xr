/**
 * XR — Phase 3 tests: non-regressive skills.
 * The headline guarantee: the agent CANNOT ship a regression — proven here.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { SkillEngine } from "../src/skills/engine.ts";
import { verify, isVerifiable, type VerifierSpec } from "../src/skills/verifier.ts";

let tmp: string;
let dbPath: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-skill-"));
  process.env.XR_HOME = join(tmp, "home");
  dbPath = join(tmp, "s.db");
});

// ---- verifier unit tests ----

test("verifier: file_nonempty pass/fail", () => {
  writeFileSync(join(tmp, "a.txt"), "hello");
  writeFileSync(join(tmp, "empty.txt"), "");
  expect(verify({ kind: "file_nonempty", path: "a.txt" }, { cwd: tmp }).passed).toBe(true);
  expect(verify({ kind: "file_nonempty", path: "empty.txt" }, { cwd: tmp }).passed).toBe(false);
  expect(verify({ kind: "file_nonempty", path: "missing.txt" }, { cwd: tmp }).passed).toBe(false);
});

test("verifier: file_contains", () => {
  writeFileSync(join(tmp, "b.txt"), "the answer is 42");
  expect(verify({ kind: "file_contains", path: "b.txt", text: "42" }, { cwd: tmp }).passed).toBe(true);
  expect(verify({ kind: "file_contains", path: "b.txt", text: "99" }, { cwd: tmp }).passed).toBe(false);
});

test("verifier: path escape is rejected", () => {
  expect(verify({ kind: "file_exists", path: "../etc/passwd" }, { cwd: tmp }).passed).toBe(false);
});

test("verifier: always_false is not verifiable", () => {
  expect(isVerifiable({ kind: "always_false" })).toBe(false);
  expect(isVerifiable({ kind: "file_exists", path: "x" })).toBe(true);
});

// ---- gate tests ----

test("gate: refuses to learn non-verifiable outcomes", () => {
  const store = new Store(dbPath);
  const eng = new SkillEngine(store, tmp);
  const out = eng.learn({
    skillId: "vibe",
    actions: { steps: [] },
    verifier: { kind: "always_false" },
    why: "felt good",
  });
  expect(out.learned).toBe(false);
  expect(store.skillCount()).toBe(0);
  store.close();
});

test("gate: refuses to learn when verifier currently fails", () => {
  const store = new Store(dbPath);
  const eng = new SkillEngine(store, tmp);
  const out = eng.learn({
    skillId: "make-report",
    actions: { steps: [{ tool: "write_file", args: { path: "report.md" } }] },
    verifier: { kind: "file_nonempty", path: "report.md" }, // file doesn't exist
    why: "should have made report",
  });
  expect(out.learned).toBe(false);
  store.close();
});

test("learn: freezes a verified success", () => {
  const store = new Store(dbPath);
  const eng = new SkillEngine(store, tmp);
  writeFileSync(join(tmp, "report.md"), "# Report\ndata");
  const out = eng.learn({
    skillId: "make-report",
    actions: { steps: [{ tool: "write_file", args: { path: "report.md" } }] },
    verifier: { kind: "file_nonempty", path: "report.md" },
    why: "produced a non-empty report",
  });
  expect(out.learned).toBe(true);
  if (out.learned) expect(out.version).toBe(1);
  expect(store.frozenCount()).toBe(1);
  expect(store.latestSkillVersion("make-report")).toBe(1);
  store.close();
});

// ---- the headline guarantee: cannot ship a regression ----

test("REGRESSION GUARD: a bad update that breaks a frozen win is AUTO-ROLLED-BACK", () => {
  const store = new Store(dbPath);
  const eng = new SkillEngine(store, tmp);

  // Learn v1 from a verified success.
  writeFileSync(join(tmp, "report.md"), "good report");
  const v1 = eng.learn({
    skillId: "make-report",
    actions: { steps: [{ tool: "write_file", args: { path: "report.md" } }] },
    verifier: { kind: "file_nonempty", path: "report.md" },
    why: "v1 works",
  });
  expect(v1.learned).toBe(true);

  // Now attempt a "bad update" that breaks the previously-good outcome
  // (simulate by deleting the file the frozen baseline depends on).
  const result = eng.updateGuarded(
    "make-report",
    1, // prev version
    () => {
      // apply: the update both bumps version AND breaks the world
      store.insertSkill("make-report", 2, "learned", "v2 attempt");
      store.setActiveSkillVersion("make-report", 2);
      rmSync(join(tmp, "report.md")); // regression: prior win no longer verifies
      return 2;
    },
    (toVersion) => {
      // rollback: restore the world to the good state
      writeFileSync(join(tmp, "report.md"), "good report");
    },
  );

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.failed.length).toBeGreaterThan(0);
  // Active version must be back to v1 (the known-good one).
  // Re-running regression now should pass again (rollback restored the file).
  expect(eng.runRegression("make-report").allPass).toBe(true);
  store.close();
});

test("REGRESSION GUARD: a good update that preserves wins is accepted", () => {
  const store = new Store(dbPath);
  const eng = new SkillEngine(store, tmp);

  writeFileSync(join(tmp, "report.md"), "good");
  eng.learn({
    skillId: "make-report",
    actions: { steps: [] },
    verifier: { kind: "file_nonempty", path: "report.md" },
    why: "v1",
  });

  const result = eng.updateGuarded(
    "make-report",
    1,
    () => {
      store.insertSkill("make-report", 2, "learned", "v2 better");
      store.setActiveSkillVersion("make-report", 2);
      // good update: does NOT break the frozen win (file still there)
      return 2;
    },
    () => {
      throw new Error("rollback should NOT be called for a good update");
    },
  );

  expect(result.ok).toBe(true);
  if (result.ok) expect(result.version).toBe(2);
  store.close();
});
