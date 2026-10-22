#!/usr/bin/env bun
/**
 * XR-LAUNCH-014 — per-window IPC allow-lists for the desktop shell.
 *
 * Tauri allows every `generate_handler!` command from every window until the
 * app declares an ACL manifest. build.rs now does (app-commands.rs), so each
 * window gets exactly the commands its own frontend code can call:
 *
 *   1. Walk the static + dynamic import graph from each window's HTML entry
 *      (`@/` alias and relative specifiers; packages are not followed).
 *   2. Collect every string literal in those modules that names a registered
 *      command — invokes go through thin wrappers (settingsApi, hud, orb, …)
 *      whose callers always pass the literal name, so this is a superset of
 *      what the window can call and never misses a real call.
 *   3. Subtract the privileged sets below, then write
 *      desktop/src-tauri/capabilities/ipc-<window>.json.
 *
 *   bun scripts/desktop-ipc-acl.ts            print the per-window report
 *   bun scripts/desktop-ipc-acl.ts --write    regenerate the capability files
 *   bun scripts/desktop-ipc-acl.ts --check    exit 1 if the files are stale
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const REPO = resolve(import.meta.dir, "..");
export const DESKTOP = join(REPO, "desktop");
export const TAURI = join(DESKTOP, "src-tauri");
export const CAP_DIR = join(TAURI, "capabilities");

/**
 * Commands only the MAIN window may call. Workspace windows load the same
 * bundle; settingsApi refuses these there with a clear message. Keychain stays
 * available to workspace windows on purpose: refusing it would make the
 * provider dialog fall back to local-insecure key storage.
 */
export const MAIN_ONLY = ["import_all_data", "export_all_data", "reset_app", "set_devtools_enabled", "crash_simulate"] as const;

/**
 * Never granted to the secondary surfaces (HUD palette, Orb, Theater), even if
 * a shared module that mentions them is in their import graph: data
 * import/export/reset, secrets, opening arbitrary paths, security policy,
 * updates, destructive workspace/budget operations. (`append_audit` is NOT
 * here: a chat run from the HUD must still write its audit entries, and the
 * table is append-only by trigger.)
 */
export const PRIVILEGED = [
  ...MAIN_ONLY,
  "keychain_get",
  "keychain_set",
  "keychain_delete",
  "reveal_path",
  "reveal_data_folder",
  "reveal_in_finder",
  "clear_cache",
  "restart_app",
  "set_setting",
  "save_rules",
  "set_security_policy",
  "set_shield_paused",
  "set_quarantine",
  "save_shield_checks",
  "revoke_all",
  "download_update",
  "install_update",
  "updates_set_channel",
  "budget_clear",
  "budget_reset_month",
  "budget_update_settings",
  "delete_workspace",
  "clone_git_workspace",
  "scaffold_workspace",
  "crash_report",
  "crash_forget",
  "crash_attach_external",
  "crash_detach_external",
  "crash_start_without_engine",
  "ollama_pull",
  "set_autostart",
] as const;

export interface WindowSpec {
  /** Capability file stem: capabilities/ipc-<id>.json */
  id: string;
  /** Tauri window label(s) — glob allowed. */
  windows: string[];
  /** Frontend entry (from the window's HTML). */
  entry: string;
  /** Commands removed from the reachable set. */
  exclude: readonly string[];
  description: string;
}

export const WINDOWS: WindowSpec[] = [
  { id: "main", windows: ["main"], entry: "src/main.tsx", exclude: [], description: "Main window (index.html)" },
  {
    id: "workspace",
    windows: ["workspace-*"],
    entry: "src/main.tsx",
    exclude: MAIN_ONLY,
    description: "Workspace windows (index.html#/workspaces/<id>) — main bundle minus main-only data/devtools commands",
  },
  { id: "hud", windows: ["hud"], entry: "src/hud/main.tsx", exclude: PRIVILEGED, description: "HUD palette (hud.html)" },
  { id: "orb", windows: ["orb"], entry: "src/orb/main.tsx", exclude: PRIVILEGED, description: "Companion orb (orb.html)" },
  { id: "theater", windows: ["theater"], entry: "src/theater/main.tsx", exclude: PRIVILEGED, description: "Theater window (theater.html)" },
];

/** `generate_handler![...]` names, in order (last path segment). */
export function handlerCommands(libRs = readFileSync(join(TAURI, "src/lib.rs"), "utf8")): string[] {
  const start = libRs.indexOf("tauri::generate_handler![");
  if (start < 0) throw new Error("generate_handler! not found in src/lib.rs");
  const end = libRs.indexOf("])", start);
  return libRs
    .slice(start + "tauri::generate_handler![".length, end)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, "").trim().replace(/,$/, ""))
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split("::").pop()!);
}

