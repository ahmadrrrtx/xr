/**
 * Phase 17 · Builder — engine-managed dev servers.
 *
 * One child process per project, owned by the daemon so it dies with the
 * daemon (and with the window that started it): `stop()` SIGTERMs the whole
 * process tree (npm → sh → vite), waits two seconds, then SIGKILLs it;
 * `stopAll()` runs on daemon shutdown and a synchronous kill runs on
 * `process.exit`. Output is kept in a ring buffer
 * (the Console pane replays it) and fanned out to subscribers as SSE
 * events. Readiness is NOT guessed from a timer: the first
 * `http://localhost:PORT`-style URL the tool prints is the signal, and
 * "Ready in N ms" is measured by the engine from spawn to that line.
 *
 * Static sites (a root `index.html`, no toolchain) are served in-process by
 * `Bun.serve` on a free loopback port — no Python, no npm, nothing to
 * install.
 *
 * Detection is a pure function over a small file-system seam so the matrix
 * is unit-tested without fixtures on disk.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

import { killTree, killTreeSync } from "./proc-tree";

export type DevServerKind = "vite" | "next" | "cra" | "node" | "cargo" | "django" | "flask" | "python" | "static" | "none";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface DetectedDevServer {
  kind: DevServerKind;
  label: string;
  /** Shell-free argv to spawn; null when nothing can be started automatically. */
  argv: string[] | null;
  /** Display form of the command (what the approval shows). */
  cmd: string | null;
  pm: PackageManager;
  needsInstall: boolean;
  installArgv: string[] | null;
  hint: string;
}

export interface DetectFs {
  exists(rel: string): boolean;
  readText(rel: string): string | null;
  which(bin: string): boolean;
}

export function realDetectFs(root: string): DetectFs {
  return {
    exists: (rel) => existsSync(join(root, rel)),
    readText: (rel) => {
      try {
        return readFileSync(join(root, rel), "utf8");
      } catch {
        return null;
      }
    },
    which: (bin) => Boolean(Bun.which(bin)),
  };
}

function packageManagerFor(fs: DetectFs): PackageManager {
  const byLock: PackageManager = fs.exists("bun.lock") || fs.exists("bun.lockb") ? "bun" : fs.exists("pnpm-lock.yaml") ? "pnpm" : fs.exists("yarn.lock") ? "yarn" : "npm";
  if (fs.which(byLock)) return byLock;
  for (const alt of ["npm", "bun", "pnpm", "yarn"] as const) if (fs.which(alt)) return alt;
  return byLock;
}

function runScript(pm: PackageManager, script: string): string[] {
  if (pm === "yarn") return ["yarn", script];
  return [pm, "run", script];
}

function execBin(pm: PackageManager, bin: string, args: string[]): string[] {
  if (pm === "bun") return ["bunx", bin, ...args];
  if (pm === "pnpm") return ["pnpm", "exec", bin, ...args];
  if (pm === "yarn") return ["yarn", bin, ...args];
  return ["npx", "--no-install", bin, ...args];
}

