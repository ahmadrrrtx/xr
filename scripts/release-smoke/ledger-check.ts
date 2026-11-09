#!/usr/bin/env bun
/**
 * Ledger check (plan section 12, task T10).
 *
 * Exits non-zero if any of these fail:
 *  1. every ledger line parses and carries the required fields
 *  2. a header line exists with a base_sha and a branch
 *  3. every commit since base_sha has a `[Txx]` id that exists in the ledger
 *  4. every `done` task has >=1 commit, an existing evidence file and an acceptance command
 *  5. every file a commit touched sits inside that task's `paths` globs
 *
 * Read-only: never writes, never touches the network.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const LEDGER = process.env.LEDGER_PATH ?? "docs/release/preview1/ledger.jsonl";
const REQUIRED = [
  "id", "title", "priority", "workstream", "source", "acceptance",
  "paths", "status", "commits", "evidence", "ts",
] as const;
const STATUSES = new Set(["todo", "doing", "done", "blocked", "dropped", "needs_owner"]);
const PRIORITIES = new Set(["P0", "P1", "P2"]);
const SUBJECT = /^\[(T\d{2}(?:\.[a-z0-9]+)?)\]\s+\S/;

const problems: string[] = [];
const fail = (m: string) => problems.push(m);
const git = (...args: string[]): string =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

/** Glob -> RegExp: `**` spans directories, `*` stops at `/`, `?` is one char. */
function globToRe(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // `a/**/b` also matches `a/b`
      } else re += "[^/]*";
    } else if (c === "?") re += ".";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

// ---- 1/2. parse + fields ----------------------------------------------------
if (!existsSync(LEDGER)) {
  console.error(`LEDGER FAIL: ${LEDGER} not found`);
  process.exit(2);
}
const lines = readFileSync(LEDGER, "utf8").split("\n").filter((l) => l.trim() !== "");
type Task = Record<string, any>;
const latest = new Map<string, Task>();
let header: Task | undefined;

lines.forEach((line, idx) => {
  let o: Task;
  try {
    o = JSON.parse(line);
  } catch (e) {
    return fail(`line ${idx + 1}: invalid JSON (${(e as Error).message})`);
  }
  if (o.type === "header") {
    if (!o.base_sha || !o.branch) fail(`line ${idx + 1}: header missing base_sha/branch`);
    header = o;
    return;
  }
  for (const f of REQUIRED) if (!(f in o)) fail(`line ${idx + 1} (${o.id ?? "?"}): missing field "${f}"`);
  if (!PRIORITIES.has(o.priority)) fail(`line ${idx + 1} (${o.id}): bad priority "${o.priority}"`);
  if (!STATUSES.has(o.status)) fail(`line ${idx + 1} (${o.id}): bad status "${o.status}"`);
  if (!Array.isArray(o.commits)) fail(`line ${idx + 1} (${o.id}): commits must be an array`);
  if (!Array.isArray(o.paths)) fail(`line ${idx + 1} (${o.id}): paths must be an array`);
  // append-only: a later line for the same id wins
  const prev = latest.get(o.id);
  if (prev && new Date(o.ts) < new Date(prev.ts)) fail(`${o.id}: older ts after newer ts (append-only violated)`);
  latest.set(o.id, o);
});

if (!header) fail("no header line (base_sha + branch) in ledger");
const base = process.env.LEDGER_BASE_SHA ?? header?.base_sha;
const ids = new Set(latest.keys());

// ---- 3/5. commit subjects + scope -------------------------------------------
let commits: { sha: string; subject: string }[] = [];
try {
  commits = git("log", "--reverse", "--format=%H%x00%s", `${base}..HEAD`)
    .split("\n").filter(Boolean)
    .map((l) => {
      const [sha, subject] = l.split("\0");
      return { sha, subject };
    });
} catch {
  fail(`cannot read git history for range ${base}..HEAD (is ${base} a valid commit?)`);
}

const commitTasks = new Map<string, string[]>();
for (const { sha, subject } of commits) {
  const m = SUBJECT.exec(subject);
  if (!m) {
    fail(`${sha.slice(0, 8)}: subject has no [Txx] id: "${subject}"`);
    continue;
  }
  const id = m[1];
  if (!ids.has(id)) {
    fail(`${sha.slice(0, 8)}: id ${id} is not in the ledger`);
    continue;
  }
  commitTasks.set(id, [...(commitTasks.get(id) ?? []), sha]);
  const task = latest.get(id)!;
  const globs = [...task.paths, "docs/release/preview1/ledger.jsonl"].map(globToRe);
  const files = git("show", "--name-only", "--pretty=format:", sha).split("\n").filter(Boolean);
  for (const f of files) {
    if (!globs.some((re) => re.test(f))) fail(`${sha.slice(0, 8)} (${id}): "${f}" is outside the task's paths`);
  }
}

// ---- 4. done tasks are evidenced --------------------------------------------
for (const [id, t] of latest) {
  const recorded: string[] = Array.isArray(t.commits) ? t.commits : [];
  const actual = commitTasks.get(id) ?? [];
  if (t.status === "done") {
    if (recorded.length === 0 && actual.length === 0) fail(`${id}: status done but no commit`);
    if (!t.evidence) fail(`${id}: status done but no evidence file`);
    else if (!existsSync(String(t.evidence).replace(/^\.\//, ""))) fail(`${id}: evidence file missing: ${t.evidence}`);
    if (!t.acceptance) fail(`${id}: status done but no acceptance command`);
  }
  if (t.status !== "done" && (actual.length > 0 || recorded.length > 0) && t.status !== "doing") {
    // informational: a commit exists but the task is not marked done yet
  }
}

// ---- report -----------------------------------------------------------------
const counted = [...latest.values()].reduce<Record<string, number>>((acc, t) => {
  acc[t.status] = (acc[t.status] ?? 0) + 1;
  return acc;
}, {});
if (problems.length) {
  console.error(`LEDGER FAIL - ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(
  `LEDGER OK - ${latest.size} tasks (${Object.entries(counted).map(([k, v]) => `${k}=${v}`).join(", ")}), ` +
    `${commits.length} commit(s) since ${base.slice(0, 8)}, all subjects carry a known [Txx] id.`,
);
