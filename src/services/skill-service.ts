/** XR 2.1A — Unified Skill Service lifecycle integration. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LifecycleHook } from "../core/lifecycle.ts";
import { SkillMarketplace, type SkillCatalogEntry, type SkillInstallOptions, type SkillSearchOptions } from "../skills/marketplace.ts";
import { SkillSDK, type SkillCreateOptions } from "../skills/sdk.ts";
import { SkillMarketplaceStore, skillsHome } from "../skills/marketplace-store.ts";
import { UnifiedSkillRuntime } from "../skills/runtime.ts";
import { SkillMarketplaceBackend, type OnlineInstallOptions, type OnlineInstallProgressSink } from "../skills/marketplace-backend.ts";
import { SkillDownloadEngine } from "../skills/download-engine.ts";
import { readSkillManifest, skillDirName } from "../skills/manifest.ts";
import { sha256File } from "../skills/signing.ts";
import {
  applyQuarantine,
  decideQuarantine,
  isQuarantined,
  promoteQuarantine,
  quarantineRemainingMs,
  type QuarantineDecision,
} from "../skills/quarantine.ts";
import { SkillManifestSchema, type SkillInstallation, type SkillManifest, type SkillPermissionScope } from "../skills/schema.ts";
import type { SkillPackageFile } from "../skills/marketplace.ts";

/** Unified install-flow progress event (SSE job stream). */
export interface InstallFlowEvent {
  step: "download" | "verify" | "install" | "validate" | "ready" | "error";
  pct: number;
  message: string;
}
export type InstallFlowSink = (e: InstallFlowEvent) => void;

export class SkillService implements LifecycleHook {
  private readonly store = new SkillMarketplaceStore();
  private readonly marketplace = new SkillMarketplace(this.store);
  private readonly sdk = new SkillSDK(this.marketplace);
  private readonly runtime = new UnifiedSkillRuntime(this.marketplace);
  private readonly backend = new SkillMarketplaceBackend(this.marketplace);

  // XR 2.1A unified runtime API.
  listUnified() { return this.runtime.list(); }
  /** SEC-02 — pin/unpin an installed skill (updates survive reinstall checks). */
  pinSkill(id: string, pinned: boolean): boolean { return this.marketplace.pin(id, pinned); }
  pinStates(): Record<string, boolean> {
    return Object.fromEntries(this.store.listInstallations().map((i) => [i.id, Boolean((i as { pinned?: boolean }).pinned)]));
  }
  inspectUnified(id: string) { return this.runtime.inspect(id); }
  searchUnified(query: string, limit?: number) { return this.runtime.search(query, limit); }
  resolve(task: string, limit?: number) { return this.runtime.resolve(task, limit); }
  dependencyReport(id: string) { return this.runtime.dependencyReport(id); }
  permissionReport(id: string) { return this.runtime.permissionReport(id); }
  runtimeHealth() { return this.runtime.health(); }
  migrate(root: string) { return this.runtime.lifecycle.migrate(root); }

  // XR 2.1C marketplace backend API.
  addRegistry(id: string, url: string) { return this.backend.addRegistry(id, url); }
  listRegistries() { return this.backend.listRegistries(); }
  removeRegistry(id: string) { return this.backend.removeRegistry(id); }
  syncRegistries() { return this.backend.syncRegistries(); }
  searchOnline(query: string) { return this.backend.searchOnline(query); }
  installOnline(id: string, options?: OnlineInstallOptions) { return this.backend.installOnline(id, options); }
  checkUpdates() { return this.backend.checkUpdates(); }
  updateOnline(id: string) { return this.backend.updateOnline(id); }
  rollbackOnline(id: string, version?: string) { return this.backend.rollback(id, version); }
  verifyPackage(path: string) { return this.backend.verifyPackage(path); }
  installLocal(dir: string, options?: SkillInstallOptions) { return this.runtime.lifecycle.installLocal(dir, options); }

