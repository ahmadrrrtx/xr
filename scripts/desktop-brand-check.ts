#!/usr/bin/env bun
/**
 * XR — Brand asset registry check (Phase 1 · design system v3, D-V3-4 / D-05).
 *
 * Decision D-05: the OFFICIAL renders (logo, avatar front, avatar side ×2,
 * hero) are the only brand geometry in the product. Nothing is re-drawn,
 * simplified, traced or "cleaned up"; the only permitted derivations are
 * format/size conversions of the same pixels, and every such file is listed —
 * with its hash — in desktop/src/assets/REGISTRY.json.
 *
 * This check turns that decision into a gate:
 *
 *   BRAND-SVG          an .svg under a brand root (assets/, desktop/src/assets/,
 *                      desktop/src-tauri/icons/) — vector "marks" are exactly
 *                      how the two divergent legacy logos came to exist
 *   BRAND-UNLISTED     a brand image that is not in the registry
 *   BRAND-HASH         a registered file whose bytes changed without the
 *                      registry (a swapped icon, a re-exported avatar)
 *   BRAND-MISSING      a registered file that is gone
 *   BRAND-IMPORT       a renderer module other than components/Brand.tsx
 *                      importing a brand image directly — placements go
 *                      through the registry component (poses, alt text,
 *                      sizing rules live there once)
 *
 *   bun run scripts/desktop-brand-check.ts            # check
 *   bun run scripts/desktop-brand-check.ts --write    # regenerate REGISTRY.json
 *                                                     # (after adding an official render)
 *
 * `checkBrand(root)` takes the repo root so the tests can prove the negative
 * branches on a fixture tree.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

export type BrandRule = "BRAND-SVG" | "BRAND-UNLISTED" | "BRAND-HASH" | "BRAND-MISSING" | "BRAND-IMPORT";
export interface BrandViolation {
  rule: BrandRule;
  file: string;
  line?: number;
  why: string;
}

/** Roots whose image files are brand geometry (relative to the repo root). */
export const BRAND_ROOTS = ["assets", "desktop/src/assets", "desktop/src-tauri/icons"];
/** Fonts live under desktop/src/assets too but are covered by desktop-fonts-check. */
const EXCLUDED_DIRS = new Set(["fonts", "seccomp", "node_modules"]);
const IMAGE_EXT = [".png", ".webp", ".jpg", ".jpeg", ".ico", ".icns", ".gif", ".avif"];
export const REGISTRY_PATH = "desktop/src/assets/REGISTRY.json";
const BRAND_COMPONENT = "desktop/src/components/Brand.tsx";

