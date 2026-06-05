/**
 * XR v0.8 — Computer Control: OS executor.
 *
 * THE ONLY FILE THAT TOUCHES THE USER'S KEYBOARD, MOUSE, OR APPS.
 *
 * Every public method:
 *   • assumes the caller already validated + classified + approved the action,
 *   • performs ONE concrete OS-level operation,
 *   • returns a structured result (no thrown errors leaking to the audit log).
 *
 * Backends:
 *   • macOS   → osascript / open
 *   • Linux   → xdotool / wmctrl / xdg-open
 *   • Windows → PowerShell (SendKeys + Start-Process)
 *
 * Nothing here is "smart".  Smartness lives in service.ts and the planner.
 */

import { spawnSync } from "node:child_process";
import { detectOS } from "./adapter.ts";
import type { Action, ActionResult } from "./types.ts";

const OS = detectOS();
const EXEC_TIMEOUT_MS = 8_000;

// ── tiny safe-shell helper ──────────────────────────────────────────────────
// We *never* build a shell string from user input.  We always spawn argv-style
// and the called program (osascript / xdotool / powershell) does its own
// argument handling.  AppleScript and PowerShell still need quoting for the
// strings *they* see — handled per-call.

function run(cmd: string, args: string[]): { code: number; stdout: string; stderr: string } {
  const res = spawnSync(cmd, args, {
    timeout: EXEC_TIMEOUT_MS,
    encoding: "utf8",
    shell: false,
  });
  return {
    code: res.status ?? -1,
    stdout: (res.stdout ?? "").toString(),
    stderr: (res.stderr ?? res.error?.message ?? "").toString(),
  };
}

function ok(message: string): ActionResult { return { ok: true, message }; }
function fail(message: string): ActionResult { return { ok: false, message }; }

