/**
 * XR — Worker Plugin Sandbox Entry Point
 *
 * This file runs inside a Worker thread. It:
 *  1) Creates a hardened VM sandbox (two-realm + membrane)
 *  2) Loads plugin code from disk (using the worker's own fs module)
 *  3) Builds a capability-gated host object
 *  4) Calls activate() and handles tool/command invocations
 *  5) Proxies capabilities that need the main thread (memory, provider, audit)
 *
 * SECURITY PROPERTIES:
 *  - This file imports ONLY: worker_threads, node:fs, node:path, node:crypto, node:vm
 *  - NO imports of child_process, net, http, https
 *  - Plugin code inside the VM sandbox CANNOT access any of these modules
 *  - The VM sandbox blocks: process, Bun, Function, eval, WebAssembly, global
 *  - Two-realm isolation: donor intrinsics have frozen prototypes + blocked code gen
 *  - Host membrane: blocks .constructor/.__proto__/.prototype on all host values
 *
 * COMMUNICATION:
 *  - Receives messages from main thread via parentPort
 *  - Sends messages to main thread via parentPort
 *  - Capability requests (memory, provider, audit) go to main thread
 *  - Other capabilities (fs, secrets, net, log) are handled locally
 */

import { parentPort } from "node:worker_threads";
import { existsSync, readFileSync, statSync, realpathSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { createContext, Script, compileFunction } from "node:vm";
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  WorkerInvokeMessage,
  SerializedContributions,
} from "./worker-protocol.ts";
import type { PermissionScope, PluginManifest, PluginContributions, PluginModule } from "./types.ts";

// ── Globals ─────────────────────────────────────────────────────────────────

const port = parentPort;
if (!port) throw new Error("sandbox-worker must run inside a Worker thread");

let pluginDir = "";
let pluginRoot = "";
let manifest: PluginManifest | null = null;
let granted: PermissionScope[] = [];
let secrets: Record<string, string | undefined> = {};
let egressAllowlist: string[] = [];
let mcpServers: Array<{ id: string; transport: string; url?: string; tools: string[]; description?: string }> = [];
let coreVersion = "";
let apiVersion = 1;

let pluginModule: PluginModule | null = null;
let contributions: PluginContributions | null = null;
let pluginHost: any = null;

// Capability request tracking
let capabilityRequestId = 0;
const pendingCapabilities = new Map<string, (result: { result?: unknown; error?: string }) => void>();

// ── Helpers ─────────────────────────────────────────────────────────────────

function post(msg: WorkerToMainMessage): void {
  port!.postMessage(msg);
}

function inside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function containedPath(root: string, relPath: string): string | null {
  const abs = resolve(root, relPath);
  return inside(root, abs) ? abs : null;
}

function safeJoin(baseDir: string, rel: string): string {
  if (typeof rel !== "string" || rel.length === 0) throw new Error("path must be non-empty string");
  if (rel.length > 1024) throw new Error("path too long");
  const abs = resolve(baseDir, rel);
  const r = relative(baseDir, abs);
  if (r.startsWith("..") || isAbsolute(r)) throw new Error(`path escapes plugin data directory: ${rel}`);
  return abs;
}

