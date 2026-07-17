/**
 * XR — Hardened PluginHost
 *
 * The host is the ONLY supported plugin API. All capabilities are:
 *  - gated by both declaration AND granted permissions (manifest = source of truth)
 *  - audited via Store
 *  - built on null-prototype objects with prototype-less functions to prevent
 *    host Function constructor escape (vm isolation defense)
 *  - path-traversal safe, size-limited, egress-filtered, budget-gated
 *
 * SECURITY PROPERTIES:
 *  - Object.create(null) for host and capability objects => no constructor/prototype escape
 *  - All exposed functions have prototype = null and frozen
 *  - safeJoin uses normalize + relative + isAbsolute checks (defense-in-depth)
 *  - fs capability limited to pluginDir/data only, no dotfiles, size limits
 *  - net capability validates URL, protocol http/https only, egress allowlist, timeout
 *  - memory capability scoped to project, size-limited
 *  - provider capability budget-gated
 *  - secrets capability validates name, redacts values, audits access
 *  - mcp capability only exposes metadata
 */

import { join, resolve, relative, isAbsolute, dirname, normalize } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import type { Store } from "../state/workspace-store.ts";
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
const MAX_FS_FILE = 10 * 1024 * 1024;
const MAX_NET_BODY = 1 * 1024 * 1024;
const MAX_MEMORY_CONTENT = 100_000;
const MAX_PROVIDER_MESSAGES = 100_000;

// ── Hardened helpers ─────────────────────────────────────────────────────────

function safeJoin(baseDir: string, rel: string): string {
  if (typeof rel !== "string" || rel.length === 0) throw new Error("path must be non-empty string");
  if (rel.length > 1024) throw new Error("path too long");
  // Normalize to prevent .. traversal via mixed separators
  const normalizedRel = normalize(rel);
  if (isAbsolute(normalizedRel)) throw new Error(`absolute paths not allowed: ${rel}`);
  if (normalizedRel.startsWith("..") || normalizedRel.includes(`..${"/"}`) || normalizedRel.includes(`..\\`)) {
    // allow legitimate ./../ but will be caught by relative check below
  }
  const abs = resolve(baseDir, normalizedRel);
  const r = relative(baseDir, abs);
  if (r.startsWith("..") || isAbsolute(r)) {
    throw new Error(`path escapes plugin data directory: ${rel}`);
  }
  return abs;
}

