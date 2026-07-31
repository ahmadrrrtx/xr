/**
 * XR Phase 2 · T9 — module relocation helper.
 *
 * Moves a top-level module to its L0–L6 home and rewrites EVERY import
 * specifier that resolved into it — both the external importers and the moved
 * files' own relative imports, which must be re-anchored to the new depth.
 *
 * Specifiers are resolved to real paths before rewriting, so a `../../x.ts`
 * that happens to contain the module name is never mangled: only imports that
 * genuinely pointed into the moved tree are touched.
 *
 * Usage: bun run scripts/phase2-move-module.ts <fromDir> <toDir>
 *   e.g. bun run scripts/phase2-move-module.ts src/trust src/runtime/trust
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve, dirname, join, sep } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/** Rewrite one file's relative specifiers using a resolver. */
function rewrite(file: string, mapResolved: (resolvedAbs: string) => string | null, anchorDir: string): boolean {
  const src = readFileSync(file, "utf8");
  const out = src.replace(/(["'])(\.[^"']*?\.tsx?)\1/g, (whole, quote: string, spec: string) => {
    const resolvedAbs = resolve(anchorDir, spec);
    const target = mapResolved(resolvedAbs);
    if (!target) return whole;
    let rel = toPosix(relative(dirname(file), target));
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${quote}${rel}${quote}`;
  });
  if (out !== src) {
    writeFileSync(file, out);
    return true;
  }
  return false;
}

const [fromArg, toArg] = process.argv.slice(2);
if (!fromArg || !toArg) {
  console.error("usage: phase2-move-module.ts <fromDir> <toDir>");
  process.exit(2);
}

const FROM = resolve(ROOT, fromArg);
const TO = resolve(ROOT, toArg);

/** Map an absolute path under FROM to its new location under TO. */
function relocate(abs: string): string | null {
  const rel = relative(FROM, abs);
  if (rel.startsWith("..") || rel === "") return null;
  return join(TO, rel);
}

const movedFiles = walk(TO); // called AFTER the git mv
const allFiles = [
  ...walk(join(ROOT, "src")),
  ...walk(join(ROOT, "test")),
  ...walk(join(ROOT, "scripts")),
];

let changed = 0;

// 1. External importers: their specifiers still resolve to the OLD location.
for (const file of allFiles) {
  if (movedFiles.includes(file)) continue;
  if (rewrite(file, relocate, dirname(file))) changed++;
}

// 2. Moved files: re-anchor. Their specifiers were written relative to the OLD
//    directory, so resolve against the old dir, then relocate if the target
//    also moved.
for (const file of movedFiles) {
  const oldDir = join(FROM, dirname(relative(TO, file)));
  const mapped = (abs: string): string | null => {
    const moved = relocate(abs);
    if (moved) return moved; // sibling inside the moved tree
    return abs; // outside the tree: same target, new relative depth
  };
  if (rewrite(file, mapped, oldDir)) changed++;
}

console.log(`${fromArg} -> ${toArg}: rewrote ${changed} file(s)`);
