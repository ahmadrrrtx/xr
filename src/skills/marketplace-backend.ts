/** XR 2.1C — Marketplace Backend orchestration. */
import { existsSync } from "node:fs";
import { SkillMarketplace } from "./marketplace.ts";
import { MarketplaceBackendStore } from "./marketplace-backend-store.ts";
import type { OnlineSkillVersion, SkillRegistryEndpoint, SkillUpdateCandidate } from "./marketplace-backend-types.ts";
import { OnlineSkillRegistryClient } from "./online-registry.ts";
import { SkillVersionResolver } from "./version-resolver.ts";
import { MarketplaceDependencySolver } from "./marketplace-dependency-solver.ts";
import { SkillDownloadEngine } from "./download-engine.ts";
import { checkSkillCompatibility } from "./compatibility.ts";
import { sha256File, verifyPackageSignature, type PackageSignatureEnvelope } from "./signing.ts";
import { compareSemver } from "./semver.ts";

export interface OnlineInstallOptions {
  versionRange?: string;
  registryId?: string;
  includeYanked?: boolean;
  enable?: boolean;
  force?: boolean;
  withDependencies?: boolean;
}

export interface OnlineInstallResult {
  ok: boolean;
  installed: Array<{ id: string; version: string }>;
  warnings: string[];
  errors: string[];
}

export class SkillMarketplaceBackend {
  readonly store: MarketplaceBackendStore;
  readonly online: OnlineSkillRegistryClient;
  readonly resolver: SkillVersionResolver;
  readonly dependencies: MarketplaceDependencySolver;
  readonly downloader = new SkillDownloadEngine();

  constructor(private readonly marketplace = new SkillMarketplace(), store = new MarketplaceBackendStore()) {
    this.store = store;
    this.online = new OnlineSkillRegistryClient(store);
    this.resolver = new SkillVersionResolver(this.online);
    this.dependencies = new MarketplaceDependencySolver(this.resolver);
  }

  addRegistry(id: string, url: string, opts: Partial<Omit<SkillRegistryEndpoint, "id" | "url" | "addedAt">> = {}): SkillRegistryEndpoint {
    return this.store.upsertRegistry({ id, url, enabled: opts.enabled ?? true, priority: opts.priority ?? 100, trustLevel: opts.trustLevel ?? "community" });
  }

  listRegistries(): SkillRegistryEndpoint[] { return this.store.listRegistries(); }
  removeRegistry(id: string): boolean { return this.store.removeRegistry(id); }
  async syncRegistries() { return await this.online.syncAll(); }
  searchOnline(query: string) { return this.online.search(query); }

  resolve(id: string, versionRange?: string, registryId?: string) {
    return this.resolver.resolve({ id, range: versionRange, registryId });
  }

  private snapshotExisting(skillId: string): void {
    const current = this.marketplace.get(skillId);
    if (!current || current.source === "bundled" || !existsSync(current.dir)) return;
    const out = this.downloader.localPackagePathForRollback(skillId, current.manifest.version);
    try {
      const packagePath = this.marketplace.package(current.dir, out);
      this.store.addRollbackSnapshot(skillId, { version: current.manifest.version, dir: current.dir, packagePath });
    } catch {
      this.store.addRollbackSnapshot(skillId, { version: current.manifest.version, dir: current.dir });
    }
  }

