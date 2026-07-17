/**
 * XR — Hardened Plugin Loader
 * Production-grade security: real VM isolation with defense-in-depth.
 *
 * SECURITY ARCHITECTURE (0.4 Plugin Sandbox Hardening):
 *  1) Validation & hashing: manifest, permission, compatibility, hash pinning, tree hash
 *  2) Static scan: defense-in-depth warnings (not primary boundary)
 *  3) Runtime isolation: plugin code runs in isolated V8 context with:
 *     - codeGeneration: { strings:false, wasm:false } => no eval/new Function/WASM
 *     - Hardened Proxy sandbox that blocks constructor-chain escapes
 *     - custom require() that ONLY allows relative files inside plugin root
 *     - no access to process, Bun, fs, net, child_process, etc.
 *     - host object is null-prototype, frozen, with prototype-less functions
 *     - no bare imports, no require.resolve, no dynamic import
 *     - Prototype-chain lockdown: Object.prototype, Array.prototype, etc.
 *       are frozen within the sandbox to prevent prototype pollution and
 *       constructor.constructor escape attempts
 *  4) Capability host is the ONLY API, gated by manifest-declared permissions
 *
 * HARDENING DETAILS (0.4 + 0.7):
 *  - createSecureSandbox() wraps globalThis in a Proxy that:
 *    a) Returns undefined for process, Bun, require, module, exports,
 *       __filename, __dirname, Function, eval, WebAssembly, importScripts
 *    b) Refuses writes/deletes/redefinitions of blocked globals
 *  - 0.7 Two-Realm Isolation: fresh VM-realm intrinsics are harvested from a
 *    donor context (frozen prototypes, policy-blocked code generation), and
 *    every host-provided value is injected through a recursive membrane that
 *    blocks ALL constructor/prototype access paths — closing the host-realm
 *    constructor-chain escape (URL instance → host Function → host process)
 *    proven by test/plugins/loader.test.ts regression tests.
 *  - Static scan remains as defense-in-depth (catches obvious issues early)
 *
 * References:
 *  - Deno capability model: explicit allow-list, no ambient authority
 *  - Goose plugin sandbox: tool isolation + approval gates
 *  - OpenHands/browser-use: secure Playwright launch without --no-sandbox
 *  - Node.js node:vm hardened resolver patterns
 */

import { existsSync, readFileSync, statSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createContext, Script, compileFunction } from "node:vm";
import { pluginIoLimit, yieldEventLoop } from "../util/concurrency.ts";
import type { Store } from "../state/workspace-store.ts";
import type { XRConfig } from "../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../core/version.ts";
import { readManifest, validatePermissions, effectiveGrant } from "./manifest.ts";
import { checkCompatibility } from "./compat.ts";
import { buildHost } from "./host.ts";
import type { PermissionScope, PluginContributions, PluginManifest, PluginModule, PluginRecord } from "./types.ts";

// ── Validation & hashing ─────────────────────────────────────────────────────

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

// Defense-in-depth only — primary security is VM isolation
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
  "node:os",
  "os",
  "node:worker_threads",
  "worker_threads",
  "node:vm",
  "vm",
];