  // Stage 13 marketplace/package API retained for backward compatibility.
  catalog(): SkillCatalogEntry[] { return this.marketplace.catalog(); }
  search(options: SkillSearchOptions = {}): SkillCatalogEntry[] { return this.marketplace.search(options); }
  get(id: string): SkillCatalogEntry | undefined { return this.marketplace.get(id); }
  recommendations(task: string, limit?: number): SkillCatalogEntry[] { return this.marketplace.recommendations(task, limit); }
  similar(id: string, limit?: number): SkillCatalogEntry[] { return this.marketplace.similar(id, limit); }
  requiredSkills(id: string): string[] { return this.marketplace.requiredSkills(id); }
  install(source: string, options?: SkillInstallOptions) { return this.marketplace.install(source, options); }
  update(id: string, options?: SkillInstallOptions) { return this.marketplace.update(id, options); }
  remove(id: string) { return this.marketplace.remove(id); }
  enable(id: string) { return this.marketplace.enable(id); }
  disable(id: string) { return this.marketplace.disable(id); }
  favorite(id: string, value: boolean) { return this.marketplace.favorite(id, value); }
  pin(id: string, value: boolean) { return this.marketplace.pin(id, value); }
  rollback(id: string, version?: string) { return this.marketplace.rollback(id, version); }
  export(id: string, outFile?: string) { return this.marketplace.export(id, outFile); }
  importPackage(file: string, options?: SkillInstallOptions) { return this.marketplace.importPackage(file, options); }
  validate(dir: string) { return this.runtime.lifecycle.validate(dir); }
  package(dir: string, outFile?: string) { return this.marketplace.package(dir, outFile); }
  publish(dir: string, outDir?: string) { return this.sdk.publish(dir, outDir); }
  create(options: SkillCreateOptions) { return this.sdk.create(options); }
  init(options: SkillCreateOptions & { dir: string }) { return this.sdk.init(options); }
  build(dir: string, outDir?: string) { return this.sdk.build(dir, outDir); }
  test(dir: string) { return this.sdk.test(dir); }
  sdkDoctor(dir?: string) { return this.sdk.doctor(dir); }
  doctor() {
    const catalog = this.catalog();
    const installed = catalog.filter((s) => s.installed).length;
    const enabled = catalog.filter((s) => s.enabled).length;
    const official = catalog.filter((s) => s.manifest.verification.level === "official").length;
    const dangerous = catalog.flatMap((s) => s.manifest.permissions.filter((p) => p.dangerous).map((p) => `${s.manifest.id}:${p.scope}`));
    const runtime = this.runtime.health();
    return { total: catalog.length, installed, enabled, official, dangerous, runtime };
  }
  executionContext(task: string, limit?: number) { return this.runtime.executionContext(task, limit); }

  // ─── Phase 20 — Skills Store lifecycle (quarantine-first install) ─────────

  installation(id: string): SkillInstallation | undefined {
    return this.store.getInstallation(id);
  }

  /**
   * Skill ids the registry marks `featured` (Phase 20 hero banner). Empty
   * when no registry cache exists — the UI falls back to an official skill.
   */
  featuredSkillIds(): string[] {
    const ids = new Set<string>();
    try {
      for (const { index } of this.backend.store.cachedRegistries()) {
        for (const skill of index.skills) if (skill.featured) ids.add(skill.id);
      }
    } catch {
      /* no registry cache — fallback is the UI's job */
    }
    return [...ids];
  }

  /** Quarantine state for the UI (engine-side truth; client cannot clear it). */
  quarantineInfo(id: string): {
    quarantined: boolean;
    until: number | null;
    remainingMs: number;
    pendingGrants: SkillPermissionScope[];
    reason: string | null;
  } {
    const installation = this.store.getInstallation(id);
    const active = isQuarantined(installation);
    return {
      quarantined: active,
      until: installation?.quarantine?.until ?? null,
      remainingMs: active ? quarantineRemainingMs(installation) : 0,
      pendingGrants: installation?.quarantine?.pendingGrants ?? [],
      reason: installation?.quarantine?.reason ?? null,
    };
  }

