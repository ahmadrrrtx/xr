#!/usr/bin/env bun
/**
 * Launch audit XR-LAUNCH-023 — npm "ghost" versions.
 *
 * The npm package was rebaselined (0.2 → 3.x → … → 1.x, see docs/HISTORY.md),
 * so @rrrtx/xr still carries 3.x builds that sort ABOVE the supported 1.x
 * line: `npm i @rrrtx/xr@'>=1'` or "highest version" tooling resolves to an
 * obsolete build. npm only lets a maintainer unpublish within its policy
 * window, so the remedy is a deprecation message on every ghost that points
 * to `@latest`.
 *
 * A ghost is any published version whose MAJOR is above the `latest`
 * dist-tag's major. Each one must be deprecated, and the message must point to
 * `@latest` (never `@beta`, which the old message did).
 *
 * This file is READ-ONLY: it probes the public registry (or a fixture) and can
 * PRINT the `npm deprecate` commands for the package owner. It never runs
 * them — registry writes are an owner action (needs publish rights + 2FA).
 *
 *   bun run npm:ghosts                       # probe the registry, exit 1 on problems
 *   bun run npm:ghosts -- --print-commands   # + the owner's npm deprecate commands
 *   bun run npm:ghosts -- --fixture f.json   # offline (tests)
 *   bun run npm:ghosts -- --json
 *
 * `bun run channel:live` runs the same check as part of the npm channel.
 */
import { readFileSync } from "node:fs";

export interface Packument {
  name?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { deprecated?: string | boolean } | undefined>;
}

export interface GhostVersion {
  version: string;
  deprecated: string | null;
  problems: string[];
}

export interface GhostReport {
  name: string;
  latest: string | null;
  ghosts: GhostVersion[];
  problems: string[];
}

export const HISTORY_URL = "https://github.com/ahmadrrrtx/xr/blob/main/docs/HISTORY.md";

function major(version: string): number | null {
  const m = /^v?(\d+)\.\d+\.\d+/.exec(version);
  return m ? Number(m[1]) : null;
}

/** The deprecation message the owner should set on every ghost (pure). */
export function ghostMessage(name: string, latest: string): string {
  const line = `${major(latest) ?? "?"}.x`;
  return `Retired build from before the version rebaseline. The supported line is ${name}@latest (${line}): npm i -g ${name}@latest. History: ${HISTORY_URL}`;
}

/** Classify every version above the latest major. Pure; never touches the network. */
export function findGhostVersions(doc: Packument, fallbackName = "@rrrtx/xr"): GhostReport {
  const name = doc.name ?? fallbackName;
  const latest = doc["dist-tags"]?.latest ?? null;
  const problems: string[] = [];
  const ghosts: GhostVersion[] = [];
  const latestMajor = latest ? major(latest) : null;
  if (latest === null || latestMajor === null) {
    problems.push(`npm dist-tag latest is ${latest ?? "unset"}; cannot tell which versions outrank it`);
    return { name, latest, ghosts, problems };
  }
  for (const [version, meta] of Object.entries(doc.versions ?? {})) {
    const m = major(version);
    if (m === null || m <= latestMajor) continue;
    const raw = meta?.deprecated;
    const deprecated = typeof raw === "string" && raw.trim() ? raw : raw === true ? "(deprecated)" : null;
    const p: string[] = [];
    if (!deprecated) p.push("not deprecated");
    else {
      if (!deprecated.includes(`${name}@latest`) && !/@latest\b/.test(deprecated)) p.push("deprecation message does not point to @latest");
      if (/@beta\b/.test(deprecated)) p.push("deprecation message points to @beta");
    }
    ghosts.push({ version, deprecated, problems: p });
    for (const x of p) problems.push(`${name}@${version} outranks latest ${latest}: ${x}`);
  }
  ghosts.sort((a, b) => a.version.localeCompare(b.version, "en", { numeric: true }));
  return { name, latest, ghosts, problems };
}

/** POSIX single-quote a shell word (the message contains no secrets, only text). */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * The owner's commands: one `npm deprecate` per ghost that still needs it —
 * explicit versions, never a range, so the effect is exactly what is shown.
 * Printed only; this module never executes them. Pure.
 */
export function deprecationCommands(report: GhostReport): string[] {
  if (!report.latest) return [];
  const msg = ghostMessage(report.name, report.latest);
  return report.ghosts.filter((g) => g.problems.length > 0).map((g) => `npm deprecate ${shq(`${report.name}@${g.version}`)} ${shq(msg)}`);
}

async function loadPackument(argv: string[]): Promise<Packument> {
  const i = argv.indexOf("--fixture");
  if (i >= 0) {
    const file = argv[i + 1];
    if (!file) throw new Error("--fixture needs a path");
    return JSON.parse(readFileSync(file, "utf8")) as Packument;
  }
  const name = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string }).name;
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status !== 200) throw new Error(`registry returned HTTP ${res.status} for ${name}`);
  return (await res.json()) as Packument;
}

async function main(argv: string[]): Promise<number> {
  let doc: Packument;
  try {
    doc = await loadPackument(argv);
  } catch (e) {
    console.error(`[npm-ghosts] ${(e as Error).message}`);
    return 2;
  }
  const report = findGhostVersions(doc);
  const commands = deprecationCommands(report);
  if (argv.includes("--json")) {
    console.log(JSON.stringify({ ...report, ok: report.problems.length === 0, commands }, null, 2));
    return report.problems.length === 0 ? 0 : 1;
  }
  console.log(`[npm-ghosts] ${report.name}: latest ${report.latest ?? "unset"}; ${report.ghosts.length} version(s) above the latest major`);
  for (const g of report.ghosts) {
    console.log(`  ${g.problems.length ? "✗" : "✓"} ${g.version}  ${g.problems.join("; ") || "deprecated → @latest"}`);
  }
  for (const p of report.problems.filter((x) => x.includes("cannot tell"))) console.log(`  ✗ ${p}`);
  if (report.problems.length === 0) {
    console.log("[npm-ghosts] ok — every version above the latest major is deprecated and points to @latest");
    return 0;
  }
  if (argv.includes("--print-commands") && commands.length) {
    console.log("\n# Owner-run only — CI and agents never run these. Needs `npm login` with publish");
    console.log("# rights on the package; append --otp=<code> to each line if 2FA is on.");
    for (const c of commands) console.log(c);
    console.log(`# Then confirm: bun run npm:ghosts`);
  } else if (commands.length) {
    console.log("[npm-ghosts] rerun with --print-commands for the owner's npm deprecate commands");
  }
  return 1;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
