#!/usr/bin/env bun
/**
 * XR — Honest marketplace data generator.
 *
 * Builds the public marketplace page from the REAL bundled inventory
 * (`skills/*` and `plugins/*`) instead of hand-written marketing listings.
 * Every entry carries zero fabricated popularity metrics: bundled items are
 * labeled "Bundled with XR" rather than shown with invented download/review
 * counts. This enforces Constitution Article XV.4 (marketplace trust is
 * signatures + provenance + tests + permissions + outcomes — never popularity)
 * and Article XIX.1 (no public claim without an evidence link).
 *
 *   bun run website/scripts/generate-marketplace.ts            # write
 *   bun run website/scripts/generate-marketplace.ts --check    # drift check (CI)
 *
 * Output: website/src/lib/marketplace.generated.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";

const ROOT = join(import.meta.dir, "..", ".."); // repo root
const SKILLS_DIR = join(ROOT, "skills");
const PLUGINS_DIR = join(ROOT, "plugins");
const OUT_FILE = join(import.meta.dir, "..", "src", "lib", "marketplace.generated.ts");

interface SkillManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  longDescription?: string;
  publisher?: string;
  categories?: string[];
  tags?: string[];
}

interface PluginManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  compatibility?: string;
}

type SiteCategory =
  | "coding"
  | "devops"
  | "data"
  | "design"
  | "productivity"
  | "research"
  | "writing"
  | "security"
  | "web";

const CATEGORY_MAP: Record<string, SiteCategory> = {
  developer: "coding",
  devops: "devops",
  data: "data",
  creative: "design",
  design: "design",
  business: "productivity",
  productivity: "productivity",
  research: "research",
  writing: "writing",
  security: "security",
  web: "web",
};

const DEFAULT_CATEGORY: SiteCategory = "productivity";

/** Icons that are already imported in the website's data module (guaranteed present). */
const ICON_BY_CATEGORY: Record<string, string> = {
  coding: "Code2",
  devops: "Terminal",
  data: "Database",
  design: "Palette",
  productivity: "Workflow",
  research: "BookOpen",
  writing: "FileCode2",
  security: "ShieldCheck",
  web: "Globe",
  extension: "Rocket",
};

const GRADIENTS: readonly string[] = [
  "linear-gradient(135deg,#7c5cff,#3b82f6)",
  "linear-gradient(135deg,#22d3ee,#6366f1)",
  "linear-gradient(135deg,#10b981,#06b6d4)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
  "linear-gradient(135deg,#f472b6,#f59e0b)",
  "linear-gradient(135deg,#14b8a6,#6366f1)",
  "linear-gradient(135deg,#ef4444,#f97316)",
  "linear-gradient(135deg,#ec4899,#a855f7)",
];

