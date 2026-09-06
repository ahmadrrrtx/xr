/**
 * XR 4.2 — Isolated long-lived process spawn (for MCP stdio servers).
 *
 * Unlike the ephemeral per-action namespace sandbox, this spawns a LONG-LIVED
 * child (an MCP stdio server) inside a bubblewrap namespace for its whole
 * lifetime. stdio pipes pass straight through bwrap, so the JSON-RPC over
 * stdin/stdout works unchanged while the server process is confined:
 *   - minimal rebuilt root (host home/secrets absent),
 *   - ambient env stripped (only the caller-provided allow-listed env is set),
 *   - network NONE by default (opt-in via allowNet),
 *   - only an explicit writable root (the workspace) exposed read/write.
 *
 * bubblewrap is the supported mechanism for long-lived isolation. If it is not
 * present, `buildIsolatedStdioSpawn` returns null and the caller fails closed
 * for high-risk servers (or uses the existing confined spawn with an explicit,
 * warned acknowledgment). The raw-`unshare` fallback is for ephemeral per-action
 * runs only and is NOT used for long-lived servers.
 */
import { existsSync, lstatSync, readlinkSync } from "node:fs";
import { runChild } from "./environment/backend.ts";

let bwrapAvailable: boolean | null = null;

/** Detect bubblewrap (cached). */
export async function detectBwrap(): Promise<boolean> {
  if (bwrapAvailable !== null) return bwrapAvailable;
  if (process.getuid?.() === 0) {
    bwrapAvailable = false;
    return false;
  }
  const probe = await runChild({
    argv: ["bwrap", "--version"],
    cwd: "/",
    env: { PATH: "/usr/bin:/bin" },
    timeoutMs: 5000,
    maxOutputBytes: 4096,
  });
  bwrapAvailable = probe.exitCode === 0;
  return bwrapAvailable;
}

/** Test hook: reset the cached detection (used to simulate unavailability). */
export function _resetBwrapDetection(): void {
  bwrapAvailable = null;
}

export interface IsolatedSpawnOptions {
  /** Host path bound read/write inside the sandbox (the server's workspace). */
  writableRoot?: string;
  /** Extra read-only host paths. */
  readOnlyRoots?: string[];
  /** Allow network inside the sandbox (weakens confinement; default false). */
  allowNet?: boolean;
}

export interface IsolatedSpawnSpec {
  argv: string[];
  outerEnv: Record<string, string>;
}

