/**
 * XR v0.8 — Computer Control: platform + dependency probe.
 *
 * Pure introspection.  No actions executed.  Used by `xr control status` and
 * `xr doctor` to tell the user *exactly* what is or isn't available on their
 * machine — and what to install to get the rest working.
 */

import { spawnSync } from "node:child_process";
import type { ControlCapabilities } from "./types.ts";

export function detectOS(): "linux" | "macos" | "windows" {
  const p = process.platform;
  if (p === "darwin") return "macos";
  if (p === "win32") return "windows";
  return "linux";
}

function hasCommand(cmd: string): boolean {
  try {
    const which = process.platform === "win32" ? "where" : "command";
    const args = process.platform === "win32" ? [cmd] : ["-v", cmd];
    const res = spawnSync(which, args, {
      stdio: "ignore",
      shell: process.platform !== "win32",
      timeout: 1500,
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

export function detectCapabilities(): ControlCapabilities {
  const os = detectOS();
  const missing: string[] = [];
  let keyboard = false;
  let mouse = false;
  let launcher = true; // open/start/xdg-open is essentially always present
  let windows = false;

  if (os === "linux") {
    keyboard = hasCommand("xdotool");
    mouse = keyboard;
    windows = hasCommand("wmctrl");
    launcher = hasCommand("xdg-open") || hasCommand("gtk-launch");
    if (!keyboard) missing.push('xdotool   (install: "sudo apt install xdotool" or distro equivalent)');
    if (!windows)  missing.push('wmctrl    (install: "sudo apt install wmctrl")');
    if (!launcher) missing.push('xdg-utils (install: "sudo apt install xdg-utils")');
  } else if (os === "macos") {
    // macOS ships everything we need (osascript, open). The user just has to
    // grant Accessibility + Screen Recording permissions on first prompt.
    keyboard = hasCommand("osascript");
    mouse = keyboard;
    windows = keyboard;
    launcher = hasCommand("open") && keyboard;
    if (!keyboard) missing.push("osascript (should be built-in; macOS is broken?)");
  } else {
    // Windows: PowerShell is required.  Newer machines have `pwsh` too.
    const ps = hasCommand("powershell") || hasCommand("pwsh");
    keyboard = ps;
    mouse = ps;
    windows = ps;
    launcher = ps;
    if (!ps) missing.push("PowerShell (install Windows PowerShell 5+ or pwsh)");
  }

  return {
    os,
    tools: { keyboard, mouse, launcher, windows },
    missing,
  };
}

/** True when at least the launcher + keyboard are available. */
export function isControlReady(caps?: ControlCapabilities): boolean {
  const c = caps ?? detectCapabilities();
  return c.tools.launcher && c.tools.keyboard;
}
