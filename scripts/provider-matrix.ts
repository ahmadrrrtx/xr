#!/usr/bin/env bun
/**
 * XR Phase 10 · Step 4 — provider capability matrix (catalog truth).
 *
 * Both audits recommended VCR-style per-preset contract fixtures and a
 * per-preset capability matrix. The catalog (`src/providers/presets.ts`,
 * re-stamped from release.manifest.json) is the single source of truth. This
 * generator emits a published capability matrix and FAILS when a fixture
 * disagrees with the catalog — so the matrix and the fixtures can never claim
 * more than the catalog (claim-lint culture applied to the provider surface).
 *
 * Columns (map to F-03/F-04/F-13 evidence):
 *   · streaming  — transport supports SSE streaming
 *   · tool-use / native-tool-calls — whether native tool calling is declared
 *   · usage-reporting — provider-reported tokens with estimated fallback (F-13)
 *   · fixture     — whether a VCR-style offline contract fixture exists
 *
 * Usage:
 *   bun run scripts/provider-matrix.ts            # print + write docs, validate
 *   bun run scripts/provider-matrix.ts --json p   # machine report
 *   bun run scripts/provider-matrix.ts --check    # validate only (exit 1 on drift)
 *
 * Exit 0 = clean; 1 = fixture/catalog drift.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { PRESETS } from "../src/providers/presets.ts";
import { CORE_VERSION } from "../src/core/version.ts";

const FIXTURES_DIR = join(import.meta.dir, "..", "test", "providers", "fixtures");

function catalogRow(id: string) {
  const p = PRESETS[id];
  const c = p.capabilities ?? {};
  return {
    id,
    label: p.label,
    kind: p.kind,
    tier: p.tier,
    streaming: Boolean(c.streaming ?? c.chat),
    toolUse: Boolean(c.toolUse ?? c.functionCalling),
    nativeToolCalls: Boolean(c.functionCalling ?? c.toolUse),
    jsonMode: Boolean(c.jsonMode),
    vision: Boolean(c.vision),
    apiKeyEnv: p.apiKeyEnv ?? null,
    authType: p.authType ?? (p.apiKeyEnv ? "bearer" : "none"),
  };
}

function loadFixture(id: string): Record<string, unknown> | null {
  const p = join(FIXTURES_DIR, `${id}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function computeMatrix(): { rows: any[]; drift: string[] } {
  const ids = Object.keys(PRESETS).sort();
  const drift: string[] = [];
  const rows: any[] = ids.map((id) => {
    const cat = catalogRow(id);
    const fx = loadFixture(id);
    if (fx) {
      const fcap = (fx.capabilities as any) ?? {};
      const checks: [string, boolean, boolean][] = [
        ["streaming", cat.streaming, Boolean(fcap.streaming)],
        ["toolUse", cat.toolUse, Boolean(fcap.toolUse)],
        ["nativeToolCalls", cat.nativeToolCalls, Boolean(fcap.nativeToolCalls)],
        ["jsonMode", cat.jsonMode, Boolean(fcap.jsonMode)],
        ["vision", cat.vision, Boolean(fcap.vision)],
      ];
      for (const [field, catalogV, fxV] of checks) {
        if (catalogV !== fxV) drift.push(`${id}.${field}: catalog=${catalogV} fixture=${fxV}`);
      }
      return { ...cat, fixture: true, fixtureUsage: (fx.usageReporting as string) ?? null };
    }
    return { ...cat, fixture: false, fixtureUsage: null };
  });
  return { rows, drift };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let json: string | null = null;
  let checkOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") json = argv[++i]!;
    else if (a === "--check") checkOnly = true;
    else if (a === "--help") { console.log("Usage: provider-matrix.ts [--json p] [--check]"); process.exit(0); }
  }
  const { rows, drift } = computeMatrix();

  const report = {
    phase: "phase-10-step-4",
    note: "per-preset capability matrix derived from the provider catalog (catalog truth) + VCR fixtures; drift between fixture and catalog fails the gate",
    generatedAt: new Date().toISOString(),
    catalogPresets: rows.length,
    fixtureCoverage: rows.filter((r) => r.fixture).length,
    drift,
    providers: rows,
  };

  if (checkOnly) {
    if (drift.length) {
      console.error("✗ provider-matrix drift:");
      for (const d of drift) console.error("  -", d);
      return 1;
    }
    console.log(`✓ provider-matrix: ${rows.length} catalog presets, ${report.fixtureCoverage} fixtures, no drift`);
    return 0;
  }

  // publish the matrix document under the release version dir (manifest-stamped)
  const rel = CORE_VERSION;
  const outPath = join(import.meta.dir, "..", "docs", "release", rel, "PROVIDER_MATRIX.md");
  const lines = [
    `# XR Provider Capability Matrix (${rel})`,
    "",
    `**Generated:** ${report.generatedAt} — from the provider catalog (catalog truth). `,
    "A row can never claim a capability the catalog does not declare; fixture drift fails CI.",
    "",
    "Legend: `✓` supported · `—` not declared · `fixture` = offline VCR contract fixture exists.",
    "",
    "| preset | kind | tier | streaming | tool-use | native-tool-calls | json | vision | usage-reporting | fixture |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const y = (b: boolean) => (b ? "✓" : "—");
      return `| ${r.id} | ${r.kind} | ${r.tier} | ${y(r.streaming)} | ${y(r.toolUse)} | ${y(r.nativeToolCalls)} | ${y(r.jsonMode)} | ${y(r.vision)} | ${r.fixture ? (r.fixtureUsage ?? "provider-reported + F-13 fallback") : "n/a"} | ${r.fixture ? "✓" : "—"} |`;
    }),
    "",
    "> **Live confirmation:** this matrix is the *declared* capability surface (catalog + offline fixtures).",
    "> Live provider smoke is `provider-canaries` (`.github/workflows/provider-canaries.yml`), which probes a provider",
    "> only when its API key is configured and never fabricates a pass. Hosted rows are `✓ fixture` (contract-tested offline);",
    "> the hosted live canary rows are produced by the canary job and recorded separately.",
  ];
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, lines.join("\n") + "\n");

  if (json) {
    mkdirSync(dirname(json), { recursive: true });
    writeFileSync(json, JSON.stringify(report, null, 2));
  }
  // print a compact summary
  for (const r of rows) {
    const y = (b: boolean) => (b ? "✓" : "·");
    console.log(`${r.id.padEnd(11)} ${r.kind.padEnd(7)} ${r.tier.padEnd(9)} s:${y(r.streaming)} t:${y(r.toolUse)} n:${y(r.nativeToolCalls)} j:${y(r.jsonMode)} v:${y(r.vision)} fx:${r.fixture ? "✓" : "·"} ${r.apiKeyEnv ?? ""}`);
  }
  console.log(`\nwrote ${outPath}`);
  if (drift.length) {
    console.error("✗ drift:");
    for (const d of drift) console.error("  -", d);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