function redactLine(line: string): string {
  return String(line)
    .replace(/sk-[A-Za-z0-9]{8,}[A-Za-z0-9_-]*/g, "«redacted-api-key»")
    .replace(/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer «redacted»")
    .replace(/([A-Z0-9_]*API[_-]?KEY\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .replace(/(password\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .replace(/(secret\s*[:=]\s*)[^\s"']+/gi, "$1«redacted»")
    .slice(0, 4000);
}

function requestCapability(capability: "memory" | "provider" | "audit", method: string, args: unknown[]): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    const requestId = `cap-${++capabilityRequestId}-${Date.now()}`;
    const timeout = setTimeout(() => {
      pendingCapabilities.delete(requestId);
      rejectPromise(new Error(`capability request timed out: ${capability}.${method}`));
    }, 30_000);
    pendingCapabilities.set(requestId, (result) => {
      clearTimeout(timeout);
      pendingCapabilities.delete(requestId);
      if (result.error) rejectPromise(new Error(result.error));
      else resolvePromise(result.result);
    });
    post({ type: "capability-request", requestId, capability, method, args });
  });
}

// ── Two-Realm Sandbox (defense-in-depth inside the Worker) ──────────────────

const BLOCKED_GLOBALS = new Set([
  "process", "Bun", "global", "require", "module", "exports",
  "__filename", "__dirname", "Function", "eval", "WebAssembly", "importScripts",
]);

const DONOR_INTRINSIC_NAMES = [
  "Object", "Array", "String", "Number", "Boolean", "BigInt", "Function",
  "Symbol", "Promise", "RegExp", "Date",
  "Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError",
  "URIError", "EvalError", "AggregateError",
  "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect",
  "JSON", "Math", "Intl",
  "ArrayBuffer", "SharedArrayBuffer", "DataView",
  "Int8Array", "Uint8Array", "Uint8ClampedArray",
  "Int16Array", "Uint16Array", "Int32Array", "Uint32Array",
  "Float32Array", "Float64Array", "BigInt64Array", "BigUint64Array",
  "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURI", "decodeURI", "encodeURIComponent", "decodeURIComponent",
];

function harvestDonorIntrinsics(): Record<string, unknown> {
  const donor = createContext({}, {
    name: "xr:sandbox:intrinsics",
    codeGeneration: { strings: false, wasm: false },
  } as any);
  const harvestExpr = `(function(){ const out = {}; ${DONOR_INTRINSIC_NAMES.map(
    (n) => `try { out[${JSON.stringify(n)}] = ${n}; } catch (_) {}`,
  ).join(" ")} return out; })()`;
  const intrinsics = new Script(harvestExpr, { filename: "xr:sandbox:harvest" } as any)
    .runInContext(donor, { timeout: 1000 } as any) as Record<string, unknown>;
  freezeDonorPrototypes(donor);
  return intrinsics;
}

function freezeDonorPrototypes(context: any): void {
  try {
    const freezeScript = new Script(`
      (function() {
        var protos = [
          Object.prototype, Array.prototype, Function.prototype,
          String.prototype, Number.prototype, Boolean.prototype,
          RegExp.prototype, Date.prototype, Map.prototype, Set.prototype,
          WeakMap.prototype, WeakSet.prototype, Promise.prototype,
          Error.prototype, TypeError.prototype, RangeError.prototype,
          ReferenceError.prototype, SyntaxError.prototype, URIError.prototype,
        ];
        var ctors = [
          "ArrayBuffer","SharedArrayBuffer","DataView",
          "Int8Array","Uint8Array","Uint8ClampedArray",
          "Int16Array","Uint16Array","Int32Array","Uint32Array",
          "Float32Array","Float64Array","BigInt64Array","BigUint64Array",
          "AggregateError",
        ];
        for (var i = 0; i < ctors.length; i++) {
          try { protos.push(globalThis[ctors[i]].prototype); } catch (e) {}
        }
        for (var i = 0; i < protos.length; i++) {
          try { Object.freeze(protos[i]); } catch (e) {}
        }
        var ns = [JSON, Math, Intl, Reflect];
        for (var i = 0; i < ns.length; i++) { try { Object.freeze(ns[i]); } catch (e) {} }
      })();
    `, { filename: "xr:sandbox:freeze" } as any);
    freezeScript.runInContext(context, { timeout: 1000 } as any);
  } catch { /* best-effort */ }
}

function createHostMembrane(): { wrap: (v: any) => any } {
  const proxyFor = new WeakMap<object, any>();
  const rawFor = new WeakMap<object, object>();
  const unwrap = (v: any): any => (rawFor.has(v) ? rawFor.get(v) : v);

  const wrap = (value: any): any => {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
    if (proxyFor.has(value)) return proxyFor.get(value);

    const proxy: any = new Proxy(value, {
      get(target, prop) {
        if (prop === "constructor" || prop === "__proto__" || prop === "prototype") return undefined;
        const v = Reflect.get(target as any, prop, target);
        if (typeof v === "function") {
          const bound = (v as (...a: any[]) => any).bind(target);
          const callProxy = new Proxy(bound, {
            get(_t, p2) {
              if (p2 === "constructor" || p2 === "__proto__" || p2 === "prototype") return undefined;
              return wrap(Reflect.get(bound as any, p2));
            },
            apply(_t, _thisArg, args) {
              return wrap(bound(...(args ?? []).map(unwrap)));
            },
            construct(_t, args) {
              return wrap(new (bound as any)(...(args ?? []).map(unwrap)));
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
      defineProperty() { return false; },
      deleteProperty() { return false; },
      setPrototypeOf() { return false; },
      getPrototypeOf() { return null; },
      apply(target: any, _thisArg, args: any[]) {
        return wrap(Reflect.apply(target, undefined, (args ?? []).map(unwrap)));
      },
      construct(target: any, args: any[]) {
        return wrap(Reflect.construct(target, (args ?? []).map(unwrap)));
      },
    });
    proxyFor.set(value, proxy);
    rawFor.set(proxy, value);
    return proxy;
  };
  return { wrap };
}

function createSecureSandbox(
  pId: string,
  intrinsics: Record<string, unknown>,
  wrapHost: (v: any) => any,
): any {
  const mkLog = (level: "log" | "warn" | "error" | "info" | "debug") =>
    (...args: any[]) => {
      const line = args.map((a: any) => {
        try { return typeof a === "string" ? a : JSON.stringify(a); }
        catch { return String(a); }
      }).join(" ");
      const redacted = redactLine(line);
      post({ type: "log", level, message: `[plugin:${pId}] ${redacted}` });
    };

  const raw: any = {};

  // Realm A: donor intrinsics
  for (const [k, v] of Object.entries(intrinsics)) raw[k] = v;
  raw.Function = undefined;
  raw.eval = undefined;

  // Realm B: host-provided capabilities
  raw.console = wrapHost({
    log: mkLog("log"), warn: mkLog("warn"), error: mkLog("error"),
    info: mkLog("info"), debug: mkLog("debug"),
  });
  raw.setTimeout = wrapHost(setTimeout);
  raw.clearTimeout = wrapHost(clearTimeout);
  raw.setInterval = wrapHost(setInterval);
  raw.clearInterval = wrapHost(clearInterval);
  raw.queueMicrotask = wrapHost(queueMicrotask);
  if (typeof setImmediate !== "undefined") raw.setImmediate = wrapHost(setImmediate);
  if (typeof clearImmediate !== "undefined") raw.clearImmediate = wrapHost(clearImmediate);
  raw.URL = wrapHost(URL);
  raw.URLSearchParams = wrapHost(URLSearchParams);
  raw.TextEncoder = wrapHost(TextEncoder);
  raw.TextDecoder = wrapHost(TextDecoder);
  raw.AbortController = wrapHost(AbortController);
  raw.AbortSignal = wrapHost(AbortSignal);
  if (typeof Blob !== "undefined") raw.Blob = wrapHost(Blob);
  if (typeof Headers !== "undefined") raw.Headers = wrapHost(Headers);
  if (typeof Request !== "undefined") raw.Request = wrapHost(Request);
  if (typeof Response !== "undefined") raw.Response = wrapHost(Response);
  if (typeof atob !== "undefined") raw.atob = wrapHost(atob);
  if (typeof btoa !== "undefined") raw.btoa = wrapHost(btoa);
  if (typeof Buffer !== "undefined") raw.Buffer = wrapHost(Buffer);
  if (typeof structuredClone !== "undefined") raw.structuredClone = wrapHost(structuredClone);
  if (typeof crypto !== "undefined") raw.crypto = wrapHost(crypto);

  // Blocked globals
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

  // Hardened Proxy wrapper
  const handler: ProxyHandler<object> = {
    get(target: any, prop: string | symbol): any {
      if (typeof prop === "string") {
        if (prop === "constructor" || prop === "__proto__") return undefined;
        if (BLOCKED_GLOBALS.has(prop)) return undefined;
      }
      return target[prop];
    },
    set(target: any, prop: string | symbol, value: any): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) return false;
      target[prop] = value;
      return true;
    },
    has(target: any, prop: string | symbol): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) return false;
      return prop in target;
    },
    deleteProperty(target: any, prop: string | symbol): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) return false;
      delete target[prop];
      return true;
    },
    defineProperty(target: any, prop: string | symbol, descriptor: PropertyDescriptor): boolean {
      if (typeof prop === "string" && BLOCKED_GLOBALS.has(prop)) return false;
      return Reflect.defineProperty(target, prop, descriptor);
    },
    setPrototypeOf() { return false; },
  };

  const proxied = new Proxy(raw, handler);
  raw.globalThis = proxied;
  raw.self = proxied;
  return proxied;
}

// ── Transpilation & Module Resolution ───────────────────────────────────────

function transpileCode(code: string, filename: string): string {
  try {
    // @ts-ignore
    if (typeof Bun !== "undefined" && (Bun as any).Transpiler) {
      // @ts-ignore
      const loader = filename.endsWith(".tsx") ? "tsx" : filename.endsWith(".ts") ? "tsx" : filename.endsWith(".jsx") ? "jsx" : "js";
      // @ts-ignore
      const t = new (Bun as any).Transpiler({ loader, target: "node" });
      const out = t.transformSync(code);
      if (typeof out === "string" && out.length > 0) return out;
    }
  } catch { /* fall through */ }
  return code;
}

function transformESMToCJS(code: string): string {
  let out = code;
  out = out.replace(/^\s*import\s+type\s+[^;]+;?/gm, "");
  out = out.replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+["'](\.[^"']+)["'];?/g,
    (_: string, names: string, p: string) => `const { ${names} } = require("${p}");`);
  out = out.replace(/import\s+([A-Za-z0-9_$]+)\s+from\s+["'](\.[^"']+)["'];?/g,
    (_: string, name: string, p: string) => `const ${name} = (require("${p}").default ?? require("${p}"));`);
  out = out.replace(/import\s+\*\s+as\s+([A-Za-z0-9_$]+)\s+from\s+["'](\.[^"']+)["'];?/g,
    (_: string, name: string, p: string) => `const ${name} = require("${p}");`);
  out = out.replace(/import\s+["'](\.[^"']+)["'];?/g, (_: string, p: string) => `require("${p}");`);
  out = out.replace(/export\s+default\s+function\s+([A-Za-z0-9_$]+)?/g,
    (_: string, name: string) => `exports.default = function ${name || ""}`.trimEnd());
  out = out.replace(/export\s+default\s+/g, "exports.default = ");
  out = out.replace(/export\s+async\s+function\s+([A-Za-z0-9_$]+)/g, "exports.$1 = async function $1");
  out = out.replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, "exports.$1 = function $1");
  const constExports: string[] = [];
  out = out.replace(/export\s+(const|let|var)\s+([A-Za-z0-9_$]+)\s*=/g,
    (_: string, kw: string, name: string) => { constExports.push(name); return `${kw} ${name} =`; });
  if (constExports.length) out += "\n" + constExports.map((n) => `exports.${n} = ${n};`).join("\n");
  out = out.replace(/export\s+\{\s*([^}]+)\s*\};?/g, (_: string, names: string) => {
    return names.split(",").map((s) => s.trim()).filter(Boolean)
      .map((n) => {
        const [orig, alias] = n.split(/\s+as\s+/).map((x: string) => x.trim());
        return `exports.${alias || orig} = ${orig};`;
      }).join("\n");
  });
  return out;
}

