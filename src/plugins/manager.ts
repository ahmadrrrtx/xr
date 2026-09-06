/** XR Stage 10 — high-level plugin platform manager. */
import { cpSync, existsSync, mkdirSync, rmSync, renameSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Store } from "../state/workspace-store.ts";
import { loadConfig, type XRConfig } from "../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { McpClient, wrapMcpTool } from "../mcp/client.ts";
import { PluginRegistry, type PluginRollbackSnapshot, type RegistryEntry } from "./registry.ts";
import { effectiveGrant } from "./manifest.ts";
import { checkCompatibility } from "./compat.ts";
import { hashEntrypoint, hashPluginTree, loadPlugin, validatePlugin, type LoadResult } from "./loader.ts";
import { loadPluginSkills } from "./skills.ts";
import type { LoadedSkill } from "../skills/loader.ts";
import { SENSITIVE_PERMISSIONS, type PermissionScope, type PluginCommand, type PluginContributions, type PluginManifest, type PluginStatus, type PluginTool } from "./types.ts";
import { CapabilityProvenanceStore } from "../platform/capabilities/provenance.ts";
import { capabilityId } from "../platform/capabilities/types.ts";
import { requireGrant } from "../capabilities/enforce.ts";
import { PluginTrustStore, pluginsAllowUnsignedEnv, pluginRiskTier, highRiskPermissions } from "./signing.ts";

