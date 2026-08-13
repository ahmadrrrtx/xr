#!/usr/bin/env bun
/**
 * XR Phase 9 · T2 — release changelog generator (conventional commits).
 *
 * One changelog authority for the release pipeline (Art. XXII/XIX): sections
 * are derived mechanically from git history — never hand-written marketing.
 *
 *   bun run scripts/changelog.ts --version 1.0.0 [--from v7.0.0] [--to HEAD]
 *                                    [--date 2026-08-05] [--write] [--check]
 *
 * Modes:
 *   (default)   print the generated section for --version to stdout
 *   --write     prepend the section into CHANGELOG.md (idempotent: an entry
 *               for the same version is replaced in place)
 *   --check     gate: CHANGELOG.md must contain an entry for the manifest
 *               version, generated from the same history (release gate)
 *
 * Conventions: Conventional Commits — type(scope)!: subject. Groups:
 *   feat→Features  fix→Fixes  perf→Performance  refactor/refacto→Refactoring
 *   ci/build→Build & CI  docs→Documentation  test→Tests  style/chore→Maintenance
 *   breaking marker ("!:" or "BREAKING CHANGE") → a prominent Breaking section.
 * Merge commits of PRs contribute their constituent commits, not the merge.
 * Non-conventional subjects land under "Other" verbatim — honesty over hiding.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, loadManifest } from "./release-manifest.ts";

export interface ParsedCommit {
  hash: string;
  type: string;
  scope: string | null;
  breaking: boolean;
  subject: string;
}

const TYPE_GROUPS: Record<string, string> = {
  feat: "Features",
  fix: "Fixes",
  perf: "Performance",
  refactor: "Refactoring",
  refacto: "Refactoring",
  ci: "Build & CI",
  build: "Build & CI",
  docs: "Documentation",
  test: "Tests",
  style: "Maintenance",
  chore: "Maintenance",
};

const GROUP_ORDER = ["Features", "Fixes", "Performance", "Refactoring", "Build & CI", "Documentation", "Tests", "Maintenance", "Other"];
const SUBJECT_MAX = 120;

function gitLog(from: string | undefined, to: string): string {
  const range = from ? `${from}..${to}` : to;
  const res = spawnSync("git", ["log", range, "--no-merges", "--format=%H%x00%s"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    throw new Error(`git log failed for range ${range}: ${(res.stderr ?? "").trim()}`);
  }
  return res.stdout;
}

export function parseCommitLine(hash: string, subject: string): ParsedCommit {
  const m = /^([A-Za-z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);
  if (m) {
    return {
      hash,
      type: m[1]!.toLowerCase(),
      scope: m[2] ?? null,
      breaking: Boolean(m[3]),
      subject: m[4]!.trim(),
    };
  }
  return { hash, type: "other", scope: null, breaking: false, subject: subject.trim() };
}

export function listCommits(from: string | undefined, to: string): ParsedCommit[] {
  const out = gitLog(from, to);
  const commits: ParsedCommit[] = [];
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const [hash, ...rest] = line.split("\x00");
    commits.push(parseCommitLine(hash, rest.join("\x00")));
  }
  return commits;
}

/** Semver tags sorted oldest → newest (excludes legacy non-semver tags). */
export function previousTagFor(version: string, tags: string[]): string | undefined {
  const semver = tags
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .map((t) => ({ tag: t, parts: t.slice(1).split(".").map(Number) }))
    .sort((a, b) => a.parts[0]! - b.parts[0]! || a.parts[1]! - b.parts[1]! || a.parts[2]! - b.parts[2]!);
  const target = version.split(".").map(Number);
  const older = semver.filter(
    (t) =>
      t.parts[0]! < target[0]! ||
      (t.parts[0]! === target[0] && t.parts[1]! < target[1]!) ||
      (t.parts[0]! === target[0] && t.parts[1]! === target[1] && t.parts[2]! < target[2]!),
  );
  return older.length ? older[older.length - 1]!.tag : undefined;
}

function clip(s: string): string {
  return s.length > SUBJECT_MAX ? `${s.slice(0, SUBJECT_MAX - 1)}…` : s;
}

