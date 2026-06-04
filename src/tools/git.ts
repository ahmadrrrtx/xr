/**
 * XR — Git Integration Tools
 * 
 * Full Git workflow without leaving XR:
 * - git_status: show working tree state
 * - git_diff: show unstaged/staged changes  
 * - git_commit: stage and commit changes
 * - git_branch: list/create/switch branches
 * - git_log: show recent commits
 * - git_stash: stash/unstash working changes
 * 
 * These mirror what Claude Code does with its git integration.
 */
import { execSync, spawn } from "node:child_process";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";

// ── Safe exec that captures both stdout and stderr ─────────────────────────────
function gitExec(args: string[], cwd: string, timeout = 10000): string {
  try {
    return execSync(`git ${args.join(" ")}`, { cwd, timeout, maxBuffer: 1024 * 1024 }).toString();
  } catch (e) {
    const err = e as any;
    return err.stdout?.toString() ?? err.message ?? "Git command failed";
  }
}

function execGitAsync(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn("git", args, { cwd, timeout: 15000, maxBuffer: 1024 * 1024 });
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    proc.on("error", (e) => resolve({ stdout, stderr: (e as Error).message, exitCode: 1 }));
  });
}

// ── Git Status Tool ────────────────────────────────────────────────────────────
export const gitStatusTool: Tool = {
  name: "git_status",
  description: "Show the current Git working tree status — staged, unstaged, and untracked files.",
  parameters: {},
  requiresApproval: false,
  async run(_args, ctx) {
    const out = gitExec(["status", "--porcelain"], ctx.cwd);
    if (!out.trim()) {
      return { ok: true, output: "✓ Working tree clean — nothing to commit.", data: { clean: true } };
    }
    const lines = out.trim().split("\n");
    const staged = lines.filter(l => l.startsWith("M") || l.startsWith("A") || l.startsWith("D"));
    const unstaged = lines.filter(l => l.startsWith(" M") || l.startsWith(" D") || l.startsWith("??"));
    const parts: string[] = [];
    if (staged.length) parts.push(`${staged.length} staged: ${staged.map(l => l.slice(2)).join(", ")}`);
    if (unstaged.length) parts.push(`${unstaged.length} changed: ${unstaged.map(l => l.slice(3)).join(", ")}`);
    ctx.audit("git.status", { staged: staged.length, unstaged: unstaged.length });
    return { ok: true, output: parts.join("\n"), data: { staged: staged.length, unstaged: unstaged.length } };
  },
};

// ── Git Diff Tool ──────────────────────────────────────────────────────────────
export const gitDiffTool: Tool = {
  name: "git_diff",
  description: "Show unstaged changes. Pass a filename to diff a specific file, or leave empty for all.",
  parameters: { file: "string (optional — diff a specific file)" },
  requiresApproval: false,
  async run(args, ctx) {
    const file = args.file ? String(args.file) : "";
    const diffArgs = file ? ["diff", "--", file] : ["diff"];
    const out = gitExec(diffArgs, ctx.cwd);
    ctx.audit("git.diff", { file: args.file });
    return { ok: true, output: out || "(no changes)", data: { chars: out.length } };
  },
};

