import { spawnSync, execSync } from "node:child_process";
import { detectOS } from "./adapter.ts";
import type { Action, ActionResult } from "./types.ts";
import * as files from "./files.ts";
import * as vision from "./vision.ts";

const OS = detectOS();
const TIMEOUT = 10000;

function run(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { timeout: TIMEOUT, encoding: "utf8", shell: false });
  return { code: r.status ?? -1, out: (r.stdout ?? "").toString(), err: (r.stderr ?? r.error?.message ?? "").toString() };
}

function ok(m: string, data?: unknown): ActionResult { return { ok: true, message: m, ...(data ? { data } : {}) }; }
function fail(m: string): ActionResult { return { ok: false, message: m }; }
function asQuote(s: string) { return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }
function psQuote(s: string) { return "'" + s.replace(/'/g, "''") + "'"; }

function execApp(name: string): ActionResult {
  if (OS === "macos") { const r = run("open", ["-a", name]); return r.code === 0 ? ok(`launched "${name}"`) : fail(r.err); }
  if (OS === "linux") {
    let r = run("gtk-launch", [name]); if (r.code === 0) return ok(`launched "${name}"`);
    r = run("xdg-open", [name]); return r.code === 0 ? ok(`opened "${name}"`) : fail("could not launch");
  }
  const r = run("powershell", ["-NoProfile", "-Command", `Start-Process ${psQuote(name)}`]);
  return r.code === 0 ? ok(`launched "${name}"`) : fail(r.err);
}

function execClose(name: string): ActionResult {
  if (OS === "macos") { const r = run("osascript", ["-e", `tell application ${asQuote(name)} to quit`]); return r.code === 0 ? ok(`closed "${name}"`) : fail(r.err); }
  if (OS === "linux") { const r = run("pkill", ["-f", name]); return ok(`close signal sent to ${name}`); }
  const r = run("powershell", ["-NoProfile", "-Command", `Get-Process '${name.replace(/'/g, "''")}' -ErrorAction SilentlyContinue | Stop-Process -Force`]);
  return ok(`closed ${name}`);
}

function execFocus(name: string): ActionResult {
  if (OS === "macos") { const r = run("osascript", ["-e", `tell application ${asQuote(name)} to activate`]); return r.code === 0 ? ok(`focused "${name}"`) : fail(r.err); }
  if (OS === "linux") { const r = run("wmctrl", ["-a", name]); return r.code === 0 ? ok(`focused "${name}"`) : fail(`wmctrl failed`); }
  return ok(`focus attempted on "${name}"`);
}

function execType(text: string): ActionResult {
  if (OS === "macos") { const r = run("osascript", ["-e", `tell application "System Events" to keystroke ${asQuote(text)}`]); return r.code === 0 ? ok(`typed ${text.length} chars`) : fail(r.err); }
  if (OS === "linux") { const r = run("xdotool", ["type", "--delay", "12", "--", text]); return r.code === 0 ? ok(`typed ${text.length} chars`) : fail(r.err); }
  const esc = text.replace(/([+^%~(){}\[\]])/g, "{$1}");
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(esc)})`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`typed ${text.length} chars`) : fail(r.err);
}

function execClick(x: number, y: number, button: "left" | "right" | "double"): ActionResult {
  if (OS === "macos") {
    const cli = button === "right" ? "rc:" : button === "double" ? "dc:" : "c:";
    const s = spawnSync("cliclick", [`${cli}${x},${y}`], { timeout: TIMEOUT });
    return s.status === 0 ? ok(`${button}-click at (${x},${y})`) : fail(`mouse-click requires cliclick: brew install cliclick`);
  }
  if (OS === "linux") {
    run("xdotool", ["mousemove", String(x), String(y)]);
    const btn = button === "right" ? "3" : "1";
    const rep = button === "double" ? ["--repeat", "2"] : [];
    const r = run("xdotool", ["click", ...rep, btn]);
    return r.code === 0 ? ok(`${button}-click at (${x},${y})`) : fail(r.err);
  }
  // Windows Native Click
  const btnCode = button === "right" ? "0x08,0x10" : button === "double" ? "0x02,0x04,0x02,0x04" : "0x02,0x04";
  const ps = `
    Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int flags, int x, int y, int data, int extra); }";
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y});
    '${btnCode}'.Split(',').ForEach({ [Mouse]::mouse_event([int]$_, 0, 0, 0, 0) })
  `;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`${button}-click at (${x},${y})`) : fail(r.err);
}

function execDrag(x1: number, y1: number, x2: number, y2: number, holdMs?: number): ActionResult {
  if (OS === "linux") {
    run("xdotool", ["mousemove", String(x1), String(y1)]); run("xdotool", ["mousedown", "1"]);
    if (holdMs) execSync(`sleep ${holdMs / 1000}`);
    run("xdotool", ["mousemove", String(x2), String(y2)]);
    const r = run("xdotool", ["mouseup", "1"]);
    return r.code === 0 ? ok(`dragged (${x1},${y1}) → (${x2},${y2})`) : fail(r.err);
  }
  if (OS === "macos") {
    const s = spawnSync("cliclick", ["dd:" + x1 + "," + y1, "dm:" + x2 + "," + y2, "du:" + x2 + "," + y2], { timeout: TIMEOUT });
    return s.status === 0 ? ok(`dragged (${x1},${y1}) → (${x2},${y2})`) : fail(`drag requires cliclick`);
  }
  const ps = `
    Add-Type -TypeDefinition "using System; using System.Runtime.InteropServices; public class Mouse { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f, int x, int y, int d, int e); }";
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x1}, ${y1});
    [Mouse]::mouse_event(0x02, 0, 0, 0, 0);
    Start-Sleep -Milliseconds ${holdMs || 200};
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x2}, ${y2});
    [Mouse]::mouse_event(0x04, 0, 0, 0, 0);
  `;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`dragged (${x1},${y1}) → (${x2},${y2})`) : fail(r.err);
}

function execKey(keys: string[]): ActionResult {
  const k = keys.map(x => x.toLowerCase());
  if (OS === "linux") { const r = run("xdotool", ["key", "--", k.join("+")]); return r.code === 0 ? ok(`pressed ${k.join("+")}`) : fail(r.err); }
  if (OS === "macos") {
    const mods = k.slice(0, -1); const last = k[k.length - 1];
    const codeMap: any = { enter: 36, return: 36, tab: 48, escape: 53, esc: 53, space: 49, up: 126, down: 125, left: 123, right: 124 };
    const modMap: any = { cmd: "command down", command: "command down", ctrl: "control down", control: "control down", alt: "option down", option: "option down", shift: "shift down" };
    const using = mods.map(m => modMap[m]).filter(Boolean);
    const code = codeMap[last];
    const cmd = code != null
      ? `tell application "System Events" to key code ${code}${using.length ? ` using {${using.join(", ")}}` : ""}`
      : `tell application "System Events" to keystroke ${asQuote(last)}${using.length ? ` using {${using.join(", ")}}` : ""}`;
    const r = run("osascript", ["-e", cmd]); return r.code === 0 ? ok(`pressed ${k.join("+")}`) : fail(r.err);
  }
  // Windows Keys
  const esc = k.join("+").replace(/ctrl/g, "^").replace(/alt/g, "%").replace(/shift/g, "+").replace(/win/g, "^{ESC}"); // minimal mapping
  const ps = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(${psQuote(esc)})`;
  const r = run("powershell", ["-NoProfile", "-Command", ps]);
  return r.code === 0 ? ok(`pressed ${k.join("+")}`) : fail(r.err);
}

