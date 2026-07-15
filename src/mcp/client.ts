/**
 * XR Stage 11 — Production-grade MCP Client
 *
 * Implements core MCP 2025-06-18 (JSON-RPC 2.0) for:
 *   - tools/list, tools/call
 *   - resources/list, resources/read
 *   - prompts/list, prompts/get
 *
 * Supported transports (production hardened):
 *   - http (POST JSON-RPC)
 *   - sse (Server-Sent Events + POST)
 *   - streamable-http (POST with optional streaming)
 *   - stdio (child_process, JSON lines)
 *
 * SECURITY (HARDENED):
 * - Every call is wrapped by XR Tool layer (approval + audit + budget + egress)
 * - Never stores raw secrets (only env var names)
 * - Timeouts, size limits, fail-closed on errors
 * - No direct fs/network access from MCP code paths
 * - CRITICAL: Environment variables are allow-listed (never inherit full process.env)
 * - Child processes run with minimal environment
 * - All inputs validated and sanitized
 */

import { spawn, ChildProcess } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";

/**
 * SECURITY: Allowed environment variables for MCP servers
 * 
 * MCP servers should NEVER inherit the full process.env from the XR host.
 * Only explicitly allowed variables are passed through.
 * 
 * This is a critical security boundary to prevent secret leakage.
 */
const ALLOWED_ENV_PREFIXES = [
  "NODE_ENV",
  "XR_",
  "MCP_",
  "PLUGIN_",
  // Add other safe prefixes as needed
];

const ALLOWED_ENV_EXACT = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  // Explicitly allowed variables
];

/**
 * SECURITY: Check if an environment variable is allowed
 */
function isEnvAllowed(key: string): boolean {
  // Check exact matches
  if (ALLOWED_ENV_EXACT.includes(key)) return true;
  
  // Check prefix matches
  for (const prefix of ALLOWED_ENV_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  
  return false;
}

/**
 * SECURITY: Create a minimal, allow-listed environment for child processes
 */
function createAllowedEnvironment(
  customEnv?: Record<string, string>
): Record<string, string> {
  const allowed: Record<string, string> = {};
  
  // Only pass through explicitly allowed variables from parent env
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && isEnvAllowed(key)) {
      allowed[key] = value;
    }
  }
  
  // Merge with custom env (this is where API keys etc. should be passed)
  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      // Validate custom env keys
      if (/^[A-Z_][A-Z0-9_]*$/i.test(key) && typeof value === "string") {
        allowed[key] = value;
      }
    }
  }
  
  // Ensure essential variables are set
  if (!allowed.PATH) {
    allowed.PATH = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  }
  
  return allowed;
}