// ── Git Commit Tool ────────────────────────────────────────────────────────────
export const gitCommitTool: Tool = {
  name: "git_commit",
  description: "Stage all changes and commit with a message. Requires a commit message. Destructive — requires approval.",
  parameters: { message: "string (required — commit message)" },
  requiresApproval: true,
  async run(args, ctx) {
    const msg = String(args.message || "chore: update via XR");
    const sanitized = msg.replace(/"/g, '\\"').slice(0, 200);
    gitExec(["add", "-A"], ctx.cwd);
    const out = gitExec(["commit", "-m", sanitized], ctx.cwd);
    ctx.audit("git.commit", { message: sanitized });
    return {
      ok: out.includes("nothing to commit") ? true : !out.includes("error"),
      output: out || `Committed: "${sanitized}"`,
      data: { message: sanitized },
    };
  },
};

// ── Git Branch Tool ────────────────────────────────────────────────────────────
export const gitBranchTool: Tool = {
  name: "git_branch",
  description: "List all branches, or create/switch to a branch. Usage: list (no args), create <name>, switch <name>.",
  parameters: { action: "string ('list' | 'create' | 'switch')", name: "string (branch name)" },
  requiresApproval: false,
  async run(args, ctx) {
    const action = String(args.action || "list");
    const name = String(args.name || "");
    
    if (action === "list") {
      const out = gitExec(["branch", "-a"], ctx.cwd);
      const current = out.split("\n").find(l => l.startsWith("*"));
      return { ok: true, output: (current ? `* ${current.slice(2)}\n` : "") + out, data: { current: current?.slice(2) } };
    }
    if (action === "create" && name) {
      const out = gitExec(["checkout", "-b", name], ctx.cwd);
      ctx.audit("git.branch.create", { name });
      return { ok: true, output: `Created and switched to branch: ${name}`, data: { name } };
    }
    if (action === "switch" && name) {
      const out = gitExec(["checkout", name], ctx.cwd);
      ctx.audit("git.branch.switch", { name });
      return { ok: true, output: `Switched to branch: ${name}`, data: { name } };
    }
    return { ok: false, output: `Usage: git_branch(action='list'|'create'|'switch', name='branch-name')` };
  },
};

// ── Git Log Tool ───────────────────────────────────────────────────────────────
export const gitLogTool: Tool = {
  name: "git_log",
  description: "Show recent commit history. Pass a number for how many commits to show (default: 10).",
  parameters: { count: "number (how many commits to show, default 10)" },
  requiresApproval: false,
  async run(args, ctx) {
    const n = Math.min(Number(args.count ?? 10), 50);
    const out = gitExec(["log", `--oneline`, `-n${n}`, `--format=%h %s (%an)`], ctx.cwd);
    ctx.audit("git.log", { count: n });
    return { ok: true, output: out || "(no commits)", data: { count: n } };
  },
};

// ── Git Stash Tool ─────────────────────────────────────────────────────────────
export const gitStashTool: Tool = {
  name: "git_stash",
  description: "Stash current changes (save without committing) or restore stashed changes.",
  parameters: { action: "string ('save' | 'pop' | 'list' | 'drop')", message: "string (optional stash description)" },
  requiresApproval: true,
  async run(args, ctx) {
    const action = String(args.action || "save");
    const msg = String(args.message || "");
    
    if (action === "save") {
      const stashArgs = msg ? ["stash", "push", "-m", msg] : ["stash", "push"];
      const out = gitExec(stashArgs, ctx.cwd);
      ctx.audit("git.stash.save", { message: msg });
      return { ok: true, output: out || "✓ Changes stashed", data: { action: "save" } };
    }
    if (action === "pop") {
      const out = gitExec(["stash", "pop"], ctx.cwd);
      ctx.audit("git.stash.pop", {});
      return { ok: true, output: out || "✓ Stashed changes restored", data: { action: "pop" } };
    }
    if (action === "list") {
      const out = gitExec(["stash", "list"], ctx.cwd);
      return { ok: true, output: out || "(no stashed changes)", data: { action: "list" } };
    }
    return { ok: false, output: "Usage: git_stash(action='save'|'pop'|'list', message='...')" };
  },
};

// ── Git Push/Pull ───────────────────────────────────────────────────────────────
export const gitPushTool: Tool = {
  name: "git_push",
  description: "Push commits to remote. Specify branch or push current branch.",
  parameters: { branch: "string (optional — branch name)", remote: "string (default 'origin')" },
  requiresApproval: true,
  async run(args, ctx) {
    const branch = String(args.branch || "");
    const remote = String(args.remote || "origin");
    const pushArgs = branch ? ["push", remote, branch] : ["push"];
    const out = gitExec(pushArgs, ctx.cwd);
    ctx.audit("git.push", { remote, branch });
    return { ok: !out.toLowerCase().includes("error"), output: out || "✓ Pushed", data: { remote, branch } };
  },
};

export const gitPullTool: Tool = {
  name: "git_pull",
  description: "Pull commits from remote. Specify branch or pull current branch.",
  parameters: { branch: "string (optional — branch name)", remote: "string (default 'origin')" },
  requiresApproval: true,
  async run(args, ctx) {
    const branch = String(args.branch || "");
    const remote = String(args.remote || "origin");
    const pullArgs = branch ? ["pull", remote, branch] : ["pull"];
    const out = gitExec(pullArgs, ctx.cwd);
    ctx.audit("git.pull", { remote, branch });
    return { ok: !out.toLowerCase().includes("error"), output: out || "✓ Pulled", data: { remote, branch } };
  },
};

// ── All Git Tools ──────────────────────────────────────────────────────────────
export const GIT_TOOLS: Tool[] = [
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitBranchTool,
  gitLogTool,
  gitStashTool,
  gitPushTool,
  gitPullTool,
];
