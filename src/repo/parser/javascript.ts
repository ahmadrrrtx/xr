/**
 * Structural scanner for JavaScript / TypeScript / JSX / TSX.
 *
 * Extracts imports, exports, functions, classes, interfaces, types, enums,
 * and exported constants. This is a deterministic scanner — not an AST —
 * and is labeled `structural`. Unusual syntax may be missed; we do not invent
 * nodes we cannot see.
 */

import { symbolId } from "../hash.ts";
import type { ParsedExport, ParsedImport, ParseResult, RepoSymbol, SymbolKind } from "../types.ts";
import { Scan } from "./scan.ts";

const KEYWORDS = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default",
  "delete", "do", "else", "enum", "export", "extends", "false", "finally",
  "for", "function", "if", "import", "in", "instanceof", "let", "new", "null",
  "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var",
  "void", "while", "with", "yield", "await", "async", "from", "as", "of",
  "type", "interface", "implements", "package", "private", "protected",
  "public", "static", "readonly", "abstract", "declare", "namespace", "module",
]);

export function parseJavaScript(relativePath: string, source: string, language: string): ParseResult {
  const symbols: RepoSymbol[] = [];
  const imports: ParsedImport[] = [];
  const exports: ParsedExport[] = [];
  const s = new Scan(source);

  while (!s.eof()) {
    s.skipWs();
    if (s.eof()) break;
    if (s.skipJsComments()) continue;
    if (s.skipString()) continue;

    const start = s.i;
    const line = s.line;
    const word = s.readIdent();
    if (!word) {
      s.advance();
      continue;
    }

    if (word === "import") {
      parseImport(s, line, imports, false);
      continue;
    }
    if (word === "export") {
      parseExport(s, relativePath, line, symbols, imports, exports);
      continue;
    }
    if (word === "async") {
      s.skipWs();
      if (s.skipJsComments()) s.skipWs();
      const next = s.readIdent();
      if (next === "function") takeFunction(s, relativePath, symbols, false, line);
      continue;
    }
    if (word === "function") {
      takeFunction(s, relativePath, symbols, false, line);
      continue;
    }
    if (word === "class") {
      takeClassLike(s, relativePath, symbols, "class", false, line);
      continue;
    }
    if (word === "interface") {
      takeClassLike(s, relativePath, symbols, "interface", false, line);
      continue;
    }
    if (word === "type") {
      takeTypeAlias(s, relativePath, symbols, false, line);
      continue;
    }
    if (word === "enum") {
      takeClassLike(s, relativePath, symbols, "enum", false, line);
      continue;
    }
    if (word === "const" || word === "let" || word === "var") {
      takeBinding(s, relativePath, symbols, word === "const" ? "constant" : "variable", false, line);
      continue;
    }
    if (word === "namespace" || word === "module") {
      takeClassLike(s, relativePath, symbols, "namespace", false, line);
      continue;
    }

    // Rewind if the ident was a keyword we don't handle — already consumed.
    void start;
    void KEYWORDS;
  }

  return {
    language,
    confidence: "structural",
    parser: "xr-js-scanner",
    symbols,
    imports,
    exports,
  };
}

function parseImport(s: Scan, line: number, imports: ParsedImport[], isReexport: boolean): void {
  s.skipWs();
  if (s.skipJsComments()) s.skipWs();
  const names: string[] = [];
  let isTypeOnly = false;
  if (s.startsWith("type") && isBoundary(s, 4)) {
    s.i += 4;
    isTypeOnly = true;
    s.skipWs();
  }
  if (s.peek() === "*" ) {
    s.advance();
    s.skipWs();
    if (s.startsWith("as")) {
      s.i += 2;
      s.skipWs();
      const alias = s.readIdent();
      if (alias) names.push(alias);
    } else {
      names.push("*");
    }
  } else if (s.peek() === "{") {
    readNamedList(s, names);
  } else {
    const def = s.readIdent();
    if (def && def !== "from") names.push(def);
    s.skipWs();
    if (s.peek() === ",") {
      s.advance();
      s.skipWs();
      if (s.peek() === "{") readNamedList(s, names);
    }
  }
  s.skipWs();
  if (s.startsWith("from")) s.i += 4;
  s.skipWs();
  const spec = readSpecifier(s);
  if (spec) imports.push({ specifier: spec, names, isTypeOnly, isReexport, line });
  skipToSemiOrNl(s);
}

