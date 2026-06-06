/**
 * XR 1.0 — plugin manager (high-level orchestrator).
 *
 * The single entry point the CLI, agent, and doctor use. It ties together the
 * registry (what's installed), the loader (safe load), and the host (capability
 * boundary), and exposes:
 *
 *   • install / remove / enable / disable / update
 *   • inspect (manifest + permissions + compatibility, no code run)
 *   • loadEnabled() → activate all enabled plugins, isolate failures
 *   • pluginTools() → contributed tools adapted into core Tools for the agent
 *   • health() → per-plugin status for `xr doctor`
 *
 * Every install/enable is EXPLICIT and audited. A broken plugin is isolated and
 * never affects the core or other plugins.
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import type { Store } from "../state/db.ts";
import { loadConfig, type XRConfig } from "../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { PluginRegistry, type RegistryEntry } from "./registry.ts";
import {
  loadPlugin,
  validatePlugin,
  hashEntrypoint,
  type LoadResult,
} from "./loader.ts";
import { effectiveGrant } from "./manifest.ts";
import { checkCompatibility } from "./compat.ts";
import type {
  PermissionScope,
  PluginCommand,
  PluginContributions,
  PluginManifest,
  PluginStatus,
  PluginTool,
} from "./types.ts";

export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  contributions: PluginContributions;
  granted: PermissionScope[];
}

export interface InstallResult {
  ok: boolean;
  manifest?: PluginManifest;
  reason?: string;
  /** Permissions the manifest requests (for the approval prompt). */
  requestedPermissions?: PermissionScope[];
}

export class PluginManager {
  private registry: PluginRegistry;
  private config: XRConfig;
  private loaded: Map<string, LoadedPlugin> = new Map();
  private loadErrors: Map<string, { reason: string; kind: string }> = new Map();

  constructor(
    private store: Store,
    private cwd: string = process.cwd(),
    config?: XRConfig,
  ) {
    this.registry = new PluginRegistry();
    this.config = config ?? loadConfig().config;
  }

  get warnings(): string[] {
    return this.registry.warnings;
  }

  // ── Inspect (no code execution) ───────────────────────────────────────────────

  /** Inspect a directory OR an installed plugin id without running its code. */
  inspect(idOrDir: string): {
    ok: boolean;
    manifest?: PluginManifest;
    errors: string[];
    installed: boolean;
    granted?: PermissionScope[];
    enabled?: boolean;
  } {
    const dir = this.resolveDir(idOrDir);
    const v = validatePlugin(dir);
    const entry = this.registry.get(v.manifest?.id ?? idOrDir);
    return {
      ok: v.ok,
      manifest: v.manifest,
      errors: v.errors,
      installed: Boolean(entry),
      granted: entry?.grantedPermissions,
      enabled: entry?.enabled,
    };
  }

  /** Resolve an id (installed) or a path (to install from) to a directory. */
  private resolveDir(idOrDir: string): string {
    if (this.registry.has(idOrDir)) return this.registry.dirFor(idOrDir);
    const abs = isAbsolute(idOrDir) ? idOrDir : resolve(this.cwd, idOrDir);
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
    // Fall back to the conventional install dir for the id.
    return this.registry.dirFor(idOrDir);
  }

  // ── Install / remove ───────────────────────────────────────────────────────────

