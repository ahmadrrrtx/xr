#!/usr/bin/env bun
/**
 * XR — Desktop type-identity check (Phase 1 · design system v3, D-V3-1).
 *
 * XR is local-first. Its typefaces therefore ship INSIDE the desktop package
 * (desktop/src/assets/fonts) and are never fetched from a CDN: a font request
 * to fonts.googleapis.com from a "local-first" app is both a network leak and a
 * cold-start stall on a machine that is offline. This check makes the rule
 * enforceable rather than aspirational:
 *
 *   FONT-URL        a stylesheet or index.html references a remote font
 *                   (googleapis / gstatic / typekit / bunny, or any http(s)
 *                   url() inside @font-face)
 *   FONT-MISSING    fonts.css points at a file that is not in assets/fonts
 *   FONT-UNPINNED   a .woff2 in assets/fonts is not listed in SHA256SUMS, or
 *                   its hash changed without the manifest (provenance drift)
 *   FONT-IDENTITY   tokens.css names a family the design system retired
 *                   (Inter) — the decision in 09-DESIGN-RETHINK-v3 is that
 *                   XR does not look like every other AI product
 *
 *   bun run scripts/desktop-fonts-check.ts           # check desktop/
 *   bun run scripts/desktop-fonts-check.ts --json    # machine-readable
 *
 * `checkFonts(root)` is exported and takes the desktop dir so the test suite
 * can prove the negative branch on a fixture tree (a gate that cannot fail is
 * decoration).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DESKTOP = join(ROOT, "desktop");

export interface FontViolation {
  rule: "FONT-URL" | "FONT-MISSING" | "FONT-UNPINNED" | "FONT-IDENTITY";
  file: string;
  line?: number;
  text: string;
  why: string;
}

const REMOTE_FONT = /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net|fonts\.cdnfonts\.com/i;
const RETIRED_FAMILIES = [/["']Inter["']/];

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === "src-tauri") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => full.endsWith(e))) out.push(full);
  }
  return out;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function checkFonts(desktopDir: string = DESKTOP): { violations: FontViolation[]; scanned: number; pinned: number } {
  const violations: FontViolation[] = [];
  const rel = (p: string) => relative(desktopDir, p);

  // 1. No remote type anywhere in the renderer's stylesheets or the HTML shell.
  const styleFiles = [...walk(join(desktopDir, "src"), [".css", ".tsx", ".ts", ".html"]), join(desktopDir, "index.html")].filter(existsSync);
  for (const file of styleFiles) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inFontFace = false;
    lines.forEach((text, i) => {
      if (/@font-face/.test(text)) inFontFace = true;
      if (REMOTE_FONT.test(text) || (inFontFace && /url\(\s*["']?https?:\/\//i.test(text))) {
        violations.push({
          rule: "FONT-URL",
          file: rel(file),
          line: i + 1,
          text: text.trim(),
          why: "type must ship inside the package — a remote font is a network leak and an offline cold-start stall",
        });
      }
      if (inFontFace && /}/.test(text)) inFontFace = false;
    });
  }

  // 2. fonts.css only references files that exist.
  const fontsCss = join(desktopDir, "src", "styles", "fonts.css");
  if (existsSync(fontsCss)) {
    const lines = readFileSync(fontsCss, "utf8").split("\n");
    lines.forEach((text, i) => {
      const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(text);
      if (!m) return;
      const target = join(desktopDir, "src", "styles", m[1]);
      if (!existsSync(target)) {
        violations.push({
          rule: "FONT-MISSING",
          file: rel(fontsCss),
          line: i + 1,
          text: text.trim(),
          why: `references ${m[1]}, which is not in the package`,
        });
      }
    });
  }

  // 3. Every bundled font is pinned by SHA256SUMS, and hashes match.
  const fontsDir = join(desktopDir, "src", "assets", "fonts");
  let pinned = 0;
  if (existsSync(fontsDir)) {
    const sumsPath = join(fontsDir, "SHA256SUMS");
    const sums = new Map<string, string>();
    if (existsSync(sumsPath)) {
      for (const line of readFileSync(sumsPath, "utf8").split("\n")) {
        const m = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
        if (m) sums.set(m[2], m[1]);
      }
    }
    for (const f of readdirSync(fontsDir).filter((n) => n.endsWith(".woff2"))) {
      const expected = sums.get(f);
      const actual = sha256(join(fontsDir, f));
      if (!expected) {
        violations.push({ rule: "FONT-UNPINNED", file: rel(join(fontsDir, f)), text: f, why: "not listed in SHA256SUMS — provenance unknown" });
      } else if (expected !== actual) {
        violations.push({ rule: "FONT-UNPINNED", file: rel(join(fontsDir, f)), text: f, why: "hash differs from SHA256SUMS — file changed without the manifest" });
      } else {
        pinned += 1;
      }
    }
    for (const listed of sums.keys()) {
      if (!existsSync(join(fontsDir, listed))) {
        violations.push({ rule: "FONT-MISSING", file: rel(sumsPath), text: listed, why: "listed in SHA256SUMS but not present" });
      }
    }
  }

  // 4. The identity decision holds at the token level.
  const tokens = join(desktopDir, "src", "styles", "tokens.css");
  if (existsSync(tokens)) {
    readFileSync(tokens, "utf8").split("\n").forEach((text, i) => {
      if (!/--xr-font/.test(text)) return;
      if (RETIRED_FAMILIES.some((re) => re.test(text))) {
        violations.push({ rule: "FONT-IDENTITY", file: rel(tokens), line: i + 1, text: text.trim(), why: "Inter was retired by the v3 design system (bundled Space Grotesk / IBM Plex Sans / JetBrains Mono)" });
      }
    });
  }

  return { violations, scanned: styleFiles.length, pinned };
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  const { violations, scanned, pinned } = checkFonts();
  if (json) {
    console.log(JSON.stringify({ violations, scanned, pinned }, null, 2));
  } else {
    console.log(`[desktop-fonts-check] scanned ${scanned} file(s) · ${pinned} bundled font file(s) pinned · ${violations.length} violation(s)`);
    for (const v of violations) {
      console.error(`  FAIL ${v.rule} ${v.file}${v.line ? `:${v.line}` : ""}`);
      console.error(`       ${v.text}`);
      console.error(`       ${v.why}`);
    }
    if (violations.length === 0) console.log("[desktop-fonts-check] ✓ type ships inside the package; no remote fonts; provenance pinned");
  }
  process.exit(violations.length === 0 ? 0 : 1);
}
