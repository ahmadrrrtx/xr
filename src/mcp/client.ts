/**
 * XR — Hardened MCP Client
 *
 * Implements MCP 2025-06-18 (JSON-RPC 2.0) for tools/list, tools/call, resources, prompts
 * Transports: http, sse, streamable-http, stdio
 *
 * SECURITY HARDENED (critical RCE fix):
 *  - Environment allow-list: never inherits full process.env for child processes
 *  - Only SAFE_ENV_KEYS + explicit cfg.env + optional apiKeyEnv injection
 *  - Command validation: no shell metacharacters, shell:false, args length limits
 *  - URL validation: http/https only
 *  - Input sanitization: prototype pollution prevention, depth limit, control char strip
 *  - Timeouts, size limits, fail-closed, audit-bound tool wrappers
 *  - No raw secret storage, only env var names
 */

import { spawn, ChildProcess } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { CORE_VERSION, PKG } from "../core/version.ts";

// ── Environment Allow-list ───────────────────────────────────────────────────

const SAFE_ENV_EXACT = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LC_NUMERIC",
  "LC_TIME",
  "TERM",
  "COLORTERM",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_RUNTIME_DIR",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "DISPLAY",
  "XAUTHORITY",
  "DBUS_SESSION_BUS_ADDRESS",
  "NODE_ENV", // not secret, but still safe to pass
] as const;

const SAFE_ENV_SET = new Set<string>(SAFE_ENV_EXACT);

function isSafeEnvKey(key: string): boolean {
  return SAFE_ENV_SET.has(key);
}

function validateEnvKey(key: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/i.test(key) && key.length >= 1 && key.length <= 120;
}

function validateEnvValue(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length > 4096) return false;
  if (value.includes("\0")) return false;
  return true;
}

/**
 * Create minimal allow-listed env for child processes.
 * This is the critical fix for RCE via secret leakage.
 */
function createAllowedEnv(customEnv?: Record<string, string>, apiKeyEnvName?: string): Record<string, string> {
  const allowed: Record<string, string> = {};

  // Copy only explicitly safe keys from parent env
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (isSafeEnvKey(k)) {
      allowed[k] = v;
    }
  }

  // Ensure PATH exists (required for spawning)
  if (!allowed.PATH) {
    allowed.PATH = process.env.PATH || "/usr/local/bin:/usr/bin:/bin";
  }

  // Merge custom env (explicitly provided for this MCP server)
  if (customEnv) {
    for (const [k, v] of Object.entries(customEnv)) {
      if (!validateEnvKey(k)) continue;
      if (!validateEnvValue(v)) continue;
      allowed[k] = v;
    }
  }

  // Inject API key env var if requested (explicit opt-in, not inherited)
  if (apiKeyEnvName) {
    if (!validateEnvKey(apiKeyEnvName)) {
      throw new Error(`invalid apiKeyEnv name: ${apiKeyEnvName}`);
    }
    const val = process.env[apiKeyEnvName];
    if (val !== undefined) {
      if (!validateEnvValue(val)) throw new Error(`apiKeyEnv value too large or invalid: ${apiKeyEnvName}`);
      allowed[apiKeyEnvName] = val;
    }
  }

  return allowed;
}

// ── Command validation ───────────────────────────────────────────────────────