interface RegistryEntry {
  file: string;
  sha256: string;
  /** Which official render this is (or was converted from). */
  source: string;
  /** What the product uses it for. */
  role: string;
}
interface Registry {
  "// why": string;
  files: RegistryEntry[];
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

function brandFiles(root: string): { images: string[]; svgs: string[] } {
  const images: string[] = [];
  const svgs: string[] = [];
  for (const r of BRAND_ROOTS) {
    for (const f of walk(join(root, r))) {
      const rel = relative(root, f).split("\\").join("/");
      if (f.endsWith(".svg")) svgs.push(rel);
      else if (IMAGE_EXT.some((e) => f.toLowerCase().endsWith(e))) images.push(rel);
    }
  }
  return { images: images.sort(), svgs: svgs.sort() };
}

function readRegistry(root: string): Registry | null {
  const p = join(root, REGISTRY_PATH);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Registry;
}

/** Provenance for files the generator knows; anything else is "official render (see README)". */
const KNOWN_SOURCES: Array<[RegExp, string, string]> = [
  [/^assets\/logo\.png$/, "official logo render", "npm package brand / README"],
  [/^assets\/avatar\.png$/, "official avatar render (front)", "npm package brand / README"],
  [/^assets\/brand\/avatar-front\.png$/, "owner-committed avatar render, front (commit 2827629)", "website + docs"],
  [/^assets\/brand\/avatar-hero\.png$/, "owner-committed avatar render, full-body winged (commit 2827629)", "website + docs"],
  [/^assets\/brand\/logo-320\.png$/, "official logo render, LANCZOS resize to 320px (pixel-only)", "daemon dashboard /assets/brand/logo.png"],
  [/^assets\/brand\/avatar-256\.png$/, "official avatar render (front), LANCZOS resize to 256px (pixel-only)", "daemon dashboard /assets/brand/avatar.png"],
  [/^assets\/brand\/palette-reference\.png$/, "owner-committed palette reference (commit 2827629)", "design reference only — never placed in UI"],
  [/^desktop\/src\/assets\/xr-logo\.png$/, "official logo render", "titlebar, boot splash, onboarding"],
  [/^desktop\/src\/assets\/xr-avatar\.png$/, "official avatar render (front)", "presence / identity, voice front pose"],
  [/^desktop\/src\/assets\/xr-avatar-(128|256)\.png$/, "official avatar render (front), resized", "docked voice orb, chips"],
  [/^desktop\/src\/assets\/xr-avatar-side\.webp$/, "official avatar side-profile render, webp", "voice pose: side (working)"],
  [/^desktop\/src\/assets\/xr-avatar-side-2\.webp$/, "official avatar side-profile render 2, webp", "voice pose: side-alt (acting)"],
  [/^desktop\/src\/assets\/xr-hero\.webp$/, "official superiority hero render, webp", "onboarding hero (cinema zone)"],
  [/^desktop\/src-tauri\/icons\//, "official avatar render, icon-size conversion", "OS app icon / installer"],
];

export function buildRegistry(root: string = ROOT): Registry {
  const { images } = brandFiles(root);
  const prior = readRegistry(root);
  const priorByFile = new Map((prior?.files ?? []).map((e) => [e.file, e]));
  return {
    "// why": "D-05: brand geometry ships ONLY as the official renders (and pixel-identical format/size conversions of them). Every brand image in the product is listed here with its hash; scripts/desktop-brand-check.ts fails CI on any unlisted, changed, or vector brand file. Regenerate with --write after adding an official render.",
    files: images.map((file) => {
      const known = KNOWN_SOURCES.find(([re]) => re.test(file));
      const p = priorByFile.get(file);
      return {
        file,
        sha256: sha256(join(root, file)),
        source: p?.source ?? known?.[1] ?? "official render (document in desktop/src/assets/README.md)",
        role: p?.role ?? known?.[2] ?? "unassigned",
      };
    }),
  };
}

export function checkBrand(root: string = ROOT): { violations: BrandViolation[]; registered: number; scannedModules: number } {
  const violations: BrandViolation[] = [];
  const { images, svgs } = brandFiles(root);

  for (const svg of svgs) {
    violations.push({ rule: "BRAND-SVG", file: svg, why: "vector brand files are re-drawn geometry by definition (D-05); ship the official render instead" });
  }

  const reg = readRegistry(root);
  const byFile = new Map((reg?.files ?? []).map((e) => [e.file, e]));
  for (const img of images) {
    const e = byFile.get(img);
    if (!e) violations.push({ rule: "BRAND-UNLISTED", file: img, why: `not in ${REGISTRY_PATH} — run scripts/desktop-brand-check.ts --write and state its official source` });
    else if (e.sha256 !== sha256(join(root, img))) violations.push({ rule: "BRAND-HASH", file: img, why: "bytes differ from the registry — a brand image changed without the registry saying why" });
  }
  for (const e of reg?.files ?? []) {
    if (!existsSync(join(root, e.file))) violations.push({ rule: "BRAND-MISSING", file: e.file, why: "registered but not present" });
  }

  // Placements go through the registry component only.
  const modules = walk(join(root, "desktop", "src")).filter((f) => /\.(tsx?|jsx?)$/.test(f));
  for (const m of modules) {
    const rel = relative(root, m).split("\\").join("/");
    if (rel === BRAND_COMPONENT) continue;
    readFileSync(m, "utf8").split("\n").forEach((text, i) => {
      if (/from\s+["'][^"']*assets\/xr-[^"']+\.(png|webp|jpe?g|avif)["']/.test(text)) {
        violations.push({ rule: "BRAND-IMPORT", file: rel, line: i + 1, why: "import brand images through components/Brand.tsx (XrLogo, XrAvatar pose=…, HERO_SRC), never directly" });
      }
    });
  }

  return { violations, registered: reg?.files.length ?? 0, scannedModules: modules.length };
}

if (import.meta.main) {
  if (process.argv.includes("--write")) {
    const reg = buildRegistry();
    writeFileSync(join(ROOT, REGISTRY_PATH), JSON.stringify(reg, null, 2) + "\n");
    console.log(`[desktop-brand-check] wrote ${REGISTRY_PATH} · ${reg.files.length} brand file(s)`);
    process.exit(0);
  }
  const { violations, registered, scannedModules } = checkBrand();
  console.log(`[desktop-brand-check] ${registered} registered brand file(s) · ${scannedModules} renderer module(s) scanned · ${violations.length} violation(s)`);
  for (const v of violations) {
    console.error(`  FAIL ${v.rule} ${v.file}${v.line ? `:${v.line}` : ""}`);
    console.error(`       ${v.why}`);
  }
  if (violations.length === 0) console.log("[desktop-brand-check] ✓ only official renders, all registered, placed through Brand.tsx");
  process.exit(violations.length === 0 ? 0 : 1);
}