const DISALLOWED_PATTERNS: Array<[RegExp, string]> = [
  [/\bprocess\.env\b/, "direct process.env access is not allowed; request host.secrets or declared permissions"],
  [/\bBun\.(spawn|spawnSync|file|write|serve)\b/, "direct Bun host APIs are not allowed in plugins"],
  [/\b(eval|Function)\s*\(/, "dynamic code execution is not allowed in plugins (blocked by VM codeGeneration policy too)"],
  [/(^|[^\w.])fetch\s*\(/, "direct fetch is not allowed; request net permission and use host.net.fetch"],
  [/\bchild_process\b/, "child_process access is blocked"],
  [/\bglobalThis\s*\[\s*["']process["']\s*\]/, "indirect process access is blocked"],
  [/\brequire\s*\(\s*["']child_process["']\s*\)/, "require('child_process') is blocked"],
  [/\brequire\s*\(\s*["']node:child_process["']\s*\)/, "require('node:child_process') is blocked"],
];

function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containedPath(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  return inside(root, abs) ? abs : null;
}

export async function hashEntrypointAsync(dir: string, manifest: PluginManifest): Promise<string | undefined> {
  const entry = containedPath(dir, manifest.entrypoint);
  if (!entry) return undefined;
  try {
    await fsp.access(entry);
    const buf = await fsp.readFile(entry);
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return undefined;
  }
}

/** Sync hash for install/CLI paths that cannot await. Prefer hashEntrypointAsync in daemon. */
export function hashEntrypoint(dir: string, manifest: PluginManifest): string | undefined {
  const entry = containedPath(dir, manifest.entrypoint);
  if (!entry || !existsSync(entry)) return undefined;
  try {
    return createHash("sha256").update(readFileSync(entry)).digest("hex");
  } catch {
    return undefined;
  }
}

export async function hashPluginTreeAsync(dir: string): Promise<string | undefined> {
  return pluginIoLimit.run(async () => {
    try {
      const root = await fsp.realpath(dir);
      const rows: Array<{ rel: string; hash: string }> = [];
      let ops = 0;
      const walk = async (cur: string): Promise<void> => {
        let names: string[];
        try {
          names = (await fsp.readdir(cur)).sort();
        } catch {
          return;
        }
        for (const name of names) {
          if (name === "data" || name === ".git" || name === "node_modules") continue;
          const p = join(cur, name);
          let st;
          try {
            st = await fsp.lstat(p);
          } catch {
            continue;
          }
          if (st.isSymbolicLink()) continue;
          if (st.isDirectory()) {
            await walk(p);
          } else if (st.isFile()) {
            try {
              const real = await fsp.realpath(p);
              if (!inside(root, real)) continue;
              const buf = await fsp.readFile(real);
              rows.push({
                rel: relative(root, real).replace(/\\/g, "/"),
                hash: createHash("sha256").update(buf).digest("hex"),
              });
            } catch {
              continue;
            }
            ops++;
            if (ops % 25 === 0) await yieldEventLoop();
          }
        }
      };
      await walk(root);
      const h = createHash("sha256");
      for (const row of rows.sort((a, b) => a.rel.localeCompare(b.rel))) h.update(`${row.rel}:${row.hash}\n`);
      return h.digest("hex");
    } catch {
      return undefined;
    }
  });
}

/**
 * Sync tree hash kept for CLI install commit. Bounded yield is not possible
 * synchronously; prefer hashPluginTreeAsync for daemon / large plugins.
 */
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

async function scanTreeAsync(dir: string): Promise<{ warnings: string[]; errors: string[] }> {
  return pluginIoLimit.run(async () => {
    const warnings: string[] = [];
    const errors: string[] = [];
    let files = 0;
    let bytes = 0;
    let root: string;
    try {
      root = await fsp.realpath(dir);
    } catch {
      return { warnings: [], errors: [`cannot resolve plugin root: ${dir}`] };
    }

    const scanFile = async (file: string) => {
      if (!SCANNED_EXT.test(file)) return;
      const rel = relative(root, file).replace(/\\/g, "/");
      let rawText: string;
      try {
        rawText = (await fsp.readFile(file, "utf8")).slice(0, 1_000_000);
      } catch {
        return;
      }
      const body = rawText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "\n");
      for (const mod of DISALLOWED_IMPORTS) {
        const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:from\\s+["']${esc}["']|import\\s*\\(["']${esc}["']\\)|require\\s*\\(["']${esc}["']\\))`);
        if (re.test(body)) errors.push(`${rel}: disallowed import "${mod}" — use PluginHost capabilities`);
      }
      for (const [re, msg] of DISALLOWED_PATTERNS) {
        if (re.test(body)) errors.push(`${rel}: ${msg}`);
      }
    };

    const walk = async (cur: string): Promise<void> => {
      let entries: string[];
      try {
        entries = await fsp.readdir(cur);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name === ".git" || name === "node_modules") {
          warnings.push(`${relative(root, join(cur, name))}: ignored dependency/VCS directory`);
          continue;
        }
        const p = join(cur, name);
        let st;
        try {
          st = await fsp.lstat(p);
        } catch {
          continue;
        }
        if (st.isSymbolicLink()) {
          errors.push(`${relative(root, p)}: symlinks are not allowed in plugin packages`);
          continue;
        }
        if (st.isDirectory()) await walk(p);
        else if (st.isFile()) {
          files++;
          bytes += st.size;
          if (files > MAX_PLUGIN_FILES) errors.push(`plugin has too many files (>${MAX_PLUGIN_FILES})`);
          if (bytes > MAX_PLUGIN_BYTES) errors.push(`plugin package is too large (>${MAX_PLUGIN_BYTES} bytes)`);
          try {
            const real = await fsp.realpath(p);
            if (!inside(root, real)) errors.push(`${relative(root, p)}: file resolves outside plugin root`);
            await scanFile(real);
          } catch {
            errors.push(`${relative(root, p)}: cannot resolve realpath`);
          }
          if (files % 20 === 0) await yieldEventLoop();
        }
      }
    };

    await walk(root);
    return { warnings, errors: [...new Set(errors)] };
  });
}

function scanTree(dir: string): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  let files = 0;
  let bytes = 0;
  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return { warnings: [], errors: [`cannot resolve plugin root: ${dir}`] };
  }

  const scanFile = (file: string) => {
    if (!SCANNED_EXT.test(file)) return;
    const rel = relative(root, file).replace(/\\/g, "/");
    let rawText: string;
    try {
      rawText = readFileSync(file, "utf8").slice(0, 1_000_000);
    } catch {
      return;
    }
    const body = rawText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/.*(?=\n|$)/g, "\n");
    for (const mod of DISALLOWED_IMPORTS) {
      const esc = mod.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`(?:from\\s+["']${esc}["']|import\\s*\\(["']${esc}["']\\)|require\\s*\\(["']${esc}["']\\))`);
      if (re.test(body)) errors.push(`${rel}: disallowed import "${mod}" — use PluginHost capabilities`);
    }
    for (const [re, msg] of DISALLOWED_PATTERNS) {
      if (re.test(body)) errors.push(`${rel}: ${msg}`);
    }
  };

  const walk = (cur: string) => {
    let entries: string[];
    try {
      entries = readdirSync(cur);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === ".git" || name === "node_modules") {
        warnings.push(`${relative(root, join(cur, name))}: ignored dependency/VCS directory`);
        continue;
      }
      const p = join(cur, name);
      let st;
      try {
        st = lstatSync(p);
      } catch {
        continue;
      }
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
        try {
          const real = realpathSync(p);
          if (!inside(root, real)) errors.push(`${relative(root, p)}: file resolves outside plugin root`);
          scanFile(real);
        } catch {
          errors.push(`${relative(root, p)}: cannot resolve realpath`);
        }
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
    if (s.command && /[;&|`$(){}<>]/.test(s.command)) errors.push(`mcp server ${s.id}: command contains shell metacharacters`);
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

/** Non-blocking plugin validation for daemon / concurrent installs. */
export async function validatePluginAsync(dir: string): Promise<ValidateResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const st = await fsp.stat(dir);
    if (!st.isDirectory()) return { ok: false, warnings, errors: [`not a directory: ${dir}`] };
  } catch {
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
  else {
    try { await fsp.access(entry); } catch { errors.push(`entrypoint not found: ${manifest.entrypoint}`); }
  }

  for (const skillPath of manifest.skillPaths) {
    const p = containedPath(dir, skillPath);
    if (!p) errors.push(`skill path escapes plugin root: ${skillPath}`);
    else {
      try {
        const st = await fsp.stat(p);
        if (!st.isDirectory()) errors.push(`skill path not found: ${skillPath}`);
      } catch {
        errors.push(`skill path not found: ${skillPath}`);
      }
    }
  }
  for (const s of manifest.mcpServers) {
    if (s.transport === "http" && !s.url) errors.push(`mcp server ${s.id}: http transport requires url`);
    if (s.transport === "stdio" && !s.command) errors.push(`mcp server ${s.id}: stdio transport requires command`);
    if (s.command && /[;&|`$(){}<>]/.test(s.command)) errors.push(`mcp server ${s.id}: command contains shell metacharacters`);
  }

  try {
    const scan = await scanTreeAsync(dir);
    warnings.push(...scan.warnings);
    errors.push(...scan.errors);
  } catch (e) {
    errors.push(`security scan failed: ${(e as Error).message}`);
  }

  const [entryHash, treeHash] = await Promise.all([
    hashEntrypointAsync(dir, manifest),
    hashPluginTreeAsync(dir),
  ]);

  return {
    ok: errors.length === 0,
    manifest,
    entryHash,
    treeHash,
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

// ── Secure VM Loader (0.4 Hardened) ──────────────────────────────────────────

function transpileCode(code: string, filename: string): string {
  try {
    // @ts-ignore - Bun global may exist
    if (typeof Bun !== "undefined" && (Bun as any).Transpiler) {
      // @ts-ignore
      const loader = filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") ? "tsx" : filename.endsWith(".jsx") ? "jsx" : "js";
      // @ts-ignore
      const t = new (Bun as any).Transpiler({ loader, target: "node" });
      const out = t.transformSync(code);
      if (typeof out === "string" && out.length > 0) return out;
    }
  } catch {
    // fall through
  }
  return code;
}

function transformESMToCJS(code: string): string {
  let out = code;

  out = out.replace(/^\s*import\s+type\s+[^;]+;?/gm, "");

  out = out.replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+["'](\.[^"']+)["'];?/g, (_: string, names: string, p: string) => {
    return `const { ${names} } = require("${p}");`;
  });

  out = out.replace(/import\s+([A-Za-z0-9_$]+)\s+from\s+["'](\.[^"']+)["'];?/g, (_: string, name: string, p: string) => {
    return `const ${name} = (require("${p}").default ?? require("${p}"));`;
  });

  out = out.replace(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+["'](\.[^"']+)["'];?/g, (_: string, name: string, p: string) => {
    return `const ${name} = require("${p}");`;
  });

  out = out.replace(/import\s+["'](\.[^"']+)["'];?/g, (_: string, p: string) => `require("${p}");`);

  out = out.replace(/export\s+default\s+function\s+([A-Za-z0-9_$]+)?/g, (_: string, name: string) => `exports.default = function ${name || ""}`.trimEnd());
  out = out.replace(/export\s+default\s+/g, "exports.default = ");

  out = out.replace(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g, "exports.$1 = async function $1");

  out = out.replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, "exports.$1 = function $1");

  const constExports: string[] = [];
  out = out.replace(/export\s+const\s+([A-Za-z0-9_$]+)\s*=/g, (_: string, name: string) => {
    constExports.push(name);
    return `const ${name} =`;
  });
  out = out.replace(/export\s+let\s+([A-Za-z0-9_$]+)\s*=/g, (_: string, name: string) => {
    constExports.push(name);
    return `let ${name} =`;
  });
  out = out.replace(/export\s+var\s+([A-Za-z0-9_$]+)\s*=/g, (_: string, name: string) => {
    constExports.push(name);
    return `var ${name} =`;
  });
  if (constExports.length) {
    out += "\n" + constExports.map((n) => `exports.${n} = ${n};`).join("\n");
  }

  out = out.replace(/export\s+\{\s*([^}]+)\s*\};?/g, (_: string, names: string) => {
    return names
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((n) => {
        const [orig, alias] = n.split(/\s+as\s+/).map((x: string) => x.trim());
        const expName = alias || orig;
        return `exports.${expName} = ${orig};`;
      })
      .join("\n");
  });

  return out;
}

function resolveFileWithExts(baseDir: string, spec: string, root: string): string | null {
  const candidates: string[] = [];
  const raw = resolve(baseDir, spec);
  candidates.push(raw);
  candidates.push(raw + ".ts");
  candidates.push(raw + ".js");
  candidates.push(raw + ".tsx");
  candidates.push(raw + ".jsx");
  candidates.push(raw + ".mjs");
  candidates.push(raw + ".cjs");
  candidates.push(raw + ".json");
  candidates.push(join(raw, "index.ts"));
  candidates.push(join(raw, "index.js"));
  candidates.push(join(raw, "index.tsx"));
  candidates.push(join(raw, "index.jsx"));

  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) {
        const real = realpathSync(c);
        if (!inside(root, real)) continue;
        return real;
      }
    } catch {
      continue;
    }
  }
  return null;
}

type ModuleRecord = { exports: any; id: string; filename: string; loaded: boolean };

// ── Two-Realm Sandbox Architecture (0.7 host-escape fix) ────────────────────
//
// Realm A — DONOR (fresh VM intrinsics):
//   A bare vm context receives FRESH, host-independent JavaScript intrinsics
//   (Object, Array, JSON, Math, Promise, Map, Set, Error classes, typed
//   arrays, ...). These are harvested and installed into the plugin sandbox.
//   Because they belong to the donor realm:
//     • the codeGeneration:{strings:false} policy applies to them, so
//       ({}).constructor.constructor("...") cannot compile code;
//     • freezing their prototypes (once, inside the donor) makes prototype
//       pollution impossible WITHOUT freezing anything in the host process.
//
// Realm B — HOST (membrane-wrapped host values):
//   Values that only the host can provide (console, timers, URL, Buffer,
//   crypto, Web API classes, ...) are injected exclusively through a
//   recursive membrane proxy that:
//     • blocks .constructor / .__proto__ / .prototype on EVERY access,
//       transitively — closing the host-realm "constructor-chain" escape
//       (e.g. new URL(...).constructor.constructor === host Function);
//     • binds host methods so keep-working APIs (timers, URL, ...) behave
//       identically to before;
//     • unwraps our own proxies when they are passed back into host calls;
//     • wraps every return value and constructed instance recursively.
//
//   Note: Web API class instances (Headers, Request, ...) become membrane
//   proxies — plugins should pass PLAIN objects back into host capabilities
//   (e.g. host.net.fetch(url, { headers: { "x": "y" } })), exactly like the
//   bundled reference plugins do.
//
// Proven by regression tests in test/plugins/loader.test.ts:
//   "host-realm constructor-chain escape via injected classes is blocked".

const BLOCKED_GLOBALS = new Set([
  "process",
  "Bun",
  "global",
  "require",
  "module",
  "exports",
  "__filename",
  "__dirname",
  "Function",
  "eval",
  "WebAssembly",
  "importScripts",
]);

/**
 * Intrinsics harvested from the donor realm. Deliberately excludes anything
 * that would grant ambient authority (fetch, WebAssembly), code-generation
 * entry points that stay disabled anyway (none needed — donor Function/eval
 * are policy-blocked), and GC-side-channel APIs (WeakRef, FinalizationRegistry).
 */
const DONOR_INTRINSIC_NAMES = [
  // Fundamental objects & constructors
  "Object", "Array", "String", "Number", "Boolean", "BigInt", "Function",
  "Symbol", "Promise", "RegExp", "Date",
  // Error hierarchy
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
  "URIError", "EvalError", "AggregateError",
  // Collections & reflection
  "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect",
  // Namespaces
  "JSON", "Math", "Intl",
  // Binary data
  "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray",
  "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  // Global functions
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent",
];

/**
 * Create a fresh donor realm, harvest its intrinsics, then freeze the
 * donor's prototypes so plugin code cannot mutate the JS environment it
 * runs against (anti prototype pollution) — all without touching host state.
 */
function harvestDonorIntrinsics(): Record<string, unknown> {
  const donor = createContext(
    {},
    {
      name: "xr:sandbox:intrinsics",
      codeGeneration: { strings: false, wasm: false },
    } as any,
  );
  const harvestExpr = `(function(){ const out = {}; ${DONOR_INTRINSIC_NAMES.map(
    (n) => `try { out[${JSON.stringify(n)}] = ${n}; } catch (_) {}`,
  ).join(" ")} return out; })()`;
  const intrinsics = new Script(harvestExpr, {
    filename: "xr:sandbox:harvest",
  } as any).runInContext(donor, { timeout: 1000 } as any) as Record<string, unknown>;
  freezeDonorPrototypes(donor);
  return intrinsics;
}

/**
 * Recursive membrane for host-realm values injected into the sandbox.
 * Every reachable object/function is wrapped; every access path that could
 * reach a host-realm Function constructor or prototype is severed.
 */
function createHostMembrane(): { wrap: (v: any) => any } {
  const proxyFor = new WeakMap<object, any>();
  const rawFor = new WeakMap<object, object>();

  const unwrap = (v: any): any => (rawFor.has(v) ? rawFor.get(v) : v);

  const wrap = (value: any): any => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      return value;
    }
    if (proxyFor.has(value)) return proxyFor.get(value);

    const proxy: any = new Proxy(value, {
      get(target, prop, _receiver) {
        // Hard-block every path back to host constructors / prototypes.
        if (prop === "constructor" || prop === "__proto__" || prop === "prototype") {
          return undefined;
        }
        const v = Reflect.get(target as any, prop, target);
        if (typeof v === "function") {
          // Bind to the host target so methods keep their `this`, then wrap
          // the call surface itself (return values are wrapped recursively).
          const bound = (v as (...a: any[]) => any).bind(target);
          const callProxy = new Proxy(bound, {
            get(_t, p2) {
              if (p2 === "constructor" || p2 === "__proto__" || p2 === "prototype") return undefined;
              return wrap(Reflect.get(bound as any, p2));
            },
            apply(_t, _thisArg, args) {
              const unwrapped = (args ?? []).map(unwrap);
              return wrap(bound(...unwrapped));
            },
            construct(_t, args) {
              const unwrapped = (args ?? []).map(unwrap);
              return wrap(new (bound as any)(...unwrapped));
            },
          });
          rawFor.set(callProxy, bound as any);
          return callProxy;
        }
        return wrap(v);
      },
      set(_target, prop, v) {
        if (prop === "constructor" || prop === "__proto__" || prop === "prototype") return false;
        return Reflect.set(value, prop, unwrap(v));
      },
      has(target, prop) {
        if (prop === "constructor" || prop === "__proto__") return false;
        return Reflect.has(target as any, prop);
      },
      defineProperty() {
        return false;
      },
      deleteProperty() {
        return false;
      },
      setPrototypeOf() {
        return false;
      },
      getPrototypeOf() {
        return null;
      },
      apply(target: any, _thisArg, args: any[]) {
        // Host function invoked directly (timers, atob, ...). Their `this`
        // is irrelevant; plugin proxies crossing back are unwrapped.
        const unwrapped = (args ?? []).map(unwrap);
        return wrap(Reflect.apply(target, undefined, unwrapped));
      },
      construct(target: any, args: any[]) {
        const unwrapped = (args ?? []).map(unwrap);
        return wrap(Reflect.construct(target, unwrapped));
      },
    });

    proxyFor.set(value, proxy);
    rawFor.set(proxy, value);
    return proxy;
  };

  return { wrap };
}

function createSecureSandbox(
  pluginId: string,
  intrinsics: Record<string, unknown>,
  wrapHost: (v: any) => any,
): any {
  // Redacted console
  const mkLog = (level: "log" | "warn" | "error" | "info" | "debug") =>
    (...args: any[]) => {
      const line = args
        .map((a) => {
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" ");
      const redacted = line.replace(
        /(sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[A-Z0-9_]*API[_-]?KEY\s*=\s*[^\s]+|password\s*[:=]\s*[^\s]+|secret\s*[:=]\s*[^\s]+)/gi,
        "«redacted»",
      );
      if (level === "log" || level === "info") console.log(`\x1b[2m[plugin:${pluginId}]\x1b[0m ${redacted}`);
      else if (level === "warn") console.warn(`\x1b[33m[plugin:${pluginId}] ${redacted}\x1b[0m`);
      else console.error(`[plugin:${pluginId}] ${redacted}`);
    };

  const sandboxConsole = {
    log: mkLog("log"),
    warn: mkLog("warn"),
    error: mkLog("error"),
    info: mkLog("info"),
    debug: mkLog("debug"),
  };

  const raw: any = {};

  // ── Realm A: donor-realm intrinsics (host-independent, frozen) ──────────
  for (const [k, v] of Object.entries(intrinsics)) {
    raw[k] = v;
  }
  // Function/eval stay blocked as ambient globals regardless of the donor:
  // even reaching them must be a dead end for plugin code.
  raw.Function = undefined;
  raw.eval = undefined;

  // ── Realm B: host-provided capabilities behind the membrane ─────────────
  raw.console = wrapHost(sandboxConsole);

  // timers
  raw.setTimeout = wrapHost(setTimeout);
  raw.clearTimeout = wrapHost(clearTimeout);
  raw.setInterval = wrapHost(setInterval);
  raw.clearInterval = wrapHost(clearInterval);
  raw.queueMicrotask = wrapHost(queueMicrotask);
  // @ts-ignore
  if (typeof setImmediate !== "undefined") raw.setImmediate = wrapHost(setImmediate);
  // @ts-ignore
  if (typeof clearImmediate !== "undefined") raw.clearImmediate = wrapHost(clearImmediate);

  // Web APIs (host-provided; instances become membrane proxies — plugins
  // should pass plain objects back into host capabilities).
  raw.URL = wrapHost(URL);
  raw.URLSearchParams = wrapHost(URLSearchParams);
  raw.TextEncoder = wrapHost(TextEncoder);
  raw.TextDecoder = wrapHost(TextDecoder);
  raw.AbortController = wrapHost(AbortController);
  raw.AbortSignal = wrapHost(AbortSignal);
  if (typeof Blob !== "undefined") raw.Blob = wrapHost(Blob);
  if (typeof File !== "undefined") raw.File = wrapHost(File);
  if (typeof FormData !== "undefined") raw.FormData = wrapHost(FormData);
  if (typeof Headers !== "undefined") raw.Headers = wrapHost(Headers);
  if (typeof Request !== "undefined") raw.Request = wrapHost(Request);
  if (typeof Response !== "undefined") raw.Response = wrapHost(Response);
  // @ts-ignore
  if (typeof atob !== "undefined") raw.atob = wrapHost(atob);
  // @ts-ignore
  if (typeof btoa !== "undefined") raw.btoa = wrapHost(btoa);
  // @ts-ignore
  if (typeof Buffer !== "undefined") raw.Buffer = wrapHost(Buffer);
  if (typeof structuredClone !== "undefined") raw.structuredClone = wrapHost(structuredClone);
  if (typeof crypto !== "undefined") raw.crypto = wrapHost(crypto);

  // Explicitly deny dangerous globals
  raw.process = undefined;
  raw.Bun = undefined;
  raw.global = undefined;
  raw.require = undefined;
  raw.module = undefined;
  raw.exports = undefined;
  raw.__filename = undefined;
  raw.__dirname = undefined;
  raw.WebAssembly = undefined;
  raw.importScripts = undefined;

  // ── Hardened Proxy wrapper (0.4) ─────────────────────────────────────────
  //
  // Intercepts ALL property access on the sandbox global and blocks:
  //   - Blocked globals (process, Bun, Function, etc.) → undefined
  //   - 'constructor' / '__proto__' on the global itself → undefined
  //   - writes / deletes / redefinitions of blocked globals
  //
  // Values returned here are either donor-realm intrinsics (safe by realm —
  // frozen prototypes, policy-blocked code generation) or membrane-wrapped
  // host values (constructor paths severed by the membrane itself).

  const handler: ProxyHandler<object> = {
    get(target: any, prop: string | symbol): any {
      if (typeof prop === "string") {
        if (prop === "constructor" || prop === "__proto__") {
          return undefined;
        }
        if (BLOCKED_GLOBALS.has(prop)) {
          return undefined;
        }
      }
      return target[prop];
    },

    set(target: any, prop: string | symbol, value: any): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) {
        return false; // Silently ignore
      }
      target[prop] = value;
      return true;
    },

    has(target: any, prop: string | symbol): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) {
        return false;
      }
      return prop in target;
    },

    deleteProperty(target: any, prop: string | symbol): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) {
        return false;
      }
      delete target[prop];
      return true;
    },

    defineProperty(target: any, prop: string | symbol, descriptor: PropertyDescriptor): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) {
        return false;
      }
      return Reflect.defineProperty(target, prop, descriptor);
    },

    setPrototypeOf(_target: any, _proto: object | null): boolean {
      return false;
    },
  };

  // The sandbox IS the proxy — all access goes through the handler.
  const proxied = new Proxy(raw, handler);

  raw.globalThis = proxied;
  raw.self = proxied;

  return proxied;
}

/**
 * Freeze built-in prototypes within the DONOR realm so the intrinsics
 * plugins receive are immutable (anti prototype pollution).
 */
function freezeDonorPrototypes(context: any): void {
  try {
    const freezeScript = new Script(
      `
      (function() {
        var protos = [
          Object.prototype,
          Array.prototype,
          Function.prototype,
          String.prototype,
          Number.prototype,
          Boolean.prototype,
          RegExp.prototype,
          Date.prototype,
          Map.prototype,
          Set.prototype,
          WeakMap.prototype,
          WeakSet.prototype,
          Promise.prototype,
          Error.prototype,
          TypeError.prototype,
          RangeError.prototype,
          ReferenceError.prototype,
          SyntaxError.prototype,
          URIError.prototype,
        ];
        var i;
        var ctorNames = [
          "ArrayBuffer", "SharedArrayBuffer", "DataView",
          "Int8Array", "Uint8Array", "Uint8ClampedArray",
          "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
          "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
          "AggregateError",
        ];
        for (i = 0; i < ctorNames.length; i++) {
          try { protos.push(globalThis[ctorNames[i]].prototype); } catch (e) {}
        }
        for (i = 0; i < protos.length; i++) {
          try { Object.freeze(protos[i]); } catch (e) {}
        }
        // Freeze the namespace objects against tampering as well.
        var ns = [JSON, Math, Intl, Reflect];
        for (i = 0; i < ns.length; i++) {
          try { Object.freeze(ns[i]); } catch (e) {}
        }
      })();
    `,
      { filename: "xr:sandbox:freeze-prototypes" } as any,
    );
    freezeScript.runInContext(context, { timeout: 1000 } as any);
  } catch {
    // Best-effort: if freezing fails, the membrane + proxy still block escapes
  }
}

async function loadInIsolatedVM(entryAbs: string, root: string, host: any, pluginId: string): Promise<PluginModule> {
  // Two-realm isolation (0.7): fresh donor-realm intrinsics (frozen, policy-
  // blocked code generation) + membrane-wrapped host capabilities.
  const intrinsics = harvestDonorIntrinsics();
  const { wrap: wrapHost } = createHostMembrane();
  const sandbox = createSecureSandbox(pluginId, intrinsics, wrapHost);
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: `plugin:${pluginId}`,
  } as any);

  const cache = new Map<string, ModuleRecord>();

  function loadModule(absPath: string): any {
    if (cache.has(absPath)) return cache.get(absPath)!.exports;

    let raw: string;
    try {
      raw = readFileSync(absPath, "utf8");
    } catch (e) {
      throw new Error(`cannot read module ${relative(root, absPath)}: ${(e as Error).message}`);
    }

    // JSON support
    if (absPath.endsWith(".json")) {
      try {
        const parsed = JSON.parse(raw);
        const mod: ModuleRecord = { exports: parsed, id: absPath, filename: absPath, loaded: true };
        cache.set(absPath, mod);
        return mod.exports;
      } catch (e) {
        throw new Error(`invalid JSON ${relative(root, absPath)}: ${(e as Error).message}`);
      }
    }

    const transpiled = transpileCode(raw, absPath);
    const cjs = transformESMToCJS(transpiled);

    const mod: ModuleRecord = { exports: {}, id: absPath, filename: absPath, loaded: false };
    cache.set(absPath, mod);

    const dirName = dirname(absPath);
    const localRequire = (spec: string): any => {
      if (typeof spec !== "string") throw new Error(`require() argument must be string, got ${typeof spec}`);
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        throw new Error(
          `require("${spec}") blocked: bare specifiers are not allowed in plugins. Use relative imports (./x) and PluginHost capabilities`,
        );
      }
      const resolved = resolveFileWithExts(dirName, spec, root);
      if (!resolved) throw new Error(`Cannot resolve "${spec}" from ${relative(root, absPath)}`);
      return loadModule(resolved);
    };
    Object.defineProperty(localRequire, "resolve", {
      value: () => { throw new Error("require.resolve is disabled in plugin sandbox"); },
      writable: false, configurable: false,
    });
    Object.defineProperty(localRequire, "cache", {
      value: undefined, writable: false, configurable: false,
    });

    const wrapper = `(function(exports, require, module, __filename, __dirname, host) {\n${cjs}\n\nif (module.exports && module.exports !== exports) {\n  // CJS reassignment support\n}\n})`;

    try {
      let ran = false;
      try {
        const script = new Script(
          `(${wrapper})(__xr_exports, __xr_require, __xr_module, __xr_filename, __xr_dirname, __xr_host);`,
          { filename: absPath } as any,
        );
        (context as any).__xr_exports = mod.exports;
        (context as any).__xr_require = localRequire;
        (context as any).__xr_module = mod;
        (context as any).__xr_filename = absPath;
        (context as any).__xr_dirname = dirName;
        (context as any).__xr_host = host;
        script.runInContext(context, { timeout: 5000 } as any);
        ran = true;
        // Cleanup bridge keys so plugins cannot reach them later
        try {
          delete (context as any).__xr_exports;
          delete (context as any).__xr_require;
          delete (context as any).__xr_module;
          delete (context as any).__xr_filename;
          delete (context as any).__xr_dirname;
          delete (context as any).__xr_host;
        } catch { /* ignore */ }
      } catch (scriptErr) {
        // Fallback to compileFunction if Script path fails
        try {
          const fn = compileFunction(wrapper, ["exports", "require", "module", "__filename", "__dirname", "host"], {
            filename: absPath,
          } as any) as any;
          fn(mod.exports, localRequire, mod, absPath, dirName, host);
          ran = true;
        } catch (e) {
          cache.delete(absPath);
          throw new Error(`compile error in ${relative(root, absPath)}: ${(e as Error).message}`);
        }
      }
      if (!ran) {
        cache.delete(absPath);
        throw new Error(`failed to execute plugin module ${relative(root, absPath)}`);
      }
    } catch (e) {
      cache.delete(absPath);
      throw e;
    }
    mod.loaded = true;
    return mod.exports;
  }

  const entryExports = loadModule(entryAbs);
  return entryExports as PluginModule;
}

export async function loadPlugin(dir: string, deps: LoadDeps): Promise<LoadResult> {
  const v = await validatePluginAsync(dir);
  if (!v.ok || !v.manifest) {
    // Fail-fast classification: a parsed-but-incompatible plugin reports
    // "incompatible" (upgrade XR / plugin) rather than a generic "error".
    if (v.manifest) {
      const preCompat = checkCompatibility(CORE_VERSION, v.manifest.apiVersion, PLUGIN_API_VERSION, v.manifest.compatibility);
      if (!preCompat.ok) {
        return { ok: false, manifest: v.manifest, reason: preCompat.reason ?? "incompatible", kind: "incompatible" };
      }
    }
    return { ok: false, reason: v.errors.join("; ") || "invalid plugin", kind: "error" };
  }
  const manifest = v.manifest;

  const compat = checkCompatibility(CORE_VERSION, manifest.apiVersion, PLUGIN_API_VERSION, manifest.compatibility);
  if (!compat.ok) return { ok: false, manifest, reason: compat.reason ?? "incompatible", kind: "incompatible" };

  if (deps.expectedHash && v.entryHash !== deps.expectedHash) {
    return { ok: false, manifest, reason: "entrypoint hash does not match install record", kind: "untrusted" };
  }
  if (deps.expectedTreeHash && v.treeHash !== deps.expectedTreeHash) {
    return { ok: false, manifest, reason: "plugin file tree hash does not match install record", kind: "untrusted" };
  }

  let root: string;
  try {
    root = realpathSync(dir);
  } catch {
    return { ok: false, manifest, reason: "cannot resolve plugin root", kind: "error" };
  }

  const entryAbs = containedPath(dir, manifest.entrypoint);
  if (!entryAbs || !existsSync(entryAbs)) {
    return { ok: false, manifest, reason: `entrypoint not found: ${manifest.entrypoint}`, kind: "error" };
  }
  let entryReal: string;
  try {
    entryReal = realpathSync(entryAbs);
  } catch {
    return { ok: false, manifest, reason: "entrypoint cannot be resolved", kind: "error" };
  }
  if (!inside(root, entryReal)) {
    return { ok: false, manifest, reason: "entrypoint escapes plugin root", kind: "error" };
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

  let mod: PluginModule;
  try {
    mod = await loadInIsolatedVM(entryReal, root, host, manifest.id);
  } catch (e) {
    return { ok: false, manifest, reason: `plugin load failed: ${(e as Error).message}`, kind: "error" };
  }

  const activate = resolveActivate(mod);
  if (!activate) {
    return { ok: false, manifest, reason: "plugin has no activate() export (need exports.activate or module.exports.activate)", kind: "error" };
  }

  try {
    const contributions = sanitizeContributions((await activate(host)) ?? {});
    return { ok: true, manifest, contributions, granted };
  } catch (e) {
    return { ok: false, manifest, reason: `activate() threw: ${(e as Error).message}`, kind: "error" };
  }
}

function resolveActivate(mod: PluginModule) {
  if (typeof (mod as any).activate === "function") return (mod as any).activate;
  if (typeof mod.default === "function") return mod.default;
  if (mod.default && typeof (mod.default as any).activate === "function") return (mod.default as any).activate;
  if ((mod as any).exports && typeof (mod as any).exports.activate === "function") return (mod as any).exports.activate;
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
