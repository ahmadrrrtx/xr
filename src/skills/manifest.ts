/** XR Stage 13 — skill manifest loading and validation. */
import { existsSync, readFileSync, realpathSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { SkillManifestSchema, type SkillLoadResult, type SkillManifest } from "./schema.ts";

export const SKILL_MANIFEST_FILENAME = "xr-skill.json";

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) meta[key] = val;
  }
  return { meta, body: m[2].trim() };
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function safeResolve(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  return isInside(root, abs) ? abs : null;
}

export function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function hashSkillTree(dir: string): string {
  const root = realpathSync(dir);
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(root);
  files.sort();
  const h = createHash("sha256");
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (rel.startsWith(".git/")) continue;
    h.update(rel);
    h.update("\0");
    h.update(readFileSync(file));
    h.update("\0");
  }
  return h.digest("hex");
}

function manifestFromSkillMd(dir: string): SkillManifest | null {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  const { meta } = parseFrontmatter(readFileSync(file, "utf8"));
  const id = (meta.id ?? meta.name ?? basename(dir)).trim().toLowerCase().replace(/\s+/g, "-");
  const description = meta.description ?? `${id} professional XR skill`;
  const raw = {
    schemaVersion: 1,
    id,
    name: meta.name ?? id.split(/[/-]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" "),
    version: /^\d+$/.test(meta.version ?? "") ? `${meta.version}.0.0` : (meta.version ?? "1.0.0"),
    description,
    publisher: meta.publisher ?? "xr",
    license: meta.license ?? "MIT",
    categories: splitList(meta.categories).length ? splitList(meta.categories) : [meta.category ?? "developer"],
    tags: splitList(meta.tags),
    keywords: splitList(meta.keywords),
    activation: { phrases: splitList(meta.triggers ?? meta.phrases), auto: true },
    content: { instructions: "SKILL.md", docs: existsSync(join(dir, "README.md")) ? ["README.md"] : [] },
    tools: splitList(meta.tools),
    permissions: splitList(meta.permissions).map((scope) => ({ scope, reason: `Declared by ${id}` })),
    verification: { level: meta.source === "preloaded" ? "official" : "unverified" },
  };
  const parsed = SkillManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function readSkillManifest(dir: string): SkillLoadResult {
  const errors: string[] = [];
  try {
    const root = realpathSync(dir);
    const manifestPath = join(root, SKILL_MANIFEST_FILENAME);
    let manifest: SkillManifest | null = null;
    if (existsSync(manifestPath)) {
      try {
        const parsed = SkillManifestSchema.safeParse(JSON.parse(readFileSync(manifestPath, "utf8")));
        if (parsed.success) manifest = parsed.data;
        else errors.push(...parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
      } catch (e) {
        errors.push(`${SKILL_MANIFEST_FILENAME} invalid JSON: ${(e as Error).message}`);
      }
    } else {
      manifest = manifestFromSkillMd(root);
      if (!manifest) errors.push(`missing ${SKILL_MANIFEST_FILENAME} or SKILL.md`);
    }

    if (!manifest) return { ok: false, errors };

    const paths = [
      manifest.content.instructions,
      manifest.content.reasoning,
      ...manifest.content.knowledge,
      ...manifest.content.promptTemplates,
      ...manifest.content.examples,
      ...manifest.content.tests,
      ...manifest.content.docs,
      ...manifest.content.assets,
      manifest.icon,
    ].filter(Boolean) as string[];
    for (const p of paths) {
      const abs = safeResolve(root, p);
      if (!abs) errors.push(`unsafe path outside skill: ${p}`);
    }
    const instructions = safeResolve(root, manifest.content.instructions);
    if (!instructions || !existsSync(instructions)) errors.push(`missing instructions file: ${manifest.content.instructions}`);

    return { ok: errors.length === 0, manifest, dir: root, errors };
  } catch (e) {
    return { ok: false, errors: [`cannot read skill: ${(e as Error).message}`] };
  }
}

export function readSkillInstructions(dir: string, manifest: SkillManifest): string {
  const root = realpathSync(dir);
  const abs = safeResolve(root, manifest.content.instructions);
  if (!abs || !existsSync(abs)) return "";
  return readFileSync(abs, "utf8").trim();
}

export function skillDirName(id: string): string {
  return id.replace(/^@/, "").replace(/[\\/:]/g, "__");
}

export function nearestSkillDir(path: string): string {
  const st = statSync(path);
  return st.isDirectory() ? path : dirname(path);
}