function parseExport(
  s: Scan,
  file: string,
  line: number,
  symbols: RepoSymbol[],
  imports: ParsedImport[],
  exports: ParsedExport[],
): void {
  s.skipWs();
  if (s.skipJsComments()) s.skipWs();
  if (s.startsWith("type") && isBoundary(s, 4)) {
    s.i += 4;
    s.skipWs();
    if (s.peek() === "{") {
      const names: string[] = [];
      readNamedList(s, names);
      s.skipWs();
      if (s.startsWith("from")) {
        s.i += 4;
        s.skipWs();
        const spec = readSpecifier(s);
        if (spec) imports.push({ specifier: spec, names, isTypeOnly: true, isReexport: true, line });
      }
      for (const n of names) exports.push({ name: n, kind: "type", line });
      skipToSemiOrNl(s);
      return;
    }
    takeTypeAlias(s, file, symbols, true, line);
    return;
  }
  if (s.peek() === "{") {
    const names: string[] = [];
    readNamedList(s, names);
    s.skipWs();
    if (s.startsWith("from")) {
      s.i += 4;
      s.skipWs();
      const spec = readSpecifier(s);
      if (spec) imports.push({ specifier: spec, names, isTypeOnly: false, isReexport: true, line });
    }
    for (const n of names) {
      exports.push({ name: n, kind: "export", line });
      pushSymbol(symbols, file, n, "export", line, line, true, n);
    }
    skipToSemiOrNl(s);
    return;
  }
  if (s.peek() === "*") {
    s.advance();
    s.skipWs();
    let alias: string | null = null;
    if (s.startsWith("as")) {
      s.i += 2;
      s.skipWs();
      alias = s.readIdent();
    }
    s.skipWs();
    if (s.startsWith("from")) {
      s.i += 4;
      s.skipWs();
      const spec = readSpecifier(s);
      if (spec) imports.push({ specifier: spec, names: alias ? [alias] : ["*"], isTypeOnly: false, isReexport: true, line });
    }
    skipToSemiOrNl(s);
    return;
  }
  if (s.startsWith("default")) {
    s.i += 7;
    s.skipWs();
    const next = s.readIdent();
    if (next === "async") {
      s.skipWs();
      const fn = s.readIdent();
      if (fn === "function") takeFunction(s, file, symbols, true, line, "default");
    } else if (next === "function") {
      takeFunction(s, file, symbols, true, line, "default");
    } else if (next === "class") {
      takeClassLike(s, file, symbols, "class", true, line, "default");
    } else if (next) {
      pushSymbol(symbols, file, next, "export", line, line, true, next);
      exports.push({ name: "default", kind: "export", line });
    } else {
      pushSymbol(symbols, file, "default", "export", line, line, true, "default");
      exports.push({ name: "default", kind: "export", line });
    }
    return;
  }
  const next = s.readIdent();
  if (next === "async") {
    s.skipWs();
    const fn = s.readIdent();
    if (fn === "function") takeFunction(s, file, symbols, true, line);
    return;
  }
  if (next === "function") {
    takeFunction(s, file, symbols, true, line);
    return;
  }
  if (next === "class") {
    takeClassLike(s, file, symbols, "class", true, line);
    return;
  }
  if (next === "interface") {
    takeClassLike(s, file, symbols, "interface", true, line);
    return;
  }
  if (next === "enum") {
    takeClassLike(s, file, symbols, "enum", true, line);
    return;
  }
  if (next === "const" || next === "let" || next === "var") {
    takeBinding(s, file, symbols, next === "const" ? "constant" : "variable", true, line);
    return;
  }
  if (next === "namespace" || next === "module") {
    takeClassLike(s, file, symbols, "namespace", true, line);
    return;
  }
}

