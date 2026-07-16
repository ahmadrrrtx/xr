/**
 * XR Stage 9/10 — safe cross-platform system-control tool stubs (async).
 *
 * These keep the core tool registry type-safe. High-risk operations are
 * approval-gated and fail closed in dry-run or unsupported environments.
 */
import type { Tool } from "../core/types.ts";
import { runCommand } from "../util/process.ts";

function tool(name: string, description: string, requiresApproval: boolean, run: Tool["run"]): Tool {
  return { name, description, parameters: {}, requiresApproval, run };
}

export const get_open_appsTool = tool("system_apps", "List visible/open applications when the OS supports it.", false, async () => {
  if (process.platform === "darwin") {
    const res = await runCommand("osascript", ["-e", 'tell application "System Events" to get name of every process whose background only is false'], { timeoutMs: 1500 });
    if (res.ok) return { ok: true, output: res.stdout.trim() || "(none)" };
  }
  return { ok: true, output: "open-app listing is not available on this platform" };
});

export const open_appTool = tool("system_open_app", "Open an application by name (approval-gated).", true, async (args, ctx) => {
  const name = String(args.name ?? "").trim();
  if (!name) return { ok: false, output: "expected { name }" };
  const approved = await ctx.approve({ tool: "system_open_app", reason: `open application ${name}`, args });
  if (!approved) return { ok: false, output: "open app denied" };
  if (ctx.dryRun) return { ok: true, output: `[dry-run] would open ${name}` };
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const argv = process.platform === "darwin" ? ["-a", name] : process.platform === "win32" ? ["/c", "start", "", name] : [name];
  const res = await runCommand(cmd, argv, { timeoutMs: 3000 });
  ctx.audit("system.open_app", { name, ok: res.ok });
  return { ok: res.ok, output: res.ok ? `opened ${name}` : `could not open ${name}` };
});

export const clipboard_readTool = tool("system_clipboard_read", "Read the system clipboard when supported.", false, async () => {
  if (process.platform === "darwin") {
    const res = await runCommand("pbpaste", [], { timeoutMs: 1500 });
    return { ok: res.ok, output: res.ok ? res.stdout.slice(0, 4000) : "clipboard read unavailable" };
  }
  if (process.platform === "win32") {
    const res = await runCommand("powershell", ["-NoProfile", "-Command", "Get-Clipboard"], { timeoutMs: 1500 });
    return { ok: res.ok, output: res.ok ? res.stdout.slice(0, 4000) : "clipboard read unavailable" };
  }
  const res = await runCommand("xclip", ["-selection", "clipboard", "-o"], { timeoutMs: 1500 });
  return { ok: res.ok, output: res.ok ? res.stdout.slice(0, 4000) : "clipboard read unavailable" };
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
  return { ok: res.ok, output: res.ok ? "clipboard updated" : "clipboard write unavailable" };
});

export const system_volumeTool = tool("system_volume", "Report or adjust system volume when supported.", false, async () => ({ ok: true, output: "volume control unavailable in this build" }));
export const system_screenshotTool = tool("system_screenshot", "Capture screenshot through the control subsystem when configured.", false, async () => ({ ok: true, output: "use computer_control for screenshots" }));
export const system_notifyTool = tool("system_notify", "Show a local notification (approval-gated).", true, async (args, ctx) => {
  const title = String(args.title ?? "XR");
  const value = String(args.value ?? args.message ?? "");
  const approved = await ctx.approve({ tool: "system_notify", reason: "show notification", preview: `${title}: ${value}`.slice(0, 300) });
  if (!approved || ctx.dryRun) return { ok: approved, output: approved ? "[dry-run] would notify" : "notification denied" };
  if (process.platform === "darwin") {
    await runCommand("osascript", ["-e", `display notification ${JSON.stringify(value)} with title ${JSON.stringify(title)}`], { timeoutMs: 1500 });
  }
  ctx.audit("system.notify", { title });
  return { ok: true, output: "notification requested" };
});
export const system_batteryTool = tool("system_battery", "Report battery status when supported.", false, async () => ({ ok: true, output: "battery status unavailable in this build" }));
export const system_mediaTool = tool("system_media", "Control media keys when supported (approval-gated).", true, async () => ({ ok: false, output: "media control unavailable in this build" }));
export const system_trashTool = tool("system_trash", "Move a file to trash (approval-gated).", true, async () => ({ ok: false, output: "trash operation unavailable in this build" }));
export const system_wifiTool = tool("system_wifi", "Report Wi-Fi/network status when supported.", false, async () => ({ ok: true, output: "wifi status unavailable in this build" }));

export const SYSTEM_TOOLS: Tool[] = [
  get_open_appsTool,
  open_appTool,
  clipboard_readTool,
  clipboard_writeTool,
  system_volumeTool,
  system_screenshotTool,
  system_notifyTool,
  system_batteryTool,
  system_mediaTool,
  system_trashTool,
  system_wifiTool,
];
