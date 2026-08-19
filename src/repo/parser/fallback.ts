/**
 * Heuristic fallback parser.
 *
 * Used for languages we do not structurally scan. Extracts import-like
 * specifiers and a single file-level module symbol. Confidence is
 * `heuristic` — callers must not treat this as equivalent to an AST.
 */

import { symbolId } from "../hash.ts";
import type { ParsedImport, ParseResult } from "../types.ts";

const IMPORT_LINE =
  /^\s*(?:import|from|using|require|include|#include|use)\s+["'<]?([A-Za-z0-9_./:@-]+)/;

export function parseFallback(relativePath: string, source: string, language: string): ParseResult {
  const imports: ParsedImport[] = [];
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length && i < 400; i++) {
    const m = IMPORT_LINE.exec(lines[i]!);
    if (!m) continue;
    const spec = m[1]!;
    if (!spec) continue;
    imports.push({
      specifier: spec.replace(/[">]$/, ""),
      names: [],
      isTypeOnly: false,
      isReexport: false,
      line: i + 1,
    });
  }
  const base = relativePath.slice(relativePath.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "") || relativePath;
  return {
    language,
    confidence: "heuristic",
    parser: "xr-heuristic",
    symbols: [
      {
        id: symbolId(relativePath, base, "module", 1),
        file: relativePath,
        name: base,
        kind: "module",
        startLine: 1,
        endLine: Math.max(1, lines.length),
        signature: base,
        exported: false,
      },
    ],
    imports,
    exports: [],
  };
}
