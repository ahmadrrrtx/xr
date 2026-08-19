/**
 * XR Phase 11 — repo capabilities as CORE TOOLS.
 *
 * The model requests repo_map / repo_search / repo_symbols / repo_dependencies
 * / repo_context / repo_diff through ToolRegistryService. It cannot enable
 * indexing itself as a privilege. Every call is workspace-scoped to ctx.cwd
 * and the active store's workspaceId.
 */

import type { Tool, ToolContext } from "../core/types.ts";
import { readTrustRequest } from "../runtime/trust/tool-support.ts";
import { WorkspaceStore } from "../state/workspace-store.ts";
import { isRepoIntelligenceEnabled, loadRepoConfig } from "./config.ts";
import { createRepoIntelligence } from "./service.ts";

function intel(ctx: ToolContext) {
  const store = WorkspaceStore.lastOpened();
  if (!store) throw new Error("no workspace store is open");
  return createRepoIntelligence({
    workspaceId: store.workspaceId,
    root: ctx.cwd,
    store,
  });
}

function disabled(): { ok: false; output: string } {
  return { ok: false, output: "repository intelligence is disabled (XR_REPO_DISABLED=1)" };
}

export const repoMapTool: Tool = {
  name: "repo_map",
  description: "Return a compact, token-budgeted structural map of the repository ranked for the current task. Structural context only — not file bodies.",
  parameters: { query: "string (optional task / terms)", tokens: "number (optional budget, default 1024)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_map", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const query = String(args.query ?? "");
    const tokens = args.tokens != null ? Number(args.tokens) : loadRepoConfig().mapTokens;
    const map = await intel(ctx).map(query, tokens);
    ctx.audit("repo.map", { files: map.files, symbols: map.symbols, tokens: map.tokens, budget: map.budget });
    return { ok: true, output: map.text, data: { tokens: map.tokens, files: map.files, symbols: map.symbols, estimator: map.tokenEstimator } };
  },
};

export const repoSearchTool: Tool = {
  name: "repo_search",
  description: "Search the repository index for files and symbols matching a query. Workspace-scoped; does not return secrets.",
  parameters: { query: "string (required)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_search", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, output: "query required" };
    const ri = intel(ctx);
    await ri.ensureIndexed();
    const hits = ri.search(query);
    ctx.audit("repo.search", { query, results: hits.length });
    const lines = hits.map((h) =>
      h.kind === "symbol"
        ? `${h.score.toFixed(1)}  ${h.relativePath}:${h.startLine}  ${h.symbolKind} ${h.name}`
        : `${h.score.toFixed(1)}  ${h.relativePath}`,
    );
    return { ok: true, output: lines.join("\n") || "(no matches)", data: { results: hits.length } };
  },
};

export const repoSymbolsTool: Tool = {
  name: "repo_symbols",
  description: "Look up a symbol by exact name in the repository index.",
  parameters: { name: "string (symbol name)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_symbols", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const name = String(args.name ?? "").trim();
    if (!name) return { ok: false, output: "name required" };
    const ri = intel(ctx);
    await ri.ensureIndexed();
    const found = ri.symbols(name);
    ctx.audit("repo.symbols", { name, results: found.length });
    const lines = found.map((s) => `${s.file}:${s.startLine}-${s.endLine}  ${s.kind} ${s.name}${s.exported ? "  export" : ""}`);
    return { ok: true, output: lines.join("\n") || `(no symbol named ${name})`, data: { results: found.length } };
  },
};

export const repoDependenciesTool: Tool = {
  name: "repo_dependencies",
  description: "Show internal/external import edges for a repository file.",
  parameters: { file: "string (relative path)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_dependencies", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const file = String(args.file ?? "").trim();
    if (!file) return { ok: false, output: "file required" };
    const ri = intel(ctx);
    await ri.ensureIndexed();
    const dep = ri.dependencies(file);
    ctx.audit("repo.dependencies", { file, out: dep.outbound.length, in: dep.inbound.length });
    const lines = [
      `outbound (${dep.outbound.length}):`,
      ...dep.outbound.slice(0, 40).map((e) => `  ${e.fromFile} --${e.kind}:${e.edgeType}--> ${e.toFile}  (${e.specifier})`),
      `inbound (${dep.inbound.length}):`,
      ...dep.inbound.slice(0, 40).map((e) => `  ${e.fromFile} --${e.kind}:${e.edgeType}--> ${e.toFile}`),
    ];
    return { ok: true, output: lines.join("\n"), data: { outbound: dep.outbound.length, inbound: dep.inbound.length } };
  },
};

export const repoContextTool: Tool = {
  name: "repo_context",
  description: "Read a relevant SECTION of a repository file (symbol-scoped when possible). Does not dump entire files.",
  parameters: { file: "string (relative path)", symbol: "string (optional symbol name)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_context", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const file = String(args.file ?? "").trim();
    if (!file) return { ok: false, output: "file required" };
    const ri = intel(ctx);
    await ri.ensureIndexed();
    const section = ri.fileContext(file, { symbol: args.symbol ? String(args.symbol) : undefined });
    if (!section) return { ok: false, output: `not in index or unreadable: ${file}` };
    ctx.audit("repo.context", { file, start: section.startLine, end: section.endLine });
    return {
      ok: true,
      output: `${section.relativePath}:${section.startLine}-${section.endLine} (${section.reason})\n${section.text}`,
      data: { startLine: section.startLine, endLine: section.endLine },
    };
  },
};

export const repoDiffTool: Tool = {
  name: "repo_diff",
  description: "Return the real git diff for the workspace (or one file). Uses git, not timestamps.",
  parameters: { file: "string (optional relative path)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("repo_diff", ctx.cwd),
  async run(args, ctx) {
    if (!isRepoIntelligenceEnabled()) return disabled();
    const file = args.file ? String(args.file) : undefined;
    const hunks = await intel(ctx).diff(file);
    ctx.audit("repo.diff", { file: file ?? "*", hunks: hunks.length });
    if (!hunks.length) return { ok: true, output: "(no unstaged diff)", data: { hunks: 0 } };
    const lines = hunks.map((h) => `${h.relativePath}  ${h.status}  +${h.additions} -${h.deletions}\n${h.patch}`);
    return { ok: true, output: lines.join("\n\n").slice(0, 12_000), data: { hunks: hunks.length } };
  },
};

export const REPO_TOOLS: Tool[] = [
  repoMapTool,
  repoSearchTool,
  repoSymbolsTool,
  repoDependenciesTool,
  repoContextTool,
  repoDiffTool,
];
