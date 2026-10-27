#!/usr/bin/env bun
/** Production vulnerability gate. Unknown scanner data is failure, never zero findings. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Advisory {
  name: string;
  severity: string;
  title: string;
  url: string;
  range?: string;
}
const NAME = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const SEVERITIES = new Set([
  "info",
  "low",
  "moderate",
  "medium",
  "high",
  "critical",
]);
export function parseAuditReport(report: unknown, exitCode = 0): Advisory[] {
  if (exitCode !== 0 && exitCode !== 1)
    throw new Error(`bun audit exited ${exitCode}`);
  if (!report || typeof report !== "object")
    throw new Error("invalid audit report shape");
  const out: Advisory[] = [];
  const push = (name: unknown, a: unknown) => {
    if (!a || typeof a !== "object" || Array.isArray(a))
      throw new Error("invalid advisory record");
    const item = a as Record<string, unknown>;
    const pkg = name ?? item.name ?? item.package;
    const severity = String(item.severity ?? item.level ?? "").toLowerCase();
    if (typeof pkg !== "string" || !NAME.test(pkg) || !SEVERITIES.has(severity))
      throw new Error("missing/invalid advisory package or severity");
    const range =
      item.vulnerable_versions ?? item.vulnerableVersions ?? item.range;
    if (range !== undefined && typeof range !== "string")
      throw new Error("invalid vulnerable version range");
    out.push({
      name: pkg,
      severity,
      title: String(item.title ?? item.summary ?? ""),
      url: String(item.url ?? ""),
      range: range as string | undefined,
    });
  };
  if (Array.isArray(report)) for (const item of report) push(undefined, item);
  else
    for (const [name, value] of Object.entries(report)) {
      if (Array.isArray(value)) for (const a of value) push(name, a);
      else if (
        value &&
        typeof value === "object" &&
        Array.isArray((value as Record<string, unknown>).advisories)
      )
        for (const a of (value as { advisories: unknown[] }).advisories)
          push(name, a);
      else throw new Error(`unrecognized audit envelope at ${name}`);
    }
  if (exitCode === 1 && !out.length)
    throw new Error("audit failed without advisory records");
  return out;
}

export function productionGraph(root: string): Map<string, Set<string>> {
  const read = (dir: string) =>
    JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const graph = new Map<string, Set<string>>(),
    visited = new Set<string>();
  const queue: Array<{ name: string; from: string; optional: boolean }> = [];
  const enqueue = (pkg: Record<string, any>, from: string) => {
    for (const name of new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ]))
      queue.push({
        name,
        from,
        optional:
          name in (pkg.optionalDependencies ?? {}) ||
          pkg.peerDependenciesMeta?.[name]?.optional === true,
      });
  };
  enqueue(read(root), root);
  while (queue.length) {
    const { name, from, optional } = queue.shift()!;
    if (!NAME.test(name)) throw new Error("invalid dependency name");
    let p = resolve(from),
      found: string | undefined;
    for (;;) {
      const dir = join(p, "node_modules", name);
      if (existsSync(join(dir, "package.json"))) {
        found = realpathSync(dir);
        break;
      }
      const parent = dirname(p);
      if (parent === p) break;
      p = parent;
    }
    if (!found) {
      if (optional) continue;
      throw new Error(`production dependency not installed: ${name}`);
    }
    if (visited.has(found)) continue;
    visited.add(found);
    const pkg = read(found);
    if (typeof pkg.version !== "string")
      throw new Error(`missing installed version: ${name}`);
    const versions = graph.get(name) ?? new Set<string>();
    versions.add(pkg.version);
    graph.set(name, versions);
    enqueue(pkg, found);
  }
  return graph;
}

if (import.meta.main) {
  try {
    const report = parseAuditReport(
      JSON.parse(readFileSync(process.argv[2], "utf8")),
      Number(process.argv[3]),
    );
    const graph = productionGraph(process.cwd());
    let blocking = 0,
      dev = 0;
    for (const a of report) {
      if (a.severity !== "high" && a.severity !== "critical") continue;
      const versions = graph.get(a.name);
      // Conservative by package name: never interpret an unknown range as safe.
      const reachable = !!versions;
      if (reachable) {
        blocking++;
        console.error(
          `audit-deps: PRODUCTION ${a.severity.toUpperCase()} in ${a.name} — ${a.title} ${a.url}`,
        );
      } else {
        dev++;
        console.log(
          `audit-deps: non-production ${a.severity} in ${a.name} — ${a.title} ${a.url}`,
        );
      }
    }
    if (blocking)
      throw new Error(`${blocking} high/critical production advisories`);
    console.log(
      `audit-deps: PASS — ${graph.size} production packages; ${dev} non-production findings`,
    );
  } catch (e) {
    console.error(`audit-deps: FAIL — ${(e as Error).message}`);
    process.exit(1);
  }
}