function resolveFileWithExts(baseDir: string, spec: string, root: string): string | null {
  const candidates: string[] = [];
  const raw = resolve(baseDir, spec);
  candidates.push(raw, raw + ".ts", raw + ".js", raw + ".tsx", raw + ".jsx",
    raw + ".mjs", raw + ".cjs", raw + ".json",
    join(raw, "index.ts"), join(raw, "index.js"), join(raw, "index.tsx"), join(raw, "index.jsx"));
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) {
        const real = realpathSync(c);
        if (!inside(root, real)) continue;
        return real;
      }
    } catch { continue; }
  }
  return null;
}

// ── Plugin Loading in VM ────────────────────────────────────────────────────

type ModuleRecord = { exports: any; id: string; filename: string; loaded: boolean };

async function loadPluginInVM(entryAbs: string, host: any, pId: string): Promise<PluginModule> {
  const intrinsics = harvestDonorIntrinsics();
  const { wrap: wrapHost } = createHostMembrane();
  const sandbox = createSecureSandbox(pId, intrinsics, wrapHost);
  const context = createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
    name: `plugin:${pId}`,
  } as any);

  const cache = new Map<string, ModuleRecord>();

  function loadModule(absPath: string): any {
    if (cache.has(absPath)) return cache.get(absPath)!.exports;
    let raw: string;
    try { raw = readFileSync(absPath, "utf8"); }
    catch (e) { throw new Error(`cannot read module ${relative(pluginRoot, absPath)}: ${(e as Error).message}`); }

    if (absPath.endsWith(".json")) {
      try {
        const parsed = JSON.parse(raw);
        const mod: ModuleRecord = { exports: parsed, id: absPath, filename: absPath, loaded: true };
        cache.set(absPath, mod);
        return mod.exports;
      } catch (e) { throw new Error(`invalid JSON ${relative(pluginRoot, absPath)}: ${(e as Error).message}`); }
    }

    const transpiled = transpileCode(raw, absPath);
    const cjs = transformESMToCJS(transpiled);
    const mod: ModuleRecord = { exports: {}, id: absPath, filename: absPath, loaded: false };
    cache.set(absPath, mod);
    const dirName = dirname(absPath);

    const localRequire = (spec: string): any => {
      if (typeof spec !== "string") throw new Error(`require() argument must be string, got ${typeof spec}`);
      if (!spec.startsWith(".") && !spec.startsWith("/")) {
        throw new Error(`require("${spec}") blocked: bare specifiers are not allowed in plugins. Use relative imports (./x) and PluginHost capabilities`);
      }
      const resolved = resolveFileWithExts(dirName, spec, pluginRoot);
      if (!resolved) throw new Error(`Cannot resolve "${spec}" from ${relative(pluginRoot, absPath)}`);
      return loadModule(resolved);
    };
    Object.defineProperty(localRequire, "resolve", { value: () => { throw new Error("require.resolve is disabled"); }, writable: false, configurable: false });
    Object.defineProperty(localRequire, "cache", { value: undefined, writable: false, configurable: false });

    const wrapper = `(function(exports, require, module, __filename, __dirname, host) {\n${cjs}\n})`;
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
      try {
        delete (context as any).__xr_exports;
        delete (context as any).__xr_require;
        delete (context as any).__xr_module;
        delete (context as any).__xr_filename;
        delete (context as any).__xr_dirname;
        delete (context as any).__xr_host;
      } catch { /* ignore */ }
    } catch (e) {
      try {
        const fn = compileFunction(wrapper, ["exports", "require", "module", "__filename", "__dirname", "host"], { filename: absPath } as any) as any;
        fn(mod.exports, localRequire, mod, absPath, dirName, host);
      } catch {
        cache.delete(absPath);
        throw new Error(`compile error in ${relative(pluginRoot, absPath)}: ${(e as Error).message}`);
      }
    }
    mod.loaded = true;
    return mod.exports;
  }

  return loadModule(entryAbs) as PluginModule;
}

