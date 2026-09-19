/**
 * XR Daemon — engine-owned PTY sessions (Phase 2 · G-05).
 *
 * A real pseudo-terminal, not a line runner: `Bun.spawn({ terminal })` gives
 * the child a controlling TTY (openpty on Linux/macOS, ConPTY on Windows —
 * bun ≥ 1.3, no native addon, so the compiled sidecar ships it as-is).
 * Full-screen programs (vim, htop, less), colours, cursor movement and
 * interactive prompts behave as in any terminal emulator.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE OWNS (and the route does not)
 * ─────────────────────────────────────────────────────────────────────────────
 *   · the process lifecycle: spawn inside a validated cwd, resize, write,
 *     kill (SIGHUP → grace → SIGKILL; Windows: close the console, then
 *     TerminateProcess), and "the daemon is going away" (`closeAll`);
 *   · the honest limits: a per-daemon session cap, a per-message input cap,
 *     and an output high-water mark past which output is DROPPED and the
 *     drop is REPORTED (a terminal that silently buffers unbounded output
 *     for a client that stopped reading is a memory leak with a UI);
 *   · the environment handed to the shell: the user's own environment (this
 *     is their machine and their shell), minus XR's internal credentials.
 *
 * The consent decision — whether a shell may be opened at all — is made by
 * the ROUTE through the durable approval store, before `open()` is ever
 * called. There is deliberately no per-keystroke policy: once a human has
 * approved an interactive shell, the keystrokes go to the shell, and the
 * approval preview says exactly that. Pretending otherwise would be a fake
 * security control (Commandment: enforcement lives where it is real).
 *
 * Measured (bun 1.3.14, Linux): an interactive bash ignores SIGTERM, so
 * `proc.kill()` alone never ends a session; SIGHUP ends the shell AND its
 * foreground job (sleep 30) in ~1 ms, as does closing the PTY master.
 */

import { existsSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";

export const PTY_MAX_SESSIONS = 8;
export const PTY_MAX_INPUT_BYTES = 64 * 1024;
export const PTY_MIN_COLS = 2;
export const PTY_MAX_COLS = 500;
export const PTY_MIN_ROWS = 1;
export const PTY_MAX_ROWS = 300;
/** Session output not yet read by the client past this many bytes is dropped (and reported). */
export const PTY_OUTPUT_HIGH_WATER_BYTES = 4 * 1024 * 1024;
/** SIGHUP → this long → SIGKILL. */
export const PTY_KILL_GRACE_MS = 2_000;

/** XR-internal credentials never reach the user's shell environment. */
const ENV_DENY = /^XR_.*(TOKEN|PASSPHRASE|SECRET)$/i;

export interface PtyExit {
  code: number | null;
  signal: string | null;
}

export interface PtyOpenOptions {
  /** Absolute, already-validated working directory (inside the project root). */
  cwd: string;
  cols: number;
  rows: number;
  /** Decoded terminal output (UTF-8, streaming decoder — partial sequences are held). */
  onData(text: string): void;
  onExit(exit: PtyExit): void;
  /** Called once when output was dropped because the client fell behind, with the byte count so far. */
  onDropped?(bytes: number): void;
  /** Test seam: shell argv override. Production resolves `defaultShell()`. */
  argv?: string[];
  env?: Record<string, string | undefined>;
}

/** The platform's interactive shell — the same choice the CLI's shell tool makes. */
export function defaultShell(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  if (platform === "win32") {
    return [env.ComSpec || env.COMSPEC || "cmd.exe"];
  }
  const candidate = env.SHELL;
  if (candidate && isExecutableFile(candidate)) return [candidate];
  return ["/bin/sh"];
}

function isExecutableFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The user's environment, minus XR credentials, plus a truthful TERM. */
export function shellEnvironment(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined) continue;
    if (ENV_DENY.test(k)) continue;
    out[k] = v;
  }
  out.TERM = "xterm-256color";
  out.COLORTERM = "truecolor";
  out.XR_TERMINAL = "1";
  return out;
}

export function clampSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
  const c = typeof cols === "number" && Number.isFinite(cols) ? Math.round(cols) : 80;
  const r = typeof rows === "number" && Number.isFinite(rows) ? Math.round(rows) : 24;
  return {
    cols: Math.min(PTY_MAX_COLS, Math.max(PTY_MIN_COLS, c)),
    rows: Math.min(PTY_MAX_ROWS, Math.max(PTY_MIN_ROWS, r)),
  };
}

type BunTerminal = {
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  close(): void;
};

export class PtySession {
  readonly id = randomUUID();
  readonly startedAt = Date.now();
  readonly pid: number;
  readonly cwd: string;
  readonly shell: string;
  cols: number;
  rows: number;
  exit: PtyExit | null = null;
  /** Bytes the client has not consumed (route decrements as it flushes). */
  pendingBytes = 0;
  droppedBytes = 0;
  private droppedReported = false;
  private readonly proc: Bun.Subprocess;
  private readonly term: BunTerminal;
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  private readonly opts: PtyOpenOptions;

