/**
 * XR-LAUNCH-033 — the test suite must leave the checkout clean.
 *
 *   · every CI test lane ends with `bash scripts/assert-clean-tree.sh`;
 *   · that script passes on a clean repo and fails on a modified, deleted or
 *     untracked file;
 *   · no test writes into the tracked benchmarks/ tree via process.cwd().
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const SCRIPT = join(ROOT, "scripts", "assert-clean-tree.sh");
const LANES = ["test-core", "test-security", "test-reliability-spawn", "test-e2e-blackbox"];

type Step = { name?: string; run?: string; if?: string };

describe("XR-LAUNCH-033 clean-tree gate", () => {
  test("every CI test lane ends with the clean-tree check (even after a red test step)", () => {
    const ci = Bun.YAML.parse(readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, { steps: Step[] }> };
    for (const lane of LANES) {
      const steps = ci.jobs[lane]?.steps ?? [];
      const last = steps[steps.length - 1];
      expect(last?.run?.trim(), lane).toBe("bash scripts/assert-clean-tree.sh");
      expect(last?.if, lane).toBe("${{ !cancelled() }}");
    }
  });

  const git = (cwd: string, ...args: string[]) =>
    spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });
  const runGate = (cwd: string) => spawnSync("bash", [SCRIPT], { cwd, encoding: "utf8" });

  test("assert-clean-tree.sh passes on a clean repo and fails on modified, deleted or untracked files", () => {
    const repo = mkdtempSync(join(tmpdir(), "xr-clean-tree-"));
    try {
      expect(git(repo, "init", "-q").status).toBe(0);
      writeFileSync(join(repo, "tracked.json"), "{}\n");
      expect(git(repo, "add", ".").status).toBe(0);
      expect(git(repo, "commit", "-qm", "init").status).toBe(0);

      const clean = runGate(repo);
      expect(clean.status).toBe(0);
      expect(clean.stdout).toContain("clean");

      writeFileSync(join(repo, "tracked.json"), '{"p95":1}\n');
      const modified = runGate(repo);
      expect(modified.status).toBe(1);
      expect(modified.stdout).toContain("tracked.json");
      expect(modified.stdout).toContain("XR-LAUNCH-033");
      git(repo, "checkout", "--", "tracked.json");

      unlinkSync(join(repo, "tracked.json"));
      expect(runGate(repo).status).toBe(1);
      git(repo, "checkout", "--", "tracked.json");

      writeFileSync(join(repo, "stray.log"), "x\n");
      const untracked = runGate(repo);
      expect(untracked.status).toBe(1);
      expect(untracked.stdout).toContain("stray.log");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  test("no test writes into the tracked benchmarks/ tree via process.cwd()", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (name === "node_modules" || name === "fixtures") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.test\.tsx?$/.test(name) && p !== import.meta.path) {
          const src = readFileSync(p, "utf8");
          if (/process\.cwd\(\)\s*,\s*["'`]benchmarks\//.test(src)) offenders.push(relative(ROOT, p));
        }
      }
    };
    walk(join(ROOT, "test"));
    expect(offenders).toEqual([]);
  });
});