  /**
   * Promote out of quarantine: dangerous scopes approved during the window
   * become real grants and the sandbox cap is lifted. Returns the promoted
   * grant list for the audit record.
   */
  promote(id: string): { ok: boolean; reason?: string; grantedPermissions?: SkillPermissionScope[]; promoted: boolean } {
    const installation = this.store.getInstallation(id);
    if (!installation) return { ok: false, reason: `skill not installed: ${id}`, promoted: false };
    if (!isQuarantined(installation)) {
      return { ok: true, promoted: false, grantedPermissions: installation.grantedPermissions };
    }
    const loaded = readSkillManifest(installation.dir);
    const manifest = loaded.manifest ?? this.get(id)?.manifest;
    if (!manifest) return { ok: false, reason: "skill manifest unavailable", promoted: false };
    const promoted = promoteQuarantine(installation, manifest);
    this.store.patchInstallation(id, {
      grantedPermissions: promoted.grantedPermissions,
      quarantine: undefined,
    });
    return { ok: true, promoted: true, grantedPermissions: promoted.grantedPermissions };
  }

  /**
   * Explicit permission grants (default-deny stays). While quarantined,
   * dangerous scopes are PARKED in `pendingGrants` — recorded approval that
   * only becomes effective on promote (never a silent bypass).
   */
  grantPermissions(id: string, scopes: SkillPermissionScope[]): { ok: boolean; reason?: string; granted: SkillPermissionScope[]; parked: SkillPermissionScope[] } {
    const installation = this.store.getInstallation(id);
    const entry = this.get(id);
    const manifest = entry?.manifest ?? (installation ? readSkillManifest(installation.dir).manifest : undefined);
    if (!installation || !manifest) return { ok: false, reason: `skill not installed: ${id}`, granted: [], parked: [] };
    const declared = new Map(manifest.permissions.map((p) => [p.scope, p]));
    const unknown = scopes.filter((s) => !declared.has(s));
    if (unknown.length) return { ok: false, reason: `undeclared permissions: ${unknown.join(", ")}`, granted: [], parked: [] };
    const quarantined = isQuarantined(installation);
    const granted = new Set(installation.grantedPermissions);
    const pending = new Set(installation.quarantine?.pendingGrants ?? []);
    const parked: SkillPermissionScope[] = [];
    for (const scope of scopes) {
      if (quarantined && declared.get(scope)?.dangerous) {
        parked.push(scope);
        pending.add(scope);
      } else {
        granted.add(scope);
      }
    }
    this.store.patchInstallation(id, {
      grantedPermissions: [...granted].sort(),
      ...(quarantined && installation.quarantine
        ? { quarantine: { ...installation.quarantine, pendingGrants: [...pending].sort() } }
        : {}),
    });
    return { ok: true, granted: [...granted].sort(), parked };
  }

  revokePermissions(id: string, scopes: SkillPermissionScope[]): { ok: boolean; reason?: string; granted: SkillPermissionScope[] } {
    const installation = this.store.getInstallation(id);
    if (!installation) return { ok: false, reason: `skill not installed: ${id}`, granted: [] };
    const drop = new Set(scopes);
    const granted = installation.grantedPermissions.filter((s) => !drop.has(s));
    const pending = (installation.quarantine?.pendingGrants ?? []).filter((s) => !drop.has(s));
    this.store.patchInstallation(id, {
      grantedPermissions: granted,
      ...(installation.quarantine ? { quarantine: { ...installation.quarantine, pendingGrants: pending } } : {}),
    });
    return { ok: true, granted };
  }

  /** Per-skill settings, stored beside (not inside) the skill tree so updates never clobber them. */
  private settingsPath(id: string): string {
    return join(skillsHome(), "settings", `${skillDirName(id)}.json`);
  }

  readSettings(id: string): Record<string, unknown> {
    const path = this.settingsPath(id);
    if (!existsSync(path)) return {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { values?: Record<string, unknown> };
      return parsed.values && typeof parsed.values === "object" ? parsed.values : {};
    } catch {
      return {};
    }
  }