function takeFunction(s: Scan, file: string, symbols: RepoSymbol[], exported: boolean, line: number, forcedName?: string): void {
  s.skipWs();
  if (s.peek() === "*") s.advance();
  s.skipWs();
  const name = forcedName ?? s.readIdent() ?? "anonymous";
  s.skipWs();
  // generics
  if (s.peek() === "<") skipAngles(s);
  s.skipWs();
  const sigStart = s.i;
  if (s.peek() === "(") s.skipBalanced("(", ")");
  s.skipWs();
  if (s.peek() === ":") {
    s.advance();
    skipType(s);
  }
  s.skipWs();
  const end = s.peek() === "{" ? s.skipBalanced("{", "}") : line;
  const sig = s.src.slice(sigStart, Math.min(s.i, sigStart + 160)).replace(/\s+/g, " ").trim();
  pushSymbol(symbols, file, name, "function", line, end, exported, sig || name);
}

function takeClassLike(
  s: Scan,
  file: string,
  symbols: RepoSymbol[],
  kind: SymbolKind,
  exported: boolean,
  line: number,
  forcedName?: string,
): void {
  s.skipWs();
  const name = forcedName ?? s.readIdent() ?? "anonymous";
  s.skipWs();
  if (s.peek() === "<") skipAngles(s);
  // skip heritage
  while (!s.eof() && s.peek() !== "{" && s.peek() !== ";" && s.peek() !== "\n") {
    if (s.skipJsComments() || s.skipString()) continue;
    s.advance();
  }
  const end = s.peek() === "{" ? takeClassBody(s, file, symbols, name) : line;
  pushSymbol(symbols, file, name, kind, line, end, exported, name);
}

function takeClassBody(s: Scan, file: string, symbols: RepoSymbol[], owner: string): number {
  if (s.peek() !== "{") return s.line;
  s.advance();
  let depth = 1;
  while (!s.eof() && depth > 0) {
    s.skipWs();
    if (s.skipJsComments() || s.skipString()) continue;
    if (s.peek() === "{") {
      depth += 1;
      s.advance();
      continue;
    }
    if (s.peek() === "}") {
      depth -= 1;
      s.advance();
      continue;
    }
    if (depth !== 1) {
      s.advance();
      continue;
    }
    const line = s.line;
    // modifiers
    let ident = s.readIdent();
    while (ident && (ident === "public" || ident === "private" || ident === "protected" || ident === "static" || ident === "async" || ident === "readonly" || ident === "abstract" || ident === "override" || ident === "get" || ident === "set")) {
      s.skipWs();
      ident = s.readIdent();
    }
    if (!ident || ident === "constructor") {
      if (ident === "constructor") {
        s.skipWs();
        if (s.peek() === "(") s.skipBalanced("(", ")");
        s.skipWs();
        if (s.peek() === "{") s.skipBalanced("{", "}");
        pushSymbol(symbols, file, "constructor", "method", line, s.line, false, `${owner}.constructor`);
      }
      continue;
    }
    s.skipWs();
    if (s.peek() === "<") skipAngles(s);
    s.skipWs();
    if (s.peek() === "(") {
      s.skipBalanced("(", ")");
      s.skipWs();
      if (s.peek() === ":") {
        s.advance();
        skipType(s);
      }
      s.skipWs();
      if (s.peek() === "{") s.skipBalanced("{", "}");
      else skipToSemiOrNl(s);
      pushSymbol(symbols, file, ident, "method", line, s.line, false, `${owner}.${ident}()`);
      continue;
    }
    if (s.peek() === "=" || s.peek() === ":" || s.peek() === ";" || s.peek() === "!") {
      skipToSemiOrNl(s);
      continue;
    }
  }
  return s.line;
}

function takeTypeAlias(s: Scan, file: string, symbols: RepoSymbol[], exported: boolean, line: number): void {
  s.skipWs();
  const name = s.readIdent();
  if (!name) return;
  s.skipWs();
  if (s.peek() === "<") skipAngles(s);
  skipToSemiOrNl(s);
  pushSymbol(symbols, file, name, "type", line, s.line, exported, name);
}

