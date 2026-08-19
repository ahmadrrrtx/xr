/**
 * Structural scanner for Python.
 *
 * Indentation-aware enough to attach `endLine` to a def/class: the body
 * ends when a non-empty line returns to the definition's indent (or less).
 */

import { symbolId } from "../hash.ts";
import type { ParsedExport, ParsedImport, ParseResult, RepoSymbol, SymbolKind } from "../types.ts";

export function parsePython(relativePath: string, source: string): ParseResult {
  const symbols: RepoSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const lines = source.split(/\r?\n/);

  const open: Array<{ name: string; kind: SymbolKind; start: number; indent: number; exported: boolean }> = [];

  const closeTo = (indent: number, endLine: number) => {
    while (open.length && open[open.length - 1]!.indent >= indent) {
      const top = open.pop()!;
      symbols.push({
        id: symbolId(relativePath, top.name, top.kind, top.start),
        file: relativePath,
        name: top.name,
        kind: top.kind,
        startLine: top.start,
        endLine,
        signature: top.name,
        exported: top.exported,
      });
      if (top.exported) exports.push({ name: top.name, kind: top.kind, line: top.start });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = raw.length - raw.trimStart().length;
    closeTo(indent + 1, i); // close siblings/children first; keep parents

    const importMatch = /^(?:from\s+(\S+)\s+)?import\s+(.+)$/.exec(trimmed);
    if (importMatch && !trimmed.startsWith("class ") && !trimmed.startsWith("def ")) {
      const fromMod = importMatch[1];
      const namesPart = importMatch[2]!.split("#")[0]!.trim();
      const names = namesPart
        .split(",")
        .map((n) => n.trim().split(/\s+as\s+/)[0]!.trim())
        .filter((n) => n && n !== "(" && n !== ")");
      const specifier = fromMod ?? names[0] ?? "";
      if (specifier) {
        imports.push({
          specifier,
          names: fromMod ? names : names.slice(1),
          isTypeOnly: false,
          isReexport: false,
          line: i + 1,
        });
      }
      continue;
    }

    const classMatch = /^(?:@\w+[^\n]*\n)*class\s+([A-Za-z_][\w]*)/.exec(trimmed);
    if (classMatch) {
      closeTo(indent, i);
      open.push({ name: classMatch[1]!, kind: "class", start: i + 1, indent, exported: indent === 0 });
      continue;
    }
    const defMatch = /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/.exec(trimmed);
    if (defMatch) {
      closeTo(indent, i);
      const kind: SymbolKind = indent > 0 ? "method" : "function";
      open.push({ name: defMatch[1]!, kind, start: i + 1, indent, exported: indent === 0 });
    }
  }
  closeTo(-1, lines.length);

  // `__all__` is an explicit export list when present.
  const allMatch = /__all__\s*=\s*\[([^\]]*)\]/.exec(source);
  if (allMatch) {
    for (const name of allMatch[1]!.split(",").map((s) => s.trim().replace(/['"]/g, "")).filter(Boolean)) {
      exports.push({ name, kind: "export", line: 1 });
    }
  }

  return {
    language: "python",
    confidence: "structural",
    parser: "xr-python-scanner",
    symbols,
    imports,
    exports,
  };
}
