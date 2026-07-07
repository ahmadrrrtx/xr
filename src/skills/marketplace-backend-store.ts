/** XR 2.1C — Local/installed Marketplace Backend registry store. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { MarketplaceBackendState, OnlineSkillRegistryIndex, SkillPublisherIdentity, SkillRegistryEndpoint } from "./marketplace-backend-types.ts";

function skillsHome(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "skills");
}

export function marketplaceBackendPath(): string {
  return join(skillsHome(), "marketplace-backend.json");
}

const EndpointSchema = z.object({
  id: z.string().min(1).max(120),
  url: z.string().min(1).max(2000),
  enabled: z.boolean(),
  priority: z.number().int(),
  trustLevel: z.enum(["unknown", "community", "reviewed", "verified", "official"]),
  addedAt: z.number().int(),
  lastSyncAt: z.number().int().optional(),
  lastError: z.string().optional(),
});

const StateSchema = z.object({
  version: z.literal(1).default(1),
  registries: z.record(EndpointSchema).default({}),
  cachedRegistries: z.record(z.any()).default({}),
  installedSources: z.record(z.object({ registryId: z.string(), packageUrl: z.string(), packageSha256: z.string().optional(), installedAt: z.number() })).default({}),
  rollbackSnapshots: z.record(z.array(z.object({ version: z.string(), dir: z.string(), packagePath: z.string().optional(), createdAt: z.number() }))).default({}),
  trustedPublishers: z.record(z.any()).default({}),
});

export class MarketplaceBackendStore {
  private state: MarketplaceBackendState;

  constructor(private readonly path = marketplaceBackendPath()) {
    this.state = this.read();
  }

  private read(): MarketplaceBackendState {
    if (!existsSync(this.path)) return StateSchema.parse({}) as MarketplaceBackendState;
    try {
      const parsed = StateSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) return parsed.data as MarketplaceBackendState;
    } catch {}
    return StateSchema.parse({}) as MarketplaceBackendState;
  }

  flush(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state, null, 2));
  }

  listRegistries(): SkillRegistryEndpoint[] {
    return Object.values(this.state.registries).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  enabledRegistries(): SkillRegistryEndpoint[] {
    return this.listRegistries().filter((registry) => registry.enabled);
  }

  getRegistry(id: string): SkillRegistryEndpoint | undefined {
    return this.state.registries[id];
  }

  upsertRegistry(input: Omit<SkillRegistryEndpoint, "addedAt"> & { addedAt?: number }): SkillRegistryEndpoint {
    const existing = this.state.registries[input.id];
    const endpoint: SkillRegistryEndpoint = { ...input, addedAt: input.addedAt ?? existing?.addedAt ?? Date.now() };
    this.state.registries[endpoint.id] = endpoint;
    this.flush();
    return endpoint;
  }

  removeRegistry(id: string): boolean {
    if (!this.state.registries[id]) return false;
    delete this.state.registries[id];
    delete this.state.cachedRegistries[id];
    this.flush();
    return true;
  }

  cacheRegistry(endpoint: SkillRegistryEndpoint, index: OnlineSkillRegistryIndex): void {
    this.state.cachedRegistries[endpoint.id] = index;
    this.state.registries[endpoint.id] = { ...endpoint, lastSyncAt: Date.now(), lastError: undefined };
    for (const publisher of index.publishers) this.state.trustedPublishers[publisher.id] = publisher;
    this.flush();
  }

  markRegistryError(endpoint: SkillRegistryEndpoint, error: string): void {
    this.state.registries[endpoint.id] = { ...endpoint, lastError: error };
    this.flush();
  }

  cachedRegistry(id: string): OnlineSkillRegistryIndex | undefined {
    return this.state.cachedRegistries[id];
  }

  cachedRegistries(): Array<{ endpoint: SkillRegistryEndpoint; index: OnlineSkillRegistryIndex }> {
    return this.enabledRegistries()
      .map((endpoint) => ({ endpoint, index: this.state.cachedRegistries[endpoint.id] }))
      .filter((row): row is { endpoint: SkillRegistryEndpoint; index: OnlineSkillRegistryIndex } => Boolean(row.index));
  }

  trustPublisher(publisher: SkillPublisherIdentity): void {
    this.state.trustedPublishers[publisher.id] = publisher;
    this.flush();
  }

  publisher(id: string): SkillPublisherIdentity | undefined {
    return this.state.trustedPublishers[id];
  }

  recordInstalledSource(skillId: string, source: { registryId: string; packageUrl: string; packageSha256?: string }): void {
    this.state.installedSources[skillId] = { ...source, installedAt: Date.now() };
    this.flush();
  }

  installedSource(skillId: string): { registryId: string; packageUrl: string; packageSha256?: string; installedAt: number } | undefined {
    return this.state.installedSources[skillId];
  }

  addRollbackSnapshot(skillId: string, snapshot: { version: string; dir: string; packagePath?: string; createdAt?: number }): void {
    const rows = this.state.rollbackSnapshots[skillId] ?? [];
    this.state.rollbackSnapshots[skillId] = [{ ...snapshot, createdAt: snapshot.createdAt ?? Date.now() }, ...rows].slice(0, 10);
    this.flush();
  }

  rollbackSnapshots(skillId: string) {
    return this.state.rollbackSnapshots[skillId] ?? [];
  }

  removeRollbackSnapshot(skillId: string, version: string): void {
    this.state.rollbackSnapshots[skillId] = (this.state.rollbackSnapshots[skillId] ?? []).filter((s) => s.version !== version);
    this.flush();
  }
}