// ── Host Builder (Worker-local) ─────────────────────────────────────────────

function buildHost(): any {
  const pId = manifest!.id;
  const grantedSet = new Set(granted);
  const dataDir = join(pluginDir, "data");

  const base: any = Object.create(null);
  base.id = pId;
  base.apiVersion = apiVersion;
  base.coreVersion = coreVersion;
  base.permissions = Object.freeze([...granted]);
  base.can = ((perm: PermissionScope) => grantedSet.has(perm));
  base.log = ((line: string) => post({ type: "log", level: "log", message: `[plugin:${pId}] ${redactLine(line)}` }));
  base.warn = ((line: string) => post({ type: "log", level: "warn", message: `[plugin:${pId}] ${redactLine(line)}` }));
  base.audit = ((event: string, detail?: Record<string, unknown>) => {
    requestCapability("audit", "record", [event, { plugin: pId, ...detail }]).catch(() => {});
  });

  // fs capability (handled locally in worker)
  if (grantedSet.has("fs:read") || grantedSet.has("fs:write")) {
    const fsCap: any = Object.create(null);
    fsCap.path = ((rel: string) => safeJoin(dataDir, rel));
    if (grantedSet.has("fs:read")) {
      fsCap.read = ((rel: string) => {
        const p = safeJoin(dataDir, rel);
        if (!existsSync(p)) return "";
        const st = statSync(p);
        if (!st.isFile()) throw new Error(`not a file: ${rel}`);
        if (st.size > 10 * 1024 * 1024) throw new Error(`file too large: ${rel}`);
        base.audit("fs.read", { path: rel, size: st.size });
        return readFileSync(p, "utf8");
      });
      fsCap.list = ((rel = ".") => {
        const p = safeJoin(dataDir, rel);
        if (!existsSync(p)) return [];
        const st = statSync(p);
        if (!st.isDirectory()) throw new Error(`not a directory: ${rel}`);
        base.audit("fs.list", { path: rel });
        return readdirSync(p).filter((n: string) => !n.startsWith(".") && n !== "node_modules");
      });
    }
    if (grantedSet.has("fs:write")) {
      fsCap.write = ((rel: string, content: string) => {
        if (typeof rel !== "string" || !rel) throw new Error("invalid path");
        if (typeof content !== "string") content = String(content);
        if (content.length > 10 * 1024 * 1024) throw new Error("content too large");
        if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
        const p = safeJoin(dataDir, rel);
        const parent = dirname(p);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(p, content);
        base.audit("fs.write", { path: rel, size: content.length });
      });
    }
    base.fs = Object.freeze(fsCap);
  }

  // net capability (handled locally in worker using global fetch)
  if (grantedSet.has("net")) {
    const isAllowed = (url: string): boolean => {
      try {
        const u = new URL(url);
        if (!["http:", "https:"].includes(u.protocol)) return false;
        if (egressAllowlist.length === 0) return true;
        return egressAllowlist.some((d) => u.hostname === d || u.hostname.endsWith("." + d));
      } catch { return false; }
    };
    const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
      let parsed: URL;
      try { parsed = new URL(url); }
      catch { throw new Error(`invalid URL: ${String(url).slice(0, 200)}`); }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`unsupported protocol: ${parsed.protocol}`);
      if (!isAllowed(url)) {
        base.audit("net.blocked", { url: String(url).slice(0, 200) });
        throw new Error(`egress blocked: host not allow-listed (${parsed.hostname})`);
      }
      base.audit("net.fetch", { url: String(url).slice(0, 200), method: init?.method ?? "GET" });
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 30_000);
      try { return await fetch(url, { ...init, signal: controller.signal as any }); }
      finally { clearTimeout(to); }
    };
    base.net = Object.freeze({ isAllowed, fetch: fetchFn });
  }

  // secrets capability (pre-loaded from workerData)
  if (grantedSet.has("secrets")) {
    base.secrets = Object.freeze({
      get: ((name: string) => {
        if (typeof name !== "string" || !name) throw new Error("invalid secret name");
        const clean = name.replace(/[^A-Za-z0-9_:-]/g, "").slice(0, 120);
        if (!clean) throw new Error("invalid secret name");
        base.audit("secrets.get", { name: clean });
        return secrets[clean] ?? undefined;
      }),
    });
  }

  // memory capability (proxied to main thread)
  if (grantedSet.has("memory:read") || grantedSet.has("memory:write")) {
    const memCap: any = Object.create(null);
    if (grantedSet.has("memory:read")) {
      memCap.recall = (async (query: string, opts?: { k?: number }) => {
        if (typeof query !== "string" || !query.trim()) throw new Error("invalid query");
        return await requestCapability("memory", "recall", [query, opts]);
      });
    }
    if (grantedSet.has("memory:write")) {
      memCap.add = ((content: string, opts?: { category?: string; importance?: number; tags?: string[] }) => {
        if (typeof content !== "string" || !content.trim()) throw new Error("invalid content");
        requestCapability("memory", "add", [content, opts]).catch(() => {});
        return { ok: true };
      });
    }
    base.memory = Object.freeze(memCap);
  }

  // provider capability (proxied to main thread)
  if (grantedSet.has("provider")) {
    base.provider = Object.freeze({
      chat: (async (messages: any[]) => {
        return await requestCapability("provider", "chat", [messages]);
      }),
    });
  }

  // mcp capability (local data from workerData)
  if (grantedSet.has("mcp")) {
    base.mcp = Object.freeze({
      servers: (() => Object.freeze([...mcpServers])),
    });
  }

  Object.freeze(base);
  return base;
}

