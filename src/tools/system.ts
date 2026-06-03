/**
 * XR — system tools: list_dir (safe), delete_file (approval), shell (sandboxed
 * + approval + dangerous-command block + dry-run aware).
 */
import { readdirSync, statSync, existsSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute, join } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { checkAction } from "../security/guard.ts";

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
    if (!p || !existsSync(p)) return { ok: false, output: `not found: ${args.path}` };
    const entries = readdirSync(p).map((n) => {
      const isDir = statSync(join(p, n)).isDirectory();
      return isDir ? n + "/" : n;
    });
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
    if (!existsSync(p)) return { ok: false, output: `not found: ${args.path}` };
    const approved = await ctx.approve({ tool: "delete_file", reason: `delete ${args.path}` });
    if (!approved) {
      ctx.audit("delete_file.denied", { path: String(args.path) });
      return { ok: false, output: "delete denied" };
    }
    if (ctx.dryRun) {
      ctx.audit("delete_file.dryrun", { path: String(args.path) });
      return { ok: true, output: `[dry-run] would delete ${args.path}` };
    }
    rmSync(p);
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
    // Deterministic policy block FIRST (architecture > behavior).
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
    try {
      const proc = Bun.spawnSync(["bash", "-lc", cmd], { cwd: ctx.cwd });
      const out = new TextDecoder().decode(proc.stdout) + new TextDecoder().decode(proc.stderr);
      ctx.audit("shell.run", { cmd, exit: proc.exitCode });
      return { ok: proc.exitCode === 0, output: out.slice(0, 4000) || `(exit ${proc.exitCode})` };
    } catch (e) {
      return { ok: false, output: `shell error: ${(e as Error).message}` };
    }
  },
};