// ── AppleScript quoting (macOS) ─────────────────────────────────────────────
function asQuote(s: string): string {
  // AppleScript strings are double-quoted; escape \ and "
  return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

// ── PowerShell single-quote escaping (Windows) ──────────────────────────────
function psQuote(s: string): string {
  return "'" + s.replace(/'/g, "''") + "'";
}

// ── Key-name normalization ──────────────────────────────────────────────────

const MAC_KEYCODES: Record<string, number> = {
  enter: 36, return: 36, tab: 48, escape: 53, esc: 53, space: 49,
  backspace: 51, delete: 51,
  up: 126, down: 125, left: 123, right: 124,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96,
};

const MAC_MODS: Record<string, string> = {
  cmd: "command down", command: "command down",
  ctrl: "control down", control: "control down",
  alt: "option down", option: "option down",
  shift: "shift down",
};

const WIN_SENDKEYS: Record<string, string> = {
  enter: "{ENTER}", return: "{ENTER}", tab: "{TAB}", esc: "{ESC}",
  escape: "{ESC}", space: " ", backspace: "{BACKSPACE}", delete: "{DELETE}",
  up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}",
  f1: "{F1}", f2: "{F2}", f3: "{F3}", f4: "{F4}", f5: "{F5}",
};

const WIN_MODS: Record<string, string> = { ctrl: "^", control: "^", alt: "%", shift: "+" };

// ── App launch / focus ─────────────────────────────────────────────────────

function execApp(name: string): ActionResult {
  if (OS === "macos") {
    const r = run("open", ["-a", name]);
    if (r.code === 0) return ok(`launched "${name}"`);
    return fail(`could not launch "${name}": ${r.stderr.trim() || "unknown error"}`);
  }
  if (OS === "linux") {
    // Prefer gtk-launch (uses .desktop files), fall back to plain exec.
    let r = run("gtk-launch", [name]);
    if (r.code === 0) return ok(`launched "${name}"`);
    r = run("xdg-open", [name]);
    if (r.code === 0) return ok(`opened "${name}"`);
    // Last resort: try executing it directly (PATH lookup).
    r = run(name, []);
    if (r.code === 0) return ok(`executed "${name}"`);
    return fail(`could not launch "${name}" (install or check the app name)`);
  }
  // windows
  const r = run("powershell", ["-NoProfile", "-Command", `Start-Process ${psQuote(name)}`]);
  if (r.code === 0) return ok(`launched "${name}"`);
  return fail(`could not launch "${name}": ${r.stderr.trim() || "unknown error"}`);
}

function execFocus(name: string): ActionResult {
  if (OS === "macos") {
    const script = `tell application ${asQuote(name)} to activate`;
    const r = run("osascript", ["-e", script]);
    if (r.code === 0) return ok(`focused "${name}"`);
    return fail(`focus failed: ${r.stderr.trim()}`);
  }
  if (OS === "linux") {
    const r = run("wmctrl", ["-a", name]);
    if (r.code === 0) return ok(`focused "${name}"`);
    return fail(`focus failed (install wmctrl, or window not found): ${r.stderr.trim()}`);
  }
  const ps = `(Get-Process | Where-Object { $_.MainWindowTitle -like '*${name.replace(/'/g, "''")}*' } | Select-Object -First 1).MainWindowHandle`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  if (r.code === 0) return ok(`focus attempted on "${name}"`);
  return fail(`focus failed: ${r.stderr.trim()}`);
}

// ── Open URL / path ────────────────────────────────────────────────────────

function execOpen(target: string): ActionResult {
  if (OS === "macos") {
    const r = run("open", [target]);
    return r.code === 0 ? ok(`opened ${target}`) : fail(`open failed: ${r.stderr.trim()}`);
  }
  if (OS === "linux") {
    const r = run("xdg-open", [target]);
    return r.code === 0 ? ok(`opened ${target}`) : fail(`xdg-open failed: ${r.stderr.trim()}`);
  }
  const r = run("powershell", ["-NoProfile", "-Command", `Start-Process ${psQuote(target)}`]);
  return r.code === 0 ? ok(`opened ${target}`) : fail(`open failed: ${r.stderr.trim()}`);
}

// ── Type text ──────────────────────────────────────────────────────────────

function execType(text: string): ActionResult {
  if (OS === "macos") {
    const script = `tell application "System Events" to keystroke ${asQuote(text)}`;
    const r = run("osascript", ["-e", script]);
    return r.code === 0 ? ok(`typed ${text.length} char(s)`) : fail(`type failed: ${r.stderr.trim()}`);
  }
  if (OS === "linux") {
    const r = run("xdotool", ["type", "--delay", "12", "--", text]);
    return r.code === 0 ? ok(`typed ${text.length} char(s)`) : fail(`xdotool type failed: ${r.stderr.trim()}`);
  }
  // Windows SendKeys: escape special characters.
  const esc = text.replace(/([+^%~(){}\[\]])/g, "{$1}");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(esc)})`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`typed ${text.length} char(s)`) : fail(`SendKeys failed: ${r.stderr.trim()}`);
}

// ── Click / move / scroll ──────────────────────────────────────────────────

function execMove(x: number, y: number): ActionResult {
  if (OS === "macos") {
    // AppleScript can't move the mouse natively without extra tooling, but
    // cliclick is the common helper.  We try it; if missing, return a clear
    // explanation rather than silently failing.
    const cli = spawnSync("cliclick", ["m:" + x + "," + y], { timeout: EXEC_TIMEOUT_MS, encoding: "utf8" });
    if (cli.status === 0) return ok(`moved cursor to (${x}, ${y})`);
    return fail(`mouse-move on macOS requires "cliclick" (brew install cliclick)`);
  }
  if (OS === "linux") {
    const r = run("xdotool", ["mousemove", String(x), String(y)]);
    return r.code === 0 ? ok(`moved cursor to (${x}, ${y})`) : fail(`xdotool failed: ${r.stderr.trim()}`);
  }
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`moved cursor to (${x}, ${y})`) : fail(`move failed: ${r.stderr.trim()}`);
}

function execClick(x: number | undefined, y: number | undefined, button: "left" | "right" | "double"): ActionResult {
  if (x == null || y == null) {
    return fail("click requires explicit coordinates in v0.8 (vision-based targeting is opt-in via `xr --computer`)");
  }
  if (OS === "macos") {
    const cliBtn = button === "right" ? "rc:" : button === "double" ? "dc:" : "c:";
    const cli = spawnSync("cliclick", [`${cliBtn}${x},${y}`], { timeout: EXEC_TIMEOUT_MS, encoding: "utf8" });
    if (cli.status === 0) return ok(`${button}-click at (${x}, ${y})`);
    return fail(`mouse-click on macOS requires "cliclick" (brew install cliclick)`);
  }
  if (OS === "linux") {
    const move = run("xdotool", ["mousemove", String(x), String(y)]);
    if (move.code !== 0) return fail(`xdotool mousemove failed: ${move.stderr.trim()}`);
    const btnNum = button === "right" ? "3" : "1";
    const repeat = button === "double" ? ["--repeat", "2"] : [];
    const r = run("xdotool", ["click", ...repeat, btnNum]);
    return r.code === 0 ? ok(`${button}-click at (${x}, ${y})`) : fail(`xdotool click failed: ${r.stderr.trim()}`);
  }
  // Windows: move + mouse_event via PowerShell + Win32.
  const psBtn =
    button === "right" ? "[Right]" :
    button === "double" ? "[Left];[Left]" : "[Left]";
  void psBtn; // we use SendInput-style via separate command below
  const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
Add-Type -MemberDefinition '[DllImport("user32.dll",CharSet=CharSet.Auto, CallingConvention=CallingConvention.StdCall)] public static extern void mouse_event(long dwFlags, long dx, long dy, long cButtons, long dwExtraInfo);' -Name "U" -Namespace W
${button === "right"
  ? `[W.U]::mouse_event(0x0008,0,0,0,0); [W.U]::mouse_event(0x0010,0,0,0,0)`
  : button === "double"
    ? `[W.U]::mouse_event(0x0002,0,0,0,0); [W.U]::mouse_event(0x0004,0,0,0,0); Start-Sleep -Milliseconds 60; [W.U]::mouse_event(0x0002,0,0,0,0); [W.U]::mouse_event(0x0004,0,0,0,0)`
    : `[W.U]::mouse_event(0x0002,0,0,0,0); [W.U]::mouse_event(0x0004,0,0,0,0)`}
`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`${button}-click at (${x}, ${y})`) : fail(`click failed: ${r.stderr.trim()}`);
}