// ── Message Handler ─────────────────────────────────────────────────────────

async function handleInit(msg: any): Promise<void> {
  pluginDir = msg.pluginDir;
  pluginRoot = realpathSync(msg.pluginDir);
  manifest = msg.manifest;
  granted = msg.granted;
  secrets = msg.secrets ?? {};
  egressAllowlist = msg.egressAllowlist ?? [];
  mcpServers = msg.mcpServers ?? [];
  coreVersion = msg.coreVersion;
  apiVersion = msg.apiVersion;

  const entryAbs = containedPath(pluginDir, manifest!.entrypoint);
  if (!entryAbs || !existsSync(entryAbs)) {
    post({ type: "loaded", ok: false, error: `entrypoint not found: ${manifest!.entrypoint}` });
    return;
  }
  const entryReal = realpathSync(entryAbs);
  if (!inside(pluginRoot, entryReal)) {
    post({ type: "loaded", ok: false, error: "entrypoint escapes plugin root" });
    return;
  }

  try {
    pluginHost = buildHost();
    pluginModule = await loadPluginInVM(entryReal, pluginHost, manifest!.id);
    post({ type: "loaded", ok: true });
  } catch (e) {
    post({ type: "loaded", ok: false, error: `plugin load failed: ${(e as Error).message}` });
  }
}

