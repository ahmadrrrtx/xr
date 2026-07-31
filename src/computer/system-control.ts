/**
 * XR — cross-platform system-control tools.
 *
 * ── Phase 0 · T7 — no stub tools, no no-op "success" ────────────────────────
 *
 * This module previously exported five tools that did nothing at all, three of
 * which reported `ok: true` while doing it:
 *
 *     system_volume   → ok:true  "volume control unavailable in this build"
 *     system_battery  → ok:true  "battery status unavailable in this build"
 *     system_wifi     → ok:true  "wifi status unavailable in this build"
 *     system_media    → ok:false "media control unavailable in this build"
 *     system_trash    → ok:false "trash operation unavailable in this build"
 *
 * They have been removed from the registry entirely. A model given a tool that
 * always "succeeds" without acting will confidently report to the user that the
 * volume was changed or the file was trashed — the exact failure mode
 * Commandment 2 forbids. An absent tool is honest; a lying tool is not.
 *
 * Two further defects found during the Phase 0 audit are fixed here:
 *   · `system_apps` returned ok:true with "not available on this platform".
 *   · `system_notify` returned ok:true on Linux/Windows while only implementing
 *     the macOS path — claiming a notification the user never saw.
 *
 * Finally, `assertNoNoOpSuccess()` is a structural guard: any tool result whose
 * output announces unavailability while claiming ok:true is downgraded to a
 * failure. It exists so this defect class cannot silently return.
 */
import type { Tool, ToolResult } from "../core/types.ts";
import { runCommand } from "../util/process.ts";

/**
 * Phrases that describe an action NOT happening.
 *
 * A result may not simultaneously claim success and say the action was
 * unavailable, unsupported or not implemented.
 */
const UNAVAILABILITY_MARKERS = [
  /\bunavailable\b/i,
  /\bnot available\b/i,
  /\bnot supported\b/i,
  /\bunsupported\b/i,
  /\bnot implemented\b/i,
  /\bno[t]? .{0,20}in this build\b/i,
  /\buse .{0,40} instead\b/i,
];

/**
 * Structural guard against no-op success (Commandment 2).
 *
 * Dry-run previews are explicitly exempt: `[dry-run] would …` is a truthful
 * statement about a simulation the caller asked for, and it is prefixed so it
 * can never be mistaken for a performed action.
 */
export function assertNoNoOpSuccess(result: ToolResult, toolName: string): ToolResult {
  if (!result.ok) return result;
  const output = String(result.output ?? "");
  if (output.startsWith("[dry-run]")) return result;
  if (UNAVAILABILITY_MARKERS.some((re) => re.test(output))) {
    return {
      ok: false,
      output: `${toolName}: action did not run — ${output}`,
    };
  }
  return result;
}

/**
 * Wrap a tool so every result passes the no-op-success guard.
 *
 * Applied at construction, so a future contributor cannot add an unavailable
 * `ok:true` path to these tools without the guard catching it.
 */
function tool(name: string, description: string, requiresApproval: boolean, run: Tool["run"]): Tool {
  const guarded: Tool["run"] = async (args, ctx) => assertNoNoOpSuccess(await run(args, ctx), name);
  return { name, description, parameters: {}, requiresApproval, run: guarded };
}

export const get_open_appsTool = tool(
  "system_apps",
  "List visible/open applications when the OS supports it.",
  false,
  async () => {
    if (process.platform === "darwin") {
      const res = await runCommand(
        "osascript",
        ["-e", 'tell application "System Events" to get name of every process whose background only is false'],
        { timeoutMs: 1500 },
      );
      if (res.ok) return { ok: true, output: res.stdout.trim() || "(none)" };
      return { ok: false, output: `could not list applications: ${res.stderr.trim() || "osascript failed"}` };
    }
    if (process.platform === "linux") {
      const res = await runCommand("wmctrl", ["-l"], { timeoutMs: 1500 });
      if (res.ok) return { ok: true, output: res.stdout.trim() || "(none)" };
      return { ok: false, output: "could not list applications: wmctrl is not installed" };
    }
    // Honest failure, not a cheerful non-answer.
    return { ok: false, output: `listing open applications is not supported on ${process.platform}` };
  },
);

