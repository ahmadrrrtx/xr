/**
 * XR 1.0 — the PluginHost: the ONLY surface a plugin ever touches.
 *
 * This is the security boundary. A plugin never receives the Store, the raw
 * config, process.env, fetch, or the node fs module. It receives a frozen host
 * whose capabilities are present ONLY for the permissions it was granted. An
 * ungranted capability is simply `undefined`, so a plugin physically cannot,
 * say, read a secret unless the user approved `secrets`.
 *
 * Every capability re-uses XR's existing, audited core systems instead of
 * re-implementing them — so plugins inherit (and cannot bypass):
 *   • the egress allow-list           (net.fetch)
 *   • the spend caps / budget gate     (provider.chat)
 *   • durable-memory rules + provenance(memory.*)
 *   • the OS-backed secret store        (secrets.get — value never logged)
 *   • the tamper-evident audit log      (every sensitive call is audited)
 */
import { join, resolve, relative, isAbsolute } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
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
import type { PermissionScope } from "./types.ts";

// ── Capability interfaces (each present only when its permission is granted) ─────

export interface FsCapability {
  /** Resolve a path inside the plugin's private data dir (never escapes it). */
  path(rel: string): string;
  /** Read a UTF-8 file from the plugin data dir. (needs fs:read) */
  read?(rel: string): string;
  /** Write a UTF-8 file to the plugin data dir. (needs fs:write) */
  write?(rel: string, content: string): void;
  /** List entries in the plugin data dir. (needs fs:read) */
  list?(rel?: string): string[];
}

export interface NetCapability {
  /** fetch, but the URL host MUST be on the user's egress allow-list. */
  fetch(url: string, init?: RequestInit): Promise<Response>;
  /** Is this host currently allowed? (lets a plugin fail gracefully) */
  isAllowed(url: string): boolean;
}

export interface MemoryCapability {
  /** Recall relevant memory (read). (needs memory:read) */
  recall?(query: string, opts?: { k?: number }): Promise<
    Array<{ id: string; category: string; content: string; scope: string }>
  >;
  /** Add a durable memory entry, tagged with the plugin's provenance. (needs memory:write) */
  add?(content: string, opts?: { category?: string; importance?: number; tags?: string[] }): {
    ok: boolean;
    reason?: string;
  };
}

export interface ProviderCapability {
  /**
   * One LLM turn. Spend-capped: if the global budget is exhausted this returns
   * an error result instead of spending. Never bypasses BudgetManager.
   */
  chat(messages: Message[]): Promise<{ ok: boolean; message: string; reason?: string }>;
}

export interface SecretsCapability {
  /** Read a named secret. The VALUE is returned to the plugin but NEVER logged. */
  get(name: string): string | undefined;
}

export interface PluginHost {
  /** Stable plugin id (namespacing). */
  readonly id: string;
  /** Host ABI version (see core/version.ts). */
  readonly apiVersion: number;
  /** Running XR core version. */
  readonly coreVersion: string;
  /** The permissions actually granted to this plugin. */
  readonly permissions: readonly PermissionScope[];

  /** True if a given permission was granted. */
  can(perm: PermissionScope): boolean;

  /** Structured logging that routes to XR (never prints raw secrets). */
  log(line: string): void;
  warn(line: string): void;

  /**
   * Append to the tamper-evident audit log under this plugin's namespace.
   * Detail is redacted by the store; never pass raw secrets.
   */
  audit(event: string, detail?: Record<string, unknown>): void;

  // Capabilities — present ONLY when the matching permission was granted.
  fs?: FsCapability;
  net?: NetCapability;
  memory?: MemoryCapability;
  provider?: ProviderCapability;
  secrets?: SecretsCapability;
}

