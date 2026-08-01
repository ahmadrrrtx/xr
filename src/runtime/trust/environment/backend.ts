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
  return new Promise((resolvePromise) => {
    const [cmd, ...args] = opts.argv;
    let stdout = "";
    let stderr = "";
    let outBytes = 0;
    let truncated = false;
    let timedOut = false;
    let killed = false;

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: opts.env,
        detached: true,
        // Phase 4 · T1 — extra parent fds are inherited by the child as
        // fd 3, 4, … (e.g. the seccomp policy file for bubblewrap).
        stdio: ["pipe", "pipe", "pipe", ...(opts.extraFds ?? [])],
      });
    } catch (err) {
      resolvePromise({
        exitCode: null,
        stdout: "",
        stderr: String(err instanceof Error ? err.message : err),
        timedOut: false,
        outputTruncated: false,
        durationMs: Date.now() - started,
        spawnError: String(err instanceof Error ? err.message : err),
        killed: false,
      });
      return;
    }

    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
        killed = true;
      } catch {
        try {
          child.kill(signal);
          killed = true;
        } catch {
          /* already dead */
        }
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGKILL");
    }, opts.timeoutMs);

    const capture = (which: "stdout" | "stderr") => (chunk: Buffer) => {
      if (truncated) return;
      const s = chunk.toString("utf8");
      if (outBytes + s.length > opts.maxOutputBytes) {
        const room = Math.max(0, opts.maxOutputBytes - outBytes);
        if (which === "stdout") stdout += s.slice(0, room);
        else stderr += s.slice(0, room);
        outBytes = opts.maxOutputBytes;
        truncated = true;
        killGroup("SIGKILL");
        return;
      }
      outBytes += s.length;
      if (which === "stdout") stdout += s;
      else stderr += s;
    };

    child.stdout?.on("data", capture("stdout"));
    child.stderr?.on("data", capture("stderr"));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: null,
        stdout,
        stderr: stderr || String(err.message),
        timedOut,
        outputTruncated: truncated,
        durationMs: Date.now() - started,
        spawnError: String(err.message),
        killed,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code,
        stdout,
        stderr,
        timedOut,
        outputTruncated: truncated,
        durationMs: Date.now() - started,
        killed,
      });
    });

    if (opts.stdin !== undefined && child.stdin) {
      child.stdin.end(opts.stdin);
    } else if (child.stdin) {
      child.stdin.end();
    }
  });
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
