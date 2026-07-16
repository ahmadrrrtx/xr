/**
 * XR — non-blocking process helpers for the daemon hot path.
 *
 * Prefer Bun.spawn when available; fall back to node:child_process.spawn.
 * Never use execSync / spawnSync / Bun.spawnSync on request handlers.
 */
import { spawn as nodeSpawn } from "node:child_process";

export interface RunCommandOptions {
  cwd?: string;
  input?: string | Uint8Array;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** When true, run via a shell (prefer argv arrays instead). */
  shell?: boolean;
  maxBuffer?: number;
  /** Inherit / ignore / pipe. Default: pipe for stdout+stderr, ignore stdin unless input provided. */
  stdio?: "pipe" | "ignore" | "inherit";
  windowsHide?: boolean;
}

export interface RunCommandResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  signal: NodeJS.Signals | null;
  error?: string;
}

const commandExistsCache = new Map<string, { ok: boolean; at: number }>();
const COMMAND_EXISTS_TTL_MS = 60_000;

function useBunSpawn(): boolean {
  return typeof (globalThis as any).Bun?.spawn === "function";
}

function decode(buf: Uint8Array | string | undefined | null): string {
  if (buf == null) return "";
  if (typeof buf === "string") return buf;
  return new TextDecoder().decode(buf);
}

/**
 * Async subprocess. Never blocks the event loop while the child runs.
 */
export async function runCommand(
  cmd: string,
  args: string[] = [],
  opts: RunCommandOptions = {},
): Promise<RunCommandResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBuffer = opts.maxBuffer ?? 8 * 1024 * 1024;
  const shell = opts.shell === true;
  const windowsHide = opts.windowsHide !== false;

  if (useBunSpawn() && !shell) {
    return runWithBun(cmd, args, opts, timeoutMs, maxBuffer);
  }
  return runWithNode(cmd, args, opts, timeoutMs, maxBuffer, shell, windowsHide);
}

async function runWithBun(
  cmd: string,
  args: string[],
  opts: RunCommandOptions,
  timeoutMs: number,
  maxBuffer: number,
): Promise<RunCommandResult> {
  const BunRef = (globalThis as any).Bun;
  let proc: any;
  try {
    const stdin =
      opts.input != null
        ? opts.input instanceof Uint8Array
          ? opts.input
          : new TextEncoder().encode(opts.input)
        : "ignore";

    proc = BunRef.spawn([cmd, ...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdin,
      stdout: opts.stdio === "inherit" ? "inherit" : opts.stdio === "ignore" ? "ignore" : "pipe",
      stderr: opts.stdio === "inherit" ? "inherit" : opts.stdio === "ignore" ? "ignore" : "pipe",
      windowsHide: opts.windowsHide !== false,
    });
  } catch (e) {
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: "",
      signal: null,
      error: (e as Error).message,
    };
  }

  let timedOut = false;
  const timer =
    timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try {
            proc.kill();
          } catch {
            /* ignore */
          }
        }, timeoutMs)
      : null;

  try {
    const [stdoutRaw, stderrRaw, exitCode] = await Promise.all([
      proc.stdout && opts.stdio !== "ignore" && opts.stdio !== "inherit"
        ? new Response(proc.stdout).arrayBuffer().then((b) => new Uint8Array(b))
        : Promise.resolve(new Uint8Array()),
      proc.stderr && opts.stdio !== "ignore" && opts.stdio !== "inherit"
        ? new Response(proc.stderr).arrayBuffer().then((b) => new Uint8Array(b))
        : Promise.resolve(new Uint8Array()),
      proc.exited as Promise<number>,
    ]);

    if (timer) clearTimeout(timer);

    let stdout = decode(stdoutRaw);
    let stderr = decode(stderrRaw);
    if (stdout.length > maxBuffer) stdout = stdout.slice(0, maxBuffer);
    if (stderr.length > maxBuffer) stderr = stderr.slice(0, maxBuffer);

    if (timedOut) {
      return {
        ok: false,
        status: null,
        stdout,
        stderr: stderr || `${cmd} timed out after ${timeoutMs}ms`,
        signal: "SIGTERM",
        error: "timeout",
      };
    }

    return {
      ok: exitCode === 0,
      status: exitCode,
      stdout,
      stderr,
      signal: null,
    };
  } catch (e) {
    if (timer) clearTimeout(timer);
    return {
      ok: false,
      status: null,
      stdout: "",
      stderr: (e as Error).message,
      signal: null,
      error: (e as Error).message,
    };
  }
}

function runWithNode(
  cmd: string,
  args: string[],
  opts: RunCommandOptions,
  timeoutMs: number,
  maxBuffer: number,
  shell: boolean,
  windowsHide: boolean,
): Promise<RunCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const child = nodeSpawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell,
      windowsHide,
      stdio: opts.stdio === "inherit" ? "inherit" : opts.stdio === "ignore" ? "ignore" : ["pipe", "pipe", "pipe"],
    });

    const finish = (result: RunCommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            try {
              child.kill("SIGKILL");
            } catch {
              /* ignore */
            }
          }, timeoutMs)
        : null;

    if (opts.input != null && child.stdin) {
      child.stdin.end(opts.input);
    } else if (child.stdin) {
      child.stdin.end();
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      if (stdout.length < maxBuffer) stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderr.length < maxBuffer) stderr += String(chunk);
    });

    child.on("error", (err) => {
      finish({
        ok: false,
        status: null,
        stdout,
        stderr: stderr || err.message,
        signal: null,
        error: err.message,
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          status: null,
          stdout,
          stderr: stderr || `${cmd} timed out after ${timeoutMs}ms`,
          signal: signal ?? "SIGKILL",
          error: "timeout",
        });
        return;
      }
      finish({
        ok: code === 0,
        status: code,
        stdout,
        stderr,
        signal: signal ?? null,
      });
    });
  });
}

/**
 * Memoized async PATH probe. Safe to call frequently from auto-detection paths.
 */
export async function commandExists(cmd: string): Promise<boolean> {
  const cached = commandExistsCache.get(cmd);
  if (cached && Date.now() - cached.at < COMMAND_EXISTS_TTL_MS) return cached.ok;

  const which = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
  const r = await runCommand(which, args, {
    timeoutMs: 1500,
    stdio: "ignore",
    shell: process.platform !== "win32",
  });
  commandExistsCache.set(cmd, { ok: r.ok, at: Date.now() });
  return r.ok;
}

/** Clear command-exists memo (tests / after package installs). */
export function clearCommandExistsCache(): void {
  commandExistsCache.clear();
}

/**
 * Spawn a long-lived child and wait for exit without capturing large buffers.
 * Useful for TTS "say" / playback side-effects.
 */
export function spawnAndWait(
  cmd: string,
  args: string[],
  timeoutMs: number,
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string | Uint8Array } = {},
): Promise<{ ok: boolean; status: number | null; error?: string }> {
  return runCommand(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.input,
    timeoutMs,
    stdio: "ignore",
  }).then((r) => ({
    ok: r.ok,
    status: r.status,
    error: r.error ?? (r.ok ? undefined : r.stderr.slice(0, 300) || `exit ${r.status}`),
  }));
}

/**
 * Capture stdout+stderr as text (common shell helper).
 */
export async function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 5000,
  opts: Omit<RunCommandOptions, "timeoutMs"> = {},
): Promise<string> {
  const r = await runCommand(cmd, args, { ...opts, timeoutMs });
  return `${r.stdout}${r.stderr}`.trim();
}