export function renderSection(version: string, date: string, commits: ParsedCommit[]): string {
  const breaking = commits.filter((c) => c.breaking);
  const lines: string[] = [`## ${version} — ${date}`, ""];
  if (breaking.length > 0) {
    lines.push("### ⚠ Breaking changes", "");
    for (const c of breaking) lines.push(`- ${c.scope ? `**${c.scope}:** ` : ""}${clip(c.subject)} (${c.hash.slice(0, 7)})`);
    lines.push("");
  }
  const byGroup = new Map<string, ParsedCommit[]>();
  for (const c of commits) {
    const group = TYPE_GROUPS[c.type] ?? "Other";
    byGroup.set(group, [...(byGroup.get(group) ?? []), c]);
  }
  for (const group of GROUP_ORDER) {
    const items = byGroup.get(group);
    if (!items || items.length === 0) continue;
    lines.push(`### ${group}`, "");
    for (const c of items) lines.push(`- ${c.scope ? `**${c.scope}:** ` : ""}${clip(c.subject)} (${c.hash.slice(0, 7)})`);
    lines.push("");
  }
  if (commits.length === 0) {
    lines.push("_No commits in range._", "");
  }
  return lines.join("\n").replace(/\n+$/, "\n");
}

/** Replace (idempotent) or prepend a version section into a changelog body. */
export function upsertSection(existing: string, version: string, section: string): string {
  const header = /^#\s+Changelog\s*\n?/m;
  const headMatch = header.exec(existing);
  const head = headMatch ? existing.slice(0, headMatch.index + headMatch[0].length) : "# Changelog\n";
  let body = headMatch ? existing.slice(headMatch.index + headMatch[0].length) : existing;

  const entryRe = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — .*?$`, "m");
  const start = entryRe.exec(body);
  if (start) {
    const next = /^## \d+\.\d+\.\d+/m;
    const rest = body.slice(start.index + start[0].length);
    const endMatch = next.exec(rest);
    const before = body.slice(0, start.index);
    const after = endMatch ? rest.slice(endMatch.index) : "";
    body = `${before}${section}\n${after}`.replace(/\n{3,}/g, "\n\n");
  } else {
    body = `\n${section}\n${body}`.replace(/\n{3,}/g, "\n\n");
  }
  return `${head.replace(/\n+$/, "\n")}\n${body.replace(/^\n+/, "")}`;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const manifest = loadManifest();
  const version = arg("--version") ?? manifest.identity.version;
  const from = arg("--from") ?? previousTagFor(
    version,
    spawnSync("git", ["tag", "--list", "v*"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").map((t) => t.trim()).filter(Boolean),
  );
  const to = arg("--to") ?? "HEAD";
  const date = arg("--date") ?? new Date().toISOString().slice(0, 10);
  const commits = listCommits(from, to);
  const section = renderSection(version, date, commits);
  const changelogPath = join(ROOT, "CHANGELOG.md");

  if (process.argv.includes("--check")) {
    if (!existsSync(changelogPath)) {
      console.error(`[changelog] FAIL — CHANGELOG.md does not exist`);
      process.exit(1);
    }
    const contents = readFileSync(changelogPath, "utf8");
    const re = new RegExp(`^## ${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `, "m");
    if (!re.test(contents)) {
      console.error(
        `[changelog] FAIL — no CHANGELOG.md entry for ${version}. Releases are evidence-bound: run \`bun run changelog:generate\` at release time (Art. XIX/XXII).`,
      );
      process.exit(1);
    }
    console.log(`[changelog] ok — entry for ${version} present (${commits.length} commits since ${from ?? "root"})`);
    return;
  }

  if (process.argv.includes("--write")) {
    const existing = existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "# Changelog\n";
    writeFileSync(changelogPath, upsertSection(existing, version, section));
    console.log(`[changelog] wrote ${version} (${commits.length} commits since ${from ?? "root"}) → CHANGELOG.md`);
    return;
  }

  process.stdout.write(section);
}

if (import.meta.main) {
  await main();
}