export const open_appTool = tool("system_open_app", "Open an application by name (approval-gated).", true, async (args, ctx) => {
  const name = String(args.name ?? args.value ?? "").trim();
  if (!name) return { ok: false, output: "no application name provided" };
  const approved = await ctx.approve({ tool: "system_open_app", reason: `open ${name}`, preview: name });
  if (!approved) return { ok: false, output: "open-app denied" };
  if (ctx.dryRun) return { ok: true, output: `[dry-run] would open ${name}` };

  let res;
  if (process.platform === "darwin") res = await runCommand("open", ["-a", name], { timeoutMs: 3000 });
  else if (process.platform === "win32") res = await runCommand("cmd", ["/c", "start", "", name], { timeoutMs: 3000 });
  else res = await runCommand("xdg-open", [name], { timeoutMs: 3000 });

  ctx.audit("system.open_app", { name, ok: res.ok });
  return res.ok
    ? { ok: true, output: `opened ${name}` }
    : { ok: false, output: `could not open ${name}: ${res.stderr.trim() || "launcher failed"}` };
});

export const clipboard_readTool = tool("system_clipboard_read", "Read the system clipboard when supported.", false, async () => {
  let res;
  if (process.platform === "darwin") res = await runCommand("pbpaste", [], { timeoutMs: 1500 });
  else if (process.platform === "win32") res = await runCommand("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { timeoutMs: 1500 });
  else res = await runCommand("xclip", ["-selection", "clipboard", "-o"], { timeoutMs: 1500 });

  return res.ok
    ? { ok: true, output: res.stdout }
    : { ok: false, output: "clipboard read failed — no clipboard utility available" };
});

export const clipboard_writeTool = tool("system_clipboard_write", "Write text to the system clipboard (approval-gated).", true, async (args, ctx) => {
  const text = String(args.text ?? args.value ?? "");
  const approved = await ctx.approve({ tool: "system_clipboard_write", reason: "write to clipboard", preview: text.slice(0, 300) });
  if (!approved) return { ok: false, output: "clipboard write denied" };
  if (ctx.dryRun) return { ok: true, output: "[dry-run] would write clipboard" };

  let res;
  if (process.platform === "darwin") {
    res = await runCommand("pbcopy", [], { input: text, timeoutMs: 1500 });
  } else if (process.platform === "win32") {
    res = await runCommand("powershell", ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"], { input: text, timeoutMs: 1500 });
  } else {
    res = await runCommand("xclip", ["-selection", "clipboard"], { input: text, timeoutMs: 1500 });
  }
  ctx.audit("system.clipboard_write", { bytes: text.length, ok: res.ok });
  return res.ok ? { ok: true, output: "clipboard updated" } : { ok: false, output: "clipboard write failed" };
});

export const system_notifyTool = tool("system_notify", "Show a local notification (approval-gated).", true, async (args, ctx) => {
  const title = String(args.title ?? "XR");
  const value = String(args.value ?? args.message ?? "");
  const approved = await ctx.approve({ tool: "system_notify", reason: "show notification", preview: `${title}: ${value}`.slice(0, 300) });
  if (!approved) return { ok: false, output: "notification denied" };
  if (ctx.dryRun) return { ok: true, output: "[dry-run] would notify" };

  // Previously this returned ok:true on every platform while only running a
  // command on macOS — reporting a notification nobody ever saw.
  let res;
  if (process.platform === "darwin") {
    res = await runCommand(
      "osascript",
      ["-e", `display notification ${JSON.stringify(value)} with title ${JSON.stringify(title)}`],
      { timeoutMs: 1500 },
    );
  } else if (process.platform === "linux") {
    res = await runCommand("notify-send", [title, value], { timeoutMs: 1500 });
  } else {
    return { ok: false, output: `notifications are not supported on ${process.platform}` };
  }

  ctx.audit("system.notify", { title, ok: res.ok });
  return res.ok
    ? { ok: true, output: "notification shown" }
    : { ok: false, output: `notification failed: ${res.stderr.trim() || "no notification daemon"}` };
});

/**
 * Tools exported to the agent registry.
 *
 * Every entry here performs a real action or reports a real failure. Tools that
 * could not do their job were deleted rather than kept as polite no-ops:
 * system_volume, system_battery, system_wifi, system_media, system_trash and
 * system_screenshot (whose only behaviour was to redirect to computer_control).
 */
export const SYSTEM_TOOLS: Tool[] = [
  get_open_appsTool,
  open_appTool,
  clipboard_readTool,
  clipboard_writeTool,
  system_notifyTool,
];

/** Tool names removed in 7.0.1 because they never performed an action. */
export const REMOVED_STUB_TOOLS = [
  "system_volume",
  "system_screenshot",
  "system_battery",
  "system_media",
  "system_trash",
  "system_wifi",
] as const;