  /**
   * Stage a local plugin source for install: validate it and return the
   * requested permissions so the caller can show an approval prompt. Does NOT
   * activate. The actual filesystem copy + registry write happens in
   * `commitInstall` after the user approves.
   */
  prepareInstall(source: string): InstallResult {
    const src = isAbsolute(source) ? source : resolve(this.cwd, source);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      return { ok: false, reason: `plugin source is not a directory: ${source}` };
    }
    const v = validatePlugin(src);
    if (!v.ok || !v.manifest) {
      return { ok: false, reason: v.errors.join("; ") || "invalid plugin" };
    }
    return {
      ok: true,
      manifest: v.manifest,
      requestedPermissions: v.manifest.permissions,
    };
  }

  /**
   * Copy a validated plugin source into XR_HOME/plugins/<id> and register it
   * with the granted permissions. `enabled` defaults to false: explicit by
   * design — the user enables it as a separate, conscious step.
   */
  commitInstall(
    source: string,
    grantedPermissions: PermissionScope[],
    opts: { enable?: boolean; updateSource?: string } = {},
  ): InstallResult {
    const prep = this.prepareInstall(source);
    if (!prep.ok || !prep.manifest) return prep;
    const manifest = prep.manifest;

    const src = isAbsolute(source) ? source : resolve(this.cwd, source);
    const dest = this.registry.dirFor(manifest.id);

    // Idempotent reinstall: clear any prior copy first.
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });

    const granted = effectiveGrant(manifest.permissions, grantedPermissions);
    const installedHash = hashEntrypoint(dest, manifest);
    const entry = PluginRegistry.newEntry(manifest, granted, {
      enabled: opts.enable ?? false,
      installedHash,
    });
    if (opts.updateSource) entry.updateSource = opts.updateSource;
    else entry.updateSource = manifest.updateSource ?? src;
    entry.source = manifest.source ?? src;
    this.registry.upsert(entry);

    this.store.audit("plugin.install", {
      plugin: manifest.id,
      version: manifest.version,
      granted,
      enabled: entry.enabled,
    });

    return { ok: true, manifest, requestedPermissions: granted };
  }

  /** Remove a plugin entirely: dispose if loaded, delete files + registry row. */
  async remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };

    await this.disposeOne(id);
    const dir = this.registry.dirFor(id);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    this.registry.remove(id);
    this.store.audit("plugin.remove", { plugin: id });
    return { ok: true };
  }

  // ── Enable / disable ───────────────────────────────────────────────────────────

  enable(id: string): { ok: boolean; reason?: string } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };

    // Compatibility re-check at enable time (core may have changed).
    const v = validatePlugin(this.registry.dirFor(id));
    if (!v.ok || !v.manifest) {
      return { ok: false, reason: v.errors.join("; ") || "invalid plugin" };
    }
    const compat = checkCompatibility(
      CORE_VERSION,
      v.manifest.apiVersion,
      PLUGIN_API_VERSION,
      v.manifest.compatibility,
    );
    if (!compat.ok) return { ok: false, reason: compat.reason };

    // Dependency gate: required plugins must be installed AND enabled.
    for (const dep of v.manifest.dependencies) {
      const d = this.registry.get(dep);
      if (!d) return { ok: false, reason: `missing dependency: ${dep} (install it first)` };
      if (!d.enabled) return { ok: false, reason: `dependency not enabled: ${dep} (enable it first)` };
    }

    this.registry.setEnabled(id, true);
    this.store.audit("plugin.enable", { plugin: id });
    return { ok: true };
  }

  async disable(id: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };

    // Refuse to leave a dependent plugin dangling.
    const dependents = this.registry
      .list()
      .filter((e) => e.enabled && this.dependsOn(e.id, id));
    if (dependents.length) {
      return {
        ok: false,
        reason: `still required by enabled plugin(s): ${dependents.map((d) => d.id).join(", ")}`,
      };
    }

    await this.disposeOne(id);
    this.registry.setEnabled(id, false);
    this.store.audit("plugin.disable", { plugin: id });
    return { ok: true };
  }

  private dependsOn(id: string, dep: string): boolean {
    const v = validatePlugin(this.registry.dirFor(id));
    return Boolean(v.manifest?.dependencies.includes(dep));
  }

  // ── Update ─────────────────────────────────────────────────────────────────────

  /**
   * Update a plugin from a local source directory (its recorded updateSource by
   * default). Re-validates and re-installs, preserving granted permissions and
   * enabled state. If the new manifest requests NEW permissions, the update is
   * rejected and the new permissions are reported so the user can re-approve.
   */
  update(id: string, source?: string): InstallResult & { newPermissions?: PermissionScope[] } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };

    const src = source ?? entry.updateSource;
    if (!src) return { ok: false, reason: `no update source recorded for ${id}` };

    const prep = this.prepareInstall(src);
    if (!prep.ok || !prep.manifest) return prep;
    if (prep.manifest.id !== id) {
      return { ok: false, reason: `update source id "${prep.manifest.id}" does not match "${id}"` };
    }

    const newPerms = prep.manifest.permissions.filter(
      (p) => !entry.grantedPermissions.includes(p),
    );
    if (newPerms.length) {
      return {
        ok: false,
        manifest: prep.manifest,
        reason: `update requests new permissions — re-install to approve`,
        newPermissions: newPerms,
      };
    }

    const res = this.commitInstall(src, entry.grantedPermissions, {
      enable: entry.enabled,
      updateSource: src,
    });
    if (res.ok) {
      this.store.audit("plugin.update", { plugin: id, version: prep.manifest.version });
    }
    return res;
  }

  // ── Permissions ────────────────────────────────────────────────────────────────

  /** Re-grant permissions for an installed plugin (subset of declared). */
  setPermissions(id: string, perms: PermissionScope[]): { ok: boolean; reason?: string; granted?: PermissionScope[] } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    const v = validatePlugin(this.registry.dirFor(id));
    if (!v.manifest) return { ok: false, reason: "invalid plugin" };
    const granted = effectiveGrant(v.manifest.permissions, perms);
    this.registry.setPermissions(id, granted);
    this.store.audit("plugin.permissions", { plugin: id, granted });
    return { ok: true, granted };
  }

  // ── Load enabled plugins (activation) ────────────────────────────────────────

  /**
   * Activate every enabled plugin. Failures are isolated and recorded — the
   * method always resolves. Dependencies are loaded before dependents.
   */
  async loadEnabled(): Promise<void> {
    this.loaded.clear();
    this.loadErrors.clear();
    // Global hard off-switch: when plugins.enabled is false, nothing is loaded
    // into the agent (the `xr plugins …` management commands still work).
    if ((this.config as any).plugins?.enabled === false) return;
    const enabled = this.registry.list().filter((e) => e.enabled);
    const ordered = this.topoSort(enabled);

    for (const entry of ordered) {
      await this.loadOne(entry);
    }
  }

  private async loadOne(entry: RegistryEntry): Promise<void> {
    const dir = this.registry.dirFor(entry.id);
    // Respect config: trust enforcement may be disabled (e.g. local dev), and a
    // denied-permission policy strips scopes before they ever reach the host.
    const pluginCfg = (this.config as any).plugins ?? {};
    const requireTrust = pluginCfg.requireTrust !== false;
    const denied: Set<string> = new Set(pluginCfg.deniedPermissions ?? []);
    const granted = entry.grantedPermissions.filter((p) => !denied.has(p));
    const res: LoadResult = await loadPlugin(dir, {
      store: this.store,
      config: this.config,
      cwd: this.cwd,
      granted,
      expectedHash: requireTrust ? entry.installedHash : undefined,
    });
    if (res.ok) {
      this.loaded.set(entry.id, {
        id: entry.id,
        manifest: res.manifest,
        contributions: res.contributions,
        granted: res.granted,
      });
      this.store.audit("plugin.load", {
        plugin: entry.id,
        tools: res.contributions.tools?.length ?? 0,
        commands: res.contributions.commands?.length ?? 0,
      });
    } else {
      this.loadErrors.set(entry.id, { reason: res.reason, kind: res.kind });
      this.store.audit("plugin.load_error", { plugin: entry.id, kind: res.kind, reason: res.reason });
    }
  }

  /** Dependencies-first ordering; cycles are broken deterministically. */
  private topoSort(entries: RegistryEntry[]): RegistryEntry[] {
    const byId = new Map(entries.map((e) => [e.id, e]));
    const out: RegistryEntry[] = [];
    const seen = new Set<string>();
    const visit = (e: RegistryEntry, stack: Set<string>) => {
      if (seen.has(e.id) || stack.has(e.id)) return;
      stack.add(e.id);
      const v = validatePlugin(this.registry.dirFor(e.id));
      for (const dep of v.manifest?.dependencies ?? []) {
        const d = byId.get(dep);
        if (d) visit(d, stack);
      }
      stack.delete(e.id);
      seen.add(e.id);
      out.push(e);
    };
    for (const e of entries) visit(e, new Set());
    return out;
  }

  private async disposeOne(id: string): Promise<void> {
    const lp = this.loaded.get(id);
    if (lp?.contributions.dispose) {
      try {
        await lp.contributions.dispose();
      } catch {
        /* dispose must not break disable/remove */
      }
    }
    this.loaded.delete(id);
  }

  // ── Contributions exposed to the rest of XR ──────────────────────────────────

  /** All loaded plugins (after loadEnabled). */
  getLoaded(): LoadedPlugin[] {
    return [...this.loaded.values()];
  }

  /** A contributed command, looked up as <pluginId> <command>. */
  findCommand(pluginId: string, command: string): { plugin: LoadedPlugin; cmd: PluginCommand } | null {
    const lp = this.loaded.get(pluginId);
    const cmd = lp?.contributions.commands?.find((c) => c.name === command);
    return lp && cmd ? { plugin: lp, cmd } : null;
  }

  /**
   * Adapt all contributed plugin tools into core Tools — namespaced
   * `plugin.<id>.<name>` and (by default) approval-gated. These plug straight
   * into the agent's tool list, inheriting the agent's approval + audit context.
   */
  pluginTools(): Tool[] {
    const tools: Tool[] = [];
    for (const lp of this.loaded.values()) {
      for (const pt of lp.contributions.tools ?? []) {
        tools.push(adaptTool(lp.id, pt));
      }
    }
    return tools;
  }

  // ── Health / status ───────────────────────────────────────────────────────────

  health(): Array<{ entry: RegistryEntry; manifest?: PluginManifest; status: PluginStatus }> {
    return this.registry.list().map((entry) => {
      const v = validatePlugin(this.registry.dirFor(entry.id));
      const err = this.loadErrors.get(entry.id);
      let status: PluginStatus;
      if (err) {
        status = {
          kind: err.kind === "incompatible" ? "incompatible" : err.kind === "untrusted" ? "untrusted" : "error",
          loaded: false,
          detail: err.reason,
        };
      } else if (!v.ok) {
        status = { kind: "error", loaded: false, detail: v.errors.join("; ") };
      } else if (this.loaded.has(entry.id)) {
        const lp = this.loaded.get(entry.id)!;
        status = {
          kind: "enabled",
          loaded: true,
          contributions:
            (lp.contributions.tools?.length ?? 0) + (lp.contributions.commands?.length ?? 0),
        };
      } else {
        status = { kind: entry.enabled ? "enabled" : "disabled", loaded: false };
      }
      return { entry, manifest: v.manifest, status };
    });
  }

  /** Convenience for `xr doctor`: counts only. */
  summary(): { installed: number; enabled: number; loaded: number; errored: number } {
    const all = this.registry.list();
    return {
      installed: all.length,
      enabled: all.filter((e) => e.enabled).length,
      loaded: this.loaded.size,
      errored: this.loadErrors.size,
    };
  }

  /** Direct registry access for the CLI list view. */
  listInstalled(): RegistryEntry[] {
    return this.registry.list();
  }
  getEntry(id: string): RegistryEntry | undefined {
    return this.registry.get(id);
  }
  dirFor(id: string): string {
    return this.registry.dirFor(id);
  }
}