export interface HostDeps {
  store: Store;
  config: XRConfig;
  cwd: string;
  /** Absolute plugin install dir (its private data dir lives under here). */
  pluginDir: string;
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

/**
 * Build a frozen PluginHost. The returned object only carries the capabilities
 * for `granted` permissions — everything else is genuinely absent.
 */
export function buildHost(
  granted: PermissionScope[],
  deps: HostDeps,
): PluginHost {
  const { store, config, cwd, pluginDir } = deps;
  const id = require_id(pluginDir);
  const grantedSet = new Set(granted);
  const dataDir = join(pluginDir, DATA_SUBDIR);

  const audit = (event: string, detail: Record<string, unknown> = {}): void => {
    try {
      store.audit(`plugin.${event}`, { plugin: id, ...detail });
    } catch {
      /* auditing is best-effort; never break a plugin on it */
    }
  };

  const host: PluginHost = {
    id,
    apiVersion: PLUGIN_API_VERSION,
    coreVersion: CORE_VERSION,
    permissions: Object.freeze([...granted]),
    can: (perm) => grantedSet.has(perm),
    log: (line) => console.log(`\x1b[2m[plugin:${id}]\x1b[0m ${line}`),
    warn: (line) => console.log(`\x1b[33m[plugin:${id}] ${line}\x1b[0m`),
    audit,
  };

  // ── fs (sandboxed to the plugin's own data dir) ──────────────────────────────
  if (grantedSet.has("fs:read") || grantedSet.has("fs:write")) {
    const fsCap: FsCapability = {
      path: (rel) => safeJoin(dataDir, rel),
    };
    if (grantedSet.has("fs:read")) {
      fsCap.read = (rel) => {
        const p = safeJoin(dataDir, rel);
        return existsSync(p) ? readFileSync(p, "utf8") : "";
      };
      fsCap.list = (rel = ".") => {
        const p = safeJoin(dataDir, rel);
        return existsSync(p) ? readdirSync(p) : [];
      };
    }
    if (grantedSet.has("fs:write")) {
      fsCap.write = (rel, content) => {
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        const p = safeJoin(dataDir, rel);
        const parent = resolve(p, "..");
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(p, String(content));
        audit("fs.write", { path: rel });
      };
    }
    host.fs = fsCap;
  }

  // ── net (egress allow-list enforced; cannot be widened by the plugin) ────────
  if (grantedSet.has("net")) {
    const allow = config.security.egressAllowlist ?? [];
    host.net = {
      isAllowed: (url) => hostAllowed(url, allow),
      fetch: async (url, init) => {
        if (!hostAllowed(url, allow)) {
          audit("net.blocked", { url: String(url).slice(0, 200) });
          throw new Error(
            `egress blocked: host not in allow-list (${String(url).slice(0, 120)})`,
          );
        }
        audit("net.fetch", { url: String(url).slice(0, 200) });
        return fetch(url, init);
      },
    };
  }

  // ── memory (re-uses MemoryStore rules + provenance) ──────────────────────────
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
          // provenance: an imported/plugin-sourced memory is marked as import.
          source: "import",
          importance: opts?.importance,
          tags: [...(opts?.tags ?? []), `plugin:${id}`],
        });
        audit("memory.add", { ok: r.ok, duplicate: r.duplicate ?? false });
        return { ok: r.ok, reason: r.reason };
      };
    }
    host.memory = memCap;
  }

  // ── provider (spend-capped; never bypasses BudgetManager) ────────────────────
  if (grantedSet.has("provider")) {
    host.provider = {
      chat: async (messages) => {
        const budget = new BudgetManager(store);
        const providerId = config.defaults.provider;
        const model = config.defaults.model;
        // Hard spend gate: if cloud + over budget, refuse (no silent fallback to
        // spend). Local models are free and always allowed.
        if (!isLocal(providerId)) {
          const status = budget.getStatus();
          if (status.isOverBudget) {
            audit("provider.blocked", { reason: "budget exhausted" });
            return {
              ok: false,
              message: "",
              reason: `budget exhausted ($${status.monthlySpend.toFixed(2)} / $${status.monthlyCap.toFixed(2)})`,
            };
          }
        }
        try {
          const provider = buildProvider(config, { provider: providerId, model });
          const turn = await provider.chat(messages, []);
          // Record spend so the plugin cannot get free uncapped LLM calls.
          if (turn.usage) {
            const price = priceFor(providerId, model);
            const usd =
              (turn.usage.inTokens / 1_000_000) * (price?.inPerMTok ?? 0) +
              (turn.usage.outTokens / 1_000_000) * (price?.outPerMTok ?? 0);
            try {
              store.recordCost(`plugin:${id}`, providerId, model, turn.usage.inTokens, turn.usage.outTokens, usd);
            } catch {
              /* best-effort cost logging */
            }
          }
          audit("provider.chat", { model });
          return { ok: true, message: turn.message };
        } catch (e) {
          return { ok: false, message: "", reason: (e as Error).message };
        }
      },
    };
  }

  // ── secrets (value returned to plugin, NEVER logged) ─────────────────────────
  if (grantedSet.has("secrets")) {
    host.secrets = {
      get: (name) => {
        // Audit only the NAME — never the value (store also redacts defensively).
        audit("secrets.get", { name });
        return getSecret(name);
      },
    };
  }

  return Object.freeze(host);
}

/** Derive the plugin id from its install dir (the dir name equals the id). */
function require_id(pluginDir: string): string {
  const parts = pluginDir.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || "plugin";
}
