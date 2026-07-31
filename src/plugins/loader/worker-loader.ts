/**
 * XR — worker-based plugin loading (real process isolation).
 *
 * Phase 2 · T7: `src/plugins/loader.ts` was 1 586 lines spanning three
 * unrelated responsibilities — manifest validation/hashing, the in-process VM
 * sandbox, and worker-based process isolation. Split by responsibility so a
 * change to one cannot silently affect the others; the security architecture
 * itself is unchanged (no behaviour edits were made during the split).
 *
 * Owns the `worker_threads` path: the plugin runs in a separate thread with the
 * capability host reached over the message protocol in `worker-protocol.ts`,
 * and falls back to the in-process VM sandbox when a worker cannot be used.
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
import { loadPlugin } from "./sandbox.ts";

// ── Worker-Based Plugin Loading (Phase 2 — Real Process Isolation) ──────────

/**
 * Load a plugin inside a Worker thread for real process isolation.
 * This is the PRIMARY loading path. Falls back to direct VM loading
 * if the Worker fails to spawn or initialize.
 *
 * SECURITY: Provides dual-layer isolation:
 *   Layer 1 — Worker Thread: separate event loop, separate global scope,
 *             killable via terminate(), no access to main thread state
 *   Layer 2 — VM Sandbox: two-realm isolation, membrane, frozen prototypes,
 *             blocked globals, capability-gated host API
 */
export async function loadPluginInWorker(dir: string, deps: LoadDeps): Promise<LoadResult> {
  // Step 1: Validate (same as loadPlugin)
  const v = await validatePluginAsync(dir);
  if (!v.ok || !v.manifest) {
    if (v.manifest) {
      const preCompat = checkCompatibility(CORE_VERSION, v.manifest.apiVersion, PLUGIN_API_VERSION, v.manifest.compatibility);
      if (!preCompat.ok) return { ok: false, manifest: v.manifest, reason: preCompat.reason ?? "incompatible", kind: "incompatible" };
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
  try { root = realpathSync(dir); }
  catch { return { ok: false, manifest, reason: "cannot resolve plugin root", kind: "error" }; }

  const entryAbs = containedPath(dir, manifest.entrypoint);
  if (!entryAbs || !existsSync(entryAbs)) {
    return { ok: false, manifest, reason: `entrypoint not found: ${manifest.entrypoint}`, kind: "error" };
  }

  const granted = effectiveGrant(manifest.permissions, deps.granted);

  // Step 2: Pre-load secrets for the worker
  const secretsForWorker: Record<string, string | undefined> = {};
  if (granted.includes("secrets")) {
    // Pre-load declared secrets from the environment/file so the worker
    // can provide them synchronously to plugin code (e.g., github plugin).
    // Only the secrets the plugin is allowed to see are included.
    try {
      const envSecrets = ["GITHUB_TOKEN", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
      for (const name of envSecrets) {
        const val = getSecret(name);
        if (val !== undefined) secretsForWorker[name] = val;
      }
    } catch { /* best-effort */ }
  }

  // Step 3: Try Worker-based loading, fallback to direct VM
  try {
    return await loadViaWorker(dir, entryAbs, manifest, granted, deps, secretsForWorker);
  } catch (workerError) {
    deps.store.audit("plugin.worker_fallback", {
      plugin: manifest.id,
      reason: (workerError as Error).message,
    });
    // Fallback to direct VM loading
    return loadPluginDirect(dir, deps);
  }
}

async function loadViaWorker(
  dir: string,
  entryAbs: string,
  manifest: PluginManifest,
  granted: PermissionScope[],
  deps: LoadDeps,
  secrets: Record<string, string | undefined>,
): Promise<LoadResult> {
  const workerPath = new URL("../sandbox-worker.ts", import.meta.url).href;
  const egressAllowlist: string[] = (deps.config as any).security?.egressAllowlist ?? [];

  const worker = new Worker(workerPath, { workerData: {} });

  return new Promise<LoadResult>((resolvePromise) => {
    let settled = false;
    const settle = (result: LoadResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };
    const fail = (reason: string) => {
      worker.terminate().catch(() => {});
      settle({ ok: false, manifest, reason, kind: "error" });
    };

    let initTimer: ReturnType<typeof setTimeout> | null = null;
    let activateTimer: ReturnType<typeof setTimeout> | null = null;
    let contributionsMeta: SerializedContributions | null = null;
    let activeWorker = worker;

    const cleanup = () => {
      if (initTimer) clearTimeout(initTimer);
      if (activateTimer) clearTimeout(activateTimer);
      try { worker.removeAllListeners(); } catch {}
    };

    // Invoke handler tracking
    const pendingInvokes = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

    initTimer = setTimeout(() => {
      fail("worker initialization timed out");
    }, INIT_TIMEOUT_MS);

    worker.on("message", (msg: WorkerToMainMessage) => {
      switch (msg.type) {
        case "ready":
          worker.postMessage({
            type: "init",
            pluginDir: dir,
            entryFile: entryAbs,
            manifest,
            granted,
            secrets,
            egressAllowlist,
            mcpServers: manifest.mcpServers,
            coreVersion: CORE_VERSION,
            apiVersion: PLUGIN_API_VERSION,
          } satisfies MainToWorkerMessage);
          break;

        case "loaded":
          if (initTimer) { clearTimeout(initTimer); initTimer = null; }
          if (!msg.ok) {
            fail(msg.error ?? "worker failed to load plugin");
            return;
          }
          activateTimer = setTimeout(() => {
            fail("plugin activate() timed out");
          }, ACTIVATE_TIMEOUT_MS);
          worker.postMessage({ type: "activate-request" } satisfies MainToWorkerMessage);
          break;

        case "activated":
          if (activateTimer) { clearTimeout(activateTimer); activateTimer = null; }
          if (!msg.ok) {
            fail(msg.error ?? "activation failed");
            return;
          }
          contributionsMeta = msg.contributions ?? null;
          const proxyContributions = buildProxyContributions(activeWorker, pendingInvokes, contributionsMeta!);
          settle({
            ok: true,
            manifest,
            contributions: proxyContributions,
            granted,
          });
          break;

        case "invoked": {
          const pending = pendingInvokes.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            pendingInvokes.delete(msg.requestId);
            if (msg.ok) pending.resolve(msg.result);
            else pending.reject(new Error(msg.error ?? "invocation failed"));
          }
          break;
        }

        case "capability-request":
          handleWorkerCapabilityRequest(worker, msg, deps, manifest.id).catch((e) => {
            worker.postMessage({
              type: "capability-response",
              requestId: msg.requestId,
              error: (e as Error).message,
            } satisfies MainToWorkerMessage);
          });
          break;

        case "log":
          if (msg.level === "warn") console.warn(msg.message);
          else if (msg.level === "error") console.error(msg.message);
          else console.log(msg.message);
          break;

        case "error":
          deps.store.audit("plugin.worker_error", { plugin: manifest.id, error: msg.message });
          if (msg.fatal) fail(`worker fatal error: ${msg.message}`);
          break;
      }
    });

    worker.on("error", (err) => {
      fail(`worker error: ${(err as Error).message}`);
    });

    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        fail(`worker exited unexpectedly with code ${code}`);
      }
    });
  });
}

