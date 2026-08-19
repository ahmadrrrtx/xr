/**
 * XR Phase 11 — parser dispatcher.
 *
 * Optional tree-sitter: if `web-tree-sitter` or `tree-sitter` can be loaded
 * we would prefer it (confidence: ast). XR does not ship those packages.
 * The probe is best-effort and never throws.
 */

import { languageForPath } from "../languages.ts";
import type { ParseResult } from "../types.ts";
import { parseFallback } from "./fallback.ts";
import { parseGo } from "./go.ts";
import { parseJavaScript } from "./javascript.ts";
import { parsePython } from "./python.ts";
import { parseRust } from "./rust.ts";

let treeSitterProbed = false;
let treeSitterAvailable = false;

export function treeSitterStatus(): { available: boolean; probed: boolean } {
  if (!treeSitterProbed) {
    treeSitterProbed = true;
    treeSitterAvailable = false;
    // Optional dependency — XR does not install tree-sitter. A future
    // operator may add it; we refuse to pretend it is present.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const resolved = (import.meta as { resolve?: (s: string) => string }).resolve;
      void resolved;
    } catch {
      treeSitterAvailable = false;
    }
  }
  return { available: treeSitterAvailable, probed: treeSitterProbed };
}

export function parseSource(relativePath: string, source: string): ParseResult {
  const spec = languageForPath(relativePath);
  if (!spec) {
    return {
      language: "unknown",
      confidence: "none",
      parser: "none",
      symbols: [],
      imports: [],
      exports: [],
    };
  }
  try {
    switch (spec.parser) {
      case "javascript":
        return parseJavaScript(relativePath, source, spec.id);
      case "python":
        return parsePython(relativePath, source);
      case "go":
        return parseGo(relativePath, source);
      case "rust":
        return parseRust(relativePath, source);
      default:
        return parseFallback(relativePath, source, spec.id);
    }
  } catch {
    return parseFallback(relativePath, source, spec.id);
  }
}

export { parseJavaScript, parsePython, parseGo, parseRust, parseFallback };