function execScroll(direction: "up" | "down" | "left" | "right", amount: number): ActionResult {
  if (OS === "linux") {
    const btn = direction === "up" ? "4" : direction === "down" ? "5" : direction === "left" ? "6" : "7";
    const r = run("xdotool", ["click", "--repeat", String(amount), btn]);
    return r.code === 0 ? ok(`scrolled ${direction} x${amount}`) : fail(`scroll failed: ${r.stderr.trim()}`);
  }
  if (OS === "macos") {
    // Use AppleScript arrow-key spam — slow but dependency-free.
    const code = direction === "up" ? 126 : direction === "down" ? 125 : direction === "left" ? 123 : 124;
    for (let i = 0; i < amount; i++) {
      const r = run("osascript", ["-e", `tell application "System Events" to key code ${code}`]);
      if (r.code !== 0) return fail(`scroll failed: ${r.stderr.trim()}`);
    }
    return ok(`scrolled ${direction} x${amount}`);
  }
  const keyMap = { up: "{UP}", down: "{DOWN}", left: "{LEFT}", right: "{RIGHT}" } as const;
  const send = keyMap[direction].repeat(amount);
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${send}')`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`scrolled ${direction} x${amount}`) : fail(`scroll failed: ${r.stderr.trim()}`);
}

// ── Key combo ──────────────────────────────────────────────────────────────

function execKey(keys: string[]): ActionResult {
  const lowered = keys.map((k) => k.toLowerCase());
  if (OS === "linux") {
    const combo = lowered.join("+");
    const r = run("xdotool", ["key", "--", combo]);
    return r.code === 0 ? ok(`pressed ${combo}`) : fail(`xdotool key failed: ${r.stderr.trim()}`);
  }
  if (OS === "macos") {
    const mods = lowered.slice(0, -1).map((m) => MAC_MODS[m]).filter(Boolean);
    const last = lowered[lowered.length - 1];
    const code = MAC_KEYCODES[last];
    if (code == null && last.length !== 1) {
      return fail(`unknown key "${last}" for macOS backend`);
    }
    const using = mods.length ? ` using {${mods.join(", ")}}` : "";
    const cmd = code != null
      ? `tell application "System Events" to key code ${code}${using}`
      : `tell application "System Events" to keystroke ${asQuote(last)}${using}`;
    const r = run("osascript", ["-e", cmd]);
    return r.code === 0 ? ok(`pressed ${lowered.join("+")}`) : fail(`key failed: ${r.stderr.trim()}`);
  }
  // windows
  const mods = lowered.slice(0, -1).map((m) => WIN_MODS[m] ?? "").join("");
  const last = lowered[lowered.length - 1];
  const tail = WIN_SENDKEYS[last] ?? last;
  const combo = mods + tail;
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${combo.replace(/'/g, "''")}')`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`pressed ${lowered.join("+")}`) : fail(`key failed: ${r.stderr.trim()}`);
}

// ── Public entry point ─────────────────────────────────────────────────────

export async function execute(action: Action): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "app":    return execApp(action.name);
      case "focus":  return execFocus(action.name);
      case "open":   return execOpen(action.target);
      case "type":   return execType(action.text);
      case "move":
        if (action.x == null || action.y == null) {
          return fail("move requires explicit coordinates in v0.8");
        }
        return execMove(action.x, action.y);
      case "click":  return execClick(action.x, action.y, action.button);
      case "scroll": return execScroll(action.direction, action.amount);
      case "key":    return execKey(action.keys);
      case "browser": {
        // Lazy-imported so this file works even when playwright isn't installed.
        const { executeBrowserAction } = await import("./browser.ts");
        return await executeBrowserAction(action);
      }
    }
  } catch (e) {
    return fail(`executor crashed: ${(e as Error).message}`);
  }
}
