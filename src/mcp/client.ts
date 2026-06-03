/**
 * XR — MCP (Model Context Protocol) client.
 *
 * Lets XR consume tools from any MCP server (databases, browsers, GitHub,
 * Notion, etc.) — a free tool ecosystem instead of building integrations.
 *
 * SECURITY: MCP servers are UNTRUSTED third-party code. So:
 *   • every MCP tool is wrapped as a normal XR Tool with requiresApproval=true
 *   • calls still pass through the egress allow-list + audit log
 *   • a poisoned tool description can't bypass the policy engine (architecture)
 *
 * Transport: JSON-RPC 2.0 over HTTP (the common MCP transport). stdio servers
 * can be bridged later. Dependency-free (fetch).
 */
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";

export interface McpServerConfig {
  id: string;
  /** HTTP endpoint of the MCP server (JSON-RPC). */
  url: string;
  /** Optional bearer token env var. */
  apiKeyEnv?: string;
}

export interface McpToolDef {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

let RPC_ID = 1;

export class McpClient {
  private apiKey?: string;
  constructor(
    private cfg: McpServerConfig,
    private f: typeof fetch = fetch,
  ) {
    this.apiKey = cfg.apiKeyEnv ? process.env[cfg.apiKeyEnv] : undefined;
  }

  private async rpc(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;
    const res = await this.f(this.cfg.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: RPC_ID++, method, params }),
    });
    if (!res.ok) throw new Error(`MCP ${this.cfg.id} HTTP ${res.status}`);
    const json: any = await res.json();
    if (json.error) throw new Error(`MCP ${this.cfg.id}: ${json.error.message ?? "error"}`);
    return json.result;
  }

  /** List the tools an MCP server exposes. */
  async listTools(): Promise<McpToolDef[]> {
    const result = await this.rpc("tools/list");
    return (result?.tools ?? []) as McpToolDef[];
  }

  /** Call an MCP tool by name. */
  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = await this.rpc("tools/call", { name, arguments: args });
    // MCP returns content blocks; flatten text.
    const content = result?.content ?? [];
    if (Array.isArray(content)) {
      return content.map((c: any) => (typeof c?.text === "string" ? c.text : JSON.stringify(c))).join("\n");
    }
    return JSON.stringify(result);
  }
}

/**
 * Wrap a remote MCP tool as a native XR Tool — namespaced, approval-gated,
 * audited. The wrapper is the security boundary around untrusted MCP code.
 */
export function wrapMcpTool(client: McpClient, serverId: string, def: McpToolDef): Tool {
  return {
    name: `mcp.${serverId}.${def.name}`,
    description: `[MCP:${serverId}] ${def.description ?? def.name}`,
    parameters: def.inputSchema ?? {},
    requiresApproval: true, // untrusted external tool → always confirm
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const approved = await ctx.approve({
        tool: `mcp.${serverId}.${def.name}`,
        reason: `call external MCP tool on '${serverId}'`,
        preview: JSON.stringify(args).slice(0, 300),
      });
      if (!approved) {
        ctx.audit("mcp.denied", { server: serverId, tool: def.name });
        return { ok: false, output: "MCP tool call denied" };
      }
      if (ctx.dryRun) {
        return { ok: true, output: `[dry-run] would call mcp.${serverId}.${def.name}` };
      }
      try {
        const out = await client.callTool(def.name, args);
        ctx.audit("mcp.call", { server: serverId, tool: def.name });
        return { ok: true, output: out.slice(0, 4000) };
      } catch (e) {
        return { ok: false, output: `MCP error: ${(e as Error).message}` };
      }
    },
  };
}