/**
 * Windows-safe filesystem primitives (CF-3). On Windows, antivirus (Defender)
 * and the search indexer can hold transient handles on freshly written plugin
 * files, turning `renameSync`/`rmSync` into EBUSY/EPERM throws. `rmSync`
 * already supports `maxRetries`/`retryDelay` for exactly this class; `renameSync`
 * does not, so wrap it with the same bounded, backoff retry contract. On
 * POSIX these are no-ops (first attempt succeeds).
 */
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
function syncSleep(ms: number): void {
  try {
    Atomics.wait(sleepBuffer, 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      /* spin */
    }
  }
}
function rmSyncRetry(path: string): void {
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
function renameSyncRetry(src: string, dest: string, attempts = 10): void {
  for (let i = 0; ; i++) {
    try {
      renameSync(src, dest);
      return;
    } catch (e) {
      if (i >= attempts) throw e;
      syncSleep(100 * (i + 1));
    }
  }
}


export interface LoadedPlugin {
  id: string;
  manifest: PluginManifest;
  contributions: PluginContributions;
  granted: PermissionScope[];
  mcpTools: Tool[];
  skills: LoadedSkill[];
}


function safeRollbackVersion(version: string | undefined): string {
  return (version ?? "unknown").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

/**
 * Phase 7 · T1 — record provenance events from the plugin plane.
 * Best-effort derived evidence: a provenance write failure must never break an
 * install/rollback (the registry remains authoritative); we surface the
 * problem on stderr instead of swallowing it silently.
 */
function recordProvenance(record: (store: CapabilityProvenanceStore) => void): void {
  try {
    record(new CapabilityProvenanceStore());
  } catch (e) {
    console.warn(`[provenance] plugin event not recorded: ${(e as Error).message}`);
  }
}

/**
 * A unique directory for one rollback snapshot.
 *
 * The name used to be `${Date.now()}-${version}`, which is NOT unique: two
 * snapshots of the same version taken inside the same millisecond produce the
 * identical path (measured: ~100% of back-to-back calls). An update
 * immediately followed by a rollback does exactly that, so the second snapshot
 * was written on top of the first — `cpSync` merged the two trees and the
 * "previous version" a rollback restored could be a mix of both. Faster hosts
 * hit the same-millisecond window more often, which is why this surfaced on
 * the Windows lane first.
 *
 * A random suffix makes the path unique regardless of clock granularity.
 */
function rollbackSnapshotDir(dest: string, version: string | undefined): string {
  const unique = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  return `${dest}.rollback/${unique}-${safeRollbackVersion(version)}`;
}

export interface InstallResult {
  ok: boolean;
  manifest?: PluginManifest;
  reason?: string;
  requestedPermissions?: PermissionScope[];
  warnings?: string[];
}

export class PluginManager {
  private registry: PluginRegistry;
  private config: XRConfig;
  private loaded: Map<string, LoadedPlugin> = new Map();
  private loadErrors: Map<string, { reason: string; kind: string }> = new Map();

  constructor(private store: Store, private cwd: string = process.cwd(), config?: XRConfig) {
    this.registry = new PluginRegistry();
    this.config = config ?? loadConfig().config;
  }

  get warnings(): string[] { return this.registry.warnings; }

  inspect(idOrDir: string): { ok: boolean; manifest?: PluginManifest; errors: string[]; warnings: string[]; installed: boolean; granted?: PermissionScope[]; enabled?: boolean; dir?: string } {
    const dir = this.resolveDir(idOrDir);
    const v = validatePlugin(dir);
    const entry = this.registry.get(v.manifest?.id ?? idOrDir);
    return { ok: v.ok, manifest: v.manifest, errors: v.errors, warnings: v.warnings, installed: Boolean(entry), granted: entry?.grantedPermissions, enabled: entry?.enabled, dir };
  }

  private resolveDir(idOrDir: string): string {
    if (this.registry.has(idOrDir)) return this.registry.dirFor(idOrDir);
    const abs = isAbsolute(idOrDir) ? idOrDir : resolve(this.cwd, idOrDir);
    if (existsSync(abs) && statSync(abs).isDirectory()) return abs;
    return this.registry.dirFor(idOrDir);
  }

  prepareInstall(source: string): InstallResult {
    const src = isAbsolute(source) ? source : resolve(this.cwd, source);
    if (!existsSync(src) || !statSync(src).isDirectory()) return { ok: false, reason: `plugin source is not a directory: ${source}` };
    const v = validatePlugin(src);
    if (!v.ok || !v.manifest) return { ok: false, reason: v.errors.join("; ") || "invalid plugin", warnings: v.warnings };
    return { ok: true, manifest: v.manifest, requestedPermissions: v.manifest.permissions, warnings: v.warnings };
  }

  commitInstall(source: string, grantedPermissions: PermissionScope[], opts: { enable?: boolean; updateSource?: string } = {}): InstallResult {
    const prep = this.prepareInstall(source);
    if (!prep.ok || !prep.manifest) return prep;
    const manifest = prep.manifest;
    const src = isAbsolute(source) ? source : resolve(this.cwd, source);
    const dest = this.registry.dirFor(manifest.id);
    // Same uniqueness hazard as rollbackSnapshotDir(): `Date.now()` alone is
    // not unique, so two installs of the same plugin inside one millisecond
    // (update → rollback → re-install in a single test, or two fast CLI calls)
    // reuse the SAME staging and backup directories. The second install then
    // stages into the first one's tree and `renameSyncRetry(dest, bak)` can
    // clobber a backup that is still the only copy of the previous version.
    // A random suffix removes the dependence on clock granularity.
    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const tmp = `${dest}.stage-${stamp}`;
    const bak = `${dest}.bak-${stamp}`;
    const hadPrevious = existsSync(dest);
    const previousEntry = this.registry.get(manifest.id);

    try {
      if (existsSync(tmp)) rmSyncRetry(tmp);
      mkdirSync(tmp, { recursive: true });
      cpSync(src, tmp, { recursive: true, dereference: false });

      const post = validatePlugin(tmp);
      if (!post.ok || !post.manifest) throw new Error(post.errors.join("; ") || "staged plugin failed validation");
      if (post.manifest.id !== manifest.id) throw new Error("staged manifest id changed during install");

      if (hadPrevious) renameSyncRetry(dest, bak);
      renameSyncRetry(tmp, dest);

      const rollbackSnapshots: PluginRollbackSnapshot[] = [...(previousEntry?.rollback ?? [])];
      if (existsSync(bak) && previousEntry) {
        const snapDir = rollbackSnapshotDir(dest, previousEntry.version);
        mkdirSync(dirname(snapDir), { recursive: true });
        cpSync(bak, snapDir, { recursive: true, dereference: false });
        rollbackSnapshots.unshift({
          version: previousEntry.version ?? "unknown",
          dir: snapDir,
          treeHash: previousEntry.treeHash,
          installedHash: previousEntry.installedHash,
          grantedPermissions: previousEntry.grantedPermissions,
          at: Date.now(),
        });
      }
      if (existsSync(bak)) rmSyncRetry(bak);

      const granted = effectiveGrant(manifest.permissions, grantedPermissions);
      const installedHash = hashEntrypoint(dest, manifest);
      const treeHash = hashPluginTree(dest);
      const entry = PluginRegistry.newEntry(manifest, granted, {
        enabled: opts.enable ?? false,
        installedHash,
        treeHash,
        source: typeof manifest.source === "string" ? manifest.source : manifest.source?.url ?? src,
        updateSource: opts.updateSource ?? manifest.updateSource ?? src,
      });
      entry.rollback = rollbackSnapshots.slice(0, 10);
      entry.history = [...(previousEntry?.history ?? []), ...(entry.history ?? [])].slice(-100);
      this.registry.upsert(entry);
      this.store.audit("plugin.install", { plugin: manifest.id, version: manifest.version, granted, enabled: entry.enabled, treeHash });
      const cid = capabilityId("plugin", manifest.id);
      recordProvenance((p) => p.recordEvent(cid, hadPrevious ? "update" : "install", {
        actor: "user",
        detail: `${hadPrevious ? "updated to" : "installed"} v${manifest.version}${entry.enabled ? " (enabled)" : ""}`,
        outcome: { status: "success", detail: "plugin staged, validated and registry-committed" },
      }));
      return { ok: true, manifest, requestedPermissions: granted, warnings: prep.warnings };
    } catch (e) {
      try { if (existsSync(tmp)) rmSyncRetry(tmp); } catch {}
      try { if (existsSync(bak) && !existsSync(dest)) renameSyncRetry(bak, dest); } catch {}
      return { ok: false, manifest, reason: (e as Error).message, warnings: prep.warnings };
    }
  }

  async remove(id: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    await this.disposeOne(id);
    const dir = this.registry.dirFor(id);
    if (existsSync(dir)) rmSyncRetry(dir);
    this.registry.remove(id);
    this.store.audit("plugin.remove", { plugin: id });
    recordProvenance((p) => p.recordEvent(capabilityId("plugin", id), "remove", { actor: "user", detail: "plugin uninstalled", outcome: { status: "success" } }));
    return { ok: true };
  }

  /**
   * Phase 8 · Step 4 — lift an UNSIGNED-quarantine after trust was recorded.
   *
   * `enable()` deliberately refuses quarantined plugins: quarantine means "a
   * human must look at this", and a plain enable would paper over it. But once
   * an operator HAS looked and recorded trust (`xr plugins allow`), the
   * quarantine has been addressed and requiring a second manual step would
   * just teach people to reach for XR_PLUGINS_ALLOW_UNSIGNED.
   *
   * This method is narrow on purpose:
   *   · it re-verifies trust itself rather than believing the caller;
   *   · it only lifts quarantines whose cause was `unsigned` — a quarantine
   *     for tampering, an error or a manual review is untouched.
   */
  liftUnsignedQuarantine(id: string): { ok: boolean; reason?: string } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    if (entry.lifecycleState !== "quarantined") return { ok: true, reason: "not quarantined" };
    if (!(entry.quarantineReason ?? "").startsWith("unsigned")) {
      return { ok: false, reason: `quarantine cause is not "unsigned" (${entry.quarantineReason}) — resolve it explicitly` };
    }
    if (!entry.treeHash) return { ok: false, reason: "no recorded tree hash" };
    const verdict = new PluginTrustStore().isTrusted(id, entry.treeHash);
    if (!verdict.ok) return { ok: false, reason: `still untrusted: ${verdict.reason}` };
    this.registry.patch(id, { lifecycleState: "installed", quarantineReason: undefined });
    this.registry.record(id, "unquarantine", `trust recorded (${verdict.kind})`);
    this.store.audit("plugin.unquarantine", { plugin: id, cause: "unsigned", trust: verdict.kind });
    return this.enable(id);
  }

  enable(id: string): { ok: boolean; reason?: string } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    if (entry.lifecycleState === "quarantined") return { ok: false, reason: `plugin is quarantined: ${entry.quarantineReason ?? "review required"}` };
    const v = validatePlugin(this.registry.dirFor(id));
    if (!v.ok || !v.manifest) return { ok: false, reason: v.errors.join("; ") || "invalid plugin" };
    const compat = checkCompatibility(CORE_VERSION, v.manifest.apiVersion, PLUGIN_API_VERSION, v.manifest.compatibility);
    if (!compat.ok) return { ok: false, reason: compat.reason };
    for (const dep of v.manifest.dependencies) {
      const d = this.registry.get(dep);
      if (!d) return { ok: false, reason: `missing dependency: ${dep}` };
      if (!d.enabled) return { ok: false, reason: `dependency not enabled: ${dep}` };
    }
    this.registry.setEnabled(id, true);
    this.registry.record(id, "enable");
    this.store.audit("plugin.enable", { plugin: id });
    recordProvenance((p) => p.recordEvent(capabilityId("plugin", id), "enable", { actor: "user", detail: "enabled" }));
    return { ok: true };
  }

  async disable(id: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    const dependents = this.registry.list().filter((e) => e.enabled && this.dependsOn(e.id, id));
    if (dependents.length) return { ok: false, reason: `still required by enabled plugin(s): ${dependents.map((d) => d.id).join(", ")}` };
    await this.disposeOne(id);
    this.registry.setEnabled(id, false);
    this.registry.setHealth(id, { state: "disabled", checkedAt: Date.now() });
    this.registry.record(id, "disable");
    this.store.audit("plugin.disable", { plugin: id });
    recordProvenance((p) => p.recordEvent(capabilityId("plugin", id), "disable", { actor: "user", detail: "disabled" }));
    return { ok: true };
  }

  async quarantine(id: string, reason: string): Promise<{ ok: boolean; reason?: string }> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    await this.disposeOne(id);
    this.registry.quarantine(id, reason);
    this.registry.record(id, "quarantine", reason);
    this.store.audit("plugin.quarantine", { plugin: id, reason });
    recordProvenance((p) => p.recordEvent(capabilityId("plugin", id), "quarantine", { actor: "user", detail: reason, outcome: { status: "failure", detail: reason } }));
    return { ok: true };
  }

  rollback(id: string, version?: string): { ok: boolean; reason?: string } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    const snapshot = (entry.rollback ?? []).find((s) => !version || s.version === version);
    if (!snapshot) return { ok: false, reason: `no rollback snapshot for ${id}${version ? `@${version}` : ""}` };
    if (!existsSync(snapshot.dir)) return { ok: false, reason: "rollback snapshot files are missing" };

    const dest = this.registry.dirFor(id);
    const currentBackup = existsSync(dest) ? rollbackSnapshotDir(dest, entry.version) : undefined;
    try {
      if (currentBackup && existsSync(dest)) {
        mkdirSync(dirname(currentBackup), { recursive: true });
        cpSync(dest, currentBackup, { recursive: true, dereference: false });
      }
      if (existsSync(dest)) rmSyncRetry(dest);
      cpSync(snapshot.dir, dest, { recursive: true, dereference: false });
      const v = validatePlugin(dest);
      if (!v.ok || !v.manifest) throw new Error(v.errors.join("; ") || "rollback snapshot failed validation");
      const installedHash = hashEntrypoint(dest, v.manifest);
      const treeHash = hashPluginTree(dest);
      const remaining = (entry.rollback ?? []).filter((s) => s !== snapshot);
      if (currentBackup) remaining.unshift({
        version: entry.version ?? "unknown",
        dir: currentBackup,
        treeHash: entry.treeHash,
        installedHash: entry.installedHash,
        grantedPermissions: entry.grantedPermissions,
        at: Date.now(),
      });
      const next = PluginRegistry.newEntry(v.manifest, [], {
        enabled: false,
        installedHash,
        treeHash,
        source: entry.source,
        updateSource: entry.updateSource,
      });
      next.installedAt = entry.installedAt;
      next.rollback = remaining.slice(0, 10);
      next.lifecycleState = "disabled";
      next.health = { state: "disabled", checkedAt: Date.now(), detail: "rolled back; permissions require review before enable" };
      next.history = [...(entry.history ?? []), { at: Date.now(), action: "rollback" as const, detail: snapshot.version }].slice(-100);
      this.registry.upsert(next);
      this.store.audit("plugin.rollback", { plugin: id, version: snapshot.version, restoredAuthority: false });
      recordProvenance((p) => p.recordEvent(capabilityId("plugin", id), "rollback", {
        actor: "user",
        detail: snapshot.version,
        outcome: { status: "success", detail: "snapshot restored and re-validated; permissions revoked pending review" },
      }));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  private dependsOn(id: string, dep: string): boolean {
    const v = validatePlugin(this.registry.dirFor(id));
    return Boolean(v.manifest?.dependencies.includes(dep));
  }

  update(id: string, source?: string): InstallResult & { newPermissions?: PermissionScope[] } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    const src = source ?? entry.updateSource;
    if (!src) return { ok: false, reason: `no update source recorded for ${id}` };
    const prep = this.prepareInstall(src);
    if (!prep.ok || !prep.manifest) return prep;
    if (prep.manifest.id !== id) return { ok: false, reason: `update source id "${prep.manifest.id}" does not match "${id}"` };
    const current = validatePlugin(this.registry.dirFor(id));
    const currentDeclared = new Set(current.manifest?.permissions ?? []);
    const newPerms = prep.manifest.permissions.filter((p) => !currentDeclared.has(p));
    if (newPerms.length) {
      this.registry.patch(id, { lifecycleState: "update_pending_review" });
      this.registry.record(id, "review", `update requests new permissions: ${newPerms.join(",")}`);
      this.store.audit("plugin.update_review_required", { plugin: id, newPermissions: newPerms });
      return { ok: false, manifest: prep.manifest, reason: "update requests new permissions — re-install to approve", newPermissions: newPerms };
    }
    const res = this.commitInstall(src, entry.grantedPermissions, { enable: entry.enabled, updateSource: src });
    if (res.ok) {
      this.registry.record(id, "update", `v${prep.manifest.version}`);
      this.store.audit("plugin.update", { plugin: id, version: prep.manifest.version });
    }
    return res;
  }

  setPermissions(id: string, perms: PermissionScope[]): { ok: boolean; reason?: string; granted?: PermissionScope[] } {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, reason: `plugin not installed: ${id}` };
    const v = validatePlugin(this.registry.dirFor(id));
    if (!v.manifest) return { ok: false, reason: "invalid plugin" };
    const denied = new Set(((this.config as any).plugins?.deniedPermissions ?? []) as string[]);
    const granted = effectiveGrant(v.manifest.permissions, perms).filter((p) => !denied.has(p));
    this.registry.setPermissions(id, granted);
    this.registry.record(id, "permissions", granted.join(","));
    this.store.audit("plugin.permissions", { plugin: id, granted });
    return { ok: true, granted };
  }

  async loadEnabled(): Promise<void> {
    this.loaded.clear();
    this.loadErrors.clear();
    if ((this.config as any).plugins?.enabled === false) return;
    // Phase 8 · Step 4 — the one-time amnesty runs BEFORE any load, so a user
    // upgrading into the signing rule never sees a single spurious quarantine.
    this.grandfatherExistingPlugins();
    const ordered = this.topoSort(this.registry.list().filter((e) => e.enabled && e.lifecycleState !== "quarantined"));
    for (const entry of ordered) await this.loadOne(entry);
  }

  /**
   * Phase 8 · Step 4 — ONE-TIME GRANDFATHERING.
   *
   * Runs only when no plugin trust store exists yet, i.e. exactly once, on the
   * first run after upgrading into the signing rule. Every plugin already in
   * the registry gets a trust record bound to the tree hash it has right now.
   *
   * The binding to the CURRENT hash is what makes this safe rather than a
   * blanket amnesty: it vouches for the code the user already had and already
   * chose to install, and nothing else. Modify a grandfathered plugin
   * afterwards and it fails the trust check like any other unsigned code.
   *
   * If no trust store can be created (no writable XR_HOME, say), this is a
   * no-op — the load path then applies the normal unsigned rule, which is the
   * safe direction to fail.
   */
  private grandfatherExistingPlugins(): void {
    const pluginCfg = (this.config as any).plugins ?? {};
    if (pluginCfg.requireSigned === false) return;
    try {
      const store = new PluginTrustStore();
      if (!store.isUninitialised) return;
      const existing = this.registry.list();
      if (!existing.length) return;
      store.ensureKeys();
      for (const entry of existing) {
        if (!entry.treeHash) continue;
        store.record(entry.id, entry.treeHash, "grandfathered", {
          by: "upgrade",
          reason: "present in the registry before plugin signing was enforced",
        });
        this.store.audit("plugin.trust.grandfathered", {
          plugin: entry.id,
          treeHash: entry.treeHash,
          note: "auto-issued local trust record on upgrade; bound to the tree hash at upgrade time",
        });
      }
    } catch {
      /* no trust store possible — fall through to the normal unsigned rule */
    }
  }

  /**
   * Phase 8 · Step 4 — the signing gate.
   *
   * Returns a quarantine reason when the plugin may not load, or null when it
   * may. Split out from loadOne so the decision is testable in isolation.
   */
  private signingGate(entry: RegistryEntry): string | null {
    const pluginCfg = (this.config as any).plugins ?? {};
    // Default TRUE — new installs must be signed.
    if (pluginCfg.requireSigned === false) return null;
    if (pluginsAllowUnsignedEnv()) {
      console.error(
        `[plugin security] WARNING: XR_PLUGINS_ALLOW_UNSIGNED=1 — signature checking is DISABLED for "${entry.id}". ` +
        `This escape hatch is removed in the next release; sign the plugin with \`xr plugins allow ${entry.id}\`.`,
      );
      this.store.audit("plugin.trust.bypassed", {
        plugin: entry.id,
        note: "XR_PLUGINS_ALLOW_UNSIGNED=1 — unsigned plugin permitted by escape hatch",
      });
      return null;
    }
    if (!entry.treeHash) {
      return "no tree hash recorded at install — cannot verify provenance";
    }
    const verdict = new PluginTrustStore().isTrusted(entry.id, entry.treeHash);
    if (!verdict.ok) return verdict.reason;
    return null;
  }

  private async loadOne(entry: RegistryEntry): Promise<void> {
    const pluginCfg = (this.config as any).plugins ?? {};
    // Phase 8 · Step 4 — provenance is checked BEFORE the plugin's code is
    // read or executed. An unsigned plugin is QUARANTINED rather than merely
    // skipped, so the state is durable and visible in `xr plugins list`
    // instead of being re-attempted (and re-failing) on every single run.
    const signingFailure = this.signingGate(entry);
    if (signingFailure) {
      const reason = `unsigned or untrusted: ${signingFailure}`;
      this.loadErrors.set(entry.id, { reason, kind: "untrusted" });
      this.registry.quarantine(entry.id, reason);
      this.registry.record(entry.id, "quarantine", reason);
      this.store.audit("plugin.quarantine", { plugin: entry.id, reason, cause: "unsigned" });
      return;
    }
    const requireTrust = pluginCfg.requireTrust !== false;
    const denied: Set<string> = new Set(pluginCfg.deniedPermissions ?? []);
    const granted = entry.grantedPermissions.filter((p) => !denied.has(p));
    const dir = this.registry.dirFor(entry.id);
    const res: LoadResult = await loadPlugin(dir, { store: this.store, config: this.config, cwd: this.cwd, granted, expectedHash: requireTrust ? entry.installedHash : undefined, expectedTreeHash: requireTrust ? entry.treeHash : undefined });
    if (!res.ok) {
      this.loadErrors.set(entry.id, { reason: res.reason, kind: res.kind });
      this.registry.setHealth(entry.id, { state: res.kind === "untrusted" ? "untrusted" : res.kind === "incompatible" ? "incompatible" : "error", checkedAt: Date.now(), detail: res.reason, errors: [res.reason] });
      this.registry.record(entry.id, "load_error", res.reason);
      this.store.audit("plugin.load_error", { plugin: entry.id, kind: res.kind, reason: res.reason });
      return;
    }
    const mcpTools = await this.loadMcpTools(entry.id, res.manifest, res.granted);
    const skills = loadPluginSkills(dir, res.manifest);
    this.loaded.set(entry.id, { id: entry.id, manifest: res.manifest, contributions: res.contributions, granted: res.granted, mcpTools, skills });
    this.registry.setHealth(entry.id, { state: "healthy", checkedAt: Date.now(), detail: `${(res.contributions.tools?.length ?? 0) + (res.contributions.commands?.length ?? 0) + mcpTools.length + skills.length} contribution(s)` });
    this.registry.record(entry.id, "load");
    this.store.audit("plugin.load", { plugin: entry.id, tools: res.contributions.tools?.length ?? 0, commands: res.contributions.commands?.length ?? 0, mcpTools: mcpTools.length, skills: skills.length });
  }

  private async loadMcpTools(pluginId: string, manifest: PluginManifest, granted: PermissionScope[]): Promise<Tool[]> {
    if (!granted.includes("mcp")) return [];
    const out: Tool[] = [];
    for (const server of manifest.mcpServers) {
      if (server.transport !== "http" || !server.url) continue;
      try {
        const client = new McpClient({ id: `${pluginId}.${server.id}`, transport: "http", url: server.url, apiKeyEnv: server.apiKeyEnv });
        const defs = await client.listTools();
        const allowed = new Set(server.tools ?? []);
        for (const def of defs) if (!allowed.size || allowed.has(def.name)) out.push(wrapMcpTool(client, `${pluginId}.${server.id}`, def));
      } catch (e) {
        this.loadErrors.set(pluginId, { kind: "error", reason: `MCP ${server.id}: ${(e as Error).message}` });
      }
    }
    return out;
  }

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
      try { await lp.contributions.dispose(); } catch {}
    }
    this.loaded.delete(id);
  }

  getLoaded(): LoadedPlugin[] { return [...this.loaded.values()]; }

  findCommand(pluginId: string, command: string): { plugin: LoadedPlugin; cmd: PluginCommand } | null {
    const lp = this.loaded.get(pluginId);
    const cmd = lp?.contributions.commands?.find((c) => c.name === command);
    return lp && cmd ? { plugin: lp, cmd } : null;
  }

  pluginTools(): Tool[] {
    const tools: Tool[] = [];
    for (const lp of this.loaded.values()) {
      for (const pt of lp.contributions.tools ?? []) tools.push(adaptTool(lp.id, pt, lp.granted));
      tools.push(...lp.mcpTools);
    }
    return tools;
  }

  pluginSkills(): LoadedSkill[] {
    return this.getLoaded().flatMap((p) => p.skills);
  }

  health(): Array<{ entry: RegistryEntry; manifest?: PluginManifest; status: PluginStatus }> {
    return this.registry.list().map((entry) => {
      const v = validatePlugin(this.registry.dirFor(entry.id));
      const err = this.loadErrors.get(entry.id);
      let status: PluginStatus;
      if (err) status = { kind: err.kind === "incompatible" ? "incompatible" : err.kind === "untrusted" ? "untrusted" : "error", loaded: false, detail: err.reason };
      else if (!v.ok) status = { kind: "error", loaded: false, detail: v.errors.join("; ") };
      else if (this.loaded.has(entry.id)) {
        const lp = this.loaded.get(entry.id)!;
        status = { kind: "enabled", loaded: true, contributions: (lp.contributions.tools?.length ?? 0) + (lp.contributions.commands?.length ?? 0) + lp.mcpTools.length + lp.skills.length };
      } else status = { kind: entry.enabled ? "enabled" : "disabled", loaded: false, detail: entry.health?.detail };
      return { entry, manifest: v.manifest, status };
    });
  }

  summary(): { installed: number; enabled: number; loaded: number; errored: number } {
    const health = this.health();
    return { installed: health.length, enabled: health.filter((h) => h.entry.enabled).length, loaded: this.loaded.size, errored: health.filter((h) => ["error", "untrusted", "incompatible"].includes(h.status.kind)).length };
  }

  listInstalled(): RegistryEntry[] { return this.registry.list(); }
  getEntry(id: string): RegistryEntry | undefined { return this.registry.get(id); }
  dirFor(id: string): string { return this.registry.dirFor(id); }
}

