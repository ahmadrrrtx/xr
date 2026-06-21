/**
 * XR Stage 10 — plugin catalog discovery.
 *
 * Catalog search is metadata-only. It never installs code and never trusts the
 * catalog as authority. Install still re-validates the manifest, permissions,
 * compatibility, file tree, and trust hashes from the source that is installed.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { PluginType, PermissionScope } from "./types.ts";
import { xrHome } from "./registry.ts";

export const CatalogEntrySchema = z.object({
  id: z.string().min(2).max(96),
  name: z.string().min(1).max(160),
  version: z.string().min(1).max(40),
  author: z.string().max(200).default("unknown"),
  description: z.string().max(2000).default(""),
  type: z.string().default("tool"),
  source: z.enum(["local", "catalog", "github", "url", "builtin"]).default("catalog"),
  sourceUrl: z.string().max(800).optional(),
  install: z
    .object({
      kind: z.enum(["local", "git", "tarball", "mcpb", "metadata-only"]).default("metadata-only"),
      path: z.string().max(800).optional(),
      url: z.string().max(800).optional(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
    })
    .default({ kind: "metadata-only" }),
  permissions: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  trustLevel: z.enum(["unknown", "community", "reviewed", "verified", "official", "local-dev"]).default("unknown"),
  tags: z.array(z.string()).default([]),
  homepage: z.string().max(800).optional(),
});

export type CatalogEntry = z.infer<typeof CatalogEntrySchema> & {
  type: PluginType | string;
  permissions: Array<PermissionScope | string>;
};

const BUILTIN_CATALOG: CatalogEntry[] = [
  {
    id: "hello",
    name: "Hello XR",
    version: "1.0.0",
    author: "rrrtx",
    description: "Reference plugin: contributes a command and a safe echo tool with no sensitive permissions.",
    type: "tool",
    source: "builtin",
    install: { kind: "local", path: "plugins/hello" },
    permissions: [],
    capabilities: ["command:greet", "tool:echo"],
    trustLevel: "official",
    tags: ["example", "tool"],
    homepage: "https://github.com/ahmadrrrtx/xr",
  },
  {
    id: "github",
    name: "GitHub",
    version: "1.0.0",
    author: "rrrtx",
    description: "Reference integration plugin for public GitHub repository lookup through permissioned network access.",
    type: "integration",
    source: "builtin",
    install: { kind: "local", path: "plugins/github" },
    permissions: ["net", "secrets"],
    capabilities: ["command:repo", "tool:repo"],
    trustLevel: "official",
    tags: ["github", "integration", "example"],
    homepage: "https://github.com/ahmadrrrtx/xr",
  },
];

function catalogFile(): string {
  return join(xrHome(), "plugins", "catalog.json");
}

function loadLocalCatalog(): CatalogEntry[] {
  const p = catalogFile();
  if (!existsSync(p)) return [];
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw?.plugins) ? raw.plugins : [];
    const out: CatalogEntry[] = [];
    for (const row of rows) {
      const parsed = CatalogEntrySchema.safeParse(row);
      if (parsed.success) out.push(parsed.data as CatalogEntry);
    }
    return out;
  } catch {
    return [];
  }
}

export function allCatalogEntries(): CatalogEntry[] {
  const byId = new Map<string, CatalogEntry>();
  for (const e of [...BUILTIN_CATALOG, ...loadLocalCatalog()]) byId.set(e.id, e);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function searchCatalog(query = ""): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  const rows = allCatalogEntries();
  if (!q) return rows;
  return rows.filter((e) => {
    const hay = [e.id, e.name, e.description, e.type, e.author, ...(e.tags ?? []), ...(e.capabilities ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

export function resolveCatalogInstallSource(entry: CatalogEntry, cwd: string): string | null {
  if (entry.install.kind !== "local" || !entry.install.path) return null;
  const fromCwd = resolve(cwd, entry.install.path);
  if (existsSync(fromCwd)) return fromCwd;
  const here = dirname(fileURLToPath(import.meta.url));
  const fromPackageRoot = resolve(here, "..", "..", entry.install.path);
  return existsSync(fromPackageRoot) ? fromPackageRoot : fromCwd;
}
