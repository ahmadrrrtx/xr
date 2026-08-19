/**
 * Structural scanner for Go.
 */

import { symbolId } from "../hash.ts";
import type { ParsedExport, ParsedImport, ParseResult, RepoSymbol, SymbolKind } from "../types.ts";
import { Scan } from "./scan.ts";

export function parseGo(relativePath: string, source: string): ParseResult {
  const symbols: RepoSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const s = new Scan(source);

  while (!s.eof()) {
    s.skipWs();
    if (s.eof()) break;
    if (s.skipJsComments() || s.skipString()) continue;
    const line = s.line;
    const word = s.readIdent();
    if (!word) {
      s.advance();
      continue;
    }
    if (word === "import") {
      s.skipWs();
      if (s.peek() === "(") {
        s.advance();
        while (!s.eof() && s.peek() !== ")") {
          s.skipWs();
          if (s.skipJsComments()) continue;
          const spec = readGoString(s);
          if (spec) imports.push({ specifier: spec, names: [], isTypeOnly: false, isReexport: false, line: s.line });
          else s.advance();
        }
        if (s.peek() === ")") s.advance();
      } else {
        const spec = readGoString(s);
        if (spec) imports.push({ specifier: spec, names: [], isTypeOnly: false, isReexport: false, line });
      }
      continue;
    }
    if (word === "func") {
      s.skipWs();
      let name = "";
      if (s.peek() === "(") {
        s.skipBalanced("(", ")");
        s.skipWs();
      }
      name = s.readIdent() ?? "";
      s.skipWs();
      if (s.peek() === "(") s.skipBalanced("(", ")");
      s.skipWs();
      const end = s.peek() === "{" ? s.skipBalanced("{", "}") : line;
      if (name) {
        const exported = /^[A-Z]/.test(name);
        push(symbols, exports, relativePath, name, "function", line, end, exported);
      }
      continue;
    }
    if (word === "type") {
      s.skipWs();
      const name = s.readIdent();
      s.skipWs();
      const kw = s.readIdent();
      const kind: SymbolKind = kw === "interface" ? "interface" : kw === "struct" ? "class" : "type";
      s.skipWs();
      const end = s.peek() === "{" ? s.skipBalanced("{", "}") : line;
      if (name) {
        const exported = /^[A-Z]/.test(name);
        push(symbols, exports, relativePath, name, kind, line, end, exported);
      }
      continue;
    }
    if (word === "const" || word === "var") {
      s.skipWs();
      if (s.peek() === "(") {
        s.skipBalanced("(", ")");
        continue;
      }
      const name = s.readIdent();
      if (name && /^[A-Z]/.test(name)) {
        push(symbols, exports, relativePath, name, word === "const" ? "constant" : "variable", line, line, true);
      }
    }
  }

  return {
    language: "go",
    confidence: "structural",
    parser: "xr-go-scanner",
    symbols,
    imports,
    exports,
  };
}

function readGoString(s: Scan): string | null {
  s.skipWs();
  if (s.peek() !== "\"" && s.peek() !== "`") {
    // alias then string
    const ident = s.readIdent();
    void ident;
    s.skipWs();
  }
  const q = s.peek();
  if (q !== "\"" && q !== "`") return null;
  s.advance();
  let out = "";
  while (!s.eof() && s.peek() !== q) out += s.advance();
  if (s.peek() === q) s.advance();
  return out;
}

function push(
  symbols: RepoSymbol[],
  exports: ParsedExport[],
  file: string,
  name: string,
  kind: SymbolKind,
  start: number,
  end: number,
  exported: boolean,
): void {
  symbols.push({
    id: symbolId(file, name, kind, start),
    file,
    name,
    kind,
    startLine: start,
    endLine: end,
    signature: name,
    exported,
  });
  if (exported) exports.push({ name, kind, line: start });
}
