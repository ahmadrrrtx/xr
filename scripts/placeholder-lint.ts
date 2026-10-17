#!/usr/bin/env bun
/**
 * placeholder-lint — P0-1 gate (XR_FINAL_MASTER_AUDIT §5, badge VERIFIED-CONSENSUS).
 *
 * The public site must ship a finished legal identity: GDPR Art. 13 requires
 * the controller's identity, and India's DPDP rules require a named grievance
 * officer. The audit found `[TO FILL: …]` markers live on /privacy and in
 * every page footer; Phase 1.1 filled them, and this gate makes sure an
 * unfinished placeholder can never reach the public surface again.
 *
 *   bun run scripts/placeholder-lint.ts   # scan website/src; exit 1 on any hit
 *
 * Fails (exit 1) on any line matching /TO FILL/i or a [[bracketed]] marker in
 * .ts/.tsx/.js/.jsx/.md/.mdx under website/src, printing `file:line  <text>`
 * per hit. An unreadable file fails closed (Commandment 13).
 */

import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

export interface Finding {
  file: string;
  line: number;
  text: string;
  marker: string;
}

const MARKERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/TO FILL/i, '"TO FILL"'],
  [/\[\[[^\]\n]*\]\]/, '"[[…]]" bracketed placeholder'],
];

const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".md", ".mdx"]);
const SKIP_DIRS = new Set(["node_modules", ".next"]);

export function scanPlaceholders(root: string): { findings: Finding[]; scanned: number } {
  const findings: Finding[] = [];
  let scanned = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path);
        continue;
      }
      if (!EXTENSIONS.has(extname(entry.name))) continue;
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch (err) {
        throw new Error(`placeholder-lint: unreadable file ${path} — failing closed: ${(err as Error).message}`);
      }
      scanned++;
      text.split("\n").forEach((lineText, index) => {
        for (const [re, marker] of MARKERS) {
          if (re.test(lineText)) findings.push({ file: path, line: index + 1, text: lineText.trim(), marker });
        }
      });
    }
  };
  walk(root);
  return { findings, scanned };
}

if (import.meta.main) {
  const REPO_ROOT = join(import.meta.dir, "..");
  const SCAN_ROOT = join(REPO_ROOT, "website", "src");
  try {
    const { findings, scanned } = scanPlaceholders(SCAN_ROOT);
    if (findings.length > 0) {
      console.error(`❌ placeholder-lint: ${findings.length} unfinished placeholder marker(s) under website/src`);
      console.error(
        "   P0-1: the public surface must carry the real legal identity (GDPR Art. 13 controller; DPDP named grievance officer). Fill it in, then re-run.",
      );
      for (const f of findings) console.error(`   ${relative(REPO_ROOT, f.file)}:${f.line}  ${f.text}`);
      process.exit(1);
    }
    console.log(`✅ placeholder-lint: no placeholder markers — ${scanned} files scanned under website/src`);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    process.exit(1);
  }
}
