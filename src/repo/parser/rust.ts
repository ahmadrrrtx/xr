/**
 * Structural scanner for Rust.
 */

import { symbolId } from "../hash.ts";
import type { ParsedExport, ParsedImport, ParseResult, RepoSymbol, SymbolKind } from "../types.ts";
import { Scan } from "./scan.ts";

export function parseRust(relativePath: string, source: string): ParseResult {
  const symbols: RepoSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const s = new Scan(source);

  while (!s.eof()) {
    s.skipWs();
    if (s.eof()) break;
    if (s.skipJsComments() || s.skipString()) continue;
    const line = s.line;
    let exported = false;
    let word = s.readIdent();
    if (!word) {
      s.advance();
      continue;
    }
    if (word === "pub") {
      exported = true;
      s.skipWs();
      if (s.peek() === "(") s.skipBalanced("(", ")");
      s.skipWs();
      word = s.readIdent();
    }
    if (!word) continue;

    if (word === "use") {
      const spec = readUse(s);
      if (spec) imports.push({ specifier: spec, names: [], isTypeOnly: false, isReexport: exported, line });
      continue;
    }
    if (word === "fn") {
      s.skipWs();
      const name = s.readIdent();
      s.skipWs();
      if (s.peek() === "<") skipGeneric(s);
      s.skipWs();
      if (s.peek() === "(") s.skipBalanced("(", ")");
      skipUntilBody(s);
      const end = s.peek() === "{" ? s.skipBalanced("{", "}") : line;
      if (name) push(symbols, exports, relativePath, name, "function", line, end, exported);
      continue;
    }
    if (word === "struct" || word === "enum" || word === "trait" || word === "mod") {
      s.skipWs();
      const name = s.readIdent();
      s.skipWs();
      if (s.peek() === "<") skipGeneric(s);
      s.skipWs();
      const end = s.peek() === "{" ? s.skipBalanced("{", "}") : line;
      const kind: SymbolKind = word === "enum" ? "enum" : word === "trait" ? "interface" : word === "mod" ? "module" : "class";
      if (name) push(symbols, exports, relativePath, name, kind, line, end, exported);
      continue;
    }
    if (word === "impl") {
      skipUntilBody(s);
      if (s.peek() === "{") s.skipBalanced("{", "}");
      continue;
    }
    if (word === "const" || word === "static" || word === "type") {
      const name = s.readIdent();
      if (name && exported) push(symbols, exports, relativePath, name, word === "type" ? "type" : "constant", line, line, true);
      skipToSemi(s);
    }
  }

  return {
    language: "rust",
    confidence: "structural",
    parser: "xr-rust-scanner",
    symbols,
    imports,
    exports,
  };
}

function readUse(s: Scan): string | null {
  s.skipWs();
  let spec = "";
  while (!s.eof() && s.peek() !== ";" && s.peek() !== "\n") {
    if (s.skipJsComments()) continue;
    spec += s.advance();
  }
  if (s.peek() === ";") s.advance();
  spec = spec.trim();
  return spec || null;
}

function skipGeneric(s: Scan): void {
  if (s.peek() !== "<") return;
  let depth = 0;
  while (!s.eof()) {
    const c = s.advance();
    if (c === "<") depth += 1;
    else if (c === ">") {
      depth -= 1;
      if (depth === 0) return;
    }
  }
}

function skipUntilBody(s: Scan): void {
  while (!s.eof() && s.peek() !== "{" && s.peek() !== ";") {
    if (s.skipJsComments() || s.skipString()) continue;
    if (s.peek() === "<") {
      skipGeneric(s);
      continue;
    }
    if (s.peek() === "(") {
      s.skipBalanced("(", ")");
      continue;
    }
    s.advance();
  }
}

function skipToSemi(s: Scan): void {
  while (!s.eof() && s.peek() !== ";" && s.peek() !== "{") {
    if (s.skipJsComments() || s.skipString()) continue;
    s.advance();
  }
  if (s.peek() === ";") s.advance();
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
