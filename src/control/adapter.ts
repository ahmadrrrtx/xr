/**
 * XR v0.8 — Computer Control: platform + dependency probe.
 *
 * Pure introspection. No actions executed. Used by `xr control status` and
 * `xr doctor` to tell the user *exactly* what is or isn't available on their
 * machine — and what to install to get the rest working.
 *
 * Async probes use non-blocking spawn; sync wrappers cache the last result
 * for CLI/status paths that cannot await.
 */
import { commandExists } from "../util/process.ts";
import type { ControlCapabilities } from "./types.ts";

export function detectOS(): "linux" | "macos" | "windows" {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";
}

let capsCache: { value: ControlCapabilities; at: number } | null = null;
const CAPS_TTL_MS = 30_000;

export async function detectCapabilitiesAsync(): Promise<ControlCapabilities> {
  if (capsCache && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.value;

  const os = detectOS();
  const missing: string[] = [];
  let keyboard = false;
  let mouse = false;
  let launcher = true;
  let windows = false;

  if (os === "linux") {
    keyboard = await commandExists("xdotool");
    mouse = keyboard;
    windows = await commandExists("wmctrl");
    launcher = (await commandExists("xdg-open")) || (await commandExists("gtk-launch"));
    if (!keyboard) missing.push('xdotool   (install: "sudo apt install xdotool" or distro equivalent)');
    if (!windows) missing.push('wmctrl    (install: "sudo apt install wmctrl")');
    if (!launcher) missing.push('xdg-utils (install: "sudo apt install xdg-utils")');
  } else if (os === "macos") {
    keyboard = await commandExists("osascript");
    mouse = keyboard;
    windows = keyboard;
    launcher = (await commandExists("open")) && keyboard;
    if (!keyboard) missing.push("osascript (should be built-in; macOS is broken?)");
  } else {
    const ps = (await commandExists("powershell")) || (await commandExists("pwsh"));
    keyboard = ps;
    mouse = ps;
    windows = ps;
    launcher = ps;
    if (!ps) missing.push("PowerShell (install Windows PowerShell 5+ or pwsh)");
  }

  const value: ControlCapabilities = {
    os,
    tools: { keyboard, mouse, launcher, windows },
    missing,
  };
  capsCache = { value, at: Date.now() };
  return value;
}

/**
 * Sync status for CLI. Returns last async probe if fresh; otherwise a
 * platform-optimistic snapshot without spawning (never blocks the event loop).
 * Call detectCapabilitiesAsync() for a live probe.
 */
export function detectCapabilities(): ControlCapabilities {
  if (capsCache && Date.now() - capsCache.at < CAPS_TTL_MS) return capsCache.value;

  const os = detectOS();
  // Optimistic defaults — tools are almost always present on macOS/Windows;
  // Linux marks keyboard unknown-as-false until async probe runs.
  if (os === "macos") {
    return {
      os,
      tools: { keyboard: true, mouse: true, launcher: true, windows: true },
      missing: [],
    };
  }
  if (os === "windows") {
    return {
      os,
      tools: { keyboard: true, mouse: true, launcher: true, windows: true },
      missing: [],
    };
  }
  return {
    os,
    tools: { keyboard: false, mouse: false, launcher: true, windows: false },
    missing: [
      'xdotool   (install: "sudo apt install xdotool" or distro equivalent)',
      'wmctrl    (install: "sudo apt install wmctrl")',
    ],
  };
}

/** True when at least the launcher + keyboard are available. */
export function isControlReady(caps?: ControlCapabilities): boolean {
  const c = caps ?? detectCapabilities();
  return c.tools.launcher && c.tools.keyboard;
}

export async function isControlReadyAsync(): Promise<boolean> {
  const c = await detectCapabilitiesAsync();
  return c.tools.launcher && c.tools.keyboard;
}

export function invalidateCapabilitiesCache(): void {
  capsCache = null;
}
