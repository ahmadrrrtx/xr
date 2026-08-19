/**
 * XR Phase 11 — resolve import specifiers to internal / external / unresolved.
 *
 * External packages are NEVER treated as repository files. Relative imports
 * are resolved against the importing file. Language-specific path aliases
 * (`@/`, `src/`) are resolved only when the target exists on disk.
 */

import { existsSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import type { DependencyKind, ParsedImport, RepoEdge } from "./types.ts";

const SOURCE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".py", ".go", ".rs"];

export function resolveDependencies(
  root: string,
  fromFile: string,
  imports: readonly ParsedImport[],
  knownFiles: ReadonlySet<string>,
): RepoEdge[] {
  const edges: RepoEdge[] = [];
  const seen = new Set<string>();
  for (const imp of imports) {
    const resolved = resolveSpecifier(root, fromFile, imp.specifier, knownFiles);
    const key = `${fromFile}|${resolved.path}|${imp.specifier}|${imp.isReexport ? "reexports" : "imports"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      fromFile,
      toFile: resolved.path,
      edgeType: imp.isReexport ? "reexports" : "imports",
      symbol: imp.names[0] ?? null,
      kind: resolved.kind,
      specifier: imp.specifier,
    });
  }
  return edges;
}

export function resolveSpecifier(
  root: string,
  fromFile: string,
  specifier: string,
  knownFiles: ReadonlySet<string>,
): { path: string; kind: DependencyKind } {
  if (!specifier) return { path: specifier, kind: "unresolved" };
  if (specifier.startsWith("node:") || specifier.startsWith("bun:")) {
    return { path: specifier, kind: "external" };
  }
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const fromDir = dirname(fromFile);
    const joined = normalize(join(fromDir, specifier)).replace(/\\/g, "/");
    const hit = matchKnown(joined, knownFiles, root);
    if (hit) return { path: hit, kind: "internal" };
    return { path: joined, kind: "unresolved" };
  }
  // Bare specifier: package import unless it maps onto a known file.
  const aliasHit = matchKnown(specifier, knownFiles, root) ?? matchKnown(`src/${specifier}`, knownFiles, root);
  if (aliasHit) return { path: aliasHit, kind: "internal" };
  return { path: specifier, kind: "external" };
}

function matchKnown(candidate: string, known: ReadonlySet<string>, root: string): string | null {
  const cleaned = candidate.replace(/^\.\//, "").replace(/\\/g, "/");
  if (known.has(cleaned)) return cleaned;
  for (const ext of SOURCE_EXTS) {
    if (known.has(cleaned + ext)) return cleaned + ext;
    if (known.has(`${cleaned}/index${ext}`)) return `${cleaned}/index${ext}`;
  }
  const abs = join(root, cleaned);
  if (existsSync(abs) && known.has(cleaned)) return cleaned;
  return null;
}