export function detectDevServer(fs: DetectFs): DetectedDevServer {
  const pkgText = fs.readText("package.json");
  if (pkgText !== null) {
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(pkgText) as typeof pkg;
    } catch {
      /* unreadable package.json → treated as a node project with no scripts */
    }
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const scripts = pkg.scripts ?? {};
    const pm = packageManagerFor(fs);
    const needsInstall = !fs.exists("node_modules");
    const installArgv = [pm, "install"];
    const base = { pm, needsInstall, installArgv };
    const hasDev = typeof scripts.dev === "string";
    const hasStart = typeof scripts.start === "string";
    if ("next" in deps) {
      const argv = hasDev ? runScript(pm, "dev") : execBin(pm, "next", ["dev"]);
      return { kind: "next", label: "Next.js", argv, cmd: argv.join(" "), hint: "Next.js project — runs the dev server.", ...base };
    }
    if ("vite" in deps || fs.exists("vite.config.ts") || fs.exists("vite.config.js") || fs.exists("vite.config.mjs")) {
      const argv = hasDev ? runScript(pm, "dev") : execBin(pm, "vite", []);
      return { kind: "vite", label: "Vite", argv, cmd: argv.join(" "), hint: "Vite project — runs the dev server with hot reload.", ...base };
    }
    if ("react-scripts" in deps) {
      const argv = hasStart ? runScript(pm, "start") : execBin(pm, "react-scripts", ["start"]);
      return { kind: "cra", label: "Create React App", argv, cmd: argv.join(" "), hint: "react-scripts project — runs `start` without opening a browser.", ...base };
    }
    if (hasDev || hasStart) {
      const script = hasDev ? "dev" : "start";
      const argv = runScript(pm, script);
      return { kind: "node", label: `${pm} run ${script}`, argv, cmd: argv.join(" "), hint: `Runs the package's \`${script}\` script.`, ...base };
    }
    if (fs.exists("index.html")) {
      return { kind: "static", label: "Static site", argv: null, cmd: "xr static server", hint: "No dev script — serving index.html statically.", ...base, needsInstall: false, installArgv: null };
    }
    return { kind: "none", label: "No dev script", argv: null, cmd: null, hint: "package.json has no `dev` or `start` script. Add one, or start a server from the terminal.", ...base };
  }
  const noPm = { pm: "npm" as const, needsInstall: false, installArgv: null };
  if (fs.exists("Cargo.toml")) {
    return { kind: "cargo", label: "Cargo", argv: ["cargo", "run"], cmd: "cargo run", hint: "Rust project — `cargo run`; the preview shows a URL only if the program prints one.", ...noPm };
  }
  if (fs.exists("manage.py")) {
    const py = fs.which("python3") ? "python3" : "python";
    const argv = [py, "manage.py", "runserver", "127.0.0.1:8000"];
    return { kind: "django", label: "Django", argv, cmd: argv.join(" "), hint: "Django project — runserver on port 8000.", ...noPm };
  }
  const req = fs.readText("requirements.txt") ?? fs.readText("pyproject.toml");
  if (req !== null) {
    const py = fs.which("python3") ? "python3" : "python";
    if (/flask/i.test(req)) {
      const argv = [py, "-m", "flask", "run", "--port", "5000"];
      return { kind: "flask", label: "Flask", argv, cmd: argv.join(" "), hint: "Flask project — `flask run` on port 5000 (set FLASK_APP if it is not app.py).", ...noPm };
    }
    const entry = ["app.py", "main.py", "server.py"].find((f) => fs.exists(f));
    if (entry) {
      const argv = [py, entry];
      return { kind: "python", label: `python ${entry}`, argv, cmd: argv.join(" "), hint: `Python project — runs ${entry}; the preview needs it to print its URL.`, ...noPm };
    }
  }
  if (fs.exists("index.html")) {
    return { kind: "static", label: "Static site", argv: null, cmd: "xr static server", hint: "Serving index.html statically from the project root.", ...noPm };
  }
  return { kind: "none", label: "Nothing to run", argv: null, cmd: null, hint: "No dev server detected. Start one from the terminal, then set the preview URL.", ...noPm };
}

/* ── readiness parsing ────────────────────────────────────────────────── */

const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\])(?::(\d+))?(\/[^\s"'<>)]*)?/i;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

/** First loopback URL in a log line → normalised `http://localhost:PORT/`, or null. */
export function parseReadyUrl(line: string): { port: number; url: string } | null {
  const m = URL_RE.exec(stripAnsi(line));
  if (!m) return null;
  const port = m[1] ? Number(m[1]) : 80;
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) return null;
  const path = m[2] && m[2] !== "/" ? m[2] : "/";
  return { port, url: `http://localhost:${port}${path}` };
}

export type LogStream = "stdout" | "stderr" | "system";
export interface DevServerLogLine {
  seq: number;
  ts: number;
  stream: LogStream;
  line: string;
}

export type DevServerEvent =
  | { type: "dev-server:log"; projectId: string; entry: DevServerLogLine }
  | { type: "dev-server:ready"; projectId: string; port: number; url: string; ms: number }
  | { type: "dev-server:exit"; projectId: string; code: number | null; signal: string | null; job: "server" | "install" }
  | { type: "dev-server:status"; projectId: string; status: DevServerStatus };

export interface DevServerStatus {
  state: "stopped" | "starting" | "running" | "exited";
  installing: boolean;
  kind: DevServerKind | null;
  cmd: string | null;
  pid: number | null;
  port: number | null;
  url: string | null;
  startedAt: number | null;
  readyMs: number | null;
  exit: { code: number | null; signal: string | null } | null;
}

const RING = 600;
const KILL_GRACE_MS = 2_000;

interface Managed {
  projectId: string;
  root: string;
  status: DevServerStatus;
  proc: Bun.Subprocess | null;
  install: Bun.Subprocess | null;
  staticServer: ReturnType<typeof Bun.serve> | null;
  log: DevServerLogLine[];
  seq: number;
  listeners: Set<(e: DevServerEvent) => void>;
}

export async function findFreePort(start = 5173, attempts = 50): Promise<number> {
  for (let p = start; p < start + attempts; p += 1) {
    const free = await new Promise<boolean>((done) => {
      const srv = createServer();
      srv.once("error", () => done(false));
      srv.listen({ port: p, host: "127.0.0.1" }, () => srv.close(() => done(true)));
    });
    if (free) return p;
  }
  throw new Error(`no free port between ${start} and ${start + attempts}`);
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json", ".wasm": "application/wasm",
};

/** Resolve a request path strictly inside root; directories fall back to index.html. */
export function staticFileFor(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return null;
  }
  const target = resolve(root, "." + normalize("/" + decoded));
  if (target !== root && !target.startsWith(root + sep)) return null;
  try {
    const st = statSync(target);
    if (st.isDirectory()) {
      const index = join(target, "index.html");
      return existsSync(index) ? index : null;
    }
    return st.isFile() ? target : null;
  } catch {
    return null;
  }
}