function isSymlink(p: string): boolean {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Build the argv to spawn `command args` inside a bubblewrap namespace with the
 * given (already allow-listed) env. Returns null if bubblewrap is unavailable
 * (callers must then fail closed for high-risk work or fall back explicitly).
 */
export async function buildIsolatedStdioSpawn(
  command: string,
  args: string[],
  env: Record<string, string>,
  opts: IsolatedSpawnOptions = {},
): Promise<IsolatedSpawnSpec | null> {
  if (!(await detectBwrap())) return null;

  const a: string[] = [
    "bwrap",
    "--unshare-user",
    "--unshare-ipc",
    "--unshare-pid",
  ];
  if (!opts.allowNet) a.push("--unshare-net"); // no network by default
  a.push(
    "--die-with-parent",
    "--new-session",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--tmpfs", "/var",
    "--tmpfs", "/home",
    "--tmpfs", "/root",
  );

  // Minimal read-only userspace (handle usrmerge symlinks).
  a.push("--ro-bind", "/usr", "/usr");
  for (const d of ["/bin", "/sbin", "/lib", "/lib64"]) {
    if (!existsSync(d)) continue;
    if (isSymlink(d)) {
      try {
        a.push("--symlink", readlinkSync(d), d);
      } catch {
        a.push("--ro-bind", d, d);
      }
    } else {
      a.push("--ro-bind", d, d);
    }
  }
  a.push("--tmpfs", "/etc");
  for (const f of ["/etc/ld.so.cache", "/etc/ld.so.conf", "/etc/nsswitch.conf", "/etc/passwd", "/etc/group", "/etc/hosts"]) {
    if (existsSync(f)) a.push("--ro-bind", f, f);
  }
  if (existsSync("/etc/ld.so.conf.d")) a.push("--ro-bind", "/etc/ld.so.conf.d", "/etc/ld.so.conf.d");

  // Writable workspace root (the ONLY host path exposed read/write).
  if (opts.writableRoot && existsSync(opts.writableRoot)) {
    a.push("--bind", opts.writableRoot, opts.writableRoot);
    a.push("--chdir", opts.writableRoot);
  }
  for (const r of opts.readOnlyRoots ?? []) {
    if (existsSync(r)) a.push("--ro-bind", r, r);
  }

  // Allow-listed env only (ambient host env is NOT inherited).
  for (const [k, v] of Object.entries(env)) {
    a.push("--setenv", k, v);
  }

  a.push("--", command, ...args);
  return { argv: a, outerEnv: { PATH: "/usr/bin:/bin" } };
}

// ── MCP server risk + placement decision ──────────────────────────────────

export type McpServerRisk = "high" | "low";

const SENSITIVE_ENV = /key|token|secret|password|passwd|credential|auth/i;

/** Classify an MCP server's risk from its config (objective facts only). */
export function mcpServerRisk(cfg: {
  transport?: string;
  apiKeyEnv?: string;
  env?: Record<string, string>;
}): McpServerRisk {
  // stdio servers run arbitrary external code as a child process; credential-
  // bearing servers are high-risk. HTTP/SSE are network clients (egress-gated
  // elsewhere) and are not child-process risk here.
  if (cfg.transport === "stdio") {
    if (cfg.apiKeyEnv) return "high";
    if (cfg.env && Object.keys(cfg.env).some((k) => SENSITIVE_ENV.test(k))) return "high";
  }
  return "low";
}

export interface McpStdioFlags {
  isolateStdio: boolean;   // XR_MCP_ISOLATE_STDIO=1 (force-isolate even low-risk)
  allowNet: boolean;       // XR_MCP_ISOLATED_NET=1
  /**
   * Phase 8 · Step 5 — a SIGNED, per-server unisolated grant from the MCP
   * allowlist (`isolation: "granted-unisolated-by:<key>"`).
   *
   * This replaces the removed `XR_MCP_ALLOW_UNISOLATED=1` environment flag.
   * The difference is not cosmetic: an env var was process-wide, anonymous,
   * unsigned and unrevocable, whereas this boolean can only be true because a
   * named ed25519 key signed a statement about THIS server id.
   */
  unisolatedGrant: boolean;
}

export type McpStdioPlacement = "isolated" | "confined" | "blocked";

/**
 * Pure placement decision for an MCP stdio server.
 *
 * High-risk servers are isolated when a sandbox exists; without one they are
 * BLOCKED unless a SIGNED per-server unisolated grant exists. Low-risk servers
 * use the existing confined spawn (or isolation when forced).
 *
 * Phase 4 · T1 — hardened mode: when `hardened` is true the escape is refused
 * entirely (policy is not confinement; a third-party process with host
 * authority is never acceptable in hardened mode). Phase 8 keeps that rule
 * exactly as it was and only changes what may open the hatch when hardened is
 * off: a signed, attributable, revocable grant instead of an env var.
 */
export function decideMcpStdioPlacement(
  risk: McpServerRisk,
  sandboxAvailable: boolean,
  flags: McpStdioFlags,
  hardened = true,
): McpStdioPlacement {
  if (risk === "high") {
    if (sandboxAvailable) return "isolated";
    if (flags.unisolatedGrant && !hardened) return "confined"; // signed per-server grant (hardened OFF)
    return "blocked"; // fail closed
  }
  // low risk
  if (sandboxAvailable && flags.isolateStdio) return "isolated";
  return "confined";
}
