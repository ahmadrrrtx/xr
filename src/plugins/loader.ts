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

/**
 * ── Phase 2 · T7 — module map ───────────────────────────────────────────────
 *
 * This file was 1 586 lines. It is now a thin public surface over three
 * responsibility-scoped modules:
 *
 *   loader/validation.ts     manifest + permission + compatibility validation,
 *                            hash pinning, tree hashing, static scan
 *   loader/sandbox.ts        the in-process VM realm + host membrane (defense-in-depth)
 *   loader/worker-loader.ts  worker_threads process isolation
 *
 * The public API below is unchanged, so every existing import keeps working.
 */

import { validatePlugin } from "./loader/validation.ts";

export {
  hashEntrypoint,
  hashEntrypointAsync,
  hashPluginTree,
  hashPluginTreeAsync,
  validatePlugin,
  validatePluginAsync,
  type LoadDeps,
  type LoadErr,
  type LoadOk,
  type LoadResult,
  type ValidateResult,
} from "./loader/validation.ts";

export { loadPlugin } from "./loader/sandbox.ts";
export { loadPluginInWorker } from "./loader/worker-loader.ts";

import type { PermissionScope, PluginRecord } from "./types.ts";

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
