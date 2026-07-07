/** XR 2.1C — Online Registry Interface. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { SkillManifestSchema } from "./schema.ts";
import type { OnlineSkillRegistryIndex, OnlineSkillVersion, SkillRegistryEndpoint } from "./marketplace-backend-types.ts";
import { MarketplaceBackendStore } from "./marketplace-backend-store.ts";

const PublisherSchema = z.object({
  id: z.string().min(1).max(160),
  name: z.string().min(1).max(180),
  description: z.string().optional(),
  website: z.string().optional(),
  verified: z.boolean().default(false),
  trustLevel: z.enum(["unknown", "community", "reviewed", "verified", "official"]).default("unknown"),
  publicKeyPem: z.string().optional(),
  keyId: z.string().optional(),
});

const VersionSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  manifest: SkillManifestSchema,
  publisherId: z.string().min(1),
  packageUrl: z.string().min(1),
  packageSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  treeSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  signature: z.string().optional(),
  signingKeyId: z.string().optional(),
  changelog: z.string().optional(),
  yanked: z.boolean().optional(),
  publishedAt: z.number(),
  downloads: z.number().optional(),
  dependencies: z.array(z.any()).optional(),
  compatibility: z.any().optional(),
});

const SkillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  publisherId: z.string().min(1),
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  versions: z.array(VersionSchema).default([]),
  featured: z.boolean().optional(),
  verified: z.boolean().optional(),
  updatedAt: z.number(),
});

const RegistrySchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal("xr.skill.registry.v1"),
  id: z.string().min(1),
  name: z.string().min(1),
  generatedAt: z.number(),
  publishers: z.array(PublisherSchema).default([]),
  skills: z.array(SkillSchema).default([]),
});

function isProbablyUrl(input: string): boolean {
  return /^https?:\/\//i.test(input);
}

async function readRegistryUrl(url: string): Promise<unknown> {
  if (isProbablyUrl(url)) {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`registry HTTP ${res.status}: ${url}`);
    return await res.json();
  }
  const path = url.startsWith("file://") ? new URL(url) : resolve(url);
  const text = readFileSync(path instanceof URL ? path : path, "utf8");
  return JSON.parse(text);
}

function resolvePackageUrls(index: OnlineSkillRegistryIndex, registryUrl: string): OnlineSkillRegistryIndex {
  if (isProbablyUrl(registryUrl) || registryUrl.startsWith("file://")) {
    const base = new URL(registryUrl);
    for (const skill of index.skills) {
      for (const version of skill.versions) {
        if (!/^(https?:\/\/|file:\/\/|\/)/i.test(version.packageUrl)) version.packageUrl = new URL(version.packageUrl, base).toString();
      }
    }
  }
  return index;
}

export class OnlineSkillRegistryClient {
  constructor(private readonly store = new MarketplaceBackendStore()) {}

  async sync(endpoint: SkillRegistryEndpoint): Promise<OnlineSkillRegistryIndex> {
    const raw = await readRegistryUrl(endpoint.url);
    const parsed = RegistrySchema.safeParse(raw);
    if (!parsed.success) throw new Error(`invalid registry ${endpoint.id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const index = resolvePackageUrls(parsed.data as OnlineSkillRegistryIndex, endpoint.url);
    this.store.cacheRegistry(endpoint, index);
    return index;
  }

  async syncAll(): Promise<Array<{ endpoint: SkillRegistryEndpoint; ok: boolean; error?: string }>> {
    const out: Array<{ endpoint: SkillRegistryEndpoint; ok: boolean; error?: string }> = [];
    for (const endpoint of this.store.enabledRegistries()) {
      try {
        await this.sync(endpoint);
        out.push({ endpoint, ok: true });
      } catch (e) {
        const msg = (e as Error).message;
        this.store.markRegistryError(endpoint, msg);
        out.push({ endpoint, ok: false, error: msg });
      }
    }
    return out;
  }

  search(query: string): Array<{ registry: SkillRegistryEndpoint; version: OnlineSkillVersion; score: number }> {
    const terms = query.toLowerCase().split(/[^a-z0-9+#._-]+/).filter(Boolean);
    const rows: Array<{ registry: SkillRegistryEndpoint; version: OnlineSkillVersion; score: number }> = [];
    for (const { endpoint, index } of this.store.cachedRegistries()) {
      for (const skill of index.skills) {
        const latest = [...skill.versions].filter((v) => !v.yanked).sort((a, b) => b.publishedAt - a.publishedAt)[0];
        if (!latest) continue;
        const text = [skill.id, skill.name, skill.description, skill.publisherId, ...skill.categories, ...skill.tags, latest.manifest.description].join(" ").toLowerCase();
        const score = terms.length ? terms.reduce((sum, t) => sum + (text.includes(t) ? 1 : 0), 0) : 1;
        if (score > 0) rows.push({ registry: endpoint, version: latest, score });
      }
    }
    return rows.sort((a, b) => b.score - a.score || b.version.publishedAt - a.version.publishedAt);
  }

  allVersions(skillId: string, registryId?: string): Array<{ registry: SkillRegistryEndpoint; version: OnlineSkillVersion }> {
    const rows: Array<{ registry: SkillRegistryEndpoint; version: OnlineSkillVersion }> = [];
    for (const { endpoint, index } of this.store.cachedRegistries()) {
      if (registryId && endpoint.id !== registryId) continue;
      for (const skill of index.skills) {
        if (skill.id !== skillId) continue;
        for (const version of skill.versions) rows.push({ registry: endpoint, version });
      }
    }
    return rows;
  }
}

export function registryFileExists(path: string): boolean {
  return existsSync(path.startsWith("file://") ? new URL(path) : path);
}