function adaptTool(pluginId: string, pt: PluginTool, granted: PermissionScope[]): Tool {
  const fqName = `plugin.${pluginId}.${pt.name}`;
  const hasSensitiveGrant = granted.some((p) => SENSITIVE_PERMISSIONS.has(p));
  /**
   * Phase 8 · Step 4 — HIGH-RISK ⇒ TIER-2.
   *
   * A plugin declaring shell/process/network is asking for precisely the
   * capabilities that turn a supply-chain compromise into host access and
   * exfiltration. Such a tool is forced to Tier-2 and can never opt out of
   * approval via `requiresApproval: false` in its own manifest — letting
   * third-party code declare itself safe is the vulnerability, not the fix.
   */
  const riskTier = pluginRiskTier(granted as unknown as string[]);
  const highRisk = riskTier === "tier2";
  const requiresApproval = highRisk || hasSensitiveGrant || pt.requiresApproval !== false;
  return {
    name: fqName,
    description: `[plugin:${pluginId}] ${pt.description}`,
    parameters: pt.parameters ?? {},
    requiresApproval,
    async run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      // Phase 8 · Step 2 — third-party code runs behind this call; the grant
      // binding is verified before the plugin sees the arguments at all.
      const gate = requireGrant(ctx, fqName, args);
      if (!gate.ok) return gate.denial;
      if (requiresApproval) {
        const risky = highRiskPermissions(granted as unknown as string[]);
        const reason = highRisk
          ? `run TIER-2 plugin tool from "${pluginId}" — declares high-risk permission(s): ${risky.join(", ")}`
          : `run plugin tool from "${pluginId}"`;
        const approved = await ctx.approve({
          tool: fqName,
          reason,
          args,
          riskTier,
          preview: JSON.stringify(args).slice(0, 300),
        });
        if (!approved) {
          ctx.audit("plugin.tool.denied", { plugin: pluginId, tool: pt.name });
          return { ok: false, output: "plugin tool call denied" };
        }
      }
      if (ctx.dryRun) return { ok: true, output: `[dry-run] would call ${fqName}` };
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
