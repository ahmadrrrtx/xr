#!/usr/bin/env bun
/**
 * mock-data-lint — XR-REL-01 release gate.
 *
 * Why this exists: `v1.1.1-rc.1` shipped a production desktop bundle that
 * displayed a hardcoded machine profile ("Apple M3 Pro / 36 GB"), an installed
 * Ollama that did not exist ("0.5.7 (mock)"), and a byte-by-byte simulated
 * model download labelled "real bytes, real progress". None of it was
 * reachable through the app's own claims, and none of the existing gates
 * (claim-lint, placeholder-lint) looked at `desktop/src`.
 *
 * Two checks, one principle: a surface may not PRESENT a fabricated value.
 *
 *   1. SOURCE  — forbidden fabrications in desktop/src. Every entry may carry
 *                an explicit, reviewable allowance (`allow`), so a legitimate
 *                use (the mock trace engine, which is a dev-only feature with
 *                its own gate) is named rather than silently permitted.
 *   2. BUNDLE  — when desktop/dist exists, the built JS must not contain the
 *                fabrication markers. This is the one that catches "it was
 *                guarded but the string still shipped".
 *
 *   bun run scripts/mock-data-lint.ts            # source + bundle if present
 *   bun run scripts/mock-data-lint.ts --source   # source only (fast, CI-lint)
 *
 * Exit 1 on any unallowed hit. An unreadable file fails closed.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const DESKTOP_SRC = join(REPO_ROOT, "desktop", "src");
const DESKTOP_DIST = join(REPO_ROOT, "desktop", "dist");

export interface Finding {
  file: string;
  line: number;
  text: string;
  rule: string;
}

interface Rule {
  /** Human name for the report. */
  id: string;
  /** Matched against a single source line. */
  re: RegExp;
  /** Repo-relative file prefixes this rule applies to. */
  scope: string[];
  /** Repo-relative paths that may legitimately contain this text. */
  allow?: string[];
  /** Why the rule exists / why an allowance is legitimate. */
  why: string;
}

/**
 * The rules. Each one is a fabrication that actually shipped once.
 */
export const SOURCE_RULES: readonly Rule[] = [
  {
    id: "hardcoded-machine",
    re: /\bApple M\d\b|\bIntel Core i[79]\b.*\bGB\b|totalMemoryGb:\s*\d+/,
    scope: ["desktop/src"],
    // detect.ts documents the incident in prose; it must not carry the value.
    allow: [],
    why: "hardware must be measured, never a bundled constant",
  },
  {
    id: "browser-dev-mock",
    re: /\(browser dev\)|\(mock\)|fall through to mock/i,
    scope: ["desktop/src"],
    allow: [],
    why: "a probe that cannot run must report unknown, not a mock value",
  },
  {
    id: "simulated-download",
    re: /pulling a6e87b2a|status:\s*'verifying'.*|const total = 2_100_000_000/,
    scope: ["desktop/src"],
    allow: [],
    why: "download progress must come from real bytes",
  },
  {
    id: "unlabelled-demo-trace",
    re: /startMockRun\(|seedMockHistory\(|materialize\(/,
    scope: ["desktop/src"],
    // The Brain's scripted-trace engine is a dev-only fixture. It may exist —
    // it is what makes the UI testable without a provider — but every path
    // that could reach it in a release build must be guarded by
    // `import.meta.env.DEV`. Those guards live at the call sites
    // (brainStore.loadRun / restartRun / startMockRun, brain/demo, runsStore,
    // the Brain and Runs screens) and are pinned by
    // test/desktop/no-fabricated-runs.test.ts.
    allow: [
      "desktop/src/stores/brainStore.ts",
      "desktop/src/brain/mock.ts",
      "desktop/src/brain/demo.ts",
      "desktop/src/runs/seed.ts",
      "desktop/src/runs/registry.ts",
      "desktop/src/stores/runsStore.ts",
      "desktop/src/screens/Brain/index.tsx",
      "desktop/src/screens/Chat/components/ToolCallCard.tsx",
    ],
    why: "a scripted trace must never be reachable as if it were a real run",
  },
];

export function scanSource(
  root = DESKTOP_SRC
): { findings: Finding[]; scanned: number } {
  const findings: Finding[] = [];
  let scanned = 0;

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(extname(entry.name))) continue;
      if (/\.test\.(ts|tsx)$/.test(entry.name)) continue;
      if (!statSync(path).isFile()) continue;

      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (err) {
        throw new Error(
          `mock-data-lint: unreadable file ${path} — failing closed: ${(err as Error).message}`
        );
      }
      scanned++;
      const repoRel = relative(REPO_ROOT, path).split("\\").join("/");

      text.split("\n").forEach((lineText, index) => {
        // Comments may describe the incident; they must not assert the value.
        // Skip comment-only lines (`//`, `/* … */`, and JSDoc ` * ` bodies) and
        // strip trailing line comments, so prose about the bug stays possible.
        const trimmed = lineText.trim();
        if (
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*") ||
          trimmed.startsWith("*") ||
          trimmed.startsWith("*/")
        )
          return;
        const code = lineText.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "");
        if (!code.trim()) return;
        for (const rule of SOURCE_RULES) {
          if (!rule.scope.some((s) => repoRel.startsWith(s))) continue;
          if (rule.allow?.some((a) => repoRel === a || repoRel.startsWith(a + "/")))
            continue;
          if (rule.re.test(code)) {
            findings.push({
              file: repoRel,
              line: index + 1,
              text: lineText.trim().slice(0, 160),
              rule: rule.id,
            });
          }
        }
      });
    }
  };

  if (existsSync(root)) walk(root);
  return { findings, scanned };
}