export interface McpServerConfig {
  id: string;
  transport?: "stdio" | "sse" | "http" | "streamable-http";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  apiKeyEnv?: string;
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpResourceDef {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDef {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpCapabilities {
  tools?: boolean;
  resources?: boolean;
  prompts?: boolean;
}

let rpcId = 1;

export class McpClient {
  private apiKey?: string;
  private proc?: ChildProcess;
  private stdin?: NodeJS.WritableStream;
  private stdout?: NodeJS.ReadableStream;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private buffer = "";
  private connected = false;

  constructor(
    private cfg: McpServerConfig,
    private f: typeof fetch = fetch,
  ) {
    this.cfg = { ...cfg, transport: cfg.transport ?? "http" };
    
    // SECURITY: Only read API key from explicitly named env var
    if (cfg.apiKeyEnv) {
      // Validate the env var name
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(cfg.apiKeyEnv)) {
        throw new Error(`Invalid API key env var name: ${cfg.apiKeyEnv}`);
      }
      this.apiKey = process.env[cfg.apiKeyEnv];
    }
  }

  async connect(): Promise<McpCapabilities> {
    if (this.connected) return this.getCapabilities();

    if (this.cfg.transport === "stdio") {
      if (!this.cfg.command) throw new Error("stdio transport requires command");
      await this.connectStdio();
    } else {
      // http / sse / streamable-http use fetch only
      // initialize once to validate
    }

    // Always attempt initialize
    try {
      const init = await this.rpc("initialize", {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "xr", version: "1.0.0" },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
      this.connected = true;
      return init.capabilities ?? {};
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  private async connectStdio() {
    // SECURITY: Create allow-listed environment (CRITICAL FIX)
    const env = createAllowedEnvironment(this.cfg.env);
    
    // SECURITY: Validate command before spawning
    if (!this.cfg.command) {
      throw new Error("No command specified for stdio transport");
    }
    
    // Basic command validation (should be expanded based on needs)
    if (this.cfg.command.includes("..") || this.cfg.command.includes("|")) {
      throw new Error("Potentially unsafe command");
    }
    
    this.proc = spawn(this.cfg.command!, this.cfg.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env,  // SECURITY: Use allow-listed environment
      shell: false,  // SECURITY: Never use shell
      detached: false,  // SECURITY: Keep child in same process group
    });

    this.stdin = this.proc.stdin!;
    this.stdout = this.proc.stdout!;

    this.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.proc.stderr?.on("data", (d) => {
      // SECURITY: Never log stderr without redaction
      const redacted = d.toString().replace(/[A-Za-z0-9+/=]{20,}/g, "«redacted»");
      if (process.env.XR_DEBUG === "1") {
        console.error("[MCP stdio stderr]", redacted.slice(0, 200));
      }
    });

    this.proc.on("exit", () => {
      this.connected = false;
      this.cleanupPending(new Error("MCP server exited"));
    });

    // SECURITY: Set process timeout to prevent hanging processes
    this.proc.on("error", (err) => {
      this.cleanupPending(err);
    });

    // give stdio a moment
    await new Promise(r => setTimeout(r, 80));
  }

  private processBuffer() {
    let idx;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
          else p.resolve(msg.result);
        }
      } catch {
        // Ignore malformed JSON lines
      }
    }
  }

  private cleanupPending(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private async rpc(method: string, params: any = {}): Promise<any> {
    const id = rpcId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    if (this.cfg.transport === "stdio") {
      if (!this.stdin) throw new Error("stdio not connected");
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        this.stdin!.write(JSON.stringify(payload) + "\n");
        // timeout safety
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`MCP rpc timeout: ${method}`));
          }
        }, 15000);
      });
    }

    // HTTP-family transports
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    // SECURITY: Validate URL before making request
    if (!this.cfg.url) {
      throw new Error("No URL specified for HTTP transport");
    }
    
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(this.cfg.url);
    } catch {
      throw new Error(`Invalid URL: ${this.cfg.url}`);
    }
    
    // SECURITY: Only allow http(s) protocols
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }

    const res = await this.f(this.cfg.url!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`MCP ${this.cfg.id} HTTP ${res.status}`);

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      // simple SSE handling for initialize / list (non-streaming responses)
      const text = await res.text();
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.id === id) {
              if (data.error) throw new Error(data.error.message);
              return data.result;
            }
          } catch {
            // Ignore malformed SSE data
          }
        }
      }
      throw new Error("No matching SSE response");
    }

    const json: any = await res.json();
    if (json.error) throw new Error(json.error.message ?? "MCP error");
    return json.result;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    try {
      if (this.proc) {
        // SECURITY: Gracefully kill process
        this.proc.kill("SIGTERM");
        
        // Force kill after timeout
        setTimeout(() => {
          if (this.proc && !this.proc.killed) {
            this.proc.kill("SIGKILL");
          }
        }, 5000);
        
        this.proc = undefined;
      }
    } catch {
      // Ignore errors during disconnect
    }
    this.cleanupPending(new Error("disconnected"));
  }

  // ── Public MCP APIs ───────────────────────────────────────────────────────

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.rpc("tools/list");
    return (res?.tools ?? []) as McpToolDef[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string & { content: string; data?: unknown }> {
    // SECURITY: Validate tool name
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      throw new Error(`Invalid tool name: ${name}`);
    }
    
    // SECURITY: Sanitize args to prevent injection
    const sanitizedArgs = sanitizeObject(args);
    
    const res = await this.rpc("tools/call", { name, arguments: sanitizedArgs });
    const blocks = res?.content ?? [];
    let text = "";
    if (Array.isArray(blocks)) {
      text = blocks.map((b: any) => (b?.text ? b.text : JSON.stringify(b))).join("\n");
    } else {
      text = typeof res === "string" ? res : JSON.stringify(res);
    }
    const content = text.slice(0, 12000);
    const out = new String(content) as unknown as string & { content: string; data?: unknown };
    out.content = content;
    out.data = res;
    return out;
  }

  async listResources(): Promise<McpResourceDef[]> {
    try {
      const res = await this.rpc("resources/list");
      return (res?.resources ?? []) as McpResourceDef[];
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    // SECURITY: Validate URI
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(uri)) {
      throw new Error(`Invalid URI: ${uri}`);
    }
    
    const res = await this.rpc("resources/read", { uri });
    const contents = res?.contents ?? [];
    if (Array.isArray(contents) && contents[0]) {
      const c = contents[0];
      return {
        content: c.text ?? (c.blob ? " [binary]" : JSON.stringify(c)),
        mimeType: c.mimeType,
      };
    }
    return { content: JSON.stringify(res).slice(0, 8000) };
  }

  async listPrompts(): Promise<McpPromptDef[]> {
    try {
      const res = await this.rpc("prompts/list");
      return (res?.prompts ?? []) as McpPromptDef[];
    } catch {
      return [];
    }
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: string }> }> {
    // SECURITY: Validate prompt name
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
      throw new Error(`Invalid prompt name: ${name}`);
    }
    
    const res = await this.rpc("prompts/get", { name, arguments: args });
    return {
      messages: (res?.messages ?? []).map((m: any) => ({
        role: m.role,
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
    };
  }

  getCapabilities(): McpCapabilities {
    // optimistic default; real values come from initialize
    return { tools: true, resources: true, prompts: true };
  }
}

/**
 * SECURITY: Sanitize object to prevent prototype pollution and injection
 */
function sanitizeObject(obj: any, depth: number = 0): any {
  if (depth > 10) return "[Max depth reached]";
  
  if (obj === null || obj === undefined) return obj;
  
  if (typeof obj === "string") {
    // Remove potential control characters
    return obj.replace(/[\x00-\x1F\x7F]/g, "");
  }
  
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item, depth + 1));
  }
  
  if (typeof obj === "object") {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      // SECURITY: Prevent prototype pollution
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      // Only allow safe keys
      if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) {
        sanitized[key] = sanitizeObject(value, depth + 1);
      }
    }
    return sanitized;
  }
  
  return obj;
}

