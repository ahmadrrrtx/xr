/**
 * XR Phase 11 — language registry.
 *
 * Support is whatever we actually parse. This file is the expansion point:
 * add an extension → language mapping and a parser id. Do not claim a
 * language here unless a parser emits symbols for it.
 */

export interface LanguageSpec {
  id: string;
  extensions: readonly string[];
  /** First-party scanner module id (see parser/registry.ts). */
  parser: "javascript" | "python" | "go" | "rust" | "fallback";
  structural: boolean;
}

export const LANGUAGES: readonly LanguageSpec[] = [
  { id: "typescript", extensions: [".ts", ".mts", ".cts"], parser: "javascript", structural: true },
  { id: "tsx", extensions: [".tsx"], parser: "javascript", structural: true },
  { id: "javascript", extensions: [".js", ".mjs", ".cjs"], parser: "javascript", structural: true },
  { id: "jsx", extensions: [".jsx"], parser: "javascript", structural: true },
  { id: "python", extensions: [".py", ".pyi"], parser: "python", structural: true },
  { id: "go", extensions: [".go"], parser: "go", structural: true },
  { id: "rust", extensions: [".rs"], parser: "rust", structural: true },
  { id: "java", extensions: [".java"], parser: "fallback", structural: false },
  { id: "c", extensions: [".c", ".h"], parser: "fallback", structural: false },
  { id: "cpp", extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh"], parser: "fallback", structural: false },
  { id: "csharp", extensions: [".cs"], parser: "fallback", structural: false },
  { id: "php", extensions: [".php"], parser: "fallback", structural: false },
  { id: "ruby", extensions: [".rb"], parser: "fallback", structural: false },
  { id: "kotlin", extensions: [".kt", ".kts"], parser: "fallback", structural: false },
  { id: "swift", extensions: [".swift"], parser: "fallback", structural: false },
];

const BY_EXT = new Map<string, LanguageSpec>();
for (const spec of LANGUAGES) {
  for (const ext of spec.extensions) BY_EXT.set(ext, spec);
}

export function languageForPath(relativePath: string): LanguageSpec | null {
  const lower = relativePath.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return BY_EXT.get(lower.slice(dot)) ?? null;
}

export function isIndexableSource(relativePath: string): boolean {
  return languageForPath(relativePath) !== null;
}

export function supportedLanguageIds(): string[] {
  return [...new Set(LANGUAGES.map((l) => l.id))];
}

export function structuralLanguageIds(): string[] {
  return LANGUAGES.filter((l) => l.structural).map((l) => l.id);
}
