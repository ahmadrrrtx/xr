/**
 * XR Phase 11 — token-budgeted repository map.
 *
 * Packs the highest-ranked files and their most relevant symbols into a
 * compact tree. The map is structural context — never implementation bodies.
 * The configured token budget is NEVER exceeded (enforced with
 * `countTokens`, estimator `xr-code-approx-v1`).
 */

import { loadRepoConfig } from "./config.ts";
import { countTokens, TOKEN_ESTIMATOR_ID } from "./tokens.ts";
import type { RankedFile, RepoMapResult, RepoSymbol } from "./types.ts";

export function generateRepoMap(
  ranked: readonly RankedFile[],
  opts: { tokenBudget?: number; query?: string } = {},
): RepoMapResult {
  const started = Date.now();
  const budget = opts.tokenBudget ?? loadRepoConfig().mapTokens;
  const header = opts.query?.trim()
    ? `Repository map (query: ${opts.query.trim().slice(0, 80)}):\n`
    : "Repository map:\n";

  let text = header;
  let tokens = countTokens(text);
  let files = 0;
  let symbols = 0;
  let truncated = false;

  const used = new Set<string>();
  const tree = buildTree(ranked);

  const walk = (node: TreeNode, indent: string): void => {
    if (tokens >= budget) {
      truncated = true;
      return;
    }
    if (node.kind === "dir") {
      const line = `${indent}${node.name}/\n`;
      const cost = countTokens(line);
      if (tokens + cost > budget) {
        truncated = true;
        return;
      }
      text += line;
      tokens += cost;
      for (const child of node.children) walk(child, `${indent}  `);
      return;
    }
    const file = node.file!;
    if (used.has(file.relativePath)) return;
    const fileLine = `${indent}${node.name}\n`;
    const fileCost = countTokens(fileLine);
    if (tokens + fileCost > budget) {
      truncated = true;
      return;
    }
    text += fileLine;
    tokens += fileCost;
    used.add(file.relativePath);
    files += 1;

    const picked = pickSymbols(file.symbols, opts.query, 8);
    for (const sy of picked) {
      const sig = formatSymbol(sy);
      const line = `${indent}  ${sig}\n`;
      const cost = countTokens(line);
      if (tokens + cost > budget) {
        truncated = true;
        return;
      }
      text += line;
      tokens += cost;
      symbols += 1;
    }
  };

  for (const child of tree.children) walk(child, "");

  // Hard guarantee: never emit over-budget text even if a last add raced.
  while (tokens > budget && text.includes("\n")) {
    const cut = text.lastIndexOf("\n", text.length - 2);
    if (cut < header.length) break;
    text = text.slice(0, cut + 1);
    tokens = countTokens(text);
    truncated = true;
  }

  return {
    text: text.trimEnd() + "\n",
    tokens: countTokens(text.trimEnd() + "\n"),
    tokenEstimator: TOKEN_ESTIMATOR_ID,
    files,
    symbols,
    budget,
    truncated,
    durationMs: Date.now() - started,
  };
}

interface TreeNode {
  kind: "dir" | "file";
  name: string;
  children: TreeNode[];
  file?: RankedFile;
}

function buildTree(ranked: readonly RankedFile[]): TreeNode {
  const root: TreeNode = { kind: "dir", name: "", children: [] };
  // Take a generous prefix; the token packer stops at the budget.
  for (const file of ranked.slice(0, 200)) {
    const parts = file.relativePath.split("/").filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]!;
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === name && c.kind === (isFile ? "file" : "dir"));
      if (!child) {
        child = { kind: isFile ? "file" : "dir", name, children: [], ...(isFile ? { file } : {}) };
        node.children.push(child);
      }
      node = child;
    }
  }
  sortTree(root);
  return root;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    if (a.kind === "file" && b.kind === "file") {
      return (b.file?.score ?? 0) - (a.file?.score ?? 0) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
  for (const c of node.children) sortTree(c);
}

function pickSymbols(symbols: readonly RepoSymbol[], query: string | undefined, max: number): RepoSymbol[] {
  const q = (query ?? "").toLowerCase();
  const scored = symbols.map((s) => {
    let n = 0;
    if (s.exported) n += 2;
    if (s.kind === "class" || s.kind === "interface" || s.kind === "function") n += 2;
    if (q && s.name.toLowerCase() === q) n += 8;
    else if (q && s.name.toLowerCase().includes(q)) n += 4;
    return { s, n };
  });
  scored.sort((a, b) => b.n - a.n || a.s.startLine - b.s.startLine);
  const out: RepoSymbol[] = [];
  const seen = new Set<string>();
  for (const { s } of scored) {
    const key = `${s.kind}:${s.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function formatSymbol(s: RepoSymbol): string {
  if (s.kind === "class") return s.name;
  if (s.kind === "interface") return s.name;
  if (s.kind === "function" || s.kind === "method") return `${s.name}()`;
  if (s.kind === "type") return `type ${s.name}`;
  if (s.kind === "enum") return `enum ${s.name}`;
  return s.name;
}
