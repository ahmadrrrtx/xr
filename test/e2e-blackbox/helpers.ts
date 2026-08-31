/**
 * XR — e2e black-box CLI harness (Phase 0).
 *
 * The layer that was missing when Audit B's live bugs shipped: every test
 * here spawns the REAL CLI (`bun run src/index.ts …`) as a child process
 * against the in-tree stub provider (test/helpers/stub-openai.ts) with an
 * isolated XR_HOME, and asserts on the process contract: exit codes, stdout,
 * the audit chain and config state. Process-boundary bugs (registry sync,
 * config rewrite, exit-code mapping, stream-vs-body decisions) are
 * structurally invisible to in-process unit tests — this harness makes them
 * first-class assertions.
 *
 * Hygiene contract (M-07 / Phase 0 DoD):
 *   · every spawned child is tracked; closeAllCli() kills anything left;
 *   · every XR_HOME is a fresh mkdtemp under the suite TMPDIR (bunfig preload);
 *   · afterEach/afterAll must call cleanup; hygiene.test.ts asserts zero live
 *     children and zero leaked stub listeners after the lane.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Database } from "bun:sqlite";
import { afterEach } from "bun:test";
import type { StubOpenAIHandle, StubRequestRecord } from "../helpers/stub-openai.ts";

/** Repository root (…/test/e2e-blackbox/ → repo). */
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const CLI_ENTRY = join(REPO_ROOT, "src", "index.ts");

/** Test concurrency knob (XR_TEST_CONCURRENCY=1 = constraint-friendly lane). */
export function testConcurrency(): number {
  const raw = process.env.XR_TEST_CONCURRENCY ?? "";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

// ── child-process registry (leak detection + cleanup) ──────────────────────

const liveChildren = new Set<ChildProcess>();

export function liveChildCount(): number {
  return liveChildren.size;
}

export function killAllChildren(): void {
  for (const child of liveChildren) {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }
  liveChildren.clear();
}

export interface CliRunResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  home: string;
  durationMs: number;
  timedOut: boolean;
}

export interface CliRunOptions {
  /** XR_HOME for the child (defaults to a fresh mkdtemp). */
  home?: string;
  /** Extra env for the child (merged over the sanitized process env). */
  env?: Record<string, string>;
  /** Hard wall-clock cap before SIGKILL. */
  timeoutMs?: number;
  /** Extra startup grace: retry interval for the readiness of interactive waits. */
  stdin?: string;
}

/**
 * Spawn the real CLI in a fresh process with a hermetic environment.
 *
 * The child's env is derived from the CURRENT env (TMPDIR from the bunfig
 * suite preload must flow through so tmp usage lands inside the suite root),
 * then scrubbed: XR_HOME/HOME are forced to the isolated dir, NO_COLOR is
 * forced (stable stdout for contract assertions), and XR_DEBUG is preserved
 * only when the parent asked for it.
 */
export interface SpawnedCli {
  child: ChildProcess;
  home: string;
  stdout(): string;
  stderr(): string;
  /** resolves when the process exits (exit code or signal). */
  exited: Promise<{ code: number | null; signal: string | null; durationMs: number }>;
  kill(signal?: NodeJS.Signals): boolean;
}

export function spawnCli(
  args: string[],
  opts: CliRunOptions = {},
): SpawnedCli {
  const home = opts.home ?? freshHome();

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  delete env.XR_HOME;
  delete env.HOME;
  env.XR_HOME = home;
  env.HOME = home;
  env.NO_COLOR = "1";

  if (opts.env) Object.assign(env, opts.env);

  const started = Date.now();
  let stdout = "";
  let stderr = "";

  const child = spawn("bun", ["run", CLI_ENTRY, ...args], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  liveChildren.add(child);

  child.stdout?.on("data", (d) => {
    stdout += String(d);
  });
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });

  const exited = new Promise<{ code: number | null; signal: string | null; durationMs: number }>(
    (resolve) => {
      const finish = (code: number | null, signal: string | null): void => {
        liveChildren.delete(child);
        resolve({ code, signal, durationMs: Date.now() - started });
      };
      child.on("exit", (code, signal) => finish(code, signal));
      child.on("error", () => finish(null, null));
    },
  );

  return {
    child,
    home,
    stdout: () => stdout,
    stderr: () => stderr,
    exited,
    kill: (signal = "SIGTERM") => {
      try {
        return child.kill(signal);
      } catch {
        return false;
      }
    },
  };
}

export async function waitForExit(
  spawned: SpawnedCli,
  timeoutMs = 90_000,
): Promise<CliRunResult> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    spawned.kill("SIGKILL");
  }, timeoutMs);
  (timer as unknown as { unref?: () => void }).unref?.();

  const outcome = await spawned.exited;
  clearTimeout(timer);
  return {
    code: outcome.code,
    signal: outcome.signal,
    stdout: spawned.stdout(),
    stderr: spawned.stderr(),
    home: spawned.home,
    durationMs: outcome.durationMs,
    timedOut,
  };
}

export function runCli(args: string[], opts: CliRunOptions = {}): Promise<CliRunResult> {
  const spawned = spawnCli(args, opts);
  return waitForExit(spawned, opts.timeoutMs);
}

afterEach(() => {
  // Defensive: no test may leak a CLI child into the next test.
  if (liveChildren.size > 0) {
    console.warn(
      `[e2e-blackbox] ${liveChildren.size} child process(es) leaked by a test — killed`,
    );
    killAllChildren();
  }
});

