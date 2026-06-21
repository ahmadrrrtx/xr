/** XR Stage 10 — plugin validation, trust hashing, static scan, and loader. */
import { existsSync, readFileSync, statSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { Store } from "../state/db.ts";
import type { XRConfig } from "../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import { readManifest, validatePermissions, effectiveGrant } from "./manifest.ts";
import { checkCompatibility } from "./compat.ts";
import { buildHost } from "./host.ts";
import type { PermissionScope, PluginContributions, PluginManifest, PluginModule, PluginRecord } from "./types.ts";

export interface ValidateResult {
  ok: boolean;
  manifest?: PluginManifest;
  entryHash?: string;
  treeHash?: string;
  warnings: string[];
  errors: string[];
}

const MAX_PLUGIN_FILES = 500;
const MAX_PLUGIN_BYTES = 10 * 1024 * 1024;
const SCANNED_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const DISALLOWED_IMPORTS = [
  "node:child_process",
  "child_process",
  "node:fs",
  "fs",
  "node:fs/promises",
  "fs/promises",
  "bun:sqlite",
  "node:net",
  "net",
  "node:tls",
  "tls",
  "node:http",
  "http",
  "node:https",
  "https",
  "node:process",
  "process",
];
const DISALLOWED_PATTERNS: Array<[RegExp, string]> = [
  [/\bprocess\.env\b/, "direct process.env access is not allowed; request secrets/provider config through the host"],
  [/\bBun\.(spawn|spawnSync|file|write|serve)\b/, "direct Bun host APIs are not allowed in plugins"],
  [/\b(eval|Function)\s*\(/, "dynamic code execution is not allowed in plugins"],
  [/(^|[^.\w])fetch\s*\(/, "direct fetch is not allowed; request the net permission and use host.net.fetch"],
];

function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containedPath(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  return inside(root, abs) ? abs : null;
}

/** Hash only the entrypoint file for backwards compatibility with the existing registry. */
export function hashEntrypoint(dir: string, manifest: PluginManifest): string | undefined {
  const entry = containedPath(dir, manifest.entrypoint);
  if (!entry || !existsSync(entry)) return undefined;
  try {
    return createHash("sha256").update(readFileSync(entry)).digest("hex");
  } catch {
    return undefined;
  }
}

/** Hash every regular file in deterministic order so helper-file tampering is caught. */
export function hashPluginTree(dir: string): string | undefined {
  try {
    const root = realpathSync(dir);
    const rows: Array<{ rel: string; hash: string }> = [];
    const walk = (cur: string) => {
      for (const name of readdirSync(cur).sort()) {
        if (name === "data" || name === ".git" || name === "node_modules") continue;
        const p = join(cur, name);
        const st = lstatSync(p);
        if (st.isSymbolicLink()) continue;
        if (st.isDirectory()) walk(p);
        else if (st.isFile()) {
          const real = realpathSync(p);
          if (!inside(root, real)) continue;
          rows.push({ rel: relative(root, real).replace(/\\/g, "/"), hash: createHash("sha256").update(readFileSync(real)).digest("hex") });
        }
      }
    };
    walk(root);
    const h = createHash("sha256");
    for (const row of rows.sort((a, b) => a.rel.localeCompare(b.rel))) h.update(`${row.rel}:${row.hash}\n`);
    return h.digest("hex");
  } catch {
    return undefined;
  }
}

function scanTree(dir: string): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  let files = 0;
  let bytes = 0;
  const root = realpathSync(dir);

  const scanFile = (file: string) => {
    if (!SCANNED_EXT.test(file)) return;
    const rel = relative(root, file).replace(/\\/g, "/");
    const rawText = readFileSync(file, "utf8").slice(0, 1_000_000);
    const text = rawText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "\n");
    for (const mod of DISALLOWED_IMPORTS) {
      const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:from\\s+["']${esc}["']|import\\s*\\(["']${esc}["']\\)|require\\s*\\(["']${esc}["']\\))`);
      if (re.test(text)) errors.push(`${rel}: disallowed import "${mod}"; use PluginHost capabilities instead`);
    }
    for (const [re, msg] of DISALLOWED_PATTERNS) {
      if (re.test(text)) errors.push(`${rel}: ${msg}`);
    }
  };

  const walk = (cur: string) => {
    for (const name of readdirSync(cur)) {
      if (name === ".git" || name === "node_modules") {
        warnings.push(`${relative(root, join(cur, name))}: ignored dependency/VCS directory`);
        continue;
      }
      const p = join(cur, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        errors.push(`${relative(root, p)}: symlinks are not allowed in plugin packages`);
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) {
        files++;
        bytes += st.size;
        if (files > MAX_PLUGIN_FILES) errors.push(`plugin has too many files (>${MAX_PLUGIN_FILES})`);
        if (bytes > MAX_PLUGIN_BYTES) errors.push(`plugin package is too large (>${MAX_PLUGIN_BYTES} bytes)`);
        const real = realpathSync(p);
        if (!inside(root, real)) errors.push(`${relative(root, p)}: file resolves outside plugin root`);
        scanFile(real);
      }
    }
  };

  walk(root);
  return { warnings, errors: [...new Set(errors)] };
}

export function validatePlugin(dir: string): ValidateResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    return { ok: false, warnings, errors: [`not a directory: ${dir}`] };
  }

  const parsed = readManifest(dir);
  if (!parsed.ok || !parsed.manifest) return { ok: false, warnings, errors: parsed.errors };
  const manifest = parsed.manifest;

  const perms = validatePermissions(manifest.permissions);
  if (!perms.ok) errors.push(...perms.errors);

  const compat = checkCompatibility(CORE_VERSION, manifest.apiVersion, PLUGIN_API_VERSION, manifest.compatibility);
  if (!compat.ok && compat.reason) errors.push(compat.reason);

  const entry = containedPath(dir, manifest.entrypoint);
  if (!entry) errors.push(`entrypoint escapes plugin root: ${manifest.entrypoint}`);
  else if (!existsSync(entry)) errors.push(`entrypoint not found: ${manifest.entrypoint}`);

  for (const skillPath of manifest.skillPaths) {
    const p = containedPath(dir, skillPath);
    if (!p) errors.push(`skill path escapes plugin root: ${skillPath}`);
    else if (!existsSync(p) || !statSync(p).isDirectory()) errors.push(`skill path not found: ${skillPath}`);
  }
  for (const s of manifest.mcpServers) {
    if (s.transport === "http" && !s.url) errors.push(`mcp server ${s.id}: http transport requires url`);
    if (s.transport === "stdio" && !s.command) errors.push(`mcp server ${s.id}: stdio transport requires command`);
  }

  try {
    const scan = scanTree(dir);
    warnings.push(...scan.warnings);
    errors.push(...scan.errors);
  } catch (e) {
    errors.push(`security scan failed: ${(e as Error).message}`);
  }

  return {
    ok: errors.length === 0,
    manifest,
    entryHash: hashEntrypoint(dir, manifest),
    treeHash: hashPluginTree(dir),
    warnings,
    errors,
  };
}

export interface LoadOk {
  ok: true;
  manifest: PluginManifest;
  contributions: PluginContributions;
  granted: PermissionScope[];
}
export interface LoadErr {
  ok: false;
  manifest?: PluginManifest;
  reason: string;
  kind: "incompatible" | "untrusted" | "error";
}
export type LoadResult = LoadOk | LoadErr;

export interface LoadDeps {
  store: Store;
  config: XRConfig;
  cwd: string;
  granted: PermissionScope[];
  expectedHash?: string;
  expectedTreeHash?: string;
}

export async function loadPlugin(dir: string, deps: LoadDeps): Promise<LoadResult> {
  const v = validatePlugin(dir);
  if (!v.ok || !v.manifest) return { ok: false, reason: v.errors.join("; ") || "invalid plugin", kind: "error" };
  const manifest = v.manifest;

  const compat = checkCompatibility(CORE_VERSION, manifest.apiVersion, PLUGIN_API_VERSION, manifest.compatibility);
  if (!compat.ok) return { ok: false, manifest, reason: compat.reason ?? "incompatible", kind: "incompatible" };

  if (deps.expectedHash && v.entryHash !== deps.expectedHash) {
    return { ok: false, manifest, reason: "entrypoint hash does not match install record", kind: "untrusted" };
  }
  if (deps.expectedTreeHash && v.treeHash !== deps.expectedTreeHash) {
    return { ok: false, manifest, reason: "plugin file tree hash does not match install record", kind: "untrusted" };
  }

  let mod: PluginModule;
  try {
    const entry = resolve(dir, manifest.entrypoint);
    mod = (await import(`${entry}?v=${Date.now()}`)) as PluginModule;
  } catch (e) {
    return { ok: false, manifest, reason: `import failed: ${(e as Error).message}`, kind: "error" };
  }

  const activate = resolveActivate(mod);
  if (!activate) {
    return { ok: false, manifest, reason: "plugin has no activate() export", kind: "error" };
  }

  const granted = effectiveGrant(manifest.permissions, deps.granted);
  const host = buildHost(granted, {
    store: deps.store,
    config: deps.config,
    cwd: deps.cwd,
    pluginDir: dir,
    pluginId: manifest.id,
    mcpServers: manifest.mcpServers,
  });

  try {
    const contributions = sanitizeContributions((await activate(host)) ?? {});
    return { ok: true, manifest, contributions, granted };
  } catch (e) {
    return { ok: false, manifest, reason: `activate() threw: ${(e as Error).message}`, kind: "error" };
  }
}

function resolveActivate(mod: PluginModule) {
  if (typeof mod.activate === "function") return mod.activate;
  if (typeof mod.default === "function") return mod.default;
  if (mod.default && typeof (mod.default as any).activate === "function") return (mod.default as any).activate;
  return undefined;
}

const CONTRIB_NAME = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
function sanitizeContributions(c: PluginContributions): PluginContributions {
  const commands = (c.commands ?? []).filter((cmd) => cmd && CONTRIB_NAME.test(cmd.name) && typeof cmd.run === "function");
  const tools = (c.tools ?? []).filter((tool) => tool && CONTRIB_NAME.test(tool.name) && typeof tool.description === "string" && typeof tool.run === "function");
  const prompts = (c.prompts ?? []).filter((p) => p && CONTRIB_NAME.test(p.id) && typeof p.template === "string");
  return { commands, tools, prompts, dispose: typeof c.dispose === "function" ? c.dispose : undefined };
}

export function describePlugin(dir: string, enabled: boolean, granted: PermissionScope[], installedAt: number, updatedAt: number): PluginRecord | null {
  const v = validatePlugin(dir);
  if (!v.manifest) return null;
  return {
    id: v.manifest.id,
    dir,
    manifest: v.manifest,
    enabled,
    grantedPermissions: granted,
    installedAt,
    updatedAt,
    status: { kind: !v.ok ? "error" : enabled ? "enabled" : "disabled", loaded: false, detail: [...v.errors, ...v.warnings].join("; ") || undefined },
    reason: v.errors.join("; ") || undefined,
  };
}
