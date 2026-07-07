/** XR 2.1C — Marketplace Backend shared types. */
import type { SkillDependency, SkillManifest } from "./schema.ts";

export type RegistryTrustLevel = "unknown" | "community" | "reviewed" | "verified" | "official";

export interface SkillRegistryEndpoint {
  id: string;
  url: string;
  enabled: boolean;
  priority: number;
  trustLevel: RegistryTrustLevel;
  addedAt: number;
  lastSyncAt?: number;
  lastError?: string;
}

export interface SkillPublisherIdentity {
  id: string;
  name: string;
  description?: string;
  website?: string;
  verified: boolean;
  trustLevel: RegistryTrustLevel;
  publicKeyPem?: string;
  keyId?: string;
}

export interface OnlineSkillVersion {
  id: string;
  version: string;
  manifest: SkillManifest;
  publisherId: string;
  packageUrl: string;
  packageSha256?: string;
  treeSha256?: string;
  signature?: string;
  signingKeyId?: string;
  changelog?: string;
  yanked?: boolean;
  publishedAt: number;
  downloads?: number;
  dependencies?: SkillDependency[];
  compatibility?: SkillManifest["compatibility"];
}

export interface OnlineSkillRecord {
  id: string;
  name: string;
  description: string;
  publisherId: string;
  categories: string[];
  tags: string[];
  versions: OnlineSkillVersion[];
  featured?: boolean;
  verified?: boolean;
  updatedAt: number;
}

export interface OnlineSkillRegistryIndex {
  schemaVersion: 1;
  type: "xr.skill.registry.v1";
  id: string;
  name: string;
  generatedAt: number;
  publishers: SkillPublisherIdentity[];
  skills: OnlineSkillRecord[];
}

export interface MarketplaceBackendState {
  version: 1;
  registries: Record<string, SkillRegistryEndpoint>;
  cachedRegistries: Record<string, OnlineSkillRegistryIndex>;
  installedSources: Record<string, { registryId: string; packageUrl: string; packageSha256?: string; installedAt: number }>;
  rollbackSnapshots: Record<string, Array<{ version: string; dir: string; packagePath?: string; createdAt: number }>>;
  trustedPublishers: Record<string, SkillPublisherIdentity>;
}

export interface VersionResolutionRequest {
  id: string;
  range?: string;
  registryId?: string;
  includeYanked?: boolean;
}

export interface VersionResolutionResult {
  ok: boolean;
  version?: OnlineSkillVersion;
  registry?: SkillRegistryEndpoint;
  reason?: string;
  candidates: OnlineSkillVersion[];
}

export interface SkillUpdateCandidate {
  id: string;
  currentVersion: string;
  latestVersion: string;
  registryId: string;
  packageUrl: string;
  changelog?: string;
}

export interface SkillInstallPlan {
  root: OnlineSkillVersion;
  registry: SkillRegistryEndpoint;
  dependencies: OnlineSkillVersion[];
  warnings: string[];
}
