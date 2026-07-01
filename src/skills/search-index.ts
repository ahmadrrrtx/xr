/** XR 2.1A — local Skill Search Index. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { UnifiedSkillRecord } from "./adapters.ts";

export interface SkillSearchHit {
  id: string;
  score: number;
  reasons: string[];
}

interface SearchIndexFile {
  version: 1;
  builtAt: number;
  documents: Array<{ id: string; text: string; tokens: string[] }>;
}

function skillHome(): string {
  return join(process.env.XR_HOME ?? join(homedir(), ".xr"), "skills");
}

function indexPath(): string {
  return join(skillHome(), "search-index.json");
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function documentText(record: UnifiedSkillRecord): string {
  const m = record.manifest;
  return [
    m.id,
    m.name,
    m.description,
    m.longDescription ?? "",
    m.publisher,
    record.kind,
    record.source,
    ...m.categories,
    ...m.tags,
    ...m.keywords,
    ...m.activation.phrases,
    ...m.tools,
    ...m.permissions.map((p) => `${p.scope} ${p.reason}`),
    ...m.dependencies.map((d) => `${d.kind} ${d.id} ${d.reason ?? ""}`),
    ...m.contributions.commands.map((c) => `${c.name} ${c.title} ${c.description}`),
    ...m.contributions.workflows.flatMap((w) => [w.id, w.title, w.description, ...w.steps.map((s) => `${s.title} ${s.instruction}`)]),
  ].join(" ");
}

export class SkillSearchIndex {
  private file: SearchIndexFile = { version: 1, builtAt: 0, documents: [] };

  constructor(private readonly path = indexPath()) {
    this.file = this.read();
  }

  private read(): SearchIndexFile {
    if (!existsSync(this.path)) return { version: 1, builtAt: 0, documents: [] };
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      if (raw?.version === 1 && Array.isArray(raw.documents)) return raw as SearchIndexFile;
    } catch {}
    return { version: 1, builtAt: 0, documents: [] };
  }

  build(records: UnifiedSkillRecord[]): SearchIndexFile {
    this.file = {
      version: 1,
      builtAt: Date.now(),
      documents: records.map((record) => {
        const text = documentText(record);
        return { id: record.manifest.id, text, tokens: tokenize(text) };
      }),
    };
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.file, null, 2));
    return this.file;
  }

  search(query: string, limit = 10): SkillSearchHit[] {
    const q = tokenize(query);
    if (!q.length) return this.file.documents.slice(0, limit).map((d) => ({ id: d.id, score: 1, reasons: ["default ordering"] }));
    const hits = this.file.documents.map((doc) => {
      let score = 0;
      const reasons: string[] = [];
      const tokenSet = new Set(doc.tokens);
      const lower = doc.text.toLowerCase();
      for (const term of q) {
        if (doc.id.toLowerCase() === term) { score += 30; reasons.push(`exact id:${term}`); }
        if (doc.id.toLowerCase().includes(term)) { score += 12; reasons.push(`id:${term}`); }
        if (tokenSet.has(term)) { score += 6; reasons.push(`token:${term}`); }
        else if (lower.includes(term)) { score += 2; reasons.push(`text:${term}`); }
      }
      return { id: doc.id, score, reasons: [...new Set(reasons)].slice(0, 8) };
    });
    return hits.filter((h) => h.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }

  stats(): { documents: number; builtAt: number; path: string } {
    return { documents: this.file.documents.length, builtAt: this.file.builtAt, path: this.path };
  }
}