  constructor(opts: PtyOpenOptions) {
    this.opts = opts;
    const size = clampSize(opts.cols, opts.rows);
    this.cols = size.cols;
    this.rows = size.rows;
    this.cwd = opts.cwd;
    const argv = opts.argv ?? defaultShell();
    this.shell = argv[0]!;
    const env = shellEnvironment(opts.env ?? process.env);
    const proc = Bun.spawn(argv, {
      cwd: opts.cwd,
      env,
      windowsHide: true,
      terminal: {
        cols: this.cols,
        rows: this.rows,
        name: "xterm-256color",
        data: (_t: unknown, chunk: Uint8Array) => this.onChunk(chunk),
        exit: () => {
          /* PTY stream closed — the process exit below is the authority */
        },
      },
    } as Parameters<typeof Bun.spawn>[1]);
    this.proc = proc;
    this.pid = proc.pid;
    this.term = (proc as unknown as { terminal: BunTerminal }).terminal;
    void proc.exited.then((code) => {
      this.exit = { code, signal: proc.signalCode ?? null };
      // Flush any bytes the streaming decoder still holds.
      const tail = this.decoder.decode();
      if (tail) this.opts.onData(tail);
      this.opts.onExit(this.exit);
    });
  }

  private onChunk(chunk: Uint8Array): void {
    if (this.pendingBytes > PTY_OUTPUT_HIGH_WATER_BYTES) {
      this.droppedBytes += chunk.length;
      if (!this.droppedReported) {
        this.droppedReported = true;
        this.opts.onDropped?.(this.droppedBytes);
      }
      return;
    }
    const text = this.decoder.decode(chunk, { stream: true });
    if (!text) return;
    this.pendingBytes += chunk.length;
    this.opts.onData(text);
  }

  /** The route calls this once the client has consumed `bytes` of output. */
  consumed(bytes: number): void {
    this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
    if (this.pendingBytes <= PTY_OUTPUT_HIGH_WATER_BYTES / 2) this.droppedReported = false;
  }

  get alive(): boolean {
    return this.exit === null;
  }

  write(data: string): void {
    if (!this.alive) throw new Error("session has exited");
    if (Buffer.byteLength(data, "utf8") > PTY_MAX_INPUT_BYTES) throw new Error(`input exceeds ${PTY_MAX_INPUT_BYTES} bytes`);
    this.term.write(data);
  }

  resize(cols: number, rows: number): { cols: number; rows: number } {
    if (!this.alive) throw new Error("session has exited");
    const size = clampSize(cols, rows);
    this.term.resize(size.cols, size.rows);
    this.cols = size.cols;
    this.rows = size.rows;
    return size;
  }

  /**
   * End the session the way a closing terminal window does: SIGHUP to the
   * shell (which forwards it to its foreground job), SIGKILL if it is still
   * alive after the grace period. Windows has no SIGHUP: the console is
   * closed and the process terminated.
   */
  async kill(graceMs = PTY_KILL_GRACE_MS): Promise<PtyExit> {
    if (this.exit) return this.exit;
    try {
      if (process.platform === "win32") {
        try {
          this.term.close();
        } catch {
          /* already closed */
        }
        this.proc.kill();
      } else {
        this.proc.kill("SIGHUP");
      }
    } catch {
      /* already gone */
    }
    const exited = await Promise.race([this.proc.exited.then(() => true), Bun.sleep(graceMs).then(() => false)]);
    if (!exited) {
      try {
        this.proc.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      await this.proc.exited;
    }
    try {
      this.term.close();
    } catch {
      /* already closed */
    }
    return this.exit ?? { code: null, signal: "SIGKILL" };
  }

  summary(): PtySessionSummary {
    return {
      id: this.id,
      pid: this.pid,
      cwd: this.cwd,
      shell: this.shell,
      cols: this.cols,
      rows: this.rows,
      startedAt: this.startedAt,
      alive: this.alive,
      exit: this.exit,
      droppedBytes: this.droppedBytes,
    };
  }
}

export interface PtySessionSummary {
  id: string;
  pid: number;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  startedAt: number;
  alive: boolean;
  exit: PtyExit | null;
  droppedBytes: number;
}

export class PtySessionRegistry {
  private readonly sessions = new Map<string, PtySession>();
  constructor(readonly maxSessions = PTY_MAX_SESSIONS) {}

  get size(): number {
    return this.sessions.size;
  }

  open(opts: PtyOpenOptions): PtySession {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`terminal session cap reached (${this.maxSessions}); close one first`);
    }
    const session = new PtySession({
      ...opts,
      onExit: (exit) => {
        this.sessions.delete(session.id);
        opts.onExit(exit);
      },
    });
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  list(): PtySessionSummary[] {
    return [...this.sessions.values()].map((s) => s.summary());
  }

  async close(id: string): Promise<PtyExit | null> {
    const s = this.sessions.get(id);
    if (!s) return null;
    const exit = await s.kill();
    this.sessions.delete(id);
    return exit;
  }

  /** Daemon shutdown: every shell gets the closing-window treatment. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)));
  }
}

/** One registry per daemon process (routes are stateless functions). */
let registry: PtySessionRegistry | null = null;
export function getPtyRegistry(): PtySessionRegistry {
  registry ??= new PtySessionRegistry();
  return registry;
}
/** Test seam. */
export function resetPtyRegistryForTests(): void {
  registry = null;
}
