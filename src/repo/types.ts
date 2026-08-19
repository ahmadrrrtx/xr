/**
 * XR Phase 11 — Repository Intelligence domain model.
 *
 * Structural facts about a workspace-scoped repository. Nothing here is
 * authority, memory, or research evidence. Parser output is labeled with an
 * honest confidence so callers never treat a heuristic as an AST.
 */

export const REPO_INDEX_VERSION = 1;
export const REPO_PARSER_VERSION = 1;

export const REPO_INDEX_STATES = ["not_indexed", "indexing", "ready", "failed"] as const;
export type RepoIndexState = (typeof REPO_INDEX_STATES)[number];

export const PARSER_CONFIDENCES = ["ast", "structural", "heuristic", "none"] as const;
export type ParserConfidence = (typeof PARSER_CONFIDENCES)[number];

export const SYMBOL_KINDS = [
  "function",
  "method",
  "class",
  "interface",
  "type",
  "enum",
  "constant",
  "variable",
  "module",
  "namespace",
  "export",
] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];

export const EDGE_TYPES = [
  "imports",
  "exports",
  "reexports",
  "references",
  "extends",
  "implements",
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

export const DEPENDENCY_KINDS = ["internal", "external", "unresolved"] as const;
export type DependencyKind = (typeof DEPENDENCY_KINDS)[number];

export const GIT_STATUSES = [
  "clean",
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
  "ignored",
  "unknown",
] as const;
export type GitFileStatus = (typeof GIT_STATUSES)[number];

export interface RepositoryInfo {
  repositoryId: string;
  workspaceId: string;
  root: string;
  gitRoot: string | null;
  indexedAt: number;
  indexVersion: number;
  parserVersion: number;
  state: RepoIndexState;
}

export interface RepoFile {
  path: string;
  relativePath: string;
  contentHash: string;
  size: number;
  language: string | null;
  gitStatus: GitFileStatus;
  lastIndexed: number;
  parserConfidence: ParserConfidence;
}

export interface RepoSymbol {
  id: string;
  file: string;
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string | null;
  exported: boolean;
}

export interface RepoEdge {
  fromFile: string;
  toFile: string;
  edgeType: EdgeType;
  symbol: string | null;
  kind: DependencyKind;
  specifier: string;
}

export interface ParsedImport {
  specifier: string;
  names: string[];
  isTypeOnly: boolean;
  isReexport: boolean;
  line: number;
}

export interface ParsedExport {
  name: string;
  kind: SymbolKind;
  line: number;
}

export interface ParseResult {
  language: string;
  confidence: ParserConfidence;
  parser: string;
  symbols: RepoSymbol[];
  imports: ParsedImport[];
  exports: ParsedExport[];
}

export interface RankedFile {
  relativePath: string;
  language: string | null;
  score: number;
  signals: RankingSignals;
  symbols: RepoSymbol[];
  gitStatus: GitFileStatus;
}

export interface RankingSignals {
  lexical: number;
  symbol: number;
  path: number;
  dependency: number;
  graph: number;
  git: number;
  task: number;
}

export interface RepoMapOptions {
  workspaceId: string;
  root: string;
  query?: string;
  tokenBudget?: number;
  now?: number;
}

export interface RepoMapResult {
  text: string;
  tokens: number;
  tokenEstimator: "xr-code-approx-v1";
  files: number;
  symbols: number;
  budget: number;
  truncated: boolean;
  durationMs: number;
}

export interface RepoSearchHit {
  relativePath: string;
  kind: "file" | "symbol";
  name: string;
  symbolKind?: SymbolKind;
  startLine?: number;
  endLine?: number;
  score: number;
  snippet?: string;
}

export interface IndexStats {
  state: RepoIndexState;
  files: number;
  symbols: number;
  edges: number;
  changedFiles: number;
  deletedFiles: number;
  cacheHits: number;
  cacheMisses: number;
  errors: number;
  durationMs: number;
  error?: string;
}

export interface RepoFileContext {
  relativePath: string;
  language: string | null;
  startLine: number;
  endLine: number;
  text: string;
  symbols: RepoSymbol[];
  reason: string;
}

export interface RepoDiffHunk {
  relativePath: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
  patch: string;
}
