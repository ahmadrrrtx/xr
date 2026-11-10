import { afterEach, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const original = resolve(import.meta.dir, "../../scripts/release-smoke/run-all.sh");
const dirs: string[] = [];
const ok = 'echo "── fixture: 1 passed · 0 failed · 0 blocked · 0 not run"\nexit 0\n';
function run(cli: string, agent = ok, isolation = ok) {
  const dir = mkdtempSync(join(tmpdir(), "xr-smoke-runner-test-")); dirs.push(dir);
  const suiteDir = join(dir, "scripts/release-smoke"); mkdirSync(suiteDir, { recursive: true });
  copyFileSync(original, join(suiteDir, "run-all.sh"));
  for (const [name, body] of [["cli", cli], ["agent-turn", agent], ["isolation", isolation]])
    writeFileSync(join(suiteDir, `smoke-${name}.sh`), `#!/bin/bash\n${body}`);
  return spawnSync("bash", [join(suiteDir, "run-all.sh")], { encoding: "utf8" });
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
test("all complete passing suites pass", () => { const r = run(ok); expect(r.status).toBe(0); expect(r.stdout).toContain("RESULT: PASS"); });
test("a crashed suite with no summary fails even if other suites pass", () => { const r = run("exit 42\n"); expect(r.status).not.toBe(0); expect(r.stdout).toContain("did not emit a complete smoke summary"); expect(r.stdout).toContain("RESULT: FAIL"); });
test("a nonzero exit fails even if the suite prints a passing summary", () => { const r = run(ok.replace("exit 0", "exit 42")); expect(r.status).not.toBe(0); expect(r.stdout).toContain("exited non-zero (42)"); });
test("an incomplete summary fails rather than counting missing fields as zero", () => { const r = run('echo "1 passed · 0 failed"\nexit 0\n'); expect(r.status).not.toBe(0); });
test("a reported failed check fails the aggregate", () => { const r = run('echo "── fixture: 1 passed · 1 failed · 0 blocked · 0 not run"\nexit 1\n'); expect(r.status).not.toBe(0); expect(r.stdout).toContain("RESULT: FAIL"); });
test("blocked results remain explicitly reported", () => { const r = run('echo "── fixture: 1 passed · 0 failed · 1 blocked · 0 not run"\nexit 0\n'); expect(r.status).toBe(0); expect(r.stdout).toContain("1 blocked"); });