/**
 * Wrap a PluginTool as a core Tool. The wrapper is the runtime security
 * boundary: namespaced name, approval gate (unless the plugin opted out AND it's
 * read-only), audit on every call. The plugin tool itself only ever received a
 * permission-scoped host at activate time, so it cannot exceed its grant here.
 */
function adaptTool(pluginId: string, pt: PluginTool): Tool {
  const fqName = `plugin.${pluginId}.${pt.name}`;
  const requiresApproval = pt.requiresApproval !== false; // default: approve
  return {
    name: fqName,
    description: `[plugin:${pluginId}] ${pt.description}`,
    parameters: pt.parameters ?? {},
    requiresApproval,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      if (requiresApproval) {
        const approved = await ctx.approve({
          tool: fqName,
          reason: `run plugin tool from "${pluginId}"`,
          preview: JSON.stringify(args).slice(0, 300),
        });
        if (!approved) {
          ctx.audit("plugin.tool.denied", { plugin: pluginId, tool: pt.name });
          return { ok: false, output: "plugin tool call denied" };
        }
      }
      if (ctx.dryRun) {
        return { ok: true, output: `[dry-run] would call ${fqName}` };
      }
      try {
        const res = await pt.run(args);
        ctx.audit("plugin.tool.call", { plugin: pluginId, tool: pt.name, ok: res.ok });
        return { ok: res.ok, output: String(res.output ?? "").slice(0, 4000), data: res.data };
      } catch (e) {
        ctx.audit("plugin.tool.error", { plugin: pluginId, tool: pt.name, error: (e as Error).message });
        return { ok: false, output: `plugin tool error: ${(e as Error).message}` };
      }
    },
  };
}
