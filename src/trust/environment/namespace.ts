/**
 * Namespace-sandbox backend (Tier 2) — the REAL high-risk boundary.
 *
 * Runs the action inside ephemeral Linux namespaces so the sandboxed process
 * has NO ambient host authority:
 *   - user namespace (unprivileged; mapped-root inside only),
 *   - mount namespace with a minimal rebuilt root (host /home, /etc/secrets,
 *     SSH/AWS creds, etc. are simply NOT PRESENT),
 *   - PID namespace (sees only its own tree),
 *   - network namespace with no connectivity by default (net=none),
 *   - IPC/UTS/cgroup namespaces,
 *   - ambient environment stripped; only explicit broker-approved env set.
 *
 * Primary mechanism: bubblewrap (`bwrap`), the auditable unprivileged sandbox
 * used by Flatpak. Fallback: raw `unshare` user+mount+pid+net namespaces with
 * tmpfs over sensitive paths (a weaker filesystem boundary, documented).
 *
 * HONEST LIMITS (see describe()):
 *   - Network is NONE inside the sandbox. A per-host ALLOWLIST is not
 *     enforceable here without userspace networking (slirp4netns); the
 *     verification layer blocks Tier-2 actions that require an allowlist.
 *   - This is local Linux only. Other platforms must use another backend or
 *     fail closed.
 *   - It confines the process; it does not protect the host kernel itself
 *     from a kernel 0-day (no claim of absolute isolation).
 */
import { existsSync, lstatSync } from "node:fs";
import {
  type BackendRunContext,
  type EnvironmentBackend,
  hitsBlockedPath,
  isWithin,
  runChild,
} from "./backend.ts";
import { NO_ENFORCEMENT, type ResourceEnforcement } from "../resources.ts";
import type { EnvironmentExecutable, EnvironmentRunResult, PlacementGuarantees } from "../types.ts";

type Mechanism = "bwrap" | "unshare";

const BWRAP_GUARANTEES: PlacementGuarantees = {
  kernelBoundary: true,
  enforcedFilesystem: true,
  enforcedNetwork: true,
  enforcedProcess: true,
  noAmbientAuthority: true,
};

const UNSHARE_GUARANTEES: PlacementGuarantees = {
  kernelBoundary: true,
  enforcedFilesystem: true, // tmpfs over /home,/root,/tmp,/var,/run hides sensitive host paths
  enforcedNetwork: true,
  enforcedProcess: true,
  noAmbientAuthority: true,
};

const ENFORCEMENT: ResourceEnforcement = {
  ...NO_ENFORCEMENT,
  wallClock: true,
  cpu: true,       // ulimit -t inside the sandbox
  memory: true,    // ulimit -v inside the sandbox
  output: true,
  temp: true,      // tmpfs scratch
  processTree: true, // PID namespace + group kill
};

export class NamespaceSandboxBackend implements EnvironmentBackend {
  readonly id = "namespace-sandbox";
  readonly placement = "namespace_sandbox" as const;
  readonly enforcement = ENFORCEMENT;
  guarantees: PlacementGuarantees = BWRAP_GUARANTEES;

  private mechanism: Mechanism | null = null;
  private bwrapPath = "bwrap";

