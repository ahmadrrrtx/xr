/**
 * XR — skills loader. Reads markdown SOPs with YAML-ish frontmatter from the
 * skills/ directory. Pre-built skills ship with XR; learned skills are added by
 * the engine (Phase 3). Loader is dependency-free (tiny frontmatter parser).
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export interface LoadedSkill {
  id: string;
  version: number;
  source: string;
  tools: string[];
  body: string;
  verifier: string; // raw verifier spec text (for display)
}

/** Minimal frontmatter parser: extracts the block between leading --- lines. */
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

export function loadSkills(skillsDir: string): LoadedSkill[] {
  if (!existsSync(skillsDir)) return [];
  const out: LoadedSkill[] = [];
  for (const name of readdirSync(skillsDir)) {
    const dir = join(skillsDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const file = join(dir, "SKILL.md");
    if (!existsSync(file)) continue;
    try {
      const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
      out.push({
        id: meta.id ?? name,
        version: Number(meta.version ?? 1),
        source: meta.source ?? "preloaded",
        tools: (meta.tools ?? "")
          .replace(/[[\]]/g, "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        verifier: meta.verifier ?? "user_approved",
        body,
      });
    } catch {
      /* skip malformed skill — never crash */
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
