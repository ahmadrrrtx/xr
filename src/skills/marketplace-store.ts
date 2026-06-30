/** XR Stage 13 — local marketplace registry and installation database. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import { InstallationSchema, PublisherSchema, ReviewSchema, type Publisher, type SkillInstallation, type SkillReview } from "./schema.ts";

export function skillsHome(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "skills");
}

export function installedSkillsDir(): string {
  return join(skillsHome(), "installed");
}

export function packageCacheDir(): string {
  return join(skillsHome(), "packages");
}

export function registryFilePath(): string {
  return join(skillsHome(), "registry.json");
}

export function ensureSkillsHome(): void {
  for (const dir of [skillsHome(), installedSkillsDir(), packageCacheDir()]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

const MarketplaceRegistrySchema = z.object({
  version: z.literal(1).default(1),
  installations: z.record(InstallationSchema).default({}),
  publishers: z.record(PublisherSchema).default({}),
  reviews: z.record(ReviewSchema).default({}),
  disabledBundled: z.array(z.string()).default([]),
  favorites: z.array(z.string()).default([]),
  analytics: z.record(z.object({ installs: z.number().int().default(0), runs: z.number().int().default(0), lastRunAt: z.number().int().optional() })).default({}),
});

type MarketplaceRegistry = z.infer<typeof MarketplaceRegistrySchema>;

export class SkillMarketplaceStore {
  private data: MarketplaceRegistry;

  constructor(private readonly path = registryFilePath()) {
    ensureSkillsHome();
    this.data = this.read();
  }

  private read(): MarketplaceRegistry {
    if (!existsSync(this.path)) return MarketplaceRegistrySchema.parse({});
    try {
      const parsed = MarketplaceRegistrySchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) return parsed.data;
    } catch {}
    const backup = `${this.path}.broken-${Date.now()}`;
    try { writeFileSync(backup, readFileSync(this.path)); } catch {}
    return MarketplaceRegistrySchema.parse({});
  }

  private flush(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }

  listInstallations(): SkillInstallation[] {
    return Object.values(this.data.installations).sort((a, b) => a.id.localeCompare(b.id));
  }

  getInstallation(id: string): SkillInstallation | undefined {
    return this.data.installations[id];
  }

  upsertInstallation(entry: SkillInstallation): void {
    this.data.installations[entry.id] = InstallationSchema.parse(entry);
    const a = this.data.analytics[entry.id] ?? { installs: 0, runs: 0 };
    a.installs += 1;
    this.data.analytics[entry.id] = a;
    this.flush();
  }

  patchInstallation(id: string, patch: Partial<SkillInstallation>): boolean {
    const cur = this.data.installations[id];
    if (!cur) return false;
    this.data.installations[id] = InstallationSchema.parse({ ...cur, ...patch, updatedAt: Date.now() });
    this.flush();
    return true;
  }

  removeInstallation(id: string): boolean {
    if (!this.data.installations[id]) return false;
    delete this.data.installations[id];
    this.flush();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const cur = this.data.installations[id];
    if (cur) return this.patchInstallation(id, { enabled });
    const disabled = new Set(this.data.disabledBundled);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    this.data.disabledBundled = [...disabled].sort();
    this.flush();
    return true;
  }

  isBundledDisabled(id: string): boolean {
    return this.data.disabledBundled.includes(id);
  }

  setFavorite(id: string, favorite: boolean): void {
    const fav = new Set(this.data.favorites);
    if (favorite) fav.add(id);
    else fav.delete(id);
    this.data.favorites = [...fav].sort();
    if (this.data.installations[id]) this.data.installations[id].favorite = favorite;
    this.flush();
  }

  isFavorite(id: string): boolean {
    return this.data.favorites.includes(id) || Boolean(this.data.installations[id]?.favorite);
  }

  pin(id: string, pinned: boolean): boolean {
    return this.patchInstallation(id, { pinned });
  }

  recordRun(id: string): void {
    const a = this.data.analytics[id] ?? { installs: 0, runs: 0 };
    a.runs += 1;
    a.lastRunAt = Date.now();
    this.data.analytics[id] = a;
    if (this.data.installations[id]) this.data.installations[id].lastUsedAt = Date.now();
    this.flush();
  }

  analytics(id: string): { installs: number; runs: number; lastRunAt?: number } {
    return this.data.analytics[id] ?? { installs: 0, runs: 0 };
  }

  upsertPublisher(publisher: Publisher): void {
    this.data.publishers[publisher.id] = PublisherSchema.parse(publisher);
    this.flush();
  }

  listPublishers(): Publisher[] {
    return Object.values(this.data.publishers).sort((a, b) => a.name.localeCompare(b.name));
  }

  addReview(review: SkillReview): void {
    this.data.reviews[review.id] = ReviewSchema.parse(review);
    this.flush();
  }

  reviewsFor(skillId: string): SkillReview[] {
    return Object.values(this.data.reviews).filter((r) => r.skillId === skillId).sort((a, b) => b.createdAt - a.createdAt);
  }

  ratingFor(skillId: string): { average: number; count: number } {
    const reviews = this.reviewsFor(skillId);
    if (!reviews.length) return { average: 0, count: 0 };
    return { average: reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length, count: reviews.length };
  }
}