/** Markers that must never appear in a built bundle. */
export const BUNDLE_MARKERS: readonly string[] = [
  "Apple M3 Pro",
  "(browser dev)",
  "(mock)",
  "pulling a6e87b2a",
  // B-2: the simulated pull's fixed byte total.
  "2100000000",
];

export function scanBundle(
  distRoot = DESKTOP_DIST
): { findings: Finding[]; scanned: number } {
  const findings: Finding[] = [];
  let scanned = 0;
  const assets = join(distRoot, "assets");
  if (!existsSync(assets)) return { findings, scanned };

  for (const name of readdirSync(assets)) {
    if (!name.endsWith(".js")) continue;
    const path = join(assets, name);
    let text: string;
    try {
      text = readFileSync(path, "utf8");
    } catch (err) {
      throw new Error(
        `mock-data-lint: unreadable bundle ${path} — failing closed: ${(err as Error).message}`
      );
    }
    scanned++;
    for (const marker of BUNDLE_MARKERS) {
      const at = text.indexOf(marker);
      if (at === -1) continue;
      findings.push({
        file: relative(REPO_ROOT, path),
        line: 0,
        text: `contains ${JSON.stringify(marker)}`,
        rule: "bundle-fabrication",
      });
    }
  }
  return { findings, scanned };
}

if (import.meta.main) {
  const sourceOnly = process.argv.includes("--source");
  try {
    const source = scanSource();
    const bundle = sourceOnly ? { findings: [], scanned: 0 } : scanBundle();
    const findings = [...source.findings, ...bundle.findings];

    if (findings.length > 0) {
      console.error(
        `❌ mock-data-lint: ${findings.length} fabricated-data marker(s)`
      );
      console.error(
        "   XR-REL-01: XR may not present a value it did not measure. Report the unknown, or gate the demo path behind import.meta.env.DEV."
      );
      for (const f of findings) {
        console.error(`   ${f.file}:${f.line}  [${f.rule}]  ${f.text}`);
      }
      process.exit(1);
    }

    console.log(
      `✅ mock-data-lint: clean — ${source.scanned} source files` +
        (sourceOnly
          ? " (bundle check skipped)"
          : `, ${bundle.scanned} bundle chunks`)
    );
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
