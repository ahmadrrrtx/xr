/** XR 2.1A — Skill Registry. */
import { SkillLoader, type SkillLoaderOptions } from "./loader-runtime.ts";
import type { UnifiedSkillRecord } from "./adapters.ts";
import { SkillSearchIndex } from "./search-index.ts";

export class SkillRegistry {
  private records: UnifiedSkillRecord[] = [];
  private readonly index = new SkillSearchIndex();

  constructor(private readonly loader = new SkillLoader()) {}

  refresh(options: SkillLoaderOptions = {}): UnifiedSkillRecord[] {
    this.records = this.loader.load(options);
    this.index.build(this.records);
    return this.records;
  }

  list(): UnifiedSkillRecord[] {
    if (!this.records.length) this.refresh();
    return this.records;
  }

  get(id: string): UnifiedSkillRecord | undefined {
    const q = id.toLowerCase();
    return this.list().find((r) => r.manifest.id.toLowerCase() === q || r.manifest.name.toLowerCase() === q);
  }

  search(query: string, limit = 10): UnifiedSkillRecord[] {
    const records = this.list();
    if (!records.length) return [];
    const hits = this.index.search(query, limit);
    const byId = new Map(records.map((record) => [record.manifest.id, record]));
    return hits.map((hit) => byId.get(hit.id)).filter((record): record is UnifiedSkillRecord => Boolean(record));
  }

  health(): { total: number; enabled: number; invalid: number; disabled: number; byKind: Record<string, number>; index: ReturnType<SkillSearchIndex["stats"]> } {
    const records = this.list();
    const byKind: Record<string, number> = {};
    for (const record of records) byKind[record.kind] = (byKind[record.kind] ?? 0) + 1;
    return {
      total: records.length,
      enabled: records.filter((r) => r.enabled).length,
      invalid: records.filter((r) => r.health === "invalid").length,
      disabled: records.filter((r) => !r.enabled).length,
      byKind,
      index: this.index.stats(),
    };
  }
}
