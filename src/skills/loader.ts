/**
 * XR — skills loader. Reads markdown SOPs with YAML-ish frontmatter from the
 * skills/ directory. Pre-built skills ship with XR; learned skills are added by
 * the engine (Phase 3). Loader is dependency-free (tiny frontmatter parser).
 */
import { FilesystemAuthority } from "../security/filesystem.ts";

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
  const out: LoadedSkill[] = [];
  let fs: FilesystemAuthority | undefined;
  try { fs = new FilesystemAuthority(skillsDir, "context"); } catch { return []; }
  try { for (const entry of fs.list(".", 2000)) {
    if (!entry.directory) continue;
    const name = entry.name;
    try {
      const { meta, body } = parseFrontmatter(fs.read(`${entry.path}/SKILL.md`, 256_000).content);
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
  } } finally { fs.close(); }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