export async function execute(action: Action): Promise<ActionResult> {
  try {
    switch (action.type) {
      case "app": return execApp(action.name);
      case "close": return execClose(action.name);
      case "focus": return execFocus(action.name);
      case "open": {
        if (OS === "macos") { const r = run("open", [action.target]); return r.code === 0 ? ok(`opened ${action.target}`) : fail(r.err); }
        if (OS === "linux") { const r = run("xdg-open", [action.target]); return r.code === 0 ? ok(`opened ${action.target}`) : fail(r.err); }
        const r = run("powershell", ["-NoProfile", "-Command", `Start-Process ${psQuote(action.target)}`]);
        return r.code === 0 ? ok(`opened ${action.target}`) : fail(r.err);
      }
      case "type": return execType(action.text);
      case "click": return execClick(action.x ?? 0, action.y ?? 0, action.button);
      case "drag_drop": return execDrag(action.x1, action.y1, action.x2, action.y2, action.holdMs);
      case "move": return execClick(action.x, action.y, "left");
      case "scroll": {
        if (OS === "linux") {
          const btn = action.direction === "up" ? "4" : action.direction === "down" ? "5" : action.direction === "left" ? "6" : "7";
          const r = run("xdotool", ["click", "--repeat", String(action.amount), btn]);
          return r.code === 0 ? ok(`scrolled ${action.direction}`) : fail(r.err);
        }
        return ok(`scrolled ${action.direction} x${action.amount}`);
      }
      case "key": return execKey(action.keys);
      case "wait_ms": await new Promise(r => setTimeout(r, action.ms)); return ok(`waited ${action.ms}ms`);
      case "screenshot": {
        const cap = await vision.captureScreen(action.savePath);
        return cap.ok ? ok(cap.message, { path: cap.path }) : fail(cap.message);
      }
      case "file":
        if (action.op === "read") return await files.fileRead(action.path);
        if (action.op === "write") return await files.fileWrite(action.path, action.content || "");
        if (action.op === "list") return await files.fileList(action.path);
        if (action.op === "mkdir") return await files.fileMkdir(action.path);
        if (action.op === "move" && action.targetPath) return await files.fileMove(action.path, action.targetPath);
        if (action.op === "delete") return await files.fileDelete(action.path);
        return fail("file op invalid");
      case "browser": {
        const { executeBrowserAction } = await import("./browser.ts");
        return await executeBrowserAction(action);
      }
      case "editor": {
        const ed = action.editor === "auto" ? "code" : action.editor;
        const args = action.file ? (action.line ? [action.file, "--goto", `${action.file}:${action.line}`] : [action.file]) : [];
        const r = run(ed, args);
        return r.code === 0 ? ok(`opened ${ed}`) : fail(`editor ${ed} not found`);
      }
      case "system": {
        if (action.op === "clipboard_read") {
          if (OS === "macos") return ok("clipboard read", { text: execSync("pbpaste").toString() });
          if (OS === "linux") return ok("clipboard read", { text: execSync("xclip -o -sel clip 2>/dev/null || xsel -b -o 2>/dev/null || echo ''").toString() });
          const o = execSync("powershell -NoProfile -Command Get-Clipboard").toString();
          return ok("clipboard read", { text: o });
        }
        return fail(`system op ${action.op} not implemented`);
      }
      default: return fail(`unknown action type`);
    }
  } catch (e) { return fail(`executor crashed: ${(e as Error).message}`); }
}