async function handleActivate(): Promise<void> {
  if (!pluginModule) {
    post({ type: "activated", ok: false, error: "plugin not loaded" });
    return;
  }

  try {
    const activate = resolveActivate(pluginModule);
    if (!activate) {
      post({ type: "activated", ok: false, error: "plugin has no activate() export" });
      return;
    }

    const rawContributions = await activate(pluginHost);
    contributions = sanitizeContributions(rawContributions ?? {});

    const serialized: SerializedContributions = {
      tools: (contributions.tools ?? []).map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        requiresApproval: t.requiresApproval,
      })),
      commands: (contributions.commands ?? []).map((c) => ({
        name: c.name,
        description: c.description,
      })),
      prompts: (contributions.prompts ?? []).map((p) => ({
        id: p.id,
        description: p.description,
        template: p.template,
      })),
      hasDispose: typeof contributions.dispose === "function",
    };

    post({ type: "activated", ok: true, contributions: serialized });
  } catch (e) {
    post({ type: "activated", ok: false, error: `activate() threw: ${(e as Error).message}` });
  }
}

async function handleInvoke(msg: WorkerInvokeMessage): Promise<void> {
  if (!contributions) {
    post({ type: "invoked", requestId: msg.requestId, ok: false, error: "plugin not activated" });
    return;
  }

  try {
    if (msg.kind === "tool") {
      const tool = contributions.tools?.find((t) => t.name === msg.name);
      if (!tool) {
        post({ type: "invoked", requestId: msg.requestId, ok: false, error: `tool not found: ${msg.name}` });
        return;
      }
      const result = await tool.run(msg.args as Record<string, unknown>);
      post({ type: "invoked", requestId: msg.requestId, ok: true, result });
    } else if (msg.kind === "command") {
      const cmd = contributions.commands?.find((c) => c.name === msg.name);
      if (!cmd) {
        post({ type: "invoked", requestId: msg.requestId, ok: false, error: `command not found: ${msg.name}` });
        return;
      }
      await cmd.run(msg.args as string[]);
      post({ type: "invoked", requestId: msg.requestId, ok: true, result: { ok: true, output: "" } });
    }
  } catch (e) {
    post({ type: "invoked", requestId: msg.requestId, ok: false, error: (e as Error).message });
  }
}

