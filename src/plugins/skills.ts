/** XR Stage 10 — plugin-packaged skills. */
import { existsSync, readdirSync, readFileSync, statSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute, resolve } from "node:path";
import type { LoadedSkill } from "../skills/loader.ts";
import type { PluginManifest } from "./types.ts";

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val.replace(/^['"]|['"]$/g, "");
  }
  return { meta, body: m[2].trim() };
}

function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function collectSkillFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name === "SKILL.md") out.push(p);
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root);
  return out;
}

/** Load skills contributed by an enabled plugin. No code execution is involved. */
export function loadPluginSkills(pluginDir: string, manifest: PluginManifest): LoadedSkill[] {
  const base = realpathSync(pluginDir);
  const skillPaths = manifest.skillPaths ?? [];
  const out: LoadedSkill[] = [];
  for (const relPath of skillPaths) {
    const abs = realpathSync(resolve(pluginDir, relPath));
    if (!inside(base, abs)) continue;
    for (const file of collectSkillFiles(abs)) {
      try {
        const real = realpathSync(file);
        if (!inside(base, real)) continue;
        const { meta, body } = parseFrontmatter(readFileSync(real, "utf8"));
        const folderName = file.split(/[\\/]/).slice(-2, -1)[0] ?? manifest.id;
        const id = `${manifest.id}/${meta.id ?? meta.name ?? folderName}`;
        out.push({
          id,
          version: Number(meta.version ?? manifest.version.replace(/[^0-9.]/g, "").split(".")[0] ?? 1),
          source: `plugin:${manifest.id}`,
          tools: (meta.tools ?? "")
            .replace(/[\[\]]/g, "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          verifier: meta.verifier ?? "user_approved",
          body,
        });
      } catch {
        /* malformed plugin skill: skip, never crash XR */
      }
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
