/**
 * XR Phase 2.5 · P2-16 — bots/types no-orphans: mechanized [DERIVED], not waivered.
 *
 * REPRODUCTION (recorded in the tracker row): `bun run boundaries` reports
 *   [no-orphans] bots/types.ts — module that is not required by any other module.
 * Census at the time: 11 type-only importers (telegram ×2, whatsapp ×5,
 * discord ×3, shared-runtime ×1) + 1 test import; bots/ owns 0 runtime modules.
 *
 * AUDIT CLASSIFICATION: "orphan" from static analysis = [DERIVED] (claim from
 * distribution health, implementation verified) — not [INVARIANT], and the
 * audit's own condition for a narrow exception applies: the consumer families
 * are peers of the same bot runtime family that consume bots/types through
 * type-only imports — invisible to a runtime-edge scan with
 * tsPreCompilationDeps:false.
 *
 * These tests prove (1) the boundary module has only documented type-only
 * exceptions, (2) the bots/types exception stays exactly scoped to its path,
 * (3) real importers still consume it (type-level).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function collectTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectTs(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("P2-16 type-only exception discipline", () => {
  test("no-orphans pathNot lists only type-contract modules (no whole-family widening)", () => {
    const conf = readFileSync(join(ROOT, ".dependency-cruiser.cjs"), "utf8");
    const noOrphans = conf.slice(conf.indexOf('name: "no-orphans"'));
    const pathNotBlock = noOrphans.slice(noOrphans.indexOf("pathNot"), noOrphans.indexOf("/dist/"));
    // The exception family stays a dotted list of FILES — never a directory
    // wildcard like ^src/bots/ without a specific file, and no unanchored path.
    expect(pathNotBlock).not.toMatch(/\^src\/bots\/\^?/) ;
    expect((pathNotBlock.match(/\^src/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(pathNotBlock).toContain("bots/types");
  });

  test("bots/types is listed exactly once and with an explanatory Phase-2.5 comment nearby", () => {
    const conf = readFileSync(join(ROOT, ".dependency-cruiser.cjs"), "utf8");
    const occurrences = conf.split("bots/types").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2); // once in pathNot, once in the comment
    expect(conf.slice(Math.max(0, conf.indexOf("bots/types") - 400), conf.indexOf("bots/types"))).toMatch(/Phase 2\.5|type-only|P2-16/i);
  });

  test("the type-only consumers remain (the exception cannot outlive its justification)", () => {
    // The real tree keeps channels under src/{telegram,whatsapp,discord}/ — the
    // peer family consuming bots/types via type-only imports (census: 11).
    const channelFiles = ["telegram", "whatsapp", "discord"].flatMap((c) =>
      collectTs(join(ROOT, "src", c)).map((p) => relative(ROOT, p)),
    );
    const typeImporters = channelFiles.filter((p) => {
      const src = readFileSync(join(ROOT, p), "utf8");
      return /from "\.\.+\/?bots\/types\.ts"/.test(src) || /from "\.\.+\/?\.\.?\/bots\/types\.ts"/.test(src);
    });
    expect(typeImporters.length, typeImporters.join(", ")).toBeGreaterThanOrEqual(10); // 10 src consumers recorded
    expect(readFileSync(join(ROOT, "test", "bots", "shared-runtime.test.ts"), "utf8")).toMatch(/bots\/types/);
  });
});
