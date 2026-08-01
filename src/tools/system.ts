/**
 * XR — system tools: list_dir (safe), delete_file (approval), shell (sandboxed
 * + approval + dangerous-command block + dry-run aware). Fully async.
 */
import { promises as fsp } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { Tool, ToolResult } from "../core/types.ts";
import { checkAction } from "../security/guard.ts";
import { runCommand } from "../util/process.ts";
import { shellTrustSpec } from "../runtime/trust/tool-support.ts";

function safe(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

export const listDirTool: Tool = {
  name: "list_dir",
  description: "List files/folders inside a directory in the working tree.",
  parameters: { path: "string (relative dir, default '.')" },
  requiresApproval: false,
  async run(args, ctx): Promise<ToolResult> {
    const p = safe(ctx.cwd, String(args.path ?? "."));
    if (!p) return { ok: false, output: `not found: ${args.path}` };
    try {
      await fsp.access(p);
    } catch {
      return { ok: false, output: `not found: ${args.path}` };
    }
    const names = await fsp.readdir(p);
    const entries = await Promise.all(names.map(async (n) => {
      try {
        const st = await fsp.stat(join(p, n));
        return st.isDirectory() ? n + "/" : n;
      } catch {
        return n;
      }
    }));
    ctx.audit("list_dir", { path: String(args.path ?? ".") });
    return { ok: true, output: entries.join("\n") || "(empty)", data: { count: entries.length } };
  },
};

export const deleteFileTool: Tool = {
  name: "delete_file",
  description: "Delete a file inside the working tree. Requires approval.",
  parameters: { path: "string (relative path)" },
  requiresApproval: true,
  async run(args, ctx): Promise<ToolResult> {
    const p = safe(ctx.cwd, String(args.path ?? ""));
    if (!p) return { ok: false, output: "unsafe path" };
    try {
      await fsp.access(p);
    } catch {
      return { ok: false, output: `not found: ${args.path}` };
    }
    const approved = await ctx.approve({ tool: "delete_file", reason: `delete ${args.path}` });
    if (!approved) {
      ctx.audit("delete_file.denied", { path: String(args.path) });
      return { ok: false, output: "delete denied" };
    }
    if (ctx.dryRun) {
      ctx.audit("delete_file.dryrun", { path: String(args.path) });
      return { ok: true, output: `[dry-run] would delete ${args.path}` };
    }
    await fsp.rm(p);
    ctx.audit("delete_file.applied", { path: String(args.path) });
    return { ok: true, output: `deleted ${args.path}` };
  },
};

export const shellTool: Tool = {
  name: "shell",
  description: "Run a shell command in the working dir. Requires approval. Dangerous commands are blocked.",
  parameters: { cmd: "string (command line)" },
  requiresApproval: true,
  async run(args, ctx): Promise<ToolResult> {
    const cmd = String(args.cmd ?? "");
    const decision = checkAction({ tool: "shell", args: { cmd } }, {
      egressAllowlist: ctx.egressAllowlist ?? [],
      requireApproval: ["shell"],
    });
    if (!decision.allowed) {
      ctx.audit("shell.blocked", { cmd, reason: decision.reason });
      return { ok: false, output: `blocked: ${decision.reason}` };
    }
    const approved = await ctx.approve({ tool: "shell", reason: `run: ${cmd}`, preview: cmd });
    if (!approved) {
      ctx.audit("shell.denied", { cmd });
      return { ok: false, output: "shell denied" };
    }
    if (ctx.dryRun) {
      ctx.audit("shell.dryrun", { cmd });
      return { ok: true, output: `[dry-run] would run: ${cmd}` };
    }
    // XR 4.2 / Phase 4 · T1 — when the runtime provides an isolated runner,
    // execute the shell command inside a verified environment (Tier 2). This
    // FAILS CLOSED if the required isolation is unavailable; it never silently
    // runs in-process. When no isolated runner is wired (deprecated out-of-tree
    // callers), hardened mode (the default) BLOCKS the command outright — the
    // host-authority fallback exists only with hardened mode explicitly OFF
    // (compat path), and is audited as a degraded execution.
    if (ctx.runIsolated) {
      const { request, executable } = shellTrustSpec(cmd, ctx.cwd, {
        timeoutMs: 120_000,
        maxOutputBytes: 4 * 1024 * 1024,
        networkTargets: ctx.egressAllowlist ?? [],
      });
      const r = await ctx.runIsolated(request, executable);
      if (r.blocked) {
        ctx.audit("shell.isolated_blocked", { cmd, reason: r.reason });
        return { ok: false, output: `blocked: ${r.reason ?? "isolation unavailable"}` };
      }
      const out = r.stdout + r.stderr;
      ctx.audit("shell.run_isolated", { cmd, exit: r.exitCode, placement: r.placement, verified: r.verified });
      return {
        ok: r.ok,
        output: out.slice(0, 4000) || `(exit ${r.exitCode})`,
        data: { isolated: true, placement: r.placement, verified: r.verified, exit: r.exitCode },
      };
    }
    if (ctx.hardened !== false) {
      ctx.audit("shell.hardened_blocked", { cmd, reason: "no isolated runner wired and hardened mode is on" });
      return {
        ok: false,
        output: "blocked: shell requires an isolated execution environment, but none is wired (hardened mode). Set XR_TRUST_HARDENED=0 only on hosts where this is explicitly accepted.",
      };
    }
    try {
      const proc = await runCommand("bash", ["-lc", cmd], { cwd: ctx.cwd, timeoutMs: 120_000, maxBuffer: 4 * 1024 * 1024 });
      const out = proc.stdout + proc.stderr;
      ctx.audit("shell.run", { cmd, exit: proc.status });
      return { ok: proc.ok, output: out.slice(0, 4000) || `(exit ${proc.status})` };
    } catch (e) {
      return { ok: false, output: `shell error: ${(e as Error).message}` };
    }
  },
};