  private verifySignatureIfPresent(version: OnlineSkillVersion, packagePath: string): { ok: boolean; warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!version.signature) return { ok: true, warnings: ["package is unsigned"], errors };
    const publisher = this.store.publisher(version.publisherId);
    if (!publisher?.publicKeyPem) return { ok: false, warnings, errors: [`publisher ${version.publisherId} has no trusted public key`] };
    const envelope: PackageSignatureEnvelope = {
      schemaVersion: 1,
      type: "xr.skill.signature.v1",
      keyId: version.signingKeyId ?? publisher.keyId ?? "unknown",
      algorithm: "ed25519",
      packageSha256: version.packageSha256 ?? "",
      signature: version.signature,
      signedAt: version.publishedAt,
    };
    const result = verifyPackageSignature(packagePath, publisher.publicKeyPem, envelope);
    if (!result.ok) errors.push(result.reason);
    return { ok: result.ok, warnings, errors };
  }

  private async installVersion(version: OnlineSkillVersion, registry: SkillRegistryEndpoint, options: OnlineInstallOptions): Promise<{ ok: boolean; warnings: string[]; errors: string[] }> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const compatibility = checkSkillCompatibility(version.manifest);
    warnings.push(...compatibility.warnings);
    if (!compatibility.ok) return { ok: false, warnings, errors: compatibility.errors };

    this.snapshotExisting(version.id);
    const download = await this.downloader.download(version.packageUrl, version.packageSha256);
    if (!download.ok || !download.path) return { ok: false, warnings, errors: [download.error ?? "download failed"] };
    if (version.packageSha256 && download.sha256 !== version.packageSha256) return { ok: false, warnings, errors: ["download hash mismatch"] };

    const signature = this.verifySignatureIfPresent(version, download.path);
    warnings.push(...signature.warnings);
    if (!signature.ok) return { ok: false, warnings, errors: signature.errors };

    try {
      this.marketplace.importPackage(download.path, { enable: options.enable ?? true, force: options.force });
      this.store.recordInstalledSource(version.id, { registryId: registry.id, packageUrl: version.packageUrl, packageSha256: version.packageSha256 });
      return { ok: true, warnings, errors };
    } catch (e) {
      return { ok: false, warnings, errors: [(e as Error).message] };
    }
  }

  async installOnline(id: string, options: OnlineInstallOptions = {}): Promise<OnlineInstallResult> {
    await this.syncRegistries();
    const resolved = this.resolver.resolve({ id, range: options.versionRange, registryId: options.registryId, includeYanked: options.includeYanked });
    if (!resolved.ok || !resolved.version || !resolved.registry) return { ok: false, installed: [], warnings: [], errors: [resolved.reason ?? "version resolution failed"] };
    const plan = options.withDependencies === false
      ? { root: resolved.version, registry: resolved.registry, dependencies: [], warnings: [] }
      : this.dependencies.solve(resolved.version, resolved.registry);

    const installed: Array<{ id: string; version: string }> = [];
    const warnings = [...plan.warnings];
    const errors: string[] = [];
    for (const dep of plan.dependencies) {
      const r = await this.installVersion(dep, resolved.registry, options);
      warnings.push(...r.warnings);
      if (!r.ok) errors.push(...r.errors);
      else installed.push({ id: dep.id, version: dep.version });
    }
    if (!errors.length) {
      const r = await this.installVersion(plan.root, resolved.registry, options);
      warnings.push(...r.warnings);
      if (!r.ok) errors.push(...r.errors);
      else installed.push({ id: plan.root.id, version: plan.root.version });
    }
    return { ok: errors.length === 0, installed, warnings, errors };
  }

  async checkUpdates(): Promise<SkillUpdateCandidate[]> {
    await this.syncRegistries();
    const installed = this.marketplace.catalog().filter((entry) => entry.installed && entry.source !== "bundled");
    const updates: SkillUpdateCandidate[] = [];
    for (const entry of installed) {
      const source = this.store.installedSource(entry.manifest.id);
      const resolved = this.resolver.resolve({ id: entry.manifest.id, registryId: source?.registryId });
      if (!resolved.ok || !resolved.version || !resolved.registry) continue;
      if (compareSemver(resolved.version.version, entry.manifest.version) > 0) {
        updates.push({ id: entry.manifest.id, currentVersion: entry.manifest.version, latestVersion: resolved.version.version, registryId: resolved.registry.id, packageUrl: resolved.version.packageUrl, changelog: resolved.version.changelog });
      }
    }
    return updates;
  }

  async updateOnline(id: string): Promise<OnlineInstallResult> {
    const current = this.marketplace.get(id);
    if (!current) return { ok: false, installed: [], warnings: [], errors: [`skill not installed: ${id}`] };
    const updates = await this.checkUpdates();
    const update = updates.find((u) => u.id === id);
    if (!update) return { ok: true, installed: [], warnings: [`${id} is already up to date`], errors: [] };
    return await this.installOnline(id, { registryId: update.registryId, versionRange: update.latestVersion, force: true });
  }

  rollback(id: string, version?: string): { ok: boolean; reason: string } {
    const snapshots = this.store.rollbackSnapshots(id);
    const snapshot = version ? snapshots.find((s) => s.version === version) : snapshots[0];
    if (!snapshot) return { ok: false, reason: `no rollback snapshot for ${id}${version ? `@${version}` : ""}` };
    try {
      if (snapshot.packagePath && existsSync(snapshot.packagePath)) this.marketplace.importPackage(snapshot.packagePath, { force: true, enable: true });
      else if (existsSync(snapshot.dir)) this.marketplace.install(snapshot.dir, { force: true, enable: true });
      else return { ok: false, reason: "rollback snapshot files are missing" };
      this.store.removeRollbackSnapshot(id, snapshot.version);
      return { ok: true, reason: `rolled back ${id} to ${snapshot.version}` };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  verifyPackage(packagePath: string, publicKeyPem?: string, signature?: PackageSignatureEnvelope): { ok: boolean; sha256: string; reason: string } {
    const actual = sha256File(packagePath);
    if (publicKeyPem && signature) {
      const result = verifyPackageSignature(packagePath, publicKeyPem, signature);
      return { ok: result.ok, sha256: actual, reason: result.reason };
    }
    return { ok: true, sha256: actual, reason: "package hash computed; no signature requested" };
  }
}