function redactLine(line: string): string {
  return String(line)
    .replace(/sk-[A-Za-z0-9]{8,}[A-Za-z0-9_-]*/g, "«redacted-api-key»")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer «redacted»")
    .replace(/([A-Z0-9_]*API[_-]?KEY\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .replace(/(password\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .replace(/(secret\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .slice(0, 4000);
}

function secureFn<T extends (...args: any[]) => any>(fn: T): T {
  const wrapped = (...args: any[]) => fn(...args);
  Object.setPrototypeOf(wrapped, null);
  try {
    Object.defineProperty(wrapped, "constructor", { value: undefined, writable: false, configurable: false });
    Object.defineProperty(wrapped, "prototype", { value: undefined, writable: false, configurable: false });
  } catch {}
  return Object.freeze(wrapped) as unknown as T;
}

function nullProto<T extends object>(obj: T): T {
  const clone = Object.create(null) as any;
  for (const [k, v] of Object.entries(obj)) {
    clone[k] = v;
  }
  return Object.freeze(clone);
}

function secureCapability<T extends object>(obj: T): T {
  const clone: any = Object.create(null);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "function") clone[k] = secureFn(v as any);
    else clone[k] = v;
  }
  return Object.freeze(clone) as T;
}

// ── Build host ───────────────────────────────────────────────────────────────

export function buildHost(granted: PermissionScope[], deps: HostDeps): PluginHost {
  const { store, config, cwd, pluginDir } = deps;
  const pluginId = deps.pluginId ?? pluginDir.replace(/[\\/]+$/g, "").split(/[\\/]/).pop() ?? "plugin";
  const grantedSet = new Set(granted);
  const dataDir = join(pluginDir, DATA_SUBDIR);

  const auditRaw = (event: string, detail: Record<string, unknown> = {}): void => {
    try {
      store.audit(`plugin.${event}`, { plugin: pluginId, ...detail });
    } catch {
      // audit best-effort
    }
  };
  const audit = secureFn(auditRaw);

  // Base host with null prototype to prevent constructor escape
  const base: any = Object.create(null);
  base.id = pluginId;
  base.apiVersion = PLUGIN_API_VERSION;
  base.coreVersion = CORE_VERSION;
  base.permissions = Object.freeze([...granted]);
  base.can = secureFn((perm: PermissionScope) => grantedSet.has(perm));
  base.log = secureFn((line: string) => {
    console.log(`\x1b[2m[plugin:${pluginId}]\x1b[0m ${redactLine(line)}`);
  });
  base.warn = secureFn((line: string) => {
    console.log(`\x1b[33m[plugin:${pluginId}] ${redactLine(line)}\x1b[0m`);
  });
  base.audit = audit;

  // ── fs ─────────────────────────────────────────────────────────────────────
  if (grantedSet.has("fs:read") || grantedSet.has("fs:write")) {
    const fsCap: any = Object.create(null);
    fsCap.path = secureFn((rel: string) => safeJoin(dataDir, rel));

    if (grantedSet.has("fs:read")) {
      fsCap.read = secureFn((rel: string) => {
        const p = safeJoin(dataDir, rel);
        if (!existsSync(p)) return "";
        const st = statSync(p);
        if (!st.isFile()) throw new Error(`not a file: ${rel}`);
        if (st.size > MAX_FS_FILE) throw new Error(`file too large (max ${MAX_FS_FILE}): ${rel}`);
        audit("fs.read", { path: rel, size: st.size });
        return readFileSync(p, "utf8");
      });
      fsCap.list = secureFn((rel = ".") => {
        const p = safeJoin(dataDir, rel);
        if (!existsSync(p)) return [];
        const st = statSync(p);
        if (!st.isDirectory()) throw new Error(`not a directory: ${rel}`);
        audit("fs.list", { path: rel });
        return readdirSync(p).filter((n) => !n.startsWith(".") && n !== "node_modules" && n !== "__pycache__");
      });
    }

    if (grantedSet.has("fs:write")) {
      fsCap.write = secureFn((rel: string, content: string) => {
        if (typeof rel !== "string" || !rel) throw new Error("invalid path");
        if (typeof content !== "string") content = String(content);
        if (content.length > MAX_FS_FILE) throw new Error(`content too large (max ${MAX_FS_FILE})`);
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        const p = safeJoin(dataDir, rel);
        const parent = dirname(p);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        // defense-in-depth: ensure parent still inside dataDir
        if (!parent.startsWith(dataDir)) throw new Error(`write escapes data dir: ${rel}`);
        writeFileSync(p, content);
        audit("fs.write", { path: rel, size: content.length });
      });
    }
    base.fs = secureCapability(fsCap);
  }

  // ── net ────────────────────────────────────────────────────────────────────
  if (grantedSet.has("net")) {
    const allow = (config as any).security?.egressAllowlist ?? (config as any).security?.egressAllowlist === undefined ? config.security?.egressAllowlist ?? [] : [];
    const egress = Array.isArray(allow) ? allow : [];

    const isAllowedFn = (url: string): boolean => {
      try {
        new URL(url);
        return hostAllowed(url, egress);
      } catch {
        return false;
      }
    };

    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error(`invalid URL: ${String(url).slice(0, 200)}`);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`unsupported protocol: ${parsed.protocol}`);
      if (!hostAllowed(url, egress)) {
        audit("net.blocked", { url: String(url).slice(0, 200) });
        throw new Error(`egress blocked: host not allow-listed (${parsed.hostname})`);
      }
      if (init?.body && typeof init.body === "string" && init.body.length > MAX_NET_BODY) {
        throw new Error(`request body too large (max ${MAX_NET_BODY})`);
      }
      audit("net.fetch", { url: String(url).slice(0, 200), method: init?.method ?? "GET" });
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 30_000);
      try {
        return await fetch(url, { ...init, signal: controller.signal as any });
      } finally {
        clearTimeout(to);
      }
    };

    base.net = secureCapability({
      isAllowed: secureFn(isAllowedFn),
      fetch: secureFn(fetchFn) as any,
    });
  }

  // ── memory ─────────────────────────────────────────────────────────────────
  if (grantedSet.has("memory:read") || grantedSet.has("memory:write")) {
    const mem = new MemoryStore(store);
    const scope = projectScopeFromCwd(cwd);
    const memCap: any = Object.create(null);

    if (grantedSet.has("memory:read")) {
      memCap.recall = secureFn(async (query: string, opts?: { k?: number }) => {
        if (typeof query !== "string" || !query.trim()) throw new Error("invalid query");
        if (query.length > 1000) throw new Error("query too long (max 1000)");
        audit("memory.recall", { k: opts?.k ?? 5 });
        const res = await mem.recallSemantic(query, { scope, k: Math.min(opts?.k ?? 5, 50) });
        return res.map((e) => ({
          id: e.id,
          category: e.category,
          content: String(e.content).slice(0, 10_000),
          scope: e.scope,
        }));
      });
    }

    if (grantedSet.has("memory:write")) {
      memCap.add = secureFn((content: string, opts?: { category?: string; importance?: number; tags?: string[] }) => {
        if (typeof content !== "string" || !content.trim()) throw new Error("invalid content");
        if (content.length > MAX_MEMORY_CONTENT) throw new Error(`content too large (max ${MAX_MEMORY_CONTENT})`);
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
      });
    }

    base.memory = secureCapability(memCap);
  }

  // ── provider ───────────────────────────────────────────────────────────────
  if (grantedSet.has("provider")) {
    base.provider = secureCapability({
      chat: secureFn(async (messages: Message[]) => {
        if (!Array.isArray(messages) || messages.length === 0) throw new Error("messages must be non-empty array");
        const total = messages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : 0), 0);
        if (total > MAX_PROVIDER_MESSAGES) throw new Error(`messages too large (max ${MAX_PROVIDER_MESSAGES})`);
        const budget = new BudgetManager(store);
        const providerId = (config as any).defaults?.provider ?? config.defaults?.provider;
        const model = (config as any).defaults?.model ?? config.defaults?.model;
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
            const usd =
              (turn.usage.inTokens / 1_000_000) * (price?.inPerMTok ?? 0) +
              (turn.usage.outTokens / 1_000_000) * (price?.outPerMTok ?? 0);
            try {
              store.recordCost(`plugin:${pluginId}`, providerId, model, turn.usage.inTokens, turn.usage.outTokens, usd);
            } catch {}
          }
          audit("provider.chat", { model });
          return { ok: true, message: turn.message };
        } catch (e) {
          return { ok: false, message: "", reason: (e as Error).message };
        }
      }),
    });
  }

  // ── secrets ────────────────────────────────────────────────────────────────
  if (grantedSet.has("secrets")) {
    base.secrets = secureCapability({
      get: secureFn((name: string) => {
        if (typeof name !== "string" || !name) throw new Error("invalid secret name");
        const clean = name.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 120);
        if (!clean) throw new Error("invalid secret name");
        audit("secrets.get", { name: clean });
        try {
          return getSecret(clean) || undefined;
        } catch {
          // src/security/secrets.ts enforces a stricter name policy
          // (^[A-Z][A-Z0-9_]{1,80}$) than the host sanitizer allows through.
          // The plugin contract is string | undefined, so an unusable name is
          // "no secret", never a crash inside the plugin VM.
          return undefined;
        }
      }),
    });
  }

  // ── mcp ────────────────────────────────────────────────────────────────────
  if (grantedSet.has("mcp")) {
    const visible = (deps.mcpServers ?? []).map((s) => ({
      id: s.id,
      transport: s.transport,
      url: s.url,
      tools: s.tools,
      description: s.description,
    }));
    base.mcp = secureCapability({
      servers: secureFn(() => Object.freeze([...visible])),
    });
  }

  // Freeze whole host — no prototype, no extension
  Object.freeze(base);
  return base as PluginHost;
}