function takeBinding(s: Scan, file: string, symbols: RepoSymbol[], kind: SymbolKind, exported: boolean, line: number): void {
  s.skipWs();
  if (s.peek() === "{") {
    // destructure — skip, not a reliable symbol
    s.skipBalanced("{", "}");
    skipToSemiOrNl(s);
    return;
  }
  const name = s.readIdent();
  if (!name) {
    skipToSemiOrNl(s);
    return;
  }
  // look ahead for function-ish `const x = (` or `const x = async`
  let end = line;
  s.skipWs();
  if (s.peek() === ":") {
    s.advance();
    skipType(s);
    s.skipWs();
  }
  if (s.peek() === "=") {
    s.advance();
    s.skipWs();
    if (s.startsWith("async")) {
      s.i += 5;
      s.skipWs();
    }
    if (s.peek() === "(" || s.startsWith("function")) {
      if (s.startsWith("function")) {
        s.i += 8;
        s.skipWs();
      }
      if (s.peek() === "(") s.skipBalanced("(", ")");
      s.skipWs();
      if (s.peek() === ":") {
        s.advance();
        skipType(s);
      }
      s.skipWs();
      if (s.startsWith("=>")) s.i += 2;
      s.skipWs();
      end = s.peek() === "{" ? s.skipBalanced("{", "}") : s.line;
      pushSymbol(symbols, file, name, "function", line, end, exported, name);
      return;
    }
  }
  skipToSemiOrNl(s);
  pushSymbol(symbols, file, name, kind, line, s.line, exported, name);
}

function readNamedList(s: Scan, names: string[]): void {
  if (s.peek() !== "{") return;
  s.advance();
  while (!s.eof() && s.peek() !== "}") {
    s.skipWs();
    if (s.skipJsComments()) continue;
    if (s.startsWith("type") && isBoundary(s, 4)) s.i += 4;
    s.skipWs();
    const n = s.readIdent();
    if (n) {
      s.skipWs();
      if (s.startsWith("as")) {
        s.i += 2;
        s.skipWs();
        const alias = s.readIdent();
        names.push(alias || n);
      } else {
        names.push(n);
      }
    }
    while (!s.eof() && s.peek() !== "," && s.peek() !== "}") s.advance();
    if (s.peek() === ",") s.advance();
  }
  if (s.peek() === "}") s.advance();
}

function readSpecifier(s: Scan): string | null {
  s.skipWs();
  const q = s.peek();
  if (q !== "'" && q !== "\"") return null;
  s.advance();
  let out = "";
  while (!s.eof() && s.peek() !== q) out += s.advance();
  if (s.peek() === q) s.advance();
  return out;
}

function skipToSemiOrNl(s: Scan): void {
  while (!s.eof()) {
    if (s.skipJsComments() || s.skipString()) continue;
    const c = s.peek();
    if (c === ";") {
      s.advance();
      return;
    }
    if (c === "\n" || c === "}") return;
    if (c === "{") {
      s.skipBalanced("{", "}");
      return;
    }
    s.advance();
  }
}

function skipAngles(s: Scan): void {
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

function skipType(s: Scan): void {
  let depth = 0;
  while (!s.eof()) {
    if (s.skipJsComments() || s.skipString()) continue;
    const c = s.peek();
    // `{` after a return type is almost always the function/method body.
    // Object type literals are skipped rather than swallowed as a body.
    if (c === "{" || c === "=" || c === ";" || c === "," || c === ")" || c === "\n") return;
    if (c === "(" || c === "[") {
      s.skipBalanced(c, c === "(" ? ")" : "]");
      continue;
    }
    if (c === "<") {
      skipAngles(s);
      continue;
    }
    if (c === ">" && depth === 0) return;
    s.advance();
  }
}

function isBoundary(s: Scan, len: number): boolean {
  const next = s.src[s.i + len] ?? "";
  return !/[A-Za-z0-9_$]/.test(next);
}

function pushSymbol(
  symbols: RepoSymbol[],
  file: string,
  name: string,
  kind: SymbolKind,
  startLine: number,
  endLine: number,
  exported: boolean,
  signature: string,
): void {
  if (!name || name === "anonymous") return;
  symbols.push({
    id: symbolId(file, name, kind, startLine),
    file,
    name,
    kind,
    startLine,
    endLine: Math.max(endLine, startLine),
    signature,
    exported,
  });
}
