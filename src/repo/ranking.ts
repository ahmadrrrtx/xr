/**
 * XR Phase 11 — deterministic ranking.
 *
 * First ranking layer is never an LLM. Score is a transparent sum of
 * named signals. Graph popularity is capped so a high-degree file cannot
 * dominate a task-specific match.
 */

import { tokenizeQuery } from "./tokens.ts";
import type { GitFileStatus, RankedFile, RankingSignals, RepoEdge, RepoFile, RepoSymbol } from "./types.ts";

export interface RankInput {
  query: string;
  files: readonly RepoFile[];
  symbols: readonly RepoSymbol[];
  edges: readonly RepoEdge[];
  git?: ReadonlyMap<string, GitFileStatus>;
}

const WEIGHTS = {
  lexical: 4.0,
  symbol: 6.0,
  path: 2.2,
  dependency: 1.6,
  graph: 1.0,
  git: 1.1,
  task: 1.4,
};

export function rankFiles(input: RankInput): RankedFile[] {
  const terms = tokenizeQuery(input.query);
  const symbolsByFile = groupSymbols(input.symbols);
  const graph = pageRank(input.files, input.edges, terms, symbolsByFile);
  const internalNeighbors = adjacency(input.edges);

  const seed = new Set<string>();
  for (const f of input.files) {
    if (fileLexical(f.relativePath, symbolsByFile.get(f.relativePath) ?? [], terms) > 0) {
      seed.add(f.relativePath);
    }
  }

  const out: RankedFile[] = [];
  for (const f of input.files) {
    const syms = symbolsByFile.get(f.relativePath) ?? [];
    const lexical = fileLexical(f.relativePath, syms, terms);
    const symbol = symbolScore(syms, terms);
    const path = pathScore(f.relativePath, terms);
    const dependency = dependencyScore(f.relativePath, seed, internalNeighbors);
    const graphScore = Math.min(graph.get(f.relativePath) ?? 0, 0.35);
    const git = gitScore(input.git?.get(f.relativePath) ?? f.gitStatus);
    const task = lexical > 0 ? 0.4 : 0;
    const signals: RankingSignals = { lexical, symbol, path, dependency, graph: graphScore, git, task };
    const score =
      signals.lexical * WEIGHTS.lexical +
      signals.symbol * WEIGHTS.symbol +
      signals.path * WEIGHTS.path +
      signals.dependency * WEIGHTS.dependency +
      signals.graph * WEIGHTS.graph +
      signals.git * WEIGHTS.git +
      signals.task * WEIGHTS.task;
    out.push({
      relativePath: f.relativePath,
      language: f.language,
      score,
      signals,
      symbols: [...syms].sort((a, b) => a.startLine - b.startLine),
      gitStatus: input.git?.get(f.relativePath) ?? f.gitStatus,
    });
  }

  out.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath));
  return out;
}

function groupSymbols(symbols: readonly RepoSymbol[]): Map<string, RepoSymbol[]> {
  const m = new Map<string, RepoSymbol[]>();
  for (const s of symbols) {
    const arr = m.get(s.file) ?? [];
    arr.push(s);
    m.set(s.file, arr);
  }
  return m;
}

function fileLexical(path: string, symbols: readonly RepoSymbol[], terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const hay = `${path} ${symbols.map((s) => s.name).join(" ")}`.toLowerCase();
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits += 1;
  return hits / terms.length;
}

function symbolScore(symbols: readonly RepoSymbol[], terms: readonly string[]): number {
  if (terms.length === 0 || symbols.length === 0) return 0;
  let best = 0;
  for (const s of symbols) {
    const n = s.name.toLowerCase();
    for (const t of terms) {
      if (n === t) best = Math.max(best, 1);
      else if (n.includes(t) && t.length >= 3) best = Math.max(best, 0.55);
    }
  }
  return best;
}

function pathScore(path: string, terms: readonly string[]): number {
  if (terms.length === 0) return 0;
  const parts = path.toLowerCase().split("/");
  let hits = 0;
  for (const t of terms) if (parts.some((p) => p.includes(t))) hits += 1;
  return hits / terms.length;
}

function dependencyScore(
  file: string,
  seed: ReadonlySet<string>,
  neighbors: Map<string, Set<string>>,
): number {
  if (seed.has(file)) return 0.5;
  const n = neighbors.get(file);
  if (!n) return 0;
  for (const other of n) if (seed.has(other)) return 0.85;
  return 0;
}

function gitScore(status: GitFileStatus): number {
  switch (status) {
    case "modified":
    case "added":
    case "renamed":
      return 0.55;
    case "untracked":
      return 0.25;
    default:
      return 0;
  }
}

function adjacency(edges: readonly RepoEdge[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    const s = m.get(a) ?? new Set();
    s.add(b);
    m.set(a, s);
  };
  for (const e of edges) {
    if (e.kind !== "internal") continue;
    add(e.fromFile, e.toFile);
    add(e.toFile, e.fromFile);
  }
  return m;
}

/**
 * Personalized PageRank. Restart mass is biased toward files whose path or
 * symbols match the query. Without a query the restart is uniform.
 */
export function pageRank(
  files: readonly RepoFile[],
  edges: readonly RepoEdge[],
  terms: readonly string[],
  symbolsByFile: Map<string, RepoSymbol[]>,
  iterations = 16,
  damping = 0.85,
): Map<string, number> {
  const nodes = files.map((f) => f.relativePath);
  const n = nodes.length;
  const rank = new Map<string, number>();
  const personal = new Map<string, number>();
  if (n === 0) return rank;

  let personalSum = 0;
  for (const f of files) {
    const lex = fileLexical(f.relativePath, symbolsByFile.get(f.relativePath) ?? [], terms);
    const p = terms.length === 0 ? 1 : 0.15 + lex;
    personal.set(f.relativePath, p);
    personalSum += p;
    rank.set(f.relativePath, 1 / n);
  }
  for (const [k, v] of personal) personal.set(k, v / (personalSum || 1));

  const inbound = new Map<string, string[]>();
  const outCount = new Map<string, number>();
  for (const node of nodes) {
    inbound.set(node, []);
    outCount.set(node, 0);
  }
  for (const e of edges) {
    if (e.kind !== "internal") continue;
    if (!outCount.has(e.fromFile) || !inbound.has(e.toFile)) continue;
    inbound.get(e.toFile)!.push(e.fromFile);
    outCount.set(e.fromFile, (outCount.get(e.fromFile) ?? 0) + 1);
  }

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Map<string, number>();
    for (const node of nodes) {
      let sum = 0;
      for (const src of inbound.get(node) ?? []) {
        const o = outCount.get(src) || 1;
        sum += (rank.get(src) ?? 0) / o;
      }
      next.set(node, (1 - damping) * (personal.get(node) ?? 1 / n) + damping * sum);
    }
    for (const node of nodes) rank.set(node, next.get(node) ?? 0);
  }

  let max = 0;
  for (const v of rank.values()) if (v > max) max = v;
  if (max > 0) for (const [k, v] of rank) rank.set(k, v / max);
  return rank;
}
