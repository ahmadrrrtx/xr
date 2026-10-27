/**
 * XR 4.2 — Environment Backend Contract
 *
 * An EnvironmentBackend executes a high-risk `EnvironmentExecutable` inside a
 * placement with declared, HONEST guarantees. Backends state exactly what they
 * do and do NOT enforce; the policy/verification layers rely on those claims.
 *
 * Phase 3 ships LOCAL backends only. The interface is deliberately extensible
 * for future worker/container/remote backends (Phase 11+), which are NOT
 * implemented here.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type {
  AuthorityGrant,
  EnvironmentExecutable,
  EnvironmentRunResult,
  PlacementGuarantees,
  PlacementKind,
} from "../types.ts";
import type { ResourceEnforcement } from "../resources.ts";

export interface BackendRunContext {
  grant: AuthorityGrant;
  /** Transient credential env (NAME→VALUE) resolved by the broker. Do not persist. */
  envInject: Record<string, string>;
  onBoundary?: (detail: string) => void;
}

export interface EnvironmentBackend {
  readonly id: string;
  readonly placement: PlacementKind;
  readonly guarantees: PlacementGuarantees;
  readonly enforcement: ResourceEnforcement;
  /** Detect whether this backend is usable on the current host RIGHT NOW. */
  detect(): Promise<boolean>;
  /** Execute inside the placement. Ephemeral: torn down before returning. */
  run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult>;
  /** Honest human description including limitations. */
  describe(): string;
}

// ── Shared hardened child runner ──────────────────────────────────────────

export interface RawRunOptions {
  argv: readonly string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  stdin?: string;
  signal?: AbortSignal;
  /**
   * Phase 4 · T1 — extra inherited file descriptors (e.g. a seccomp policy
   * file for bubblewrap). Each parent fd is passed to the child as fd
   * 3, 4, … in order (node's stdio fd mapping); the caller references the
   * CHILD-side number in argv (e.g. `--seccomp 3`). The caller must open the
   * fds before calling runChild and may close them afterwards — the child's
   * copies are independent.
   */
  extraFds?: number[];
}

export interface RawRunOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled?: boolean;
  outputTruncated: boolean;
  durationMs: number;
  spawnError?: string;
  killed: boolean;
}

/**
 * Spawn a child in its own process group, enforce a wall-clock timeout (kills
 * the whole group), and bound captured output. Used by the in-process and
 * restricted backends and as a building block for sandbox shells.
 */
export function runChild(opts: RawRunOptions): Promise<RawRunOutcome> {
  const started = Date.now();
  const empty = (extra: Partial<RawRunOutcome>): RawRunOutcome => ({ exitCode: null, stdout: "", stderr: "", timedOut: false, cancelled: false, outputTruncated: false, durationMs: Date.now() - started, killed: false, ...extra });
  if (opts.signal?.aborted) return Promise.resolve(empty({ cancelled: true, stderr: "cancelled before start" }));
  if (!opts.argv.length || !Number.isSafeInteger(opts.timeoutMs) || opts.timeoutMs <= 0 || !Number.isSafeInteger(opts.maxOutputBytes) || opts.maxOutputBytes <= 0 || Buffer.byteLength(opts.stdin ?? "") > 1024 * 1024) {
    return Promise.resolve(empty({ spawnError: "invalid command/resource bounds", stderr: "invalid command/resource bounds" }));
  }
  return new Promise((resolvePromise) => {
    const [cmd, ...args] = opts.argv;
    const out: Buffer[] = [], err: Buffer[] = [];
    let outBytes = 0, truncated = false, timedOut = false, cancelled = false, killed = false, finished = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["pipe", "pipe", "pipe", ...(opts.extraFds ?? [])] });
    } catch (e) { resolvePromise(empty({ spawnError: (e as Error).message, stderr: (e as Error).message })); return; }
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); killed = true; }
      catch { try { killed = child.kill("SIGKILL") || killed; } catch { /* already dead */ } }
      // A detached descendant must not hold the caller's response pipes open.
      child.stdin?.destroy(); child.stdout?.destroy(); child.stderr?.destroy();
    };
    const abort = () => { cancelled = true; killGroup(); };
    const timer = setTimeout(() => { timedOut = true; killGroup(); }, opts.timeoutMs);
    opts.signal?.addEventListener("abort", abort, { once: true });
    if (opts.signal?.aborted) abort();
    const finish = (code: number | null, spawnError?: string) => {
      if (finished) return; finished = true;
      clearTimeout(timer); opts.signal?.removeEventListener("abort", abort);
      // Byte accounting is over raw buffers, not UTF-16 code units. Incomplete
      // UTF-8 tails at a truncated boundary are omitted rather than expanded.
      const decode = (chunks: Buffer[]) => new TextDecoder().decode(Buffer.concat(chunks), { stream: true });
      resolvePromise({ exitCode: code, stdout: decode(out), stderr: decode(err) || spawnError || "", timedOut, cancelled, outputTruncated: truncated, durationMs: Date.now() - started, spawnError, killed });
    };
    const capture = (chunks: Buffer[]) => (chunk: Buffer) => {
      if (truncated) return;
      const room = opts.maxOutputBytes - outBytes;
      const bytes = Math.min(room, chunk.length);
      if (bytes) { chunks.push(Buffer.from(chunk.subarray(0, bytes))); outBytes += bytes; }
      if (chunk.length > room) { truncated = true; killGroup(); }
    };
    child.stdout?.on("data", capture(out)); child.stderr?.on("data", capture(err));
    child.on("error", e => finish(null, e.message));
    child.on("close", code => finish(code));
    child.stdin?.on("error", () => { /* EPIPE after an early child exit */ });
    child.stdin?.end(opts.stdin);
  });
}

/** Docker CLI death alone does not kill a running container. Always remove
 * the uniquely named per-action container, including timeout/cancellation. */
export async function runDisposableContainer(opts: RawRunOptions): Promise<RawRunOutcome> {
  const name = `xr-action-${randomUUID()}`;
  const argv = [...opts.argv.slice(0, 2), "--name", name, ...opts.argv.slice(2)];
  const out = await runChild({ ...opts, argv });
  if (opts.signal?.aborted && out.durationMs === 0) return out;
  const clean = await runChild({ argv: [opts.argv[0], "rm", "-f", name], cwd: "/", env: opts.env, timeoutMs: 5000, maxOutputBytes: 4096 });
  if (clean.exitCode !== 0 && !/no such (container|object)/i.test(clean.stderr)) return { ...out, exitCode: null, spawnError: "container cleanup failed; inspect the xr-action container before further execution" };
  return out;
}

// ── Path containment (defense-in-depth; NOT a substitute for OS mounts) ───

export function safeResolve(p: string): string {
  try {
    return realpathSync(resolve(p));
  } catch {
    return resolve(p);
  }
}

/** True when `target` is within `root` (both resolved). Symlink-aware via realpath. */
export function isWithin(target: string, root: string): boolean {
  const t = safeResolve(target);
  const r = safeResolve(root);
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep);
}

/** True when any blocked path is an ancestor of (or equal to) `target`. */
export function hitsBlockedPath(target: string, blocked: readonly string[]): boolean {
  const t = safeResolve(target);
  return blocked.some((b) => {
    const rb = safeResolve(b);
    return t === rb || t.startsWith(rb.endsWith(sep) ? rb : rb + sep);
  });
}