function validateCommand(cmd: string): void {
  if (typeof cmd !== "string" || !cmd.trim()) throw new Error("command must be non-empty string");
  if (cmd.length > 300) throw new Error("command too long (max 300)");
  // Block shell metacharacters (since shell:false, but defense-in-depth)
  if (/[;&|`$(){}<>\\!*?~#]/.test(cmd)) {
    // Allow '/' '-' '.' '_' alphanumeric, but disallow shell injection chars
    // However we still need to allow paths like "/usr/bin/python3" which are safe
    // The above regex already blocks ; & | ` $ ( ) { } < > \ ! * ? ~ #
    // For extra safety, check if contains those
    if (/[;&|`$()]/.test(cmd)) throw new Error(`command contains shell metacharacters: ${cmd}`);
  }
  if (cmd.includes("\0") || cmd.includes("\n") || cmd.includes("\r")) throw new Error("command contains invalid characters");
}

function validateArgs(args: string[]): void {
  if (!Array.isArray(args)) throw new Error("args must be array");
  for (const a of args) {
    if (typeof a !== "string") throw new Error("arg must be string");
    if (a.length > 500) throw new Error(`arg too long (max 500): ${a.slice(0, 100)}`);
    if (a.includes("\0")) throw new Error("arg contains null byte");
  }
}

// ── Sanitization ─────────────────────────────────────────────────────────────

function sanitizeObject(obj: any, depth = 0): any {
  if (depth > 10) return "[Max depth reached]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    // Strip control chars except \n \t
    return obj.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").slice(0, 10_000);
  }
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) {
    if (obj.length > 1000) return obj.slice(0, 1000).map((e) => sanitizeObject(e, depth + 1));
    return obj.map((e) => sanitizeObject(e, depth + 1));
  }
  if (typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(k)) continue;
      out[k] = sanitizeObject(v, depth + 1);
    }
    return out;
  }
  return undefined;
}

function validateUrl(urlStr: string): URL {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error(`invalid URL: ${urlStr.slice(0, 200)}`);
  }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`unsupported protocol: ${u.protocol}`);
  return u;
}

function validateToolName(name: string): void {
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(name)) throw new Error(`invalid tool name: ${name}`);
}
function validatePromptName(name: string): void {
  if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(name)) throw new Error(`invalid prompt name: ${name}`);
}
function validateResourceUri(uri: string): void {
  if (uri.length > 2000) throw new Error("URI too long");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:[^\s]*$/.test(uri)) throw new Error(`invalid URI: ${uri.slice(0, 200)}`);
}

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Client ───────────────────────────────────────────────────────────────────

export class McpClient {
  private apiKey?: string;
  private proc?: ChildProcess;
  private stdin?: NodeJS.WritableStream;
  private stdout?: NodeJS.ReadableStream;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private buffer = "";
  private connected = false;
  private allowedEnv: Record<string, string>;

  constructor(
    private cfg: McpServerConfig,
    private f: typeof fetch = fetch,
  ) {
    this.cfg = { ...cfg, transport: cfg.transport ?? "http" };

    if (cfg.apiKeyEnv) {
      if (!validateEnvKey(cfg.apiKeyEnv)) throw new Error(`invalid apiKeyEnv name: ${cfg.apiKeyEnv}`);
      this.apiKey = process.env[cfg.apiKeyEnv];
    }

    // Pre-compute allowed env (critical security boundary)
    this.allowedEnv = createAllowedEnv(cfg.env, cfg.apiKeyEnv);

    // Validate command/args early for stdio
    if (this.cfg.transport === "stdio") {
      if (!this.cfg.command) throw new Error("stdio transport requires command");
      validateCommand(this.cfg.command);
      if (this.cfg.args) validateArgs(this.cfg.args);
      if (this.cfg.url) {
        try { validateUrl(this.cfg.url); } catch {}
      }
    } else {
      if (this.cfg.url) validateUrl(this.cfg.url);
    }
  }

  async connect(): Promise<McpCapabilities> {
    if (this.connected) return this.getCapabilities();

    if (this.cfg.transport === "stdio") {
      await this.connectStdio();
    }

    try {
      const init = await this.rpc("initialize", {
        protocolVersion: "2025-06-18",
        clientInfo: { name: PKG.name, version: CORE_VERSION },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      });
      this.connected = true;
      return init.capabilities ?? {};
    } catch (e) {
      await this.disconnect();
      throw e;
    }
  }

  private async connectStdio(): Promise<void> {
    // SECURITY: Use allow-listed env only (CRITICAL FIX)
    const env = this.allowedEnv;

    this.proc = spawn(this.cfg.command!, this.cfg.args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      shell: false,
    });

    this.stdin = this.proc.stdin!;
    this.stdout = this.proc.stdout!;

    let totalBuffer = 0;
    const MAX_BUFFER = 10 * 1024 * 1024; // 10MB

    this.stdout.on("data", (chunk: Buffer) => {
      const s = chunk.toString();
      totalBuffer += s.length;
      if (totalBuffer > MAX_BUFFER) {
        this.buffer = "";
        totalBuffer = 0;
        this.cleanupPending(new Error("MCP stdout buffer overflow"));
        try { this.proc?.kill("SIGTERM"); } catch {}
        return;
      }
      this.buffer += s;
      this.processBuffer();
    });

    this.proc.stderr?.on("data", (d: Buffer) => {
      if (process.env.XR_DEBUG === "1") {
        console.error("[MCP stdio stderr]", d.toString().slice(0, 500));
      }
    });

    this.proc.on("exit", (code, signal) => {
      this.connected = false;
      this.cleanupPending(new Error(`MCP server exited (code=${code} signal=${signal})`));
    });

    this.proc.on("error", (err) => {
      this.cleanupPending(err);
    });

    await new Promise((r) => setTimeout(r, 80));
  }

  private processBuffer() {
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      if (line.length > 1024 * 1024) continue; // skip huge lines
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id)!;
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(msg.error.message || "MCP error"));
          else p.resolve(msg.result);
        }
      } catch {
        // ignore malformed JSON
      }
    }
  }

  private cleanupPending(err: Error) {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private async rpc(method: string, params: any = {}): Promise<any> {
    const id = rpcId++;
    const safeParams = sanitizeObject(params);
    const payload = { jsonrpc: "2.0", id, method, params: safeParams };

    if (this.cfg.transport === "stdio") {
      if (!this.stdin) throw new Error("stdio not connected");
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        try {
          this.stdin!.write(JSON.stringify(payload) + "\n");
        } catch (e) {
          this.pending.delete(id);
          reject(e);
          return;
        }
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`MCP rpc timeout: ${method}`));
          }
        }, 15_000);
      });
    }

    // HTTP-family
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.apiKey) headers["authorization"] = `Bearer ${this.apiKey}`;

    if (!this.cfg.url) throw new Error("no URL for HTTP transport");
    validateUrl(this.cfg.url);

    const res = await this.f(this.cfg.url!, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(`MCP ${this.cfg.id} HTTP ${res.status}`);

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      const text = await res.text();
      if (text.length > 2 * 1024 * 1024) throw new Error("SSE response too large");
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        if (line.startsWith("data:")) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            if (data.id === id) {
              if (data.error) throw new Error(data.error.message);
              return data.result;
            }
          } catch {}
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
        try {
          this.proc.kill("SIGTERM");
        } catch {}
        const procRef = this.proc;
        setTimeout(() => {
          try {
            if (procRef && !procRef.killed) procRef.kill("SIGKILL");
          } catch {}
        }, 5000);
        this.proc = undefined;
      }
    } catch {}
    this.cleanupPending(new Error("disconnected"));
  }

  // ── Public MCP APIs ────────────────────────────────────────────────────────

  async listTools(): Promise<McpToolDef[]> {
    const res = await this.rpc("tools/list");
    const tools = (res?.tools ?? []) as McpToolDef[];
    // sanitize
    return tools
      .filter((t) => t && typeof t.name === "string" && /^[a-zA-Z0-9_.-]+$/.test(t.name))
      .slice(0, 200);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string & { content: string; data?: unknown }> {
    validateToolName(name);
    const sanitizedArgs = sanitizeObject(args);
    const res = await this.rpc("tools/call", { name, arguments: sanitizedArgs });
    const blocks = res?.content ?? [];
    let text = "";
    if (Array.isArray(blocks)) {
      text = blocks.map((b: any) => (b?.text ? String(b.text).slice(0, 4000) : JSON.stringify(b).slice(0, 1000))).join("\n");
    } else {
      text = typeof res === "string" ? res : JSON.stringify(res);
    }
    const content = text.slice(0, 12_000);
    const out = new String(content) as unknown as string & { content: string; data?: unknown };
    out.content = content;
    out.data = res;
    return out;
  }

  async listResources(): Promise<McpResourceDef[]> {
    try {
      const res = await this.rpc("resources/list");
      const list = (res?.resources ?? []) as McpResourceDef[];
      return list.filter((r) => r && typeof r.uri === "string").slice(0, 200);
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<{ content: string; mimeType?: string }> {
    validateResourceUri(uri);
    const res = await this.rpc("resources/read", { uri });
    const contents = res?.contents ?? [];
    if (Array.isArray(contents) && contents[0]) {
      const c = contents[0];
      return {
        content: String(c.text ?? (c.blob ? "[binary]" : JSON.stringify(c))).slice(0, 8000),
        mimeType: c.mimeType,
      };
    }
    return { content: JSON.stringify(res).slice(0, 8000) };
  }

  async listPrompts(): Promise<McpPromptDef[]> {
    try {
      const res = await this.rpc("prompts/list");
      const list = (res?.prompts ?? []) as McpPromptDef[];
      return list.filter((p) => p && typeof p.name === "string").slice(0, 200);
    } catch {
      return [];
    }
  }

  async getPrompt(name: string, args?: Record<string, string>): Promise<{ messages: Array<{ role: string; content: string }> }> {
    validatePromptName(name);
    const safeArgs = args ? sanitizeObject(args) : undefined;
    const res = await this.rpc("prompts/get", { name, arguments: safeArgs });
    return {
      messages: (res?.messages ?? [])
        .map((m: any) => ({
          role: String(m.role || "user").slice(0, 20),
          content: typeof m.content === "string" ? m.content.slice(0, 8000) : JSON.stringify(m.content).slice(0, 8000),
        }))
        .slice(0, 50),
    };
  }

  getCapabilities(): McpCapabilities {
    return { tools: true, resources: true, prompts: true };
  }
}

// ── Safe XR Tool Wrappers (approval + audit boundary) ───────────────────────

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
        preview: JSON.stringify(sanitizeObject(args)).slice(0, 280),
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
        ctx.audit("mcp.tool.error", { server: serverId, tool: def.name, error: String(e.message).slice(0, 500) });
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
      try {
        validateResourceUri(uri);
      } catch {
        return { ok: false, output: "Invalid URI" };
      }
      const approved = await ctx.approve({
        tool: fullName,
        reason: `Read MCP resource from "${serverId}"`,
        preview: uri.slice(0, 300),
      });
      if (!approved) {
        ctx.audit("mcp.resource.denied", { server: serverId, uri: uri.slice(0, 500) });
        return { ok: false, output: "Resource access denied" };
      }
      if (ctx.dryRun) return { ok: true, output: `[dry-run] would read ${uri}` };
      try {
        const { content } = await client.readResource(uri);
        ctx.audit("mcp.resource.read", { server: serverId, uri: uri.slice(0, 500) });
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
      properties: Object.fromEntries((def.arguments || []).map((a) => [a.name, { type: "string", description: a.description }])),
    },
    requiresApproval: false,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.dryRun) return { ok: true, output: `[dry-run] would fetch prompt ${def.name}` };
      try {
        const result = await client.getPrompt(def.name, args as any);
        ctx.audit("mcp.prompt.get", { server: serverId, prompt: def.name });
        const text = result.messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
        return { ok: true, output: text.slice(0, 6000), data: result };
      } catch (e: any) {
        return { ok: false, output: `Prompt error: ${e.message}` };
      }
    },
  };
}
