/**
 * XR — patch_file: replace one exact snippet in a text file.
 *
 * It is a thin layer over write_file: the patched text is computed here, then
 * written through the same tool, so approval, the diff preview, `v` (edit before
 * accepting) and the trust-handoff checks are identical for both tools.
 *
 * The snippet must occur exactly once. Zero matches and several matches both fail
 * with a message the model can act on, so an edit never lands in the wrong place.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../core/types.ts";
import { workspaceWriteTrustRequest } from "../runtime/trust/tool-support.ts";
import { writeFileTool } from "./files.ts";

/** Pure: apply a unique-match replacement. Returns the new text or a reason it cannot apply. */
export function applyUniquePatch(
  text: string,
  oldText: string,
  newText: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  if (!oldText) return { ok: false, reason: "patch_file requires a non-empty `old` snippet to find" };
  const first = text.indexOf(oldText);
  if (first < 0) return { ok: false, reason: "patch_file: `old` was not found in the file (copy it exactly, including whitespace)" };
  if (text.indexOf(oldText, first + 1) >= 0) {
    const count = text.split(oldText).length - 1;
    return { ok: false, reason: `patch_file: \`old\` matches ${count} places; include more surrounding lines so it is unique` };
  }
  return { ok: true, content: text.slice(0, first) + newText + text.slice(first + oldText.length) };
}

export const patchFileTool: Tool = {
  name: "patch_file",
  description:
    "Edit a text file by replacing one exact snippet (`old`, which must occur exactly once) with `new`. Requires approval; the human sees the diff.",
  parameters: { path: "string (relative path)", old: "string (exact existing text)", new: "string (replacement text)" },
  requiresApproval: true,
  trustRequest: (args, ctx) => workspaceWriteTrustRequest("patch_file", ctx.cwd, [String(args.path ?? "")]),
  async run(args, ctx: ToolContext): Promise<ToolResult> {
    const rawPath = String(args.path ?? "").trim();
    if (!rawPath) return { ok: false, output: "patch_file requires a non-empty `path`" };
    const abs = isAbsolute(rawPath) ? rawPath : resolve(ctx.cwd, rawPath);
    const rel = relative(ctx.cwd, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) return { ok: false, output: `path escapes working directory: ${rawPath}` };
    if (!existsSync(abs)) return { ok: false, output: `file not found: ${rawPath} (use write_file to create it)` };

    const applied = applyUniquePatch(readFileSync(abs, "utf8"), String(args.old ?? ""), String(args.new ?? ""));
    if (!applied.ok) return { ok: false, output: applied.reason };
    // Same approval, diff preview and write path as write_file.
    return writeFileTool.run({ path: rawPath, content: applied.content }, ctx);
  },
};
