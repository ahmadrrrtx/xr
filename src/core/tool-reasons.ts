/**
 * XR-LAUNCH-024 — stable, non-sensitive reason codes for failed tool calls.
 *
 * A failed tool used to reach the user (and `--json` consumers) as a bare
 * "failed"; the real cause lived only in the audit DB. Every failed
 * `tool_result` now carries:
 *
 *   · `error`  — the tool's own message (what the model also sees);
 *   · `reason` — one code from TOOL_REASONS (stable API: codes are only added,
 *                never renamed — scripts may branch on them);
 *   · `next`   — a short next step for a person.
 *
 * Codes never contain paths, commands or secret material, so they are safe to
 * log and to show anywhere. Tools may set `ToolResult.reason` explicitly; when
 * they do not, classifyToolFailure maps the known denial messages XR's own
 * tools emit. Anything unrecognised is `failed:tool`, never a guess.
 */

import { FilesystemError } from "../security/fs-native.ts";

export const TOOL_REASONS = {
  "denied:escape": "The path is outside the project folder. Use a path inside the working directory, or start XR in the folder it should work on.",
  "denied:secret-path": "XR does not read, move or run commands on secret/credential files (.env, keys, tokens). Do this step yourself, or move the non-secret part into another file.",
  "denied:filesystem": "The filesystem authority refused this path (symlink, hard link, mount crossing or a blocked path). Use a regular file inside the project.",
  "denied:user": "The action was declined, at the approval prompt or by a configured deny rule. Ask again and approve it, or change the rule, if you want it to run.",
  "denied:dangerous-command": "XR blocks destructive shell commands (for example recursive deletes of system paths or raw disk writes). If you really mean it, run it yourself outside XR.",
  "denied:policy": "A capability policy blocked this tool for this run. Check the workspace or agent policy, or use a mode that allows it.",
  "blocked:isolation-unavailable": "No verified sandbox is available for this command, and XR does not fall back to running it unsandboxed. Run `xr doctor` to see the sandbox status.",
  "blocked:integrity": "The execution-integrity gate refused a binary it could not verify. Check the command, or review XR_EXEC_INTEGRITY.",
  "blocked:filesystem-unsupported": "The native filesystem authority is unavailable. Linux requires glibc and an enforcing openat2-capable kernel; other platforms require a supported native backend. See docs/release/SUPPORT_MATRIX.md.",
  "missing:file": "The file or folder does not exist. Check the path; it is relative to the working directory.",
  "invalid:arguments": "The model sent incomplete or malformed arguments. Retry; if it repeats, try another model.",
  "invalid:unknown-tool": "The model asked for a tool that is not available in this mode. Retry, or switch to a mode that has it.",
  "failed:stale": "The file changed while XR was working on it. Retry the step.",
  "failed:too-large": "The file or folder is larger than XR's tool limit. Narrow the request to a smaller file or subfolder.",
  "failed:binary": "The file is binary; XR's text tools read UTF-8 text only.",
  "failed:cancelled": "The step was cancelled before it finished.",
  "failed:command": "The command ran and exited with an error. Its output above shows why.",
  "failed:tool": "The tool reported an error. Its message above shows why.",
  "error:exception": "The tool crashed unexpectedly. Retry; if it repeats, run `xr doctor` and report the issue.",
} as const;

export type ToolReasonCode = keyof typeof TOOL_REASONS;

export function isToolReasonCode(value: unknown): value is ToolReasonCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TOOL_REASONS, value);
}

export function nextStepFor(code: ToolReasonCode): string {
  return TOOL_REASONS[code];
}

/** Reason for an error thrown by the filesystem authority (src/security/fs-native.ts). */
export function filesystemReason(e: unknown): ToolReasonCode {
  if (!(e instanceof FilesystemError)) return "denied:filesystem";
  if (e.detail === "secret-path") return "denied:secret-path";
  switch (e.code) {
    case "escape": return "denied:escape";
    case "missing": return "missing:file";
    case "stale": return "failed:stale";
    case "limit": return "failed:too-large";
    case "unsupported": return "blocked:filesystem-unsupported";
    case "binary": return "failed:binary";
    default: return "denied:filesystem";
  }
}

/** Reason for a src/security/guard.ts checkAction refusal (its `reason` text). */
export function guardDenialReason(reason: string | undefined): ToolReasonCode {
  const r = reason ?? "";
  if (/secret\/credential path|reference to secret material/.test(r)) return "denied:secret-path";
  if (/dangerous shell command/.test(r)) return "denied:dangerous-command";
  return "denied:policy";
}

/**
 * Map a failed tool's message to a code. Only the exact denial texts XR's own
 * tools produce are recognised (src/security/fs-native.ts, filesystem.ts,
 * guard.ts, tools/files.ts, tools/system.ts); everything else is `failed:tool`.
 */
export function classifyToolFailure(tool: string, output: string): ToolReasonCode {
  const o = output.trim();
  if (o === "path escapes the project root") return "denied:escape";
  if (/^blocked: blocked: /.test(o)) return guardDenialReason(o);
  if (/secret\/credential path/.test(o)) return "denied:secret-path";
  if (o === "filesystem missing") return "missing:file";
  if (o === "filesystem stale") return "failed:stale";
  if (o === "filesystem limit") return "failed:too-large";
  if (o === "filesystem unsupported") return "blocked:filesystem-unsupported";
  if (o === "filesystem binary") return "failed:binary";
  if (o === "filesystem denied") return "denied:filesystem";
  if (/^(write|delete) denied( by user)?$|^shell denied$|re-approval was denied$/.test(o)) return "denied:user";
  if (/^blocked: grant /.test(o)) return "denied:policy";
  if (/^blocked: (shell requires an isolated execution environment|.*isolation)/i.test(o)) return "blocked:isolation-unavailable";
  if (/^blocked by execution-integrity gate/.test(o)) return "blocked:integrity";
  if (/ requires a non-empty /.test(o) || / received invalid arguments/.test(o)) return "invalid:arguments";
  if (/cancelled/.test(o) && tool === "shell") return "failed:cancelled";
  if (tool === "shell" && !o.startsWith("blocked")) return "failed:command";
  return "failed:tool";
}

/** The failure fields a `tool_result` stream event carries. */
export function toolFailure(tool: string, output: string, explicit?: string): { error: string; reason: ToolReasonCode; next: string } {
  const reason = isToolReasonCode(explicit) ? explicit : classifyToolFailure(tool, output);
  return { error: output, reason, next: nextStepFor(reason) };
}

/** Build the `tool_result` stream event for a tool that ran (ok or failed). */
export function toolResultEvent(
  id: string,
  tool: string,
  result: { ok: boolean; output: string; reason?: string },
): { type: "tool_result"; id: string; tool: string; ok: boolean; result: string; error?: string; reason?: ToolReasonCode; next?: string } {
  const base = { type: "tool_result" as const, id, tool, ok: result.ok, result: result.output };
  return result.ok ? base : { ...base, ...toolFailure(tool, result.output, result.reason) };
}