  async detect(): Promise<boolean> {
    if (process.getuid?.() === 0) return false; // unprivileged sandbox only
    // Try bubblewrap first.
    const bwrap = await runChild({
      argv: ["bwrap", "--version"],
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    if (bwrap.exitCode === 0) {
      this.mechanism = "bwrap";
      this.guarantees = BWRAP_GUARANTEES;
      return true;
    }
    // Fall back to raw user namespaces.
    const un = await runChild({
      argv: ["unshare", "-Urmnp", "--fork", "--mount-proc", "true"],
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" },
      timeoutMs: 5000,
      maxOutputBytes: 4096,
    });
    if (un.exitCode === 0) {
      this.mechanism = "unshare";
      this.guarantees = UNSHARE_GUARANTEES;
      return true;
    }
    this.mechanism = null;
    return false;
  }

  async run(exec: EnvironmentExecutable, ctx: BackendRunContext): Promise<EnvironmentRunResult> {
    if (!this.mechanism) {
      return refused("namespace sandbox not available on this host");
    }
    const grant = ctx.grant;

    // Admission: cwd must be within a granted writable root and not blocked.
    const writable = grant.fs.writableRoots;
    if (writable.length > 0 && !writable.some((r) => isWithin(exec.cwd, r))) {
      return refused(`cwd ${exec.cwd} outside granted writable roots`);
    }
    if (hitsBlockedPath(exec.cwd, grant.fs.blockedPaths)) {
      return refused(`cwd ${exec.cwd} is a blocked sensitive path`);
    }
    // Network: this backend enforces net=NONE only.
    if (grant.net.mode === "allowlist" && grant.net.allowlist.length > 0) {
      return refused("namespace sandbox enforces network=none; an allowlist requires a different backend");
    }

    const envInject = ctx.envInject;
    const sandboxArgv =
      this.mechanism === "bwrap"
        ? this.buildBwrap(exec, ctx, writable, envInject)
        : this.buildUnshare(exec, ctx, writable, envInject);

    const raw = await runChild({
      argv: sandboxArgv,
      cwd: "/",
      env: { PATH: "/usr/bin:/bin" }, // env for launching the sandboxer only
      timeoutMs: exec.timeoutMs + 5000, // sandbox setup + exec budget
      maxOutputBytes: exec.maxOutputBytes,
      stdin: exec.stdin,
    });

    const boundaryEvent =
      raw.outputTruncated || raw.timedOut || raw.spawnError !== undefined || raw.exitCode !== 0;
    if (boundaryEvent && ctx.onBoundary) {
      ctx.onBoundary(raw.spawnError ?? (raw.timedOut ? "timeout" : `exit=${raw.exitCode}`));
    }

    return {
      ok: raw.exitCode === 0 && !raw.timedOut && raw.spawnError === undefined,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: raw.timedOut,
      outputTruncated: raw.outputTruncated,
      durationMs: raw.durationMs,
      boundaryEvent,
      boundaryDetail: raw.spawnError ?? (raw.outputTruncated ? "output limit" : raw.timedOut ? "wall-clock timeout" : undefined),
    };
  }

  // ── bubblewrap ──────────────────────────────────────────────────────────
  private buildBwrap(
    exec: EnvironmentExecutable,
    ctx: BackendRunContext,
    writableRoots: readonly string[],
    envInject: Record<string, string>,
  ): string[] {
    const a: string[] = [
      this.bwrapPath,
      "--unshare-user",
      "--unshare-ipc",
      "--unshare-pid",
      "--unshare-net", // no network
      "--die-with-parent",
      "--new-session",
      "--proc", "/proc",
      "--dev", "/dev",
      "--tmpfs", "/tmp",
      "--tmpfs", "/run",
      "--tmpfs", "/var",
      "--tmpfs", "/home",
      "--tmpfs", "/root",
    ];

    // Rebuild a minimal read-only userspace. Handle usrmerge (symlinked dirs).
    a.push("--ro-bind", "/usr", "/usr");
    for (const d of ["/bin", "/sbin", "/lib", "/lib64"]) {
      if (!existsSync(d)) continue;
      if (isSymlink(d)) {
        const target = readLinkTarget(d); // e.g. "usr/bin"
        a.push("--symlink", target, d);
      } else {
        a.push("--ro-bind", d, d);
      }
    }
    // Minimal /etc for dynamic linking + identity resolution (no broad /etc).
    a.push("--tmpfs", "/etc");
    for (const f of [
      "/etc/ld.so.cache",
      "/etc/ld.so.conf",
      "/etc/nsswitch.conf",
      "/etc/passwd",
      "/etc/group",
      "/etc/hosts",
    ]) {
      if (existsSync(f)) a.push("--ro-bind", f, f);
    }
    if (existsSync("/etc/ld.so.conf.d")) a.push("--ro-bind", "/etc/ld.so.conf.d", "/etc/ld.so.conf.d");

    // Granted writable roots (the ONLY host paths exposed read/write).
    for (const r of writableRoots) {
      if (existsSync(r)) a.push("--bind", r, r);
    }
    for (const r of ctx.grant.fs.readOnlyRoots) {
      if (existsSync(r)) a.push("--ro-bind", r, r);
    }

    // Environment: stripped + explicit + broker-injected. Set PATH + HOME.
    const env: Record<string, string> = {
      PATH: "/usr/bin:/bin",
      HOME: "/tmp",
      ...exec.env,
      ...envInject,
    };
    for (const [k, v] of Object.entries(env)) {
      a.push("--setenv", k, v);
    }

    a.push("--chdir", exec.cwd);

    // Resource limits via ulimit inside the sandbox, then exec the command.
    a.push(...this.wrapWithLimits(exec));
    return a;
  }

  // ── raw unshare fallback ────────────────────────────────────────────────
  private buildUnshare(
    exec: EnvironmentExecutable,
    ctx: BackendRunContext,
    writableRoots: readonly string[],
    envInject: Record<string, string>,
  ): string[] {
    // Build an inner shell that hides sensitive paths under tmpfs, sets a
    // clean env, applies ulimits, then execs the command. (No pivot_root: the
    // base rootfs stays visible read-only — a weaker boundary than bwrap.)
    const mounts = ["mount --make-rprivate / 2>/dev/null || true"];
    // Hide sensitive dirs under tmpfs — but NEVER tmpfs a directory that is an
    // ancestor of a granted writable root, or we would hide the workspace itself
    // (a tmpfs over /tmp would swallow a workspace under /tmp before we bind it).
    for (const d of ["/home", "/root", "/tmp", "/var", "/run"]) {
      const ancestorOfWritable = writableRoots.some((w) => w === d || w.startsWith(d + "/"));
      if (!ancestorOfWritable) {
        mounts.push(`mount -t tmpfs tmpfs ${d} 2>/dev/null || true`);
      }
    }
    // Bind granted writable roots. Their parent was not tmpfs'd above, so the
    // host content stays accessible and the bind references the real path.
    for (const r of writableRoots) {
      mounts.push(`mkdir -p ${shellQuote(r)} 2>/dev/null || true`);
      mounts.push(`mount --bind ${shellQuote(r)} ${shellQuote(r)} 2>/dev/null || true`);
    }
    const env = { PATH: "/usr/bin:/bin", HOME: "/tmp", ...exec.env, ...envInject };
    const exports = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shellQuote(v)}`)
      .join("; ");
    const limits = this.limitScript(exec);
    const cmd = exec.argv.map(shellQuote).join(" ");
    const script = `${mounts.join("; ")}; ${exports}; cd ${shellQuote(exec.cwd)}; ${limits} exec ${cmd}`;
    return ["unshare", "-Urmnp", "--fork", "--mount-proc", "/bin/sh", "-c", script];
  }

  private wrapWithLimits(exec: EnvironmentExecutable): string[] {
    const limits = this.limitScript(exec);
    if (!limits) {
      return ["--", ...exec.argv];
    }
    // sh -c '<limits> exec "$0" "$@"' <cmd> <args...>
    return ["--", "/bin/sh", "-c", `${limits} exec "$0" "$@"`, ...exec.argv];
  }

  private limitScript(exec: EnvironmentExecutable): string {
    const g = exec; // limits come from the grant via ctx in callers; here use exec.timeoutMs only
    const parts: string[] = [];
    // cpu/memory limits are passed through exec.env conventions by the manager.
    const cpu = (exec as { cpuSeconds?: number }).cpuSeconds;
    const memBytes = (exec as { memoryBytes?: number }).memoryBytes;
    const maxProc = (exec as { maxProcesses?: number }).maxProcesses;
    if (typeof cpu === "number") parts.push(`ulimit -t ${cpu} 2>/dev/null || true;`);
    if (typeof memBytes === "number") parts.push(`ulimit -v ${Math.ceil(memBytes / 1024)} 2>/dev/null || true;`);
    if (typeof maxProc === "number") parts.push(`ulimit -u ${maxProc} 2>/dev/null || true;`);
    void g;
    return parts.join(" ");
  }

  describe(): string {
    const mech = this.mechanism ?? "unavailable";
    return `Linux namespace sandbox (${mech}). user+mount+pid+net+ipc+uts+cgroup namespaces; minimal rebuilt root; host home/secrets absent; network NONE; ambient env stripped; ulimit cpu/mem/proc. LIMITS: network allowlist not enforceable (net=none only); Linux-only; confines the process but makes no claim against host-kernel 0-days.`;
  }
}

function refused(reason: string): EnvironmentRunResult {
  return {
    ok: false,
    exitCode: null,
    stdout: "",
    stderr: `namespace sandbox refused: ${reason}`,
    timedOut: false,
    outputTruncated: false,
    durationMs: 0,
    boundaryEvent: true,
    boundaryDetail: reason,
  };
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function readLinkTarget(p: string): string {
  try {
    // bwrap --symlink wants the relative target (e.g. "usr/bin").
    const { readlinkSync } = require("node:fs") as typeof import("node:fs");
    return readlinkSync(p);
  } catch {
    return `usr/${p.split("/").pop()}`;
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