export class DevServerRegistry {
  private readonly servers = new Map<string, Managed>();

  private entry(projectId: string, root: string): Managed {
    let m = this.servers.get(projectId);
    if (!m) {
      m = {
        projectId,
        root,
        status: { state: "stopped", installing: false, kind: null, cmd: null, pid: null, port: null, url: null, startedAt: null, readyMs: null, exit: null },
        proc: null,
        install: null,
        staticServer: null,
        log: [],
        seq: 0,
        listeners: new Set(),
      };
      this.servers.set(projectId, m);
    }
    return m;
  }

  status(projectId: string): DevServerStatus | null {
    return this.servers.get(projectId)?.status ?? null;
  }

  logTail(projectId: string, n = 200): DevServerLogLine[] {
    const m = this.servers.get(projectId);
    return m ? m.log.slice(-n) : [];
  }

  subscribe(projectId: string, root: string, fn: (e: DevServerEvent) => void): () => void {
    const m = this.entry(projectId, root);
    m.listeners.add(fn);
    return () => m.listeners.delete(fn);
  }

  private emit(m: Managed, e: DevServerEvent): void {
    for (const l of m.listeners) {
      try {
        l(e);
      } catch {
        /* listener errors never break the server */
      }
    }
  }

  private push(m: Managed, stream: LogStream, line: string): void {
    m.seq += 1;
    const entry: DevServerLogLine = { seq: m.seq, ts: Date.now(), stream, line: stripAnsi(line).slice(0, 4_000) };
    m.log.push(entry);
    if (m.log.length > RING) m.log.splice(0, m.log.length - RING);
    this.emit(m, { type: "dev-server:log", projectId: m.projectId, entry });
  }

  private setStatus(m: Managed, patch: Partial<DevServerStatus>): void {
    m.status = { ...m.status, ...patch };
    this.emit(m, { type: "dev-server:status", projectId: m.projectId, status: m.status });
  }

