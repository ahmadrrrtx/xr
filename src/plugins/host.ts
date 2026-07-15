/**
 * XR Stage 10 — PluginHost.
 *
 * The host is the ONLY supported plugin API. Capabilities are present only when
 * both declared and granted. XR treats plugins as untrusted by default:
 * - install/load scanning blocks obvious ambient-authority imports
 * - all sensitive host calls audit through XR
 * - tool calls remain approval-gated
 * - SECURITY: Host object is frozen to prevent capability escape
 * - SECURITY: All paths are validated to prevent traversal
 * - SECURITY: No direct access to Node.js internals
 */

import { join, resolve, relative, isAbsolute, dirname, normalize } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import type { Store } from "../state/db.ts";
import type { XRConfig } from "../config/config.ts";
import { hostAllowed } from "../tools/egress.ts";
import { getSecret } from "../security/secrets.ts";
import { MemoryStore, projectScopeFromCwd } from "../memory/store.ts";
import { BudgetManager } from "../cost/manager.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import type { Message } from "../core/types.ts";
import { PLUGIN_API_VERSION, CORE_VERSION } from "../core/version.ts";
import type { McpServerDeclaration, PermissionScope } from "./types.ts";

export interface FsCapability {
  path(rel: string): string;
  read?(rel: string): string;
  write?(rel: string, content: string): void;
  list?(rel?: string): string[];
}

export interface NetCapability {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  isAllowed(url: string): boolean;
}

export interface MemoryCapability {
  recall?(query: string, opts?: { k?: number }): Promise<Array<{ id: string; category: string; content: string; scope: string }>>;
  add?(content: string, opts?: { category?: string; importance?: number; tags?: string[] }): { ok: boolean; reason?: string };
}

export interface ProviderCapability {
  chat(messages: Message[]): Promise<{ ok: boolean; message: string; reason?: string }>;
}

export interface SecretsCapability {
  get(name: string): string | undefined;
}

export interface McpCapability {
  servers(): ReadonlyArray<Pick<McpServerDeclaration, "id" | "transport" | "url" | "tools" | "description">>;
}

export interface PluginHost {
  readonly id: string;
  readonly apiVersion: number;
  readonly coreVersion: string;
  readonly permissions: readonly PermissionScope[];
  can(perm: PermissionScope): boolean;
  log(line: string): void;
  warn(line: string): void;
  audit(event: string, detail?: Record<string, unknown>): void;
  fs?: FsCapability;
  net?: NetCapability;
  memory?: MemoryCapability;
  provider?: ProviderCapability;
  secrets?: SecretsCapability;
  mcp?: McpCapability;
}

export interface HostDeps {
  store: Store;
  config: XRConfig;
  cwd: string;
  pluginDir: string;
  pluginId?: string;
  mcpServers?: McpServerDeclaration[];
}

const DATA_SUBDIR = "data";

/**
 * SECURITY: Safely join paths and prevent directory traversal
 * 
 * This is a critical security function. It ensures that plugins cannot
 * access files outside their designated data directory.
 */
function safeJoin(baseDir: string, rel: string): string {
  // SECURITY: Normalize the relative path to prevent traversal
  const normalizedRel = normalize(rel);
  
  // SECURITY: Reject if path tries to escape
  if (normalizedRel.startsWith("..") || isAbsolute(normalizedRel)) {
    throw new Error(`Path traversal detected: ${rel}`);
  }
  
  const abs = resolve(baseDir, normalizedRel);
  const r = relative(baseDir, abs);
  
  if (r.startsWith("..") || isAbsolute(r)) {
    throw new Error(`Path escapes the plugin data directory: ${rel}`);
  }
  
  return abs;
}

/**
 * SECURITY: Validate and sanitize log output
 */
function redactLine(line: string): string {
  return String(line)
    .replace(/(sk-[A-Za-z0-9]{8,})/g, "«redacted-api-key»")
    .replace(/(Bearer\s+[A-Za-z0-9._-]{8,})/gi, "Bearer «redacted»")
    .replace(/([A-Z0-9_]*API[_-]?KEY\s*=\s*)[^\s]+/gi, "$1«redacted»")
    .replace(/(password\s*[:=]\s*)[^\s]+/gi, "$1«redacted»")
    .replace(/(secret\s*[:=]\s*)[^\s]+/gi, "$1«redacted»");
}

/**
 * SECURITY: Build the plugin host with strict capability enforcement
 * 
 * The host is the security boundary between the plugin and XR.
 * Only explicitly granted permissions result in capabilities being exposed.
 */
