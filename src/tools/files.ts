/**
 * XR — file tools: read_file (safe) and write_file (diff + approval gate).
 * write_file NEVER touches disk without explicit human approval.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { readTrustRequest, workspaceWriteTrustRequest } from "../runtime/trust/tool-support.ts";
import { classifySensitiveWrite } from "../security/trust-handoff.ts";

/** Keep the agent inside its working directory (no escaping with ../). */
function safePath(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes working directory: ${p}`);
  }
  return abs;
}

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the working directory.",
  parameters: { path: "string (relative path)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("read_file", ctx.cwd),
  async run(args, ctx): Promise<ToolResult> {
    const p = safePath(ctx.cwd, String(args.path ?? ""));
    if (!existsSync(p)) return { ok: false, output: `file not found: ${args.path}` };
    const content = readFileSync(p, "utf8");
    ctx.audit("read_file", { path: String(args.path) });
    const clipped = content.length > 4000 ? content.slice(0, 4000) + "\n…(truncated)" : content;
    return { ok: true, output: clipped, data: { length: content.length } };
  },
};

/** Minimal line-based diff for the approval preview. */
function makeDiff(oldText: string, newText: string): string {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out.join("\n") || "(no textual change)";
}

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create or overwrite a text file inside the working directory. Requires approval.",
  parameters: { path: "string (relative path)", content: "string (full new content)" },
  requiresApproval: true,
  trustRequest: (args, ctx) => workspaceWriteTrustRequest("write_file", ctx.cwd, [String(args.path ?? "")]),
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const p = safePath(ctx.cwd, String(args.path ?? ""));
    const newContent = String(args.content ?? "");
    const old = existsSync(p) ? readFileSync(p, "utf8") : "";
    const diff = makeDiff(old, newContent);

    // Phase 07 · Trust Handoff — writes to sensitive/executable config files
    // (.git/config, .git/hooks/*, .claude/settings.local.json, .vscode/tasks.json,
    // *.code-workspace, package.json scripts, CI, Dockerfile, shell rc, …) are
    // consumed and EXECUTED by a trusted external component OUTSIDE XR's sandbox
    // after the turn ends. Surface an explicit, informed human approval that
    // shows the trusted consumer and the execution implication. We never
    // silently block legitimate files, and the model's own "approval" never
    // counts as the required human approval.
    const trust = classifySensitiveWrite(String(args.path ?? ""), ctx.cwd);
    if (trust.requiresApproval) {
      ctx.audit("write_file.trust_handoff", {
        path: String(args.path),
        classification: trust.classification,
        ruleId: trust.ruleId,
      });
    }

    const approved = await ctx.approve({
      tool: "write_file",
      reason: trust.requiresApproval
        ? `TRUST-HANDOFF WRITE [${trust.classification}] ${existsSync(p) ? "overwrite" : "create"} ${args.path} — consumed by: ${trust.trustedComponent}. ${trust.reason}`
        : existsSync(p)
          ? `overwrite ${args.path}`
          : `create ${args.path}`,
      preview: trust.requiresApproval ? `${trust.executionImplication ?? ""}\n\n--- diff ---\n${diff}` : diff,
    });
    if (!approved) {
      ctx.audit("write_file.denied", { path: String(args.path) });
      return { ok: false, output: "write denied by user" };
    }
    writeFileSync(p, newContent);
    ctx.audit("write_file.applied", { path: String(args.path), bytes: newContent.length });
    return { ok: true, output: `wrote ${args.path} (${newContent.length} bytes)` };
  },
};