  /** Validate against the manifest's declared settings, then persist. */
  saveSettings(id: string, values: Record<string, unknown>): { ok: boolean; reason?: string; saved: Record<string, unknown> } {
    const entry = this.get(id);
    if (!entry) return { ok: false, reason: `skill not found: ${id}`, saved: {} };
    const decls = entry.manifest.settings ?? [];
    const known = new Map(decls.map((d) => [d.key, d]));
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      const decl = known.get(key);
      if (!decl) return { ok: false, reason: `unknown setting: ${key}`, saved: {} };
      if (value === undefined || value === null || value === "") {
        if (decl.required) return { ok: false, reason: `missing required setting: ${key}`, saved: {} };
        continue;
      }
      if (decl.type === "boolean" && typeof value !== "boolean") return { ok: false, reason: `${key} must be boolean`, saved: {} };
      if (decl.type === "number" && typeof value !== "number") return { ok: false, reason: `${key} must be number`, saved: {} };
      if ((decl.type === "string" || decl.type === "secret" || decl.type === "enum") && typeof value !== "string") {
        return { ok: false, reason: `${key} must be a string`, saved: {} };
      }
      if (decl.type === "enum" && !decl.options.includes(String(value))) {
        return { ok: false, reason: `${key} must be one of: ${decl.options.join(", ")}`, saved: {} };
      }
      cleaned[key] = value;
    }
    for (const decl of decls) {
      if (decl.required && !(decl.key in cleaned) && decl.default === undefined) {
        return { ok: false, reason: `missing required setting: ${decl.key}`, saved: {} };
      }
    }
    const path = this.settingsPath(id);
    mkdirSync(join(skillsHome(), "settings"), { recursive: true });
    writeFileSync(path, JSON.stringify({ id, values: cleaned, updatedAt: Date.now() }, null, 2));
    return { ok: true, saved: cleaned };
  }

  /**
   * Install-from-URL/local PREVIEW (no side effects beyond a cached download):
   * validate the manifest, report signature state, and say honestly whether
   * quarantine will be forced. The UI then runs the real install flow.
   */
  async previewSource(source: string): Promise<{
    ok: boolean;
    kind: "local-dir" | "package" | "git" | "remote" | "catalog";
    manifest: SkillManifest | null;
    warnings: string[];
    errors: string[];
    decision: QuarantineDecision;
    packageSha256?: string;
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const fail = (errorsIn: string[], decision = decideQuarantine({ level: "unverified", signed: false, publisherKnown: false, fromRegistry: false })) => ({
      ok: false,
      kind: "remote" as const,
      manifest: null,
      warnings,
      errors: errorsIn,
      decision,
    });

    const catalogHit = this.get(source);
    if (catalogHit && !/^(https?:|git@|github:|file:)/.test(source) && !source.endsWith(".xrs")) {
      const level = catalogHit.manifest.verification.level;
      const bundled = catalogHit.source === "bundled";
      return {
        ok: true,
        kind: "catalog",
        manifest: catalogHit.manifest,
        warnings,
        errors,
        decision: bundled
          ? { forced: false, reason: "bundled", detail: "Ships with XR — no quarantine needed." }
          : decideQuarantine({ level, signed: Boolean(catalogHit.manifest.verification.signature), publisherKnown: level === "official" || level === "verified", fromRegistry: false }),
      };
    }

    if (/^(git@|github:)/.test(source) || (/^https?:\/\//i.test(source) && /\.git\/?$/i.test(source))) {
      return {
        ok: true,
        kind: "git",
        manifest: null,
        warnings: ["Git repository — XR clones and validates the manifest at install time."],
        errors,
        decision: decideQuarantine({ level: "unverified", signed: false, publisherKnown: false, fromRegistry: false }),
      };
    }

    let packagePath: string | null = null;
    let dir: string | null = null;
    if (existsSync(source)) {
      if (source.endsWith(".xrs")) packagePath = source;
      else dir = source;
    } else if (/^https?:\/\//i.test(source)) {
      const download = await new SkillDownloadEngine().download(source);
      if (!download.ok || !download.path) return fail([download.error ?? "download failed"]);
      packagePath = download.path;
      warnings.push("Package downloaded to the local cache for inspection.");
    } else {
      return fail([`source not found: ${source}`]);
    }

    if (dir) {
      const validated = this.validate(dir);
      if (!validated.ok || !validated.manifest) return fail(validated.errors.length ? validated.errors : ["invalid skill directory"]);
      warnings.push(...validated.warnings);
      return {
        ok: true,
        kind: "local-dir",
        manifest: validated.manifest,
        warnings,
        errors,
        decision: decideQuarantine({ level: validated.manifest.verification.level, signed: Boolean(validated.manifest.verification.signature), publisherKnown: false, fromRegistry: false }),
      };
    }

    if (packagePath) {
      try {
        const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as SkillPackageFile;
        if (pkg.type !== "xr.skill.package" || pkg.schemaVersion !== 1) return fail(["not an XR skill package (.xrs)"]);
        const manifest = SkillManifestSchema.parse(pkg.manifest);
        return {
          ok: true,
          kind: "package",
          manifest,
          warnings,
          errors,
          packageSha256: sha256File(packagePath),
          decision: decideQuarantine({ level: manifest.verification.level, signed: Boolean(manifest.verification.signature), publisherKnown: false, fromRegistry: false }),
        };
      } catch (e) {
        return fail([(e as Error).message]);
      }
    }
    return fail(["unsupported source"]);
  }

  /**
   * The ONE install flow the Skills Store uses (registry id or url/local).
   * Steps stream through `emit` (SSE job events): download → verify →
   * install → validate → ready. Quarantine policy is applied BEFORE the
   * record is written and cannot be bypassed by passing `quarantine:false`
   * for unsigned / untrusted sources.
   */
  async installWithProgress(
    input: {
      id: string;
      registryId?: string;
      versionRange?: string;
      fromUrl?: string;
      localPath?: string;
      quarantine: boolean;
      grantPermissions?: SkillPermissionScope[];
      enable?: boolean;
      pin?: boolean;
    },
    emit: InstallFlowSink,
  ): Promise<{
    ok: boolean;
    skillId: string | null;
    version: string | null;
    installed: Array<{ id: string; version: string }>;
    warnings: string[];
    errors: string[];
    quarantineForced: boolean;
    quarantined: boolean;
    quarantineReason: string | null;
  }> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const source = input.localPath ?? input.fromUrl;
    const grants = [...new Set(input.grantPermissions ?? [])];

    // ── 1. Decide quarantine policy BEFORE touching disk ────────────────────
    let decision: QuarantineDecision;
    let resolvedManifest: SkillManifest | null = null;
    if (source) {
      const preview = await this.previewSource(source);
      warnings.push(...preview.warnings);
      errors.push(...preview.errors);
      decision = preview.decision;
      resolvedManifest = preview.manifest;
    } else {
      const online = this.backend.resolve(input.id, input.versionRange, input.registryId);
      const entry = this.get(input.id);
      if (online.ok && online.version) {
        const level = online.version.manifest.verification.level;
        const publisher = this.backend.store.publisher(online.version.publisherId);
        resolvedManifest = online.version.manifest;
        decision = decideQuarantine({
          level,
          signed: Boolean(online.version.signature),
          publisherKnown: Boolean(publisher?.publicKeyPem) || level === "official" || level === "verified",
          fromRegistry: true,
        });
      } else if (entry) {
        // Bundled / already-on-disk skill: first-party content ships WITH XR.
        if (entry.source === "bundled") {
          decision = { forced: false, reason: "bundled", detail: "Ships with XR — no quarantine needed." };
        } else {
          decision = decideQuarantine({
            level: entry.manifest.verification.level,
            signed: Boolean(entry.manifest.verification.signature),
            publisherKnown: entry.manifest.verification.level === "official" || entry.manifest.verification.level === "verified",
            fromRegistry: false,
          });
        }
        resolvedManifest = entry.manifest;
      } else {
        return {
          ok: false,
          skillId: input.id,
          version: null,
          installed: [],
          warnings,
          errors: [...errors, online.reason ?? `skill not found: ${input.id}`],
          quarantineForced: false,
          quarantined: false,
          quarantineReason: null,
        };
      }
    }

    const wantsQuarantine = input.quarantine || decision.forced;
    const quarantineForced = decision.forced;
    if (decision.forced && input.quarantine === false) {
      // Explicit attempt to opt out of a FORCED quarantine — refuse outright.
      return {
        ok: false,
        skillId: input.id,
        version: null,
        installed: [],
        warnings,
        errors: [...errors, `quarantine is required: ${decision.detail}`],
        quarantineForced: true,
        quarantined: false,
        quarantineReason: decision.reason,
      };
    }

    // ── 2. Run the engine install (one path for every source) ───────────────
    let installed: Array<{ id: string; version: string }> = [];
    try {
      if (source) {
        emit({ step: "download", pct: 20, message: "Fetching package…" });
        emit({ step: "verify", pct: 60, message: "Validating package…" });
        const opts: SkillInstallOptions = {
          enable: input.enable ?? true,
          force: true,
          grantPermissions: grants,
          pin: input.pin ?? false,
        };
        const installation = this.install(source, opts);
        installed = [{ id: installation.id, version: installation.version }];
        emit({ step: "install", pct: 100, message: "Installed." });
      } else {
        const onProgress: OnlineInstallProgressSink = (p) => emit(p);
        const online = this.backend.resolve(input.id, input.versionRange, input.registryId);
        if (online.ok && online.version && !this.get(input.id)) {
          const result = await this.backend.installOnline(
            input.id,
            {
              registryId: input.registryId ?? online.registry?.id,
              versionRange: input.versionRange,
              enable: input.enable ?? true,
              force: true,
            },
            onProgress,
          );
          warnings.push(...result.warnings);
          errors.push(...result.errors);
          installed = result.installed;
          if (!result.ok) {
            return {
              ok: false,
              skillId: input.id,
              version: online.version.version,
              installed,
              warnings,
              errors,
              quarantineForced,
              quarantined: false,
              quarantineReason: decision.reason,
            };
          }
        } else {
          emit({ step: "install", pct: 50, message: "Registering skill…" });
          const opts: SkillInstallOptions = { enable: input.enable ?? true, force: true, grantPermissions: grants, pin: input.pin ?? false };
          const installation = this.install(input.id, opts);
          installed = [{ id: installation.id, version: installation.version }];
          emit({ step: "install", pct: 100, message: "Installed." });
        }
      }
    } catch (e) {
      return {
        ok: false,
        skillId: input.id,
        version: null,
        installed,
        warnings,
        errors: [...errors, (e as Error).message],
        quarantineForced,
        quarantined: false,
        quarantineReason: decision.reason,
      };
    }

    // ── 3. Validate the installed tree + dependencies ───────────────────────
    const rootId = installed[installed.length - 1]?.id ?? input.id;
    const installation = this.store.getInstallation(rootId);
    emit({ step: "validate", pct: 50, message: "Validating manifest & dependencies…" });
    if (installation) {
      try {
        const validated = this.validate(installation.dir);
        warnings.push(...validated.warnings);
        if (!validated.ok) errors.push(...validated.errors);
      } catch (e) {
        errors.push((e as Error).message);
      }
      const deps = this.dependencyReport(rootId);
      for (const missing of deps?.requiredMissing ?? []) {
        warnings.push(`missing dependency: ${missing.dependency.kind}:${missing.dependency.id}`);
      }
    }
    if (errors.length) {
      emit({ step: "error", pct: 100, message: errors.join("; ") });
      return {
        ok: false,
        skillId: rootId,
        version: installed[installed.length - 1]?.version ?? null,
        installed,
        warnings,
        errors,
        quarantineForced,
        quarantined: false,
        quarantineReason: decision.reason,
      };
    }

    // ── 4. Apply quarantine + explicit grants (engine-side, persisted) ─────
    const manifest = resolvedManifest ?? this.get(rootId)?.manifest ?? (installation ? readSkillManifest(installation.dir).manifest : null);
    let quarantined = false;
    if (installation && manifest) {
      if (wantsQuarantine) {
        const capped = applyQuarantine(installation, manifest, grants, decision.reason);
        this.store.patchInstallation(rootId, {
          grantedPermissions: capped.grantedPermissions,
          quarantine: capped.quarantine,
        });
        quarantined = true;
      } else if (grants.length) {
        // Explicit operator grants (default-deny preserved: never invent scopes).
        this.store.patchInstallation(rootId, { grantedPermissions: [...new Set([...installation.grantedPermissions, ...grants])].sort() });
      }
    }

    emit({ step: "ready", pct: 100, message: quarantined ? "Ready — running in quarantine." : "Ready." });
    return {
      ok: true,
      skillId: rootId,
      version: installed[installed.length - 1]?.version ?? null,
      installed,
      warnings,
      errors: [],
      quarantineForced,
      quarantined,
      quarantineReason: quarantined ? decision.reason : null,
    };
  }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> { this.runtime.list(); }
  async onStop(): Promise<void> {}
}
