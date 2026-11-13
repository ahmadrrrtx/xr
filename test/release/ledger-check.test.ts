import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const checker = resolve(import.meta.dir, "../../scripts/release-smoke/ledger-check.ts");
const dirs: string[] = [];
function cmd(cwd: string, command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr}`);
  return result.stdout.trim();
}
function fixture(subject = "[T01] verified change", file = "allowed.txt") {
  const dir = mkdtempSync(join(tmpdir(), "xr-ledger-test-")); dirs.push(dir);
  cmd(dir, "git", ["init", "-q"]);
  cmd(dir, "git", ["config", "user.name", "Test"]);
  cmd(dir, "git", ["config", "user.email", "test@example.invalid"]);
  writeFileSync(join(dir, "base.txt"), "base\n");
  cmd(dir, "git", ["add", "."]); cmd(dir, "git", ["commit", "-qm", "base"]);
  const base = cmd(dir, "git", ["rev-parse", "HEAD"]);
  writeFileSync(join(dir, file), "change\n");
  cmd(dir, "git", ["add", "."]); cmd(dir, "git", ["commit", "-qm", subject]);
  mkdirSync(join(dir, "docs/release/preview1"), { recursive: true });
  writeFileSync(join(dir, "evidence.txt"), "observed output\n");
  const header = { type: "header", base_sha: base, branch: "test" };
  const task = { id: "T01", title: "test", priority: "P1", workstream: "WS1", source: "test", acceptance: "true", paths: ["allowed.txt"], status: "done", commits: [], evidence: "evidence.txt", ts: "2026-11-10T00:00:00Z" };
  const ledger = join(dir, "docs/release/preview1/ledger.jsonl");
  const write = (extra: unknown[] = []) => writeFileSync(ledger, [header, task, ...extra].map((o) => JSON.stringify(o)).join("\n") + "\n");
  write();
  const check = () => spawnSync(process.execPath, [checker], { cwd: dir, encoding: "utf8" });
  return { dir, task, write, check };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
test("valid new task and scoped commit pass", () => { expect(fixture().check().status).toBe(0); });
test("new malformed history line still fails", () => {
  const f = fixture(); const bad: Record<string, unknown> = { ...f.task }; delete bad.commits; f.write([bad]);
  const r = f.check(); expect(r.status).not.toBe(0); expect(r.stderr).toContain('missing field "commits"');
});
test("out-of-scope changed files fail", () => {
  const r = fixture("[T01] change", "outside.txt").check(); expect(r.status).not.toBe(0); expect(r.stderr).toContain("outside the mapped tasks' paths");
});
test("new commit without task ID is not covered by historical exceptions", () => {
  const r = fixture("Fix like e551b234d61528f70835128d64b7be939ab9641c").check();
  expect(r.status).not.toBe(0); expect(r.stderr).toContain("subject has no [Txx] id");
});
test("unrecognized multi-ID subjects are not generically exempted", () => {
  const r = fixture("[T01][T02] change").check(); expect(r.status).not.toBe(0); expect(r.stderr).toContain("subject has no [Txx] id");
});
test("a done task must have an existing evidence file", () => {
  const f = fixture(); f.task.evidence = "does-not-exist"; f.write();
  const r = f.check(); expect(r.status).not.toBe(0); expect(r.stderr).toContain("evidence file missing");
});