function humanize(id: string): string {
  return id
    .split(/[_-]/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function firstSentence(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const dot = clean.indexOf(". ");
  const first = dot === -1 ? clean : clean.slice(0, dot + 1);
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

function parseFrontMatter(md: string): { id?: string; version?: string } {
  const m = /^---\s*\n([\s\S]*?)\n---/.exec(md);
  if (!m) return {};
  const out: { id?: string; version?: string } = {};
  for (const line of m[1]!.split("\n")) {
    const kv = /^([a-zA-Z_]+):\s*(.*)$/.exec(line);
    if (kv) {
      const key = kv[1]!;
      const value = kv[2]!.replace(/["']/g, "").trim();
      if (key === "id") out.id = value;
      if (key === "version") out.version = value;
    }
  }
  return out;
}

interface Item {
  id: string;
  name: string;
  tagline: string;
  description: string;
  type: "skill" | "extension";
  category: SiteCategory;
  author: string;
  verified: boolean;
  downloads: number;
  rating: number;
  reviews: number;
  version: string;
  compatibility: string;
  icon: string;
  iconBg: string;
  installs: string;
  updated: string;
  installCmd: string;
  tags: string[];
}

function loadItems(): Item[] {
  const items: Item[] = [];

  for (const dir of readdirSync(SKILLS_DIR).sort()) {
    const skillDir = join(SKILLS_DIR, dir);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(skillDir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const manifestPath = join(skillDir, "xr-skill.json");
    let manifest: SkillManifest = {};
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as SkillManifest;
    } catch {
      // Preloaded skill without a manifest: read front matter from SKILL.md.
      const mdPath = join(skillDir, "SKILL.md");
      if (existsSync(mdPath)) {
        const fm = parseFrontMatter(readFileSync(mdPath, "utf8"));
        const id = fm.id ?? dir;
        manifest = { id, name: humanize(id), version: fm.version ?? "1" };
      } else {
        continue; // Not a skill directory.
      }
    }

    const id = manifest.id ?? dir;
    const categories = manifest.categories ?? [];
    const category = CATEGORY_MAP[categories[0]?.toLowerCase() ?? ""] ?? DEFAULT_CATEGORY;
    const description =
      manifest.description ?? manifest.longDescription ?? `${manifest.name ?? humanize(id)} — bundled XR skill.`;

    items.push({
      id,
      name: manifest.name ?? humanize(id),
      tagline: firstSentence(description),
      description,
      type: "skill",
      category,
      author: "XR Official",
      verified: true,
      downloads: 0,
      rating: 0,
      reviews: 0,
      version: manifest.version ?? "1.0.0",
      compatibility: "Bundled with XR",
      icon: ICON_BY_CATEGORY[category] ?? "Zap",
      iconBg: GRADIENTS[items.length % GRADIENTS.length]!,
      installs: "Bundled",
      updated: "Ships with XR",
      installCmd: `xr skills inspect ${id}`,
      tags: (manifest.tags ?? []).slice(0, 3),
    });
  }

  if (existsSync(PLUGINS_DIR)) {
    for (const dir of readdirSync(PLUGINS_DIR).sort()) {
      const manifestPath = join(PLUGINS_DIR, dir, "xr-plugin.json");
      if (!existsSync(manifestPath)) continue;
      let manifest: PluginManifest = {};
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PluginManifest;
      } catch {
        continue;
      }
      const id = manifest.id ?? dir;
      const description = manifest.description ?? `${manifest.name ?? humanize(id)} — bundled XR plugin.`;
      items.push({
        id,
        name: manifest.name ?? humanize(id),
        tagline: firstSentence(description),
        description,
        type: "extension",
        category: "devops",
        author: manifest.author ?? "XR Official",
        verified: true,
        downloads: 0,
        rating: 0,
        reviews: 0,
        version: manifest.version ?? "1.0.0",
        compatibility: manifest.compatibility ?? "Bundled with XR",
        icon: "Rocket",
        iconBg: GRADIENTS[items.length % GRADIENTS.length]!,
        installs: "Bundled",
        updated: "Ships with XR",
        installCmd: `xr skills install-local ${dir}`,
        tags: [],
      });
    }
  }

  return items.sort((a, b) => a.name.localeCompare(b.name));
}

const CATEGORIES: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "coding", label: "Coding" },
  { id: "devops", label: "DevOps" },
  { id: "data", label: "Data" },
  { id: "design", label: "Design" },
  { id: "productivity", label: "Productivity" },
  { id: "research", label: "Research" },
  { id: "writing", label: "Writing" },
  { id: "security", label: "Security" },
  { id: "web", label: "Web" },
];

function render(items: Item[]): string {
  const lines: string[] = [];
  lines.push("/* eslint-disable */");
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(" * Source: skills/* and plugins/* — the real bundled inventory.");
  lines.push(" * Regenerate: bun run website/scripts/generate-marketplace.ts");
  lines.push(" * CI fails on drift: add `website:marketplace:check` to the gates.");
  lines.push(" *");
  lines.push(" * No fabricated popularity metrics. Bundled items report");
  lines.push(" * downloads=0, rating=0, reviews=0 and are labeled \"Bundled with XR\"");
  lines.push(" * (Constitution Art. XV.4 — marketplace trust is never popularity).");
  lines.push(" */");
  lines.push("import { Code2, Terminal, Database, Palette, Workflow, BookOpen, FileCode2, ShieldCheck, Globe, Rocket, Zap } from \"lucide-react\";");
  lines.push("import type { ComponentType } from \"react\";");
  lines.push("");
  lines.push("export type ItemType = \"skill\" | \"extension\";");
  lines.push("");
  lines.push("export interface MarketplaceItem {");
  lines.push("  id: string;");
  lines.push("  name: string;");
  lines.push("  tagline: string;");
  lines.push("  description: string;");
  lines.push("  type: ItemType;");
  lines.push("  category: string;");
  lines.push("  author: string;");
  lines.push("  verified: boolean;");
  lines.push("  downloads: number;");
  lines.push("  rating: number;");
  lines.push("  reviews: number;");
  lines.push("  version: string;");
  lines.push("  compatibility: string;");
  lines.push("  icon: ComponentType<{ className?: string }>;");
  lines.push("  iconBg: string;");
  lines.push("  installs: string;");
  lines.push("  updated: string;");
  lines.push("  installCmd: string;");
  lines.push("  tags: string[];");
  lines.push("}");
  lines.push("");
  lines.push("export const marketplaceCategories = [");
  for (const c of CATEGORIES) lines.push(`  { id: ${JSON.stringify(c.id)}, label: ${JSON.stringify(c.label)} },`);
  lines.push("] as const;");
  lines.push("");
  lines.push("export const marketplaceItems: MarketplaceItem[] = [");
  for (const it of items) {
    lines.push("  {");
    lines.push(`    id: ${JSON.stringify(it.id)},`);
    lines.push(`    name: ${JSON.stringify(it.name)},`);
    lines.push(`    tagline: ${JSON.stringify(it.tagline)},`);
    lines.push(`    description: ${JSON.stringify(it.description)},`);
    lines.push(`    type: ${JSON.stringify(it.type)},`);
    lines.push(`    category: ${JSON.stringify(it.category)},`);
    lines.push(`    author: ${JSON.stringify(it.author)},`);
    lines.push(`    verified: ${String(it.verified)},`);
    lines.push(`    downloads: ${it.downloads},`);
    lines.push(`    rating: ${it.rating},`);
    lines.push(`    reviews: ${it.reviews},`);
    lines.push(`    version: ${JSON.stringify(it.version)},`);
    lines.push(`    compatibility: ${JSON.stringify(it.compatibility)},`);
    lines.push(`    icon: ${it.icon},`);
    lines.push(`    iconBg: ${JSON.stringify(it.iconBg)},`);
    lines.push(`    installs: ${JSON.stringify(it.installs)},`);
    lines.push(`    updated: ${JSON.stringify(it.updated)},`);
    lines.push(`    installCmd: ${JSON.stringify(it.installCmd)},`);
    lines.push(`    tags: ${JSON.stringify(it.tags)},`);
    lines.push("  },");
  }
  lines.push("];");
  lines.push("");
  return lines.join("\n");
}

const check = process.argv.includes("--check");
const items = loadItems();
const output = render(items);

if (check) {
  if (!existsSync(OUT_FILE)) {
    console.error(`[marketplace:check] MISSING ${relative(ROOT, OUT_FILE)} — run website/scripts/generate-marketplace.ts`);
    process.exit(1);
  }
  const current = readFileSync(OUT_FILE, "utf8");
  if (current !== output) {
    console.error(
      `[marketplace:check] DRIFT in ${relative(ROOT, OUT_FILE)} — regenerate with bun run website/scripts/generate-marketplace.ts`,
    );
    process.exit(1);
  }
  console.log(`[marketplace:check] ok — ${items.length} real items (${items.filter((i) => i.type === "skill").length} skills, ${items.filter((i) => i.type === "extension").length} plugins)`);
  process.exit(0);
}

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, output, "utf8");
console.log(`[marketplace:generate] wrote ${relative(ROOT, OUT_FILE)} — ${items.length} real items`);
