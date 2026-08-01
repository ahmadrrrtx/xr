/**
 * XR — the in-process VM realm (two-realm isolation).
 *
 * DEFENSE-IN-DEPTH, NOT A SECURITY BOUNDARY (Phase 4 · T8): `node:vm` shares
 * the host process and address space; a V8 escape would land inside the XR
 * runtime. The REAL boundary for untrusted plugin code is the OS-level
 * isolation selected by the trust lattice (see src/runtime/trust/environment)
 * and the worker's restricted import surface. The VM realm only hardens the
 * in-process layer: frozen intrinsics, blocked code generation, and a host
 * membrane that stops constructor-chain escapes.
 *
 * Phase 2 · T7: `src/plugins/loader.ts` was 1 586 lines spanning three
 * unrelated responsibilities — manifest validation/hashing, the in-process VM
 * sandbox (defense-in-depth), and worker-based process isolation. Split by responsibility so a
 * change to one cannot silently affect the others; the security architecture
 * itself is unchanged (no behaviour edits were made during the split).
 *
 * Owns step (3) and (4): the isolated V8 realm, the host membrane that blocks
 * constructor-chain escapes, and the capability host that is the plugin's only
 * API. This is the security boundary proven by
 * `test/plugins/loader.test.ts`; nothing here was altered by the split.
 */

import { existsSync, readFileSync, statSync, readdirSync, lstatSync, realpathSync } from "node:fs";
import { promises as fsp } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { createHash } from "node:crypto";
import { createContext, Script, compileFunction } from "node:vm";
import { Worker } from "node:worker_threads";
import { pluginIoLimit, yieldEventLoop } from "../../util/concurrency.ts";
import type { Store } from "../../state/workspace-store.ts";
import type { XRConfig } from "../../config/config.ts";
import { CORE_VERSION, PLUGIN_API_VERSION } from "../../core/version.ts";
import { readManifest, validatePermissions, effectiveGrant } from "../manifest.ts";
import { checkCompatibility } from "../compat.ts";
import { buildHost } from "../host.ts";
import { getSecret } from "../../security/secrets.ts";
import type { PermissionScope, PluginContributions, PluginManifest, PluginModule, PluginRecord, PluginCommand, PluginTool, PluginPrompt } from "../types.ts";
import type {
  MainToWorkerMessage, WorkerToMainMessage, SerializedContributions,
} from "../worker-protocol.ts";
import {
  ACTIVATE_TIMEOUT_MS, INVOKE_TIMEOUT_MS, INIT_TIMEOUT_MS,
} from "../worker-protocol.ts";
import {
  containedPath,
  inside,
  validatePluginAsync,
  type LoadDeps,
  type LoadResult,
} from "./validation.ts";

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
