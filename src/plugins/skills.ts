/** Plugin SOP content is authorized separately from installed-code/manifest loading. */
import { FilesystemAuthority } from "../security/filesystem.ts";
import type { LoadedSkill } from "../skills/loader.ts";
import type { PluginManifest } from "./types.ts";
function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":"); if (idx === -1) continue;
    const key = line.slice(0, idx).trim(), val = line.slice(idx + 1).trim();
    if (key) meta[key] = val.replace(/^['"]|['"]$/g, "");
  }
  return { meta, body: m[2].trim() };
}
export function loadPluginSkills(pluginDir: string, manifest: PluginManifest): LoadedSkill[] {
  const out: LoadedSkill[] = [];
  let fs: FilesystemAuthority;
  try { fs = new FilesystemAuthority(pluginDir, "context"); } catch { return []; }
  try {
    for (const path of manifest.skillPaths ?? []) {
      try {
        for (const file of fs.walk(path)) {
          if (file.name !== "SKILL.md") continue;
          try {
            const { meta, body } = parseFrontmatter(fs.read(file.path, 256_000).content);
            const folder = file.path.split("/").slice(-2, -1)[0] ?? manifest.id;
            out.push({ id: `${manifest.id}/${meta.id ?? meta.name ?? folder}`,
              version: Number(meta.version ?? manifest.version.replace(/[^0-9.]/g, "").split(".")[0] ?? 1), source: `plugin:${manifest.id}`,
              tools: (meta.tools ?? "").replace(/[\[\]]/g, "").split(",").map(s => s.trim()).filter(Boolean),
              verifier: meta.verifier ?? "user_approved", body });
          } catch { /* unsafe/malformed body is not context */ }
        }
      } catch { /* unsafe/nonexistent skill roots are not candidates */ }
    }
  } finally { fs.close(); }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