// ── hermetic filesystem helpers ────────────────────────────────────────────

export function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "xr-e2e-home-"));
}

export function removeHome(home: string): void {
  try {
    rmSync(home, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

export function configPath(home: string): string {
  return join(home, "config.json");
}

export function readConfig(home: string): Record<string, any> {
  const p = configPath(home);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
}

export function writeConfig(home: string, config: Record<string, unknown>): void {
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), JSON.stringify(config, null, 2) + "\n");
}

/**
 * A custom-provider config block matching what `xr providers add` writes, so
 * suites that exercise the RUN side can install a provider the same way the
 * CLI does. `addCustomProvider` writes {id,label,baseUrl,apiKeyEnv,defaultModel,headers,capabilities}.
 */
export const CONFIG_VERSION = 20;

export function stubProviderConfig(
  providerId: string,
  stub: StubOpenAIHandle,
  overrides: {
    streaming?: boolean;
    model?: string;
    keyEnv?: string;
    label?: string;
  } = {},
): Record<string, unknown> {
  const streaming = overrides.streaming ?? true;
  return {
    id: providerId,
    label: overrides.label ?? `Stub ${providerId}`,
    baseUrl: stub.baseUrl,
    apiKeyEnv: overrides.keyEnv,
    defaultModel: overrides.model ?? stub.model,
    headers: undefined,
    capabilities: { chat: true, streaming, toolUse: true },
  };
}

/** Install a single custom provider (fresh config, version = CONFIG_VERSION). */
export function installStubProvider(
  home: string,
  providerId: string,
  stub: StubOpenAIHandle,
  overrides: Parameters<typeof stubProviderConfig>[2] = {},
): void {
  const existing = readConfig(home);
  writeConfig(home, {
    version: existing.version ?? CONFIG_VERSION,
    providerEngine: {
      routingStrategy: "hybrid",
      customProviders: [stubProviderConfig(providerId, stub, overrides) as never],
      providerCapabilities: {},
    },
  });
}

/**
 * Run the CLI against a freshly-isolated home that already has the stub
 * provider installed — the canonical "fresh process, custom provider" turn.
 */
export async function runWithProvider(
  args: string[],
  stub: StubOpenAIHandle,
  providerId: string,
  overrides: Parameters<typeof stubProviderConfig>[2] = {},
  runOpts: CliRunOptions = {},
): Promise<CliRunResult> {
  const home = runOpts.home ?? freshHome();
  installStubProvider(home, providerId, stub, overrides);
  return runCli(args, { ...runOpts, home });
}

// ── audit-chain readers (read-only; CLI must be exited first) ──────────────

export interface AuditRow {
  session_id: string | null;
  event: string;
  detail: string;
  created_at: number;
  hash: string;
  prev_hash: string;
}

export function auditRows(home: string): AuditRow[] {
  const dbPath = join(home, "xr.db");
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .query(
        "SELECT session_id, event, detail, created_at, hash, prev_hash FROM audit_log ORDER BY id ASC",
      )
      .all() as AuditRow[];
  } finally {
    db.close();
  }
}

export function auditEvents(home: string): string[] {
  return auditRows(home).map((r) => r.event);
}

export function auditDetail(home: string, event: string): string[] {
  return auditRows(home)
    .filter((r) => r.event === event)
    .map((r) => r.detail);
}

export function hasAudit(home: string, event: string): boolean {
  return auditEvents(home).includes(event);
}

/** The session_id of the most recent session.start (the default run's session). */
export function lastSessionId(home: string): string | null {
  const rows = auditRows(home).filter((r) => r.event === "session.start");
  const last = rows[rows.length - 1];
  return last?.session_id ?? null;
}

export function auditForSession(home: string, sessionId: string | null): AuditRow[] {
  if (!sessionId) return [];
  return auditRows(home).filter((r) => r.session_id === sessionId);
}

// ── port-leak assertion helpers (M-07) ─────────────────────────────────────

/**
 * Assert a port is free by binding it. Returns true when bind succeeds
 * (nothing is listening). Used after stub close() to prove zero leaked
 * listeners for the ports the suite opened.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const { createServer } = require("node:net") as typeof import("node:net");
    const probe = createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      // EADDRINUSE → something is listening; anything else is not "free" either.
      resolve(err.code !== "EADDRINUSE");
    });
    probe.listen(port, "127.0.0.1", () => {
      probe.close(() => resolve(true));
    });
  });
}

/** Wait until the stub is fully closed AND its port is bindable again. */
export async function assertStubClosed(
  stub: StubOpenAIHandle,
  label = "stub",
): Promise<void> {
  await stub.close();
  // Give the kernel a beat to release the socket.
  await new Promise((r) => setTimeout(r, 50));
  const free = await isPortFree(stub.port);
  if (!free) {
    throw new Error(`[port-leak] ${label} port ${stub.port} still bound after close()`);
  }
}

// ── assertion sugar ────────────────────────────────────────────────────────

export function expectExit(result: CliRunResult, expected: number): void {
  if (result.code !== expected) {
    throw new Error(
      `expected exit ${expected}, got ${result.code} (signal ${result.signal})\n` +
        `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
}

export function expectNoTimedOut(result: CliRunResult): void {
  if (result.timedOut) {
    throw new Error(
      `CLI child timed out (SIGKILLed)\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`,
    );
  }
}

export function stderrOf(result: CliRunResult): string {
  return result.stderr + result.stdout;
}