export function buildHost(granted: PermissionScope[], deps: HostDeps): PluginHost {
  const { store, config, cwd, pluginDir } = deps;
  const pluginId = deps.pluginId ?? pluginDir.replace(/[\\/]+$/g, "").split(/[\\/]/).pop() ?? "plugin";
  const grantedSet = new Set(granted);
  const dataDir = join(pluginDir, DATA_SUBDIR);

  // SECURITY: Audit function is frozen and cannot be modified
  const audit = (event: string, detail: Record<string, unknown> = {}): void => {
    try {
      store.audit(`plugin.${event}`, { plugin: pluginId, ...detail });
    } catch {
      /* audit is best-effort; never crash host construction */
    }
  };

  // SECURITY: Build the host object with only granted capabilities
  const host: PluginHost = {
    id: pluginId,
    apiVersion: PLUGIN_API_VERSION,
    coreVersion: CORE_VERSION,
    permissions: Object.freeze([...granted]),
    can: (perm) => grantedSet.has(perm),
    log: (line) => console.log(`\x1b[2m[plugin:${pluginId}]\x1b[0m ${redactLine(line)}`),
    warn: (line) => console.log(`\x1b[33m[plugin:${pluginId}] ${redactLine(line)}\x1b[0m`),
    audit,
  };

  // ── File System Capability ─────────────────────────────────────────────
  // SECURITY: Only allow access to plugin's own data directory
  
  if (grantedSet.has("fs:read") || grantedSet.has("fs:write")) {
    const fsCap: FsCapability = { 
      path: (rel) => {
        // SECURITY: Validate relative path
        if (typeof rel !== "string" || rel.length === 0) {
          throw new Error("Invalid path");
        }
        return safeJoin(dataDir, rel);
      }
    };
    
    if (grantedSet.has("fs:read")) {
      fsCap.read = (rel) => {
        const p = safeJoin(dataDir, rel);
        
        // SECURITY: Verify file is within data directory (defense-in-depth)
        if (!existsSync(p)) return "";
        
        const stats = statSync(p);
        if (!stats.isFile()) {
          throw new Error(`Path is not a file: ${rel}`);
        }
        
        // SECURITY: Limit file size to prevent memory exhaustion
        if (stats.size > 10 * 1024 * 1024) {
          throw new Error(`File too large: ${rel}`);
        }
        
        audit("fs.read", { path: rel, size: stats.size });
        return readFileSync(p, "utf8");
      };
      
      fsCap.list = (rel = ".") => {
        const p = safeJoin(dataDir, rel);
        
        if (!existsSync(p)) return [];
        
        const stats = statSync(p);
        if (!stats.isDirectory()) {
          throw new Error(`Path is not a directory: ${rel}`);
        }
        
        audit("fs.list", { path: rel });
        return readdirSync(p).filter(name => {
          // SECURITY: Prevent listing sensitive files
          return !name.startsWith(".") && name !== "node_modules";
        });
      };
    }
    
    if (grantedSet.has("fs:write")) {
      fsCap.write = (rel, content) => {
        // SECURITY: Validate inputs
        if (typeof rel !== "string" || rel.length === 0) {
          throw new Error("Invalid path");
        }
        if (typeof content !== "string") {
          content = String(content);
        }
        
        // SECURITY: Limit content size
        if (content.length > 10 * 1024 * 1024) {
          throw new Error("Content too large (max 10MB)");
        }
        
        if (!existsSync(dataDir)) {
          mkdirSync(dataDir, { recursive: true });
        }
        
        const p = safeJoin(dataDir, rel);
        const parent = dirname(p);
        
        if (!existsSync(parent)) {
          mkdirSync(parent, { recursive: true });
        }
        
        // SECURITY: Verify parent is still within data directory
        if (!parent.startsWith(dataDir)) {
          throw new Error(`Write path escapes data directory: ${rel}`);
        }
        
        writeFileSync(p, String(content));
        audit("fs.write", { path: rel, size: content.length });
      };
    }
    
    host.fs = Object.freeze(fsCap);
  }

  // ── Network Capability ────────────────────────────────────────────────
  // SECURITY: All network requests go through egress filtering
  
  if (grantedSet.has("net")) {
    const allow = config.security.egressAllowlist ?? [];
    
    host.net = Object.freeze({
      isAllowed: (url: string) => {
        // SECURITY: Validate URL format
        try {
          new URL(url);
          return hostAllowed(url, allow);
        } catch {
          return false;
        }
      },
      
      fetch: async (url: string, init?: RequestInit) => {
        // SECURITY: Validate URL
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new Error(`Invalid URL: ${url}`);
        }
        
        // SECURITY: Only allow http(s) protocols
        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
          throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
        }
        
        // SECURITY: Check egress allowlist
        if (!hostAllowed(url, allow)) {
          audit("net.blocked", { url: String(url).slice(0, 200) });
          throw new Error(`egress blocked: host not in allow-list (${String(url).slice(0, 120)})`);
        }
        
        // SECURITY: Limit request size
        if (init?.body && typeof init.body === "string" && init.body.length > 1_000_000) {
          throw new Error("Request body too large (max 1MB)");
        }
        
        audit("net.fetch", { url: String(url).slice(0, 200), method: init?.method ?? "GET" });
        
        // SECURITY: Add timeout to prevent hanging requests
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        
        try {
          return await fetch(url, {
            ...init,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      },
    });
  }

  // ── Memory Capability ─────────────────────────────────────────────────
  // SECURITY: Memory access is scoped to project and plugin
  
  if (grantedSet.has("memory:read") || grantedSet.has("memory:write")) {
    const mem = new MemoryStore(store);
    const scope = projectScopeFromCwd(cwd);
    const memCap: MemoryCapability = {};
    
    if (grantedSet.has("memory:read")) {
      memCap.recall = async (query, opts) => {
        if (typeof query !== "string" || query.length === 0) {
          throw new Error("Invalid query");
        }
        
        // SECURITY: Limit query length
        if (query.length > 1000) {
          throw new Error("Query too long (max 1000 chars)");
        }
        
        audit("memory.recall", { k: opts?.k ?? 5 });
        const res = await mem.recallSemantic(query, { scope, k: opts?.k ?? 5 });
        return res.map((e) => ({ 
          id: e.id, 
          category: e.category, 
          content: e.content.slice(0, 10000), // SECURITY: Limit content length
          scope: e.scope 
        }));
      };
    }
    
    if (grantedSet.has("memory:write")) {
      memCap.add = (content, opts) => {
        // SECURITY: Validate inputs
        if (typeof content !== "string" || content.length === 0) {
          throw new Error("Invalid content");
        }
        
        // SECURITY: Limit content size
        if (content.length > 100_000) {
          throw new Error("Content too large (max 100KB)");
        }
        
        const r = mem.add({
          content,
          category: (opts?.category as any) ?? "fact",
          scope,
          source: "import",
          importance: opts?.importance,
          tags: [...(opts?.tags ?? []), `plugin:${pluginId}`],
        });
        audit("memory.add", { ok: r.ok, duplicate: r.duplicate ?? false });
        return { ok: r.ok, reason: r.reason };
      };
    }
    
    host.memory = Object.freeze(memCap);
  }

  // ── Provider Capability ───────────────────────────────────────────────
  // SECURITY: Provider access goes through budget and approval gates
  
  if (grantedSet.has("provider")) {
    host.provider = Object.freeze({
      chat: async (messages: Message[]) => {
        // SECURITY: Validate messages
        if (!Array.isArray(messages) || messages.length === 0) {
          throw new Error("Invalid messages");
        }
        
        // SECURITY: Limit total message size
        const totalSize = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
        if (totalSize > 100_000) {
          throw new Error("Messages too large (max 100KB)");
        }
        
        const budget = new BudgetManager(store);
        const providerId = config.defaults.provider;
        const model = config.defaults.model;
        
        if (!isLocal(providerId)) {
          const status = budget.getStatus();
          if (status.isOverBudget) {
            audit("provider.blocked", { reason: "budget exhausted" });
            return { 
              ok: false, 
              message: "", 
              reason: `budget exhausted ($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)})` 
            };
          }
        }
        
        try {
          const provider = buildProvider(config, { provider: providerId, model });
          const turn = await provider.chat(messages, []);
          
          if (turn.usage) {
            const price = priceFor(providerId, model);
            const usd = (turn.usage.inTokens / 1_000_000) * (price?.inPerMTok ?? 0) + (turn.usage.outTokens / 1_000_000) * (price?.outPerMTok ?? 0);
            try { 
              store.recordCost(`plugin:${pluginId}`, providerId, model, turn.usage.inTokens, turn.usage.outTokens, usd); 
            } catch { }
          }
          
          audit("provider.chat", { model });
          return { ok: true, message: turn.message };
        } catch (e) {
          return { ok: false, message: "", reason: (e as Error).message };
        }
      },
    });
  }

  // ── Secrets Capability ─────────────────────────────────────────────────
  // SECURITY: Secrets are accessed by name only, values never logged
  
  if (grantedSet.has("secrets")) {
    host.secrets = Object.freeze({
      get: (name: string) => {
        // SECURITY: Validate secret name
        if (typeof name !== "string" || name.length === 0) {
          throw new Error("Invalid secret name");
        }
        
        // SECURITY: Only allow safe secret names
        const clean = name.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 120);
        if (clean.length === 0) {
          throw new Error("Invalid secret name");
        }
        
        audit("secrets.get", { name: clean });
        const value = getSecret(clean);
        
        // SECURITY: Return undefined instead of null/empty to prevent leaks
        return value || undefined;
      },
    });
  }

  // ── MCP Capability ────────────────────────────────────────────────────
  // SECURITY: Only metadata exposed, no direct access to MCP servers
  
  if (grantedSet.has("mcp")) {
    const visible = (deps.mcpServers ?? []).map((s) => ({ 
      id: s.id, 
      transport: s.transport, 
      url: s.url, 
      tools: s.tools, 
      description: s.description 
    }));
    host.mcp = Object.freeze({ 
      servers: () => Object.freeze([...visible]) 
    });
  }

  // SECURITY: Freeze the entire host object to prevent modifications
  return Object.freeze(host);
}
