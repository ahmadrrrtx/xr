/**
 * XR Stage 10 — PluginHost.
 *
 * The host is the only supported plugin API. Capabilities are present only when
 * both declared and granted. XR still treats in-process plugins as untrusted:
 * install/load scanning blocks obvious ambient-authority imports, all sensitive
 * host calls audit through XR, and tool calls remain approval-gated.
 */
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
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

function safeJoin(baseDir: string, rel: string): string {
  const abs = isAbsolute(rel) ? rel : resolve(baseDir, rel);
  const r = relative(baseDir, abs);
  if (r.startsWith("..") || isAbsolute(r)) {
    throw new Error(`path escapes the plugin data directory: ${rel}`);
  }
  return abs;
}

function redactLine(line: string): string {
  return String(line).replace(/(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[A-Z0-9_]*API[_-]?KEY\s*=\s*[^\s]+)/g, "«redacted»");
}

export function buildHost(granted: PermissionScope[], deps: HostDeps): PluginHost {
  const { store, config, cwd, pluginDir } = deps;
  const pluginId = deps.pluginId ?? pluginDir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "plugin";
  const grantedSet = new Set(granted);
  const dataDir = join(pluginDir, DATA_SUBDIR);

  const audit = (event: string, detail: Record<string, unknown> = {}): void => {
    try {
      store.audit(`plugin.${event}`, { plugin: pluginId, ...detail });
    } catch {
      /* audit is best-effort; never crash host construction */
    }
  };

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

  if (grantedSet.has("fs:read") || grantedSet.has("fs:write")) {
    const fsCap: FsCapability = { path: (rel) => safeJoin(dataDir, rel) };
    if (grantedSet.has("fs:read")) {
      fsCap.read = (rel) => {
        const p = safeJoin(dataDir, rel);
        audit("fs.read", { path: rel });
        return existsSync(p) ? readFileSync(p, "utf8") : "";
      };
      fsCap.list = (rel = ".") => {
        const p = safeJoin(dataDir, rel);
        audit("fs.list", { path: rel });
        return existsSync(p) ? readdirSync(p) : [];
      };
    }
    if (grantedSet.has("fs:write")) {
      fsCap.write = (rel, content) => {
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        const p = safeJoin(dataDir, rel);
        const parent = dirname(p);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(p, String(content));
        audit("fs.write", { path: rel });
      };
    }
    host.fs = Object.freeze(fsCap);
  }

  if (grantedSet.has("net")) {
    const allow = config.security.egressAllowlist ?? [];
    host.net = Object.freeze({
      isAllowed: (url: string) => hostAllowed(url, allow),
      fetch: async (url: string, init?: RequestInit) => {
        if (!hostAllowed(url, allow)) {
          audit("net.blocked", { url: String(url).slice(0, 200) });
          throw new Error(`egress blocked: host not in allow-list (${String(url).slice(0, 120)})`);
        }
        audit("net.fetch", { url: String(url).slice(0, 200) });
        return fetch(url, init);
      },
    });
  }

  if (grantedSet.has("memory:read") || grantedSet.has("memory:write")) {
    const mem = new MemoryStore(store);
    const scope = projectScopeFromCwd(cwd);
    const memCap: MemoryCapability = {};
    if (grantedSet.has("memory:read")) {
      memCap.recall = async (query, opts) => {
        audit("memory.recall", { k: opts?.k ?? 5 });
        const res = await mem.recallSemantic(query, { scope, k: opts?.k ?? 5 });
        return res.map((e) => ({ id: e.id, category: e.category, content: e.content, scope: e.scope }));
      };
    }
    if (grantedSet.has("memory:write")) {
      memCap.add = (content, opts) => {
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

  if (grantedSet.has("provider")) {
    host.provider = Object.freeze({
      chat: async (messages: Message[]) => {
        const budget = new BudgetManager(store);
        const providerId = config.defaults.provider;
        const model = config.defaults.model;
        if (!isLocal(providerId)) {
          const status = budget.getStatus();
          if (status.isOverBudget) {
            audit("provider.blocked", { reason: "budget exhausted" });
            return { ok: false, message: "", reason: `budget exhausted ($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)})` };
          }
        }
        try {
          const provider = buildProvider(config, { provider: providerId, model });
          const turn = await provider.chat(messages, []);
          if (turn.usage) {
            const price = priceFor(providerId, model);
            const usd = (turn.usage.inTokens / 1_000_000) * (price?.inPerMTok ?? 0) + (turn.usage.outTokens / 1_000_000) * (price?.outPerMTok ?? 0);
            try { store.recordCost(`plugin:${pluginId}`, providerId, model, turn.usage.inTokens, turn.usage.outTokens, usd); } catch {}
          }
          audit("provider.chat", { model });
          return { ok: true, message: turn.message };
        } catch (e) {
          return { ok: false, message: "", reason: (e as Error).message };
        }
      },
    });
  }

  if (grantedSet.has("secrets")) {
    host.secrets = Object.freeze({
      get: (name: string) => {
        const clean = String(name).replace(/[^A-Z0-9_:-]/gi, "").slice(0, 120);
        audit("secrets.get", { name: clean });
        return clean ? getSecret(clean) : undefined;
      },
    });
  }

  if (grantedSet.has("mcp")) {
    const visible = (deps.mcpServers ?? []).map((s) => ({ id: s.id, transport: s.transport, url: s.url, tools: s.tools, description: s.description }));
    host.mcp = Object.freeze({ servers: () => Object.freeze([...visible]) });
  }

  return Object.freeze(host);
}