async function handleDispose(): Promise<void> {
  try {
    if (contributions?.dispose) await contributions.dispose();
  } catch { /* best-effort */ }
  post({ type: "disposed" });
}

function resolveActivate(mod: PluginModule) {
  if (typeof (mod as any).activate === "function") return (mod as any).activate;
  if (typeof mod.default === "function") return mod.default;
  if (mod.default && typeof (mod.default as any).activate === "function") return (mod.default as any).activate;
  return undefined;
}

const CONTRIB_NAME = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
function sanitizeContributions(c: any): PluginContributions {
  const commands = (c.commands ?? []).filter((cmd: any) => cmd && CONTRIB_NAME.test(cmd.name) && typeof cmd.run === "function");
  const tools = (c.tools ?? []).filter((tool: any) => tool && CONTRIB_NAME.test(tool.name) && typeof tool.description === "string" && typeof tool.run === "function");
  const prompts = (c.prompts ?? []).filter((p: any) => p && CONTRIB_NAME.test(p.id) && typeof p.template === "string");
  return { commands, tools, prompts, dispose: typeof c.dispose === "function" ? c.dispose : undefined };
}

// ── Main Message Loop ───────────────────────────────────────────────────────

port.on("message", (msg: MainToWorkerMessage) => {
  switch (msg.type) {
    case "init":
      handleInit(msg).catch((e) => post({ type: "error", message: (e as Error).message, fatal: true }));
      break;
    case "activate-request":
      handleActivate().catch((e) => post({ type: "error", message: (e as Error).message, fatal: false }));
      break;
    case "invoke":
      handleInvoke(msg).catch((e) => {
        post({ type: "invoked", requestId: (msg as any).requestId, ok: false, error: (e as Error).message });
      });
      break;
    case "dispose":
      handleDispose().catch(() => post({ type: "disposed" }));
      break;
    case "capability-response":
      const handler = pendingCapabilities.get(msg.requestId);
      if (handler) handler({ result: msg.result, error: msg.error });
      break;
  }
});

// Signal readiness
post({ type: "ready" });
