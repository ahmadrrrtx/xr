#!/usr/bin/env bun
/**
 * XR Phase 3 · F-01 — tag ⇔ npm invariant for the 1.x line.
 *
 * Historical git tags `v3.*` / `v4.*` / `v7.*` (and `backup-*`) are out of
 * band — they never had matching npm versions and are documented in
 * docs/HISTORY.md. This gate only binds the 1.x line:
 *
 *   a git tag v1.*  ⇔  a published npm version 1.*
 *   a published npm 1.*  ⇔  a git tag v1.*
 *
 * Vacuous pass: no 1.x tags AND no 1.x npm versions (today's HEAD, before
 * the first Phase-3 publish). Fail closed as soon as either side exists
 * without the other.
 *
 * Repair is print-only unless `--yes` is passed (operator-only mutation).
 *
 * Usage:
 *   bun run scripts/tag-npm-invariant.ts
 *   bun run scripts/tag-npm-invariant.ts --skip-if-unpublished
 *   bun run scripts/tag-npm-invariant.ts --repair
 *   bun run scripts/tag-npm-invariant.ts --repair --yes
 */
import { spawnSync } from "node:child_process";
import { ROOT } from "./release-manifest.ts";

const HISTORICAL = /^(v3\.|v4\.|v7\.|backup-)/;
const LINE_1_TAG = /^v1\./;
const LINE_1_VER = /^1\./;

export type TagClass = "historical" | "line-1" | "other";

export function classifyGitTag(tag: string): TagClass {
  if (HISTORICAL.test(tag)) return "historical";
  if (LINE_1_TAG.test(tag)) return "line-1";
  return "other";
}

export interface InvariantResult {
  ok: boolean;
  git1: string[];
  npm1: string[];
  missingOnNpm: string[];
  missingOnGit: string[];
}

export function assertTagNpmInvariant(opts: {
  gitTags: string[];
  npmVersions: string[];
}): InvariantResult {
  const git1 = opts.gitTags.filter((t) => classifyGitTag(t) === "line-1").map((t) => t.replace(/^v/, ""));
  const npm1 = opts.npmVersions.filter((v) => LINE_1_VER.test(v));
  const npmSet = new Set(npm1);
  const gitSet = new Set(git1);
  const missingOnNpm = git1.filter((v) => !npmSet.has(v));
  const missingOnGit = npm1.filter((v) => !gitSet.has(v));
  return {
    ok: missingOnNpm.length === 0 && missingOnGit.length === 0,
    git1,
    npm1,
    missingOnNpm,
    missingOnGit,
  };
}

export function repairCommands(latestOnNpm: string | null): string[] {
  return [
    `# Historical 3.x is still npm dist-tag \`latest\` (${latestOnNpm ?? "3.1.5"} sorts higher than 1.0.0).`,
    `# Do NOT auto-repoint latest until stable 1.0.0 ships (Phase 3 runbook; P2 gate).`,
    `npm deprecate @rrrtx/xr@3.1.5 "superseded — install 1.0.0; see docs/HISTORY.md"`,
    `npm deprecate @rrrtx/xr@3.1.0 "superseded — install 1.0.0; see docs/HISTORY.md"`,
    `npm deprecate @rrrtx/xr@3.0.3 "superseded — install 1.0.0; see docs/HISTORY.md"`,
    `# After the stable 1.0.0 publish (not beta):`,
    `npm dist-tag add @rrrtx/xr@1.0.0 latest`,
    `npm dist-tag ls @rrrtx/xr`,
  ];
}

export function listLocalGitTags(): string[] {
  const res = spawnSync("git", ["tag", "--list"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status !== 0) {
    throw new Error(`git tag --list failed: ${(res.stderr ?? "").trim()}`);
  }
  return (res.stdout ?? "")
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function fetchNpmPackument(pkg = "@rrrtx/xr"): Promise<{
  versions: string[];
  distTags: Record<string, string>;
}> {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg).replace("%40", "@")}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return { versions: [], distTags: {} };
  if (!res.ok) throw new Error(`npm registry ${res.status} for ${pkg}`);
  const body = (await res.json()) as {
    versions?: Record<string, unknown>;
    "dist-tags"?: Record<string, string>;
  };
  return {
    versions: Object.keys(body.versions ?? {}),
    distTags: body["dist-tags"] ?? {},
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const skipIfUnpublished = argv.includes("--skip-if-unpublished");
  const repair = argv.includes("--repair");
  const yes = argv.includes("--yes");

  const gitTags = listLocalGitTags();
  const packument = await fetchNpmPackument();
  const result = assertTagNpmInvariant({ gitTags, npmVersions: packument.versions });

  if (skipIfUnpublished && result.git1.length === 0 && result.npm1.length === 0) {
    console.log("tag⇔npm: skip — no 1.x git tags and no 1.x npm versions yet (vacuous pass)");
    return;
  }

  console.log(`tag⇔npm: git 1.x = [${result.git1.join(", ") || "none"}]`);
  console.log(`tag⇔npm: npm 1.x = [${result.npm1.join(", ") || "none"}]`);
  console.log(`tag⇔npm: dist-tags = ${JSON.stringify(packument.distTags)}`);

  if (repair) {
    const cmds = repairCommands(packument.distTags.latest ?? null);
    for (const c of cmds) console.log(c);
    if (yes) {
      console.error("tag⇔npm --yes: refusing to mutate npm from CI. Run the printed commands locally as the package owner.");
      process.exit(2);
    }
  }

  if (!result.ok) {
    if (result.missingOnNpm.length) {
      console.error(`tag⇔npm FAIL — git tags without npm versions: ${result.missingOnNpm.map((v) => "v" + v).join(", ")}`);
    }
    if (result.missingOnGit.length) {
      console.error(`tag⇔npm FAIL — npm versions without git tags: ${result.missingOnGit.join(", ")}`);
    }
    process.exit(1);
  }
  console.log("tag⇔npm: ok (1.x line in sync, historical v3/v4/v7 out of band)");
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[tag-npm-invariant] fatal:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
