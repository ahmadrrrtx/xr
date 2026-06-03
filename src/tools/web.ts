/**
 * XR — web/live-data tools. Every one is egress-gated (allow-list) so the agent
 * can never reach an unapproved domain — exfiltration is structurally blocked.
 */
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { hostAllowed, htmlToText } from "./egress.ts";

const DEFAULT_SEARXNG = process.env.XR_SEARXNG ?? "https://searx.be";

function egressOk(url: string, ctx: ToolContext): string | null {
  const allow = ctx.egressAllowlist ?? [];
  if (allow.length === 0) return "egress blocked: no domains in allow-list";
  if (!hostAllowed(url, allow)) {
    let host = "?";
    try {
      host = new URL(url).hostname;
    } catch {}
    return `egress blocked: ${host} not in allow-list`;
  }
  return null;
}

export const fetchUrlTool: Tool = {
  name: "fetch_url",
  description: "Fetch a web page (allow-listed domains only) and return clean text.",
  parameters: { url: "string (http/https url)" },
  requiresApproval: false,
  async run(args, ctx): Promise<ToolResult> {
    const url = String(args.url ?? "");
    const blocked = egressOk(url, ctx);
    if (blocked) {
      ctx.audit("fetch_url.blocked", { url, reason: blocked });
      return { ok: false, output: blocked };
    }
    try {
      const res = await fetch(url, { headers: { "User-Agent": "XR-Agent/0.1" } });
      const html = await res.text();
      const text = htmlToText(html);
      ctx.audit("fetch_url", { url, bytes: text.length });
      return { ok: true, output: text.slice(0, 4000) + (text.length > 4000 ? "\n…(truncated)" : "") };
    } catch (e) {
      return { ok: false, output: `fetch failed: ${(e as Error).message}` };
    }
  },
};

export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web via a SearXNG instance. Returns titles + snippets + urls.",
  parameters: { query: "string", max_results: "number (optional, default 5)" },
  requiresApproval: false,
  async run(args, ctx): Promise<ToolResult> {
    const query = String(args.query ?? "");
    const max = Number(args.max_results ?? 5);
    const endpoint = `${DEFAULT_SEARXNG.replace(/\/$/, "")}/search?q=${encodeURIComponent(query)}&format=json`;
    // The SearXNG host must itself be allow-listed.
    const blocked = egressOk(endpoint, ctx);
    if (blocked) {
      ctx.audit("web_search.blocked", { query, reason: blocked });
      return { ok: false, output: `${blocked} (add your SearXNG host to egress allow-list)` };
    }
    try {
      const res = await fetch(endpoint, { headers: { "User-Agent": "XR-Agent/0.1" } });
      const json: any = await res.json();
      const results = (json.results ?? []).slice(0, max).map((r: any, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${(r.content ?? "").slice(0, 200)}`,
      );
      ctx.audit("web_search", { query, count: results.length });
      return { ok: true, output: results.join("\n\n") || "(no results)", data: { count: results.length } };
    } catch (e) {
      return { ok: false, output: `search failed: ${(e as Error).message}` };
    }
  },
};

export const checkPackageTool: Tool = {
  name: "check_package",
  description: "Look up a package's latest version & info (npm or pypi). Egress-gated.",
  parameters: { name: "string", registry: "string ('npm' | 'pypi')" },
  requiresApproval: false,
  async run(args, ctx): Promise<ToolResult> {
    const name = String(args.name ?? "");
    const registry = String(args.registry ?? "npm");
    const url =
      registry === "pypi"
        ? `https://pypi.org/pypi/${encodeURIComponent(name)}/json`
        : `https://registry.npmjs.org/${encodeURIComponent(name)}`;
    const blocked = egressOk(url, ctx);
    if (blocked) return { ok: false, output: blocked };
    try {
      const res = await fetch(url);
      if (!res.ok) return { ok: false, output: `not found: ${name}` };
      const json: any = await res.json();
      const version = registry === "pypi" ? json.info?.version : json["dist-tags"]?.latest;
      const desc = registry === "pypi" ? json.info?.summary : json.description;
      ctx.audit("check_package", { name, registry, version });
      return { ok: true, output: `${name}@${version} — ${desc ?? ""}`, data: { version } };
    } catch (e) {
      return { ok: false, output: `lookup failed: ${(e as Error).message}` };
    }
  },
};
