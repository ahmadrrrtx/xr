#!/usr/bin/env bun
/**
 * XR-LAUNCH-012 — flaky-test quarantine (test/quarantine.json).
 *
 *   bun run scripts/quarantine.ts --files     quarantined files, space-separated
 *   bun run scripts/quarantine.ts --regex     the same as an ERE for --exclude
 *   bun run scripts/quarantine.ts --check     validate entries (owner, issue, expiry)
 *   bun run scripts/quarantine.ts --run       run them (the non-blocking CI job)
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "..");
export const MAX_DAYS = 45;
export interface QuarantineEntry { file: string; owner: string; issue: string; added: string; expires: string; reason: string }

export function loadQuarantine(path = join(ROOT, "test/quarantine.json")): QuarantineEntry[] {
  return (JSON.parse(readFileSync(path, "utf8")) as { entries: QuarantineEntry[] }).entries ?? [];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Problems with the quarantine list; empty = valid. `today` is YYYY-MM-DD. */
export function checkQuarantine(entries: QuarantineEntry[], today: string, root = ROOT): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const at = e.file || "(no file)";
    if (!e.file || !existsSync(join(root, e.file))) out.push(`${at}: file does not exist`);
    if (seen.has(e.file)) out.push(`${at}: listed twice`);
    seen.add(e.file);
    if (!/^@[\w-]+$/.test(e.owner ?? "")) out.push(`${at}: owner must be a @github-handle`);
    if (!/^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+|XR-LAUNCH-\d{3})$/.test(e.issue ?? "")) out.push(`${at}: issue must be a GitHub issue URL or an XR-LAUNCH-### finding`);
    if (!e.reason || e.reason.length < 20) out.push(`${at}: reason is required`);
    if (!DATE.test(e.added ?? "") || !DATE.test(e.expires ?? "")) { out.push(`${at}: added/expires must be YYYY-MM-DD`); continue; }
    const span = (Date.parse(e.expires) - Date.parse(e.added)) / 86_400_000;
    if (span > MAX_DAYS) out.push(`${at}: expiry is ${span} days after added (max ${MAX_DAYS})`);
    if (e.expires < today) out.push(`${at}: quarantine EXPIRED on ${e.expires} — fix the test or renew with a new issue/owner decision`);
  }
  return out;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

if (import.meta.main) {
  const entries = loadQuarantine();
  const arg = process.argv[2];
  if (arg === "--files") console.log(entries.map((e) => e.file).join(" "));
  else if (arg === "--regex") console.log(entries.length ? `^(${entries.map((e) => escapeRe(e.file)).join("|")})$` : "");
  else if (arg === "--check") {
    const problems = checkQuarantine(entries, new Date().toISOString().slice(0, 10));
    for (const p of problems) console.error(`::error::quarantine: ${p}`);
    if (problems.length) process.exit(1);
    console.log(`[quarantine] ${entries.length} entr${entries.length === 1 ? "y" : "ies"} valid`);
  } else if (arg === "--run") {
    if (!entries.length) { console.log("[quarantine] nothing quarantined"); process.exit(0); }
    for (const e of entries) console.log(`[quarantine] ${e.file} — owner ${e.owner}, ${e.issue}, expires ${e.expires}`);
    const r = spawnSync("bun", ["test", ...entries.map((e) => e.file)], { stdio: "inherit", cwd: ROOT });
    process.exit(r.status ?? 1);
  } else {
    console.error("usage: quarantine.ts --files|--regex|--check|--run");
    process.exit(2);
  }
}