  /** Pump a pipe into the log, line by line; `onLine` sees clean text. */
  private pump(m: Managed, stream: ReadableStream<Uint8Array> | null | undefined, name: "stdout" | "stderr", onLine?: (line: string) => void): Promise<void> {
    if (!stream) return Promise.resolve();
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const flush = (final: boolean) => {
      const parts = buf.split(/\r?\n|\r/);
      buf = final ? "" : (parts.pop() ?? "");
      for (const p of parts) {
        if (!p.trim()) continue;
        this.push(m, name, p);
        onLine?.(stripAnsi(p));
      }
      if (final && buf.trim()) {
        this.push(m, name, buf);
        onLine?.(stripAnsi(buf));
        buf = "";
      }
    };
    return (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          if (buf.length > 64_000) buf = buf.slice(-64_000);
          flush(false);
        }
        flush(true);
      } catch {
        /* pipe closed */
      }
    })();
  }

  private childEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (typeof v === "string") env[k] = v;
    env.FORCE_COLOR = "0";
    env.NO_COLOR = "1";
    env.BROWSER = "none";
    delete env.PORT;
    return env;
  }

  /** Start the detected server. Throws when one is already running or the kind cannot be started. */
  async start(projectId: string, root: string, detected: DetectedDevServer): Promise<DevServerStatus> {
    const m = this.entry(projectId, root);
    if (m.status.state === "starting" || m.status.state === "running") throw new Error("dev server already running");
    m.log = [];
    m.seq = 0;
    const startedAt = Date.now();
    m.status = { ...m.status, exit: null, pid: null, port: null, url: null, readyMs: null };

    if (detected.kind === "static") {
      const port = await findFreePort(8000);
      const server = Bun.serve({
        hostname: "127.0.0.1",
        port,
        fetch: (req) => {
          const file = staticFileFor(root, new URL(req.url).pathname);
          if (!file) return new Response("Not found", { status: 404 });
          const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
          return new Response(Bun.file(file), { headers: { "content-type": type, "cache-control": "no-store" } });
        },
      });
      m.staticServer = server;
      const url = `http://localhost:${port}/`;
      this.push(m, "system", `Serving ${root} at ${url}`);
      this.setStatus(m, { state: "running", kind: "static", cmd: detected.cmd, pid: null, port, url, startedAt, readyMs: Date.now() - startedAt });
      this.emit(m, { type: "dev-server:ready", projectId, port, url, ms: m.status.readyMs ?? 0 });
      return m.status;
    }

    if (!detected.argv) throw new Error("nothing to start for this project");
    const [bin, ...args] = detected.argv;
    if (!bin || !Bun.which(bin)) throw new Error(`${bin ?? "command"} is not installed or not on PATH`);
    let proc: Bun.Subprocess;
    try {
      proc = Bun.spawn([bin, ...args], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: this.childEnv(), windowsHide: true });
    } catch (e) {
      throw new Error(`spawn failed: ${(e as Error).message}`);
    }
    m.proc = proc;
    this.push(m, "system", `$ ${detected.cmd}`);
    this.setStatus(m, { state: "starting", kind: detected.kind, cmd: detected.cmd, pid: proc.pid, startedAt });

    const onLine = (line: string) => {
      if (m.status.state !== "starting") return;
      const ready = parseReadyUrl(line);
      if (!ready) return;
      const ms = Date.now() - startedAt;
      this.setStatus(m, { state: "running", port: ready.port, url: ready.url, readyMs: ms });
      this.emit(m, { type: "dev-server:ready", projectId, port: ready.port, url: ready.url, ms });
    };
    void this.pump(m, proc.stdout as ReadableStream<Uint8Array>, "stdout", onLine);
    void this.pump(m, proc.stderr as ReadableStream<Uint8Array>, "stderr", onLine);
    void proc.exited.then((code) => {
      if (m.proc !== proc) return;
      m.proc = null;
      const signal = proc.signalCode ?? null;
      this.push(m, "system", `exited (${signal ?? `code ${code}`})`);
      this.setStatus(m, { state: "exited", pid: null, exit: { code, signal } });
      this.emit(m, { type: "dev-server:exit", projectId, code, signal, job: "server" });
    });
    return m.status;
  }

  async stop(projectId: string): Promise<boolean> {
    const m = this.servers.get(projectId);
    if (!m) return false;
    let stopped = false;
    if (m.staticServer) {
      try {
        m.staticServer.stop(true);
      } catch {
        /* already stopped */
      }
      m.staticServer = null;
      stopped = true;
    }
    const proc = m.proc;
    if (proc) {
      m.proc = null;
      stopped = true;
      // Whole tree: `npm run dev` is only the wrapper around the listener.
      await killTree(proc.pid, KILL_GRACE_MS);
    }
    if (stopped) {
      this.push(m, "system", "stopped");
      this.setStatus(m, { state: "stopped", pid: null, port: null, url: null, readyMs: null, exit: null });
    }
    return stopped;
  }

  /** `<pm> install` streamed into the same log; resolves with the exit code. */
  async install(projectId: string, root: string, argv: string[]): Promise<number | null> {
    const m = this.entry(projectId, root);
    if (m.install) throw new Error("install already running");
    const [bin, ...args] = argv;
    if (!bin || !Bun.which(bin)) throw new Error(`${bin ?? "package manager"} is not installed or not on PATH`);
    const proc = Bun.spawn([bin, ...args], { cwd: root, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: this.childEnv(), windowsHide: true });
    m.install = proc;
    this.push(m, "system", `$ ${argv.join(" ")}`);
    this.setStatus(m, { installing: true });
    await Promise.all([this.pump(m, proc.stdout as ReadableStream<Uint8Array>, "stdout"), this.pump(m, proc.stderr as ReadableStream<Uint8Array>, "stderr")]);
    const code = await proc.exited;
    m.install = null;
    this.push(m, "system", `install exited (code ${code})`);
    this.setStatus(m, { installing: false });
    this.emit(m, { type: "dev-server:exit", projectId, code, signal: proc.signalCode ?? null, job: "install" });
    return code;
  }

  running(): number {
    return [...this.servers.values()].filter((m) => m.proc !== null || m.staticServer !== null).length;
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.servers.keys()].map((id) => this.stop(id)));
  }

  /** Synchronous last resort for `process.exit` — no awaiting possible there. */
  killAllSync(): void {
    for (const m of this.servers.values()) {
      if (m.proc) killTreeSync(m.proc.pid);
      if (m.install) killTreeSync(m.install.pid);
      try {
        m.staticServer?.stop(true);
      } catch {
        /* gone */
      }
    }
  }
}

let registry: DevServerRegistry | null = null;
let exitHooked = false;
export function getDevServers(): DevServerRegistry {
  if (!registry) {
    registry = new DevServerRegistry();
    if (!exitHooked) {
      exitHooked = true;
      process.once("exit", () => registry?.killAllSync());
    }
  }
  return registry;
}
export function resetDevServersForTests(): void {
  registry?.killAllSync();
  registry = null;
}
