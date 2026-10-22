/** File tools own their bounded read/mutation through the shared authority. */
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { readTrustRequest, workspaceWriteTrustRequest } from "../runtime/trust/tool-support.ts";
import { classifySensitiveWrite } from "../security/trust-handoff.ts";
import { unifiedDiff } from "../util/unified-diff.ts";
import { FilesystemAuthority, filesystemMessage } from "../security/filesystem.ts";
import { filesystemReason } from "../core/tool-reasons.ts";

export const readFileTool: Tool = {
  name: "read_file",
  description: "Read a UTF-8 text file inside the working directory.",
  parameters: { path: "string (relative path)" },
  requiresApproval: false,
  trustRequest: (_args, ctx) => readTrustRequest("read_file", ctx.cwd),
  async run(args, ctx): Promise<ToolResult> {
    let fs: FilesystemAuthority | undefined;
    try {
      if (typeof args.path !== "string" || !args.path.trim()) return { ok: false, output: "read_file requires a non-empty `path`" };
      fs = ctx.filesystem ?? new FilesystemAuthority(ctx.cwd);
      const snapshot = fs.read(args.path);
      ctx.audit("read_file", { path: snapshot.path, authority: fs.descriptor().id });
      const content = snapshot.content;
      return { ok: true, output: content.length > 4000 ? content.slice(0, 4000) + "\n…(truncated)" : content, data: { length: content.length } };
    } catch (e) { return { ok: false, output: filesystemMessage(e), reason: filesystemReason(e) }; }
    finally { if (fs && fs !== ctx.filesystem) fs.close(); }
  },
};

export const writeFileTool: Tool = {
  name: "write_file",
  description: "Create or overwrite a text file inside the working directory. Requires approval.",
  parameters: { path: "string (relative path)", content: "string (full new content)" },
  requiresApproval: true,
  trustRequest: (args, ctx) => workspaceWriteTrustRequest("write_file", ctx.cwd, [String(args.path ?? "")]),
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    if (typeof args.path !== "string" || !args.path.trim() || typeof args.content !== "string") return { ok: false, output: "write_file requires a non-empty `path` (and the file body in `content`)" };
    let fs: FilesystemAuthority | undefined;
    let pending: ReturnType<FilesystemAuthority["prepare"]> | undefined;
    try {
      fs = ctx.filesystem ?? new FilesystemAuthority(ctx.cwd);
      pending = fs.prepare(args.path, "write");
      let content = args.content;
      const trust = classifySensitiveWrite(pending.path, fs.root);
      if (trust.requiresApproval) ctx.audit("write_file.trust_handoff", { path: pending.path, classification: trust.classification, ruleId: trust.ruleId });
      const diff = pending.sensitive ? "(sensitive previous content withheld)" : unifiedDiff(pending.oldContent, content, pending.path);
      const approved = await ctx.approve({
        tool: "write_file", args: { path: pending.path, content, filesystem: pending.identity },
        reason: trust.requiresApproval
          ? `TRUST-HANDOFF WRITE [${trust.classification}] ${pending.existed ? "overwrite" : "create"} ${pending.path} — consumed by: ${trust.trustedComponent}. ${trust.reason}`
          : `${pending.existed ? "overwrite" : "create"} ${pending.path}`,
        preview: trust.requiresApproval ? `${trust.executionImplication ?? ""}\n\n--- diff ---\n${diff}` : diff,
        // The trusted terminal editor changes the proposal, not the host filesystem.
        replaceContent: edited => { content = edited; },
      });
      if (!approved) { ctx.audit("write_file.denied", { path: pending.path }); return { ok: false, output: "write denied by user", reason: "denied:user" }; }
      pending.validate();
      if (ctx.dryRun) { ctx.audit("write_file.dryrun", { path: pending.path, bytes: content.length }); return { ok: true, output: `[dry-run] would write ${pending.path} (${content.length} bytes)` }; }
      pending.commit(content);
      ctx.audit("write_file.applied", { path: pending.path, bytes: content.length, authority: fs.descriptor().id });
      return { ok: true, output: `wrote ${pending.path} (${content.length} bytes)` };
    } catch (e) { return { ok: false, output: filesystemMessage(e), reason: filesystemReason(e) }; }
    finally { pending?.close(); if (fs && fs !== ctx.filesystem) fs.close(); }
  },
};