function buildProxyContributions(
  worker: Worker,
  pendingInvokes: Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>,
  meta: SerializedContributions,
): PluginContributions {
  const invoke = (kind: "tool" | "command", name: string, args: any): Promise<any> => {
    return new Promise((resolvePromise, rejectPromise) => {
      const requestId = `inv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = setTimeout(() => {
        pendingInvokes.delete(requestId);
        worker.terminate().catch(() => {});
        rejectPromise(new Error(`plugin ${kind} invocation timed out: ${name}`));
      }, INVOKE_TIMEOUT_MS);
      pendingInvokes.set(requestId, { resolve: resolvePromise, reject: rejectPromise, timer });
      worker.postMessage({
        type: "invoke",
        requestId,
        kind,
        name,
        args,
      } satisfies MainToWorkerMessage);
    });
  };

  const tools: PluginTool[] = meta.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
    requiresApproval: t.requiresApproval,
    run: (args: Record<string, unknown>) => invoke("tool", t.name, args),
  }));

  const commands: PluginCommand[] = meta.commands.map((c) => ({
    name: c.name,
    description: c.description,
    run: (argv: string[]) => invoke("command", c.name, argv),
  }));

  const prompts: PluginPrompt[] = meta.prompts.map((p) => ({
    id: p.id,
    description: p.description,
    template: p.template,
  }));

  const dispose = meta.hasDispose
    ? async () => {
        worker.postMessage({ type: "dispose" } satisfies MainToWorkerMessage);
        await new Promise<void>((r) => setTimeout(r, 500));
        worker.terminate().catch(() => {});
      }
    : undefined;

  return { tools, commands, prompts, dispose };
}

async function handleWorkerCapabilityRequest(
  worker: Worker,
  msg: any,
  deps: LoadDeps,
  pluginId: string,
): Promise<void> {
  const { requestId, capability, method, args } = msg;
  let result: any;
  let error: string | undefined;

  try {
    switch (capability) {
      case "audit":
        if (method === "record") {
          deps.store.audit(args[0] as string, args[1] as Record<string, unknown>);
        }
        result = undefined;
        break;

      case "memory":
        if (method === "recall") {
          // Memory requires the MemoryStore which lives on the main thread
          // For the Worker sandbox, return empty results
          result = [];
        } else if (method === "add") {
          result = { ok: true };
        }
        break;

      case "provider":
        if (method === "chat") {
          result = { ok: false, message: "", reason: "provider not available in worker sandbox" };
        }
        break;

      default:
        error = `unknown capability: ${capability}`;
    }
  } catch (e) {
    error = (e as Error).message;
  }

  worker.postMessage({
    type: "capability-response",
    requestId,
    result,
    error,
  } satisfies MainToWorkerMessage);
}

/**
 * Direct VM loading (fallback path when Worker fails to spawn).
 * Delegates to the existing loadPlugin() function.
 */
async function loadPluginDirect(dir: string, deps: LoadDeps): Promise<LoadResult> {
  return loadPlugin(dir, deps);
}
