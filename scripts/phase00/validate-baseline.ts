#!/usr/bin/env bun
/**
 * XR Phase 00 — validate that a frozen baseline capture is complete and sane.
 *
 * Validates ARTIFACT QUALITY, not whether XR meets Phase 01 performance targets.
 *
 *   bun run scripts/phase00/validate-baseline.ts
 *   bun run scripts/phase00/validate-baseline.ts --dir benchmarks/baseline/2026-08-15
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_DATE, OUT_DIR, ROOT, SECRET_PATTERNS } from "./lib.ts";

const args = process.argv.slice(2);
const dirFlag = args.indexOf("--dir");
const dir = dirFlag >= 0 ? join(ROOT, args[dirFlag + 1] ?? "") : OUT_DIR;

type Issue = { level: "error" | "warn"; msg: string };
const issues: Issue[] = [];

function err(msg: string) {
  issues.push({ level: "error", msg });
}
function warn(msg: string) {
  issues.push({ level: "warn", msg });
}

const REQUIRED = [
  "commit.txt",
  "git.json",
  "versions.json",
  "hardware.json",
  "typecheck.json",
  "boundaries.json",
  "test-results.json",
  "perf-cli.json",
  "perf-daemon.json",
  "perf-dashboard-first-paint.json",
  "perf-chat-ttft.json",
  "perf-tools.json",
  "perf-memory-retrieval.json",
  "security.json",
  "audit.json",
  "reliability.json",
  "golden-tasks.json",
  "baseline-summary.json",
  "BASELINE_REPORT.md",
];

if (!existsSync(dir)) {
  console.error(`baseline dir missing: ${dir}`);
  process.exit(1);
}

const files = readdirSync(dir);
for (const f of REQUIRED) {
  if (!files.includes(f)) err(`missing required artifact: ${f}`);
}

function readJson(name: string): any {
  const p = join(dir, name);
  if (!existsSync(p)) return null;
  const text = readFileSync(p, "utf8");
  for (const re of SECRET_PATTERNS) {
    // Reset lastIndex
    re.lastIndex = 0;
    if (re.test(text)) err(`possible secret in ${name} matching ${re}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    err(`${name} is not valid JSON: ${(e as Error).message}`);
    return null;
  }
}

const commitTxt = existsSync(join(dir, "commit.txt"))
  ? readFileSync(join(dir, "commit.txt"), "utf8").trim()
  : "";
if (!/^[0-9a-f]{7,40}$/i.test(commitTxt)) err(`commit.txt invalid: ${commitTxt}`);

const git = readJson("git.json");
const versions = readJson("versions.json");
const summary = readJson("baseline-summary.json");
const daemon = readJson("perf-daemon.json");
const cli = readJson("perf-cli.json");
const dash = readJson("perf-dashboard-first-paint.json");
const chat = readJson("perf-chat-ttft.json");
const mem = readJson("perf-memory-retrieval.json");
const tools = readJson("perf-tools.json");
const tests = readJson("test-results.json");
const typecheck = readJson("typecheck.json");
const security = readJson("security.json");
const audit = readJson("audit.json");

if (git && commitTxt && git.head && git.head !== commitTxt) {
  err(`git.json head ${git.head} != commit.txt ${commitTxt}`);
}
if (summary && commitTxt && summary.currentBaselineCommit !== commitTxt) {
  err(`baseline-summary commit mismatch`);
}
if (versions && !versions.bun) err("versions.json missing bun");
if (versions && !versions.xr?.version) err("versions.json missing xr.version");

if (typecheck && typecheck.status !== "PASS") {
  warn(`typecheck status is ${typecheck.status} (recorded; Phase00 allows FAIL as data but preferred PASS)`);
}

function requireSamples(obj: any, label: string) {
  if (!obj) {
    err(`${label} missing`);
    return;
  }
  if (obj.sampleCount != null && obj.sampleCount < 1) err(`${label} sampleCount < 1`);
  if (Array.isArray(obj.samplesMs) && obj.samplesMs.length < 1) err(`${label} samplesMs empty`);
  if (obj.p95 != null && typeof obj.p95 === "number" && obj.p95 < 0) err(`${label} negative p95`);
}

if (cli?.scenarios) {
  for (const s of cli.scenarios) {
    requireSamples(s, `cli:${s.id}`);
    if (!s.sampleCount || s.sampleCount < 1) err(`cli ${s.id} missing samples`);
  }
} else {
  err("perf-cli.json missing scenarios");
}

if (daemon?.endpoints) {
  for (const e of daemon.endpoints) {
    requireSamples(e, `daemon:${e.id}`);
    if (!e.statusCodes?.length) err(`daemon ${e.id} missing statusCodes`);
  }
  requireSamples(daemon.startup, "daemon.startup");
} else {
  err("perf-daemon.json missing endpoints");
}

if (dash?.firstMeaningfulPaint) {
  requireSamples(dash.firstMeaningfulPaint, "dashboard.FMP");
} else {
  err("perf-dashboard-first-paint.json missing firstMeaningfulPaint");
}

if (chat) {
  if (!chat.samples && !chat.sampleCount) warn("chat missing sample count field");
  if (!chat.statusCodes?.length) err("chat missing statusCodes");
}

if (mem?.recall) requireSamples(mem.recall, "memory.recall");
else err("perf-memory-retrieval.json missing recall");

if (tools?.tools) {
  for (const t of tools.tools) requireSamples(t, `tool:${t.id}`);
} else {
  err("perf-tools.json missing tools");
}

if (tests && tests.passed == null && tests.status == null) err("test-results.json incomplete");
if (security && !security.status) err("security.json missing status");
if (audit && !audit.status) err("audit.json missing status");

if (summary && !summary.semantics) warn("baseline-summary missing semantics block");
if (summary && !Array.isArray(summary.preExistingIssues)) warn("baseline-summary missing preExistingIssues");

// Ensure no production-looking token fields
for (const f of files) {
  if (!f.endsWith(".json")) continue;
  const text = readFileSync(join(dir, f), "utf8");
  if (/"token"\s*:\s*"[a-f0-9]{20,}"/i.test(text)) err(`${f} appears to embed a raw token field`);
}

const errors = issues.filter((i) => i.level === "error");
const warns = issues.filter((i) => i.level === "warn");

const report = {
  schemaVersion: 1,
  validatedAt: new Date().toISOString(),
  dir: dir.replace(ROOT + "/", ""),
  ok: errors.length === 0,
  errorCount: errors.length,
  warnCount: warns.length,
  issues,
  requiredCount: REQUIRED.length,
  presentCount: REQUIRED.filter((f) => files.includes(f)).length,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) {
  console.error(`\nVALIDATE FAIL: ${errors.length} error(s)`);
  process.exit(1);
}
console.error(`\nVALIDATE PASS (${warns.length} warning(s))`);