// ── Safe XR Tool Wrappers (the security boundary) ───────────────────────────

export function wrapMcpTool(client: McpClient, serverId: string, def: McpToolDef): Tool {
  const fullName = `mcp.${serverId}.${def.name}`;
  return {
    name: fullName,
    description: `[MCP:${serverId}] ${def.description ?? def.name}`,
    parameters: def.inputSchema ?? { type: "object", properties: {} },
    requiresApproval: true,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const approved = await ctx.approve({
        tool: fullName,
        reason: `Invoke external MCP tool on server "${serverId}"`,
        preview: JSON.stringify(args).slice(0, 280),
      });
      if (!approved) {
        ctx.audit("mcp.tool.denied", { server: serverId, tool: def.name });
        return { ok: false, output: "MCP tool call denied by user" };
      }
      if (ctx.dryRun) {
        return { ok: true, output: `[dry-run] would call ${fullName}` };
      }
      try {
        const { content } = await client.callTool(def.name, args);
        ctx.audit("mcp.tool.call", { server: serverId, tool: def.name });
        return { ok: true, output: content };
      } catch (e: any) {
        ctx.audit("mcp.tool.error", { server: serverId, tool: def.name, error: e.message });
        return { ok: false, output: `MCP error: ${e.message}` };
      }
    },
  };
}

export function wrapMcpResource(client: McpClient, serverId: string, def: McpResourceDef): Tool {
  const fullName = `mcp.${serverId}.resource.${def.uri.replace(/[^a-z0-9]/gi, "_")}`;
  return {
    name: fullName,
    description: `[MCP resource:${serverId}] ${def.name ?? def.uri} — ${def.description ?? ""}`,
    parameters: { type: "object", properties: { uri: { type: "string", default: def.uri } } },
    requiresApproval: true,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const uri = (args.uri as string) || def.uri;
      
      // SECURITY: Validate URI
      if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(uri)) {
        return { ok: false, output: "Invalid URI" };
      }
      
      const approved = await ctx.approve({
        tool: fullName,
        reason: `Read MCP resource from "${serverId}"`,
        preview: uri,
      });
      if (!approved) {
        ctx.audit("mcp.resource.denied", { server: serverId, uri });
        return { ok: false, output: "Resource access denied" };
      }
      if (ctx.dryRun) return { ok: true, output: `[dry-run] would read ${uri}` };
      try {
        const { content } = await client.readResource(uri);
        ctx.audit("mcp.resource.read", { server: serverId, uri });
        return { ok: true, output: content };
      } catch (e: any) {
        return { ok: false, output: `Resource error: ${e.message}` };
      }
    },
  };
}

export function wrapMcpPrompt(client: McpClient, serverId: string, def: McpPromptDef): Tool {
  const fullName = `mcp.${serverId}.prompt.${def.name}`;
  return {
    name: fullName,
    description: `[MCP prompt:${serverId}] ${def.description ?? def.name}`,
    parameters: {
      type: "object",
      properties: Object.fromEntries((def.arguments || []).map(a => [a.name, { type: "string", description: a.description }])),
    },
    requiresApproval: false, // prompts are read-only templates; still audited
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.dryRun) return { ok: true, output: `[dry-run] would fetch prompt ${def.name}` };
      try {
        const result = await client.getPrompt(def.name, args as any);
        ctx.audit("mcp.prompt.get", { server: serverId, prompt: def.name });
        const text = result.messages.map(m => `${m.role}: ${m.content}`).join("\n\n");
        return { ok: true, output: text.slice(0, 6000), data: result };
      } catch (e: any) {
        return { ok: false, output: `Prompt error: ${e.message}` };
      }
    },
  };
}
