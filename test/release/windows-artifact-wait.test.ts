import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

// The prerequisite runs on Ubuntu; POSIX fake gh is intentionally not a Windows fixture.
const linuxOrMac = test.skipIf(process.platform === "win32" || spawnSync("jq", ["--version"]).status !== 0);
const script = resolve("scripts/journey/wait-windows-artifact.sh");
const sha = "a".repeat(40);
function run(scenario: string, timeout = "0", hash = sha) {
  const dir = mkdtempSync(join(tmpdir(), "xr-wait-artifact-"));
  try {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "gh"), `#!/bin/bash
set -eu
[ "$1" = api ] || exit 21
case "$2" in
  *workflows/desktop-app.yml/runs*)
    [[ "$2" == *"head_sha=$GITHUB_SHA"* ]] || exit 22
    [[ "$4" == *"$GITHUB_SHA"* && "$4" == *'"workflow_dispatch"'* && "$4" == *'"push"'* ]] || exit 23
    [ "$SCENARIO" != api_error ] || exit 17
    [ "$SCENARIO" != missing ] || exit 0
    if [ "$SCENARIO" = pr_only ]; then
      printf '{"workflow_runs":[{"head_sha":"%s","event":"pull_request","id":999}]}' "$GITHUB_SHA" | jq -r "$4"
    else
      printf '{"workflow_runs":[{"head_sha":"%s","event":"pull_request","id":999},{"head_sha":"%s","event":"workflow_dispatch","id":123},{"head_sha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","event":"push","id":888}]}' "$GITHUB_SHA" "$GITHUB_SHA" | jq -r "$4"
    fi
    ;;
  *runs/123/artifacts*)
    [ "$SCENARIO" != duplicate ] || { echo 2; exit; }
    if [ "$SCENARIO" = delayed ] && [ ! -f "$COUNTER" ]; then touch "$COUNTER"; echo 0; else echo 1; fi
    ;;
  *) exit 24 ;;
esac
`, { mode: 0o755 });
    const output = join(dir, "output");
    const result = spawnSync("bash", [script, timeout, "1"], { cwd: dir, encoding: "utf8", timeout: 6000, env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, GITHUB_REPOSITORY: "test/repo", GITHUB_SHA: hash, GITHUB_OUTPUT: output, COUNTER: join(dir, "counter"), SCENARIO: scenario } });
    return { ...result, output: result.status === 0 ? readFileSync(output, "utf8") : "", evidence: (() => { try { return readFileSync(join(dir, "evidence", "artifact-status.txt"), "utf8"); } catch { return ""; } })() };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

linuxOrMac("an exact-head artifact produces only its actual run ID", () => {
  const r = run("ready");
  expect(r.status).toBe(0);
  expect(r.output).toBe("run_id=123\n");
  expect(r.evidence).toContain(`head_sha=${sha}`);
});
linuxOrMac("an artifact arriving after the first lookup is picked up", () => {
  const r = run("delayed", "3");
  expect(r.status).toBe(0);
  expect(r.output).toBe("run_id=123\n");
});
linuxOrMac("missing or duplicate artifacts fail blocked and never output a run ID", () => {
  for (const scenario of ["missing", "pr_only", "duplicate"]) {
    const r = run(scenario);
    expect(r.status).not.toBe(0);
    expect(r.output).toBe("");
    expect(r.evidence).toContain("BLOCKED");
  }
});
linuxOrMac("API failures and invalid hashes do not succeed", () => {
  const failed = run("api_error");
  expect(failed.status).not.toBe(0);
  expect(failed.evidence).toContain("BLOCKED: desktop workflow lookup failed");
  expect(run("ready", "0", "not-a-full-sha").status).not.toBe(0);
});