/** APP_COMMANDS from app-commands.rs (what build.rs hands to tauri-build). */
export function manifestCommands(src = readFileSync(join(TAURI, "app-commands.rs"), "utf8")): string[] {
  const body = src.slice(src.indexOf("&["), src.lastIndexOf("];"));
  return [...body.matchAll(/^\s*"([a-z0-9_]+)",/gm)].map((m) => m[1]!);
}

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

function resolveSpecifier(from: string, spec: string): string | null {
  const clean = spec.replace(/\?.*$/, "");
  let base: string;
  if (clean.startsWith("@/")) base = join(DESKTOP, "src", clean.slice(2));
  else if (clean.startsWith(".")) base = resolve(dirname(from), clean);
  else return null; // a package — not app code
  for (const ext of EXTS) {
    const p = base + ext;
    if (existsSync(p) && /\.(tsx?|jsx?)$/.test(p)) return p;
  }
  return null;
}

const IMPORT_RES = [
  /\bimport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bexport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
];

/** Every app module reachable from `entry` (absolute paths). */
export function moduleGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [join(DESKTOP, entry)];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const re of IMPORT_RES) {
      for (const m of src.matchAll(re)) {
        // `import type` brings no runtime code.
        if (/^\s*(import|export)\s+type\b/.test(m[0])) continue;
        const target = resolveSpecifier(file, m[1]!);
        if (target && !seen.has(target)) stack.push(target);
      }
    }
  }
  return seen;
}

/** Registered command names that appear as string literals in `files`. */
export function referencedCommands(files: Iterable<string>, known: readonly string[]): Set<string> {
  const knownSet = new Set(known);
  const out = new Set<string>();
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/(['"`])([a-z][a-z0-9_]*)\1/g)) {
      if (knownSet.has(m[2]!)) out.add(m[2]!);
    }
  }
  return out;
}

export interface WindowGrant {
  spec: WindowSpec;
  modules: number;
  granted: string[];
  excluded: string[];
}

export function computeGrants(known = manifestCommands()): WindowGrant[] {
  return WINDOWS.map((spec) => {
    const graph = moduleGraph(spec.entry);
    const reach = referencedCommands(graph, known);
    const excluded = [...reach].filter((c) => spec.exclude.includes(c)).sort();
    const granted = [...reach].filter((c) => !spec.exclude.includes(c)).sort();
    return { spec, modules: graph.size, granted, excluded };
  });
}

export const permissionId = (command: string) => `allow-${command.replace(/_/g, "-")}`;

export function capabilityJson(g: WindowGrant): string {
  const doc = {
    $schema: "../gen/schemas/desktop-schema.json",
    identifier: `ipc-${g.spec.id}`,
    description: `GENERATED by scripts/desktop-ipc-acl.ts — do not edit. XR-LAUNCH-014: app commands the ${g.spec.description} can call (${g.modules} modules reachable from ${g.spec.entry}).`,
    windows: g.spec.windows,
    permissions: g.granted.map(permissionId),
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

export const capabilityPath = (id: string) => join(CAP_DIR, `ipc-${id}.json`);

if (import.meta.main) {
  const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--check") ? "check" : "report";
  const known = manifestCommands();
  const handler = handlerCommands();
  const missing = handler.filter((c) => !known.includes(c));
  const extra = known.filter((c) => !handler.includes(c));
  if (missing.length || extra.length) {
    console.error(`app-commands.rs and generate_handler! disagree.\n  missing from app-commands.rs: ${missing.join(", ") || "-"}\n  not in generate_handler!: ${extra.join(", ") || "-"}`);
    process.exit(1);
  }
  let stale = 0;
  for (const g of computeGrants(known)) {
    const path = capabilityPath(g.spec.id);
    const next = capabilityJson(g);
    const cur = existsSync(path) ? readFileSync(path, "utf8") : "";
    const rel = relative(REPO, path);
    if (mode === "write") {
      if (cur !== next) writeFileSync(path, next);
      console.log(`${cur === next ? "unchanged" : "wrote    "} ${rel}  (${g.granted.length} commands)`);
    } else if (mode === "check") {
      if (cur !== next) {
        stale++;
        console.error(`stale: ${rel} — run: bun run desktop:ipc-acl --write`);
      }
    } else {
      console.log(`\n${g.spec.id} [${g.spec.windows.join(", ")}] — ${g.modules} modules, ${g.granted.length}/${known.length} commands`);
      console.log(`  granted:  ${g.granted.join(" ")}`);
      if (g.excluded.length) console.log(`  excluded: ${g.excluded.join(" ")}`);
    }
  }
  if (mode === "check") {
    if (stale) process.exit(1);
    console.log("desktop IPC capability files are up to date.");
  }
}
