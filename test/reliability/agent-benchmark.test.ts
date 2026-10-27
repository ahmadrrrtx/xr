import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import suite from "../../benchmarks/agent/v1/suite.json";
import {
  snapshot,
  unauthorizedChanges,
  validateSuite,
} from "../../scripts/lib/agent-benchmark-evidence";
const ROOT = resolve(import.meta.dir, "../..");
test("benchmark verifier cannot forgive canary mutation because a different path was allowed", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-benchmark-verifier-"));
  try {
    writeFileSync(join(dir, "canary"), "before");
    const before = snapshot(dir);
    writeFileSync(join(dir, "canary"), "after");
    expect(unauthorizedChanges(before, snapshot(dir), [])).toEqual(["canary"]);
    expect(
      unauthorizedChanges(before, snapshot(dir), ["different-allowed-file"]),
    ).toEqual(["canary"]);
    expect(unauthorizedChanges(before, snapshot(dir), ["canary"])).toEqual([]);
    expect(() =>
      validateSuite({
        ...suite,
        tasks: suite.tasks.map((t) => ({ ...t, id: "duplicate" })),
      }),
    ).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("all15 actual verifiers pass, costs remain explicitly synthetic/unavailable, owner home stays byte-identical", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-benchmark-outer-")),
    owner = join(dir, "owner"),
    out = join(dir, "report.json");
  mkdirSync(owner);
  writeFileSync(join(owner, "do-not-touch"), "outer private fixture bytes");
  const before = snapshot(owner);
  try {
    const run = spawnSync(
      process.execPath,
      ["scripts/agent-benchmark.ts", "--out", out],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          HOME: owner,
          XR_HOME: owner,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        },
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    const report = JSON.parse(readFileSync(out, "utf8"));
    expect(report.summary).toMatchObject({
      selectedTasks: 15,
      passed: 15,
      failed: 0,
      blocked: 0,
      coverage: 1,
      unauthorizedSideEffects: 0,
      unexpectedNetworkAttempts: 0,
      billedUsd: null,
    });
    expect(report.results.find((r: any) => r.id === "A01").facts).toMatchObject(
      { verifierExitAfter: 0, verifierRuns: 2 },
    );
    expect(report.results.find((r: any) => r.id === "A10").outcome).toBe(
      "cancelled",
    );
    expect(report.results.find((r: any) => r.id === "A12")).toMatchObject({
      modelCalls: 2,
      attemptRows: 2,
      retries: 1,
    });
    expect(
      report.results.every(
        (r: any) =>
          r.billedUsd === null &&
          r.usageSources.every((s: string) => s === "estimated"),
      ),
    ).toBe(true);
    expect(snapshot(owner)).toEqual(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
test("unsupported live/unknown flags fail before any product module import or owner-home effect", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-benchmark-flags-"));
  try {
    const before = snapshot(dir);
    const r = spawnSync(
      process.execPath,
      ["scripts/agent-benchmark.ts", "--live"],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          HOME: dir,
          XR_HOME: dir,
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        },
        encoding: "utf8",
        timeout: 3000,
      },
    );
    expect(r.status).toBe(2);
    expect(snapshot(dir)).toEqual(before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("report writer refuses an unrelated destination instead of overwriting owner data", () => {
  const dir = mkdtempSync(join(tmpdir(), "xr-benchmark-output-")),
    path = join(dir, "owner.json");
  writeFileSync(path, '{"owner":"unchanged"}');
  try {
    const r = spawnSync(
      process.execPath,
      ["scripts/agent-benchmark.ts", "--smoke", "--out", path],
      {
        cwd: ROOT,
        env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
    );
    expect(r.status).not.toBe(0);
    expect(readFileSync(path, "utf8")).toBe('{"owner":"unchanged"}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
