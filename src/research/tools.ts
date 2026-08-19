/**
 * XR Phase 10 — research capabilities as CORE TOOLS.
 *
 * The model requests `research_search` / `research_scrape` / `research_crawl`
 * / `research_map` / `research_extract` through the unified
 * ToolRegistryService — it does NOT enable Firecrawl itself. Every call flows
 * through the same provider pool, budget, egress allowlist, SSRF guard and
 * audit as the CLI/API surfaces (one execution path).
 *
 * The tools are synchronous from the caller's perspective (they await the
 * operation); crawl obeys the same bounded limits, so a tool crawl can never
 * run away. Jobs created by tool calls are in-memory (not persisted to the
 * workspace store — the tool context carries no store handle).
 */

import type { Tool, ToolContext } from "../core/types.ts";
import { loadConfig } from "../config/config.ts";
import { networkTrustRequest } from "../runtime/trust/tool-support.ts";
import type { ResearchJob, ResearchLimits, ResearchRequest } from "./provider-types.ts";
import { buildResearchPool, researchLimitsFromConfig } from "./factory.ts";
import { ResearchJobRegistry } from "./jobs.ts";
import { runResearchOperation } from "./runner.ts";

interface ToolDeps {
  pool: ReturnType<typeof buildResearchPool>["pool"];
  limits: ResearchLimits;
}

function depsFor(_ctx: ToolContext): ToolDeps {
  const { config } = loadConfig();
  const { pool } = buildResearchPool(config);
  const limits = researchLimitsFromConfig(config);
  return { pool, limits };
}

/** Compact, truthful summary of a finished job for the model. */
function summarize(job: ResearchJob): string {
  const header = job.state === "partial"
    ? `Research partially completed (${job.sources.length} source(s) retrieved; some failed).`
    : job.state === "budget_exhausted"
      ? `Research stopped: ${job.progress.message ?? "budget exhausted"} — ${job.sources.length} source(s) retrieved so far.`
      : job.state === "failed"
        ? `Research failed: ${job.error ?? "unknown error"}.`
        : `Research ${job.kind} completed with ${job.sources.length} source(s).`;

  const lines: string[] = [header];
  for (const s of job.sources.slice(0, 12)) {
    lines.push(`[${s.sourceId}] ${s.title ?? s.url} — ${s.url}`);
  }
  if (job.result && job.kind === "extract") {
    try {
      lines.push("data: " + JSON.stringify((job.result as { data?: unknown }).data).slice(0, 2000));
    } catch {
      /* ignore */
    }
  }
  if (job.citations.length) {
    lines.push(`citations: ${job.citations.map((c) => c.id).join(", ")}`);
  }
  return lines.join("\n");
}

async function run(args: Record<string, unknown>, ctx: ToolContext, request: Omit<ResearchRequest, "source">): Promise<{ ok: boolean; output: string; data?: unknown }> {
  const { pool, limits } = depsFor(ctx);
  const registry = new ResearchJobRegistry(null, "tool");
  const job = await runResearchOperation(
    {
      pool,
      registry,
      egressAllowlist: ctx.egressAllowlist ?? [],
      allowedHosts: ctx.allowedHosts,
      audit: (event, detail) => ctx.audit(event, detail),
    },
    { ...request, limits: request.limits ?? limits, source: "tool" },
  );
  const ok = job.state === "completed" || job.state === "partial";
  return { ok, output: summarize(job), data: job.result };
}

export const researchSearchTool: Tool = {
  name: "research_search",
  description: "Search the web through XR's research providers (SearXNG / Firecrawl) and return normalized, cited sources. Egress- and SSRF-gated.",
  parameters: { query: "string (search query)", max_results: "number (optional)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => networkTrustRequest("research_search", ctx.cwd, ["web-search"]),
  run: async (args, ctx) => run(args, ctx, { intent: "search", query: String(args.query ?? "") }),
};

export const researchScrapeTool: Tool = {
  name: "research_scrape",
  description: "Scrape one public URL into clean text/markdown with metadata and a content hash. Egress- and SSRF-gated.",
  parameters: { url: "string (http/https url)" },
  requiresApproval: false,
  trustRequest: (args, ctx) => networkTrustRequest("research_scrape", ctx.cwd, [String(args.url ?? "")]),
  run: async (args, ctx) => run(args, ctx, { intent: "scrape", urls: [String(args.url ?? "")] }),
};

export const researchCrawlTool: Tool = {
  name: "research_crawl",
  description: "Crawl a site (async, bounded by max pages/depth) and return normalized pages with citations. Egress- and SSRF-gated.",
  parameters: { url: "string (http/https url)", max_pages: "number (optional)", max_depth: "number (optional)" },
  requiresApproval: false,
  trustRequest: (args, ctx) => networkTrustRequest("research_crawl", ctx.cwd, [String(args.url ?? "")]),
  run: async (args, ctx) =>
    run(args, ctx, {
      intent: "crawl",
      urls: [String(args.url ?? "")],
      limits: args.max_pages || args.max_depth ? { maxPages: Number(args.max_pages) || undefined, maxDepth: Number(args.max_depth) || undefined } : undefined,
    }),
};

export const researchMapTool: Tool = {
  name: "research_map",
  description: "Map a site's URLs (discovery only — does not scrape them). Egress- and SSRF-gated.",
  parameters: { url: "string (http/https url)" },
  requiresApproval: false,
  trustRequest: (args, ctx) => networkTrustRequest("research_map", ctx.cwd, [String(args.url ?? "")]),
  run: async (args, ctx) => run(args, ctx, { intent: "map", urls: [String(args.url ?? "")] }),
};

export const researchExtractTool: Tool = {
  name: "research_extract",
  description: "Extract structured data from URLs against a JSON schema (schema-validated — invalid output is rejected). Egress- and SSRF-gated.",
  parameters: { urls: "string[] (http/https urls)", schema: "object (JSON schema)" },
  requiresApproval: false,
  trustRequest: (args, ctx) => networkTrustRequest("research_extract", ctx.cwd, Array.isArray(args.urls) ? (args.urls as string[]) : []),
  run: async (args, ctx) => {
    const urls = Array.isArray(args.urls) ? (args.urls as unknown[]).map(String) : [];
    const schema = args.schema && typeof args.schema === "object" ? (args.schema as Record<string, unknown>) : {};
    return run(args, ctx, { intent: "extract", urls, schema });
  },
};

export const RESEARCH_TOOLS: Tool[] = [researchSearchTool, researchScrapeTool, researchCrawlTool, researchMapTool, researchExtractTool];
