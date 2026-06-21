/**
 * XR Stage 9 — Computer Control: CLI handlers.
 */
import type { Store } from "../state/db.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { detectCapabilities, isControlReady } from "./adapter.ts";
import { isDisabled, runAction, runPlan, runTypedPlan, runComputerUse } from "./service.ts";
import type { Action, ControlOptions, ExecutionMode } from "./types.ts";
import { planActions } from "./planner.ts";
import { browserStatus, shutdownBrowser } from "./browser.ts";
import { listRemembered, forgetPlan, clearAllMemory, fingerprintTask } from "./memory.ts";
import { buildProvider } from "../providers/factory.ts";
import { spawnSync } from "node:child_process";

interface ParsedFlags {
  mode: ExecutionMode;
  yes: boolean;
  delayMs: number;
  noMemory: boolean;
  rest: string[];
}
function parseFlags(argv: string[]): ParsedFlags {
  let mode: ExecutionMode = "auto";
  let yes = false;
  let delayMs = 250;
  let noMemory = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run" || a === "--preview") mode = "dry-run";
    else if (a === "--step") mode = "step";
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--delay") delayMs = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--no-memory") noMemory = true;
    else rest.push(a);
  }
  return { mode, yes, delayMs, noMemory, rest };
}
function makeOpts(flags: ParsedFlags): ControlOptions {
  return { mode: flags.mode, autoApproveSensitive: flags.yes, delayMs: flags.delayMs };
}
function finish(success: boolean, msg: string): void {
  if (success) ok(msg); else warn(msg);
}

// ---- status / enable ----
async function cmdStatus(): Promise<void> {
  banner();
  console.log(C.bold("🖥  Computer Control Status"));
  const caps = detectCapabilities();
  const kill = isDisabled();
  const { config } = loadConfig();
  console.log(`  enabled .......... ${kill.disabled ? C.red(`✗ ${kill.reason}`) : C.green("✓ yes")}`);
  console.log(`  platform ......... ${C.cyan(caps.os)}`);
  console.log(`  launcher ......... ${caps.tools.launcher ? C.green("✓") : C.red("✗")}`);
  console.log(`  keyboard ......... ${caps.tools.keyboard ? C.green("✓") : C.red("✗")}`);
  console.log(`  mouse ............ ${caps.tools.mouse ? C.green("✓") : C.red("✗")}`);
  console.log(`  windows .......... ${caps.tools.windows ? C.green("✓") : C.red("✗")}`);
  try {
    const { listPermissions } = await import("./permissions.ts");
    console.log(`  permissions ...... ${C.dim(listPermissions().join(", ") || "(none)")}`);
  } catch {}
  if (caps.missing.length) {
    console.log(""); console.log(C.amber("  Install these for full capability:"));
    for (const m of caps.missing) console.log(`    • ${m}`);
  }
  console.log("");
}

async function cmdStart(): Promise<void> {
  const { config } = loadConfig();
  if (!config.control) (config as any).control = {};
  config.control!.enabled = true;
  saveConfig(config);
  ok("computer control enabled");
  info('Grant permissions: xr control permissions grant desktop');
}
async function cmdStop(): Promise<void> {
  const { config } = loadConfig();
  if (!config.control) (config as any).control = {};
  config.control!.enabled = false;
  saveConfig(config);
  ok("computer control disabled");
}

// ---- actions ----
async function cmdApp(store: Store, flags: ParsedFlags): Promise<void> {
  const name = flags.rest.join(" ").trim(); if (!name) { warn(`usage: xr control app "<app name>"`); return; }
  const r = await runAction(store, { type: "app", name }, makeOpts(flags)); finish(r.result.ok, r.result.message);
}
async function cmdClose(store: Store, flags: ParsedFlags): Promise<void> {
  const name = flags.rest.join(" ").trim(); if (!name) { warn(`usage: xr control close "<app name>"`); return; }
  const r = await runAction(store, { type: "close", name }, makeOpts(flags)); finish(r.result.ok, r.result.message);
}
async function cmdOpen(store: Store, flags: ParsedFlags): Promise<void> {
  const target = flags.rest.join(" ").trim(); if (!target) { warn(`usage: xr control open "<url or path>"`); return; }
  const r = await runAction(store, { type: "open", target }, makeOpts(flags)); finish(r.result.ok, r.result.message);
}
async function cmdType(store: Store, flags: ParsedFlags): Promise<void> {
  const text = flags.rest.join(" "); if (!text) { warn(`usage: xr control type "<text>"`); return; }
  const r = await runAction(store, { type: "type", text }, makeOpts(flags)); finish(r.result.ok, r.result.message);
}
async function cmdClick(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim();
  const m = raw.match(/\(?\s*(\d+)\s*[,\s]\s*(\d+)\s*\)?/);
  if (!m) { warn(`usage: xr control click "<x,y>" [--right|--double]`); return; }
  const button: "left" | "right" | "double" = flags.rest.includes("--right") ? "right" : flags.rest.includes("--double") ? "double" : "left";
  const r = await runAction(store, { type: "click", x: Number(m[1]), y: Number(m[2]), button }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdDrag(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ");
  const m = raw.match(/(\d+)[,\s]+(\d+)[^\d]+(\d+)[,\s]+(\d+)/);
  if (!m) { warn(`usage: xr control drag <x1,y1> <x2,y2>`); return; }
  const [, x1, y1, x2, y2] = m.map(Number);
  const r = await runAction(store, { type: "drag_drop", x1, y1, x2, y2 }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdMove(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim();
  const m = raw.match(/\(?\s*(\d+)\s*[,\s]\s*(\d+)\s*\)?/);
  if (!m) { warn(`usage: xr control move "<x,y>"`); return; }
  const r = await runAction(store, { type: "move", x: Number(m[1]), y: Number(m[2]) }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdScroll(store: Store, flags: ParsedFlags): Promise<void> {
  const dir = (flags.rest[0] ?? "").toLowerCase();
  if (!["up","down","left","right"].includes(dir)) { warn(`usage: xr control scroll <up|down|left|right> [amount]`); return; }
  const amount = Math.max(1, Math.min(50, Number(flags.rest[1]) || 3));
  const r = await runAction(store, { type: "scroll", direction: dir as any, amount }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdKey(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim(); if (!raw) { warn(`usage: xr control key "<ctrl+c | cmd+tab | enter>"`); return; }
  const keys = raw.split(/[+\s]+/).filter(Boolean);
  const r = await runAction(store, { type: "key", keys }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdFocus(store: Store, flags: ParsedFlags): Promise<void> {
  const name = flags.rest.join(" ").trim(); if (!name) { warn(`usage: xr control focus "<window name>"`); return; }
  const r = await runAction(store, { type: "focus", name }, makeOpts(flags)); finish(r.result.ok, r.result.message);
}

// ---- file / editor / screenshot / system ----
async function cmdFile(store: Store, flags: ParsedFlags): Promise<void> {
  const op = (flags.rest[0] || "list") as any;
  const path = flags.rest[1] || "~/";
  if (op === "write") {
    const content = flags.rest.slice(2).join(" ");
    const r = await runAction(store, { type: "file", op: "write", path, content }, makeOpts(flags));
    finish(r.result.ok, r.result.message); return;
  }
  if (op === "move") {
    const targetPath = flags.rest[2]; if (!targetPath) { warn(`usage: xr control file move <src> <dest>`); return; }
    const r = await runAction(store, { type: "file", op: "move", path, targetPath }, makeOpts(flags));
    finish(r.result.ok, r.result.message); return;
  }
  const r = await runAction(store, { type: "file", op, path }, makeOpts(flags));
  const data: any = r.result.data || {};
  if (data.text) console.log(data.text.slice(0, 4000));
  if (data.list) console.log(data.list);
  finish(r.result.ok, r.result.message);
}
async function cmdEditor(store: Store, flags: ParsedFlags): Promise<void> {
  const file = flags.rest[0]; if (!file) { warn(`usage: xr control editor <file> [line]`); return; }
  const line = Number(flags.rest[1]) || undefined;
  const r = await runAction(store, { type: "editor", op: "open", editor: "auto", file, line }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}
async function cmdScreenshot(store: Store, flags: ParsedFlags): Promise<void> {
  const r = await runAction(store, { type: "screenshot", target: "screen" }, makeOpts(flags));
  const data: any = r.result.data || {};
  if (data.path) info(`saved: ${data.path}`);
  finish(r.result.ok, r.result.message);
}
async function cmdSystem(store: Store, flags: ParsedFlags): Promise<void> {
  const op = flags.rest[0] || "notify";
  if (op === "clipboard") { const r = await runAction(store, { type: "system", op: "clipboard_read" }, makeOpts(flags)); console.log((r.result.data as any)?.text || ""); return; }
  const value = flags.rest.slice(1).join(" ") || "XR";
  const r = await runAction(store, { type: "system", op: "notify", title: "XR", value }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

// ---- computer-use ----
async function cmdComputer(store: Store, flags: ParsedFlags): Promise<void> {
  const task = flags.rest.join(" ").trim(); if (!task) { warn(`usage: xr control computer "<task>"`); return; }
  const { config } = loadConfig();
  const provider = buildProvider(config, {});
  banner();
  console.log(C.bold(`🤖 Computer-Use: ${task}`));
  const res = await runComputerUse(store, task, provider);
  console.log(""); ok(res);
}

// ---- plan ----
async function cmdPlan(store: Store, flags: ParsedFlags): Promise<void> {
  const task = flags.rest.join(" ").trim();
  if (!task) { warn(`usage: xr control plan "<task>" [--dry-run|--step|--yes]`); return; }
  banner(); console.log(C.bold(`🧭 Planning: ${task}`));
  const { config } = loadConfig();
  const provider = buildProvider(config, {});
  const memoryEnabled = config.control?.memory?.enabled !== false && !flags.noMemory;
  const planned = await planActions(provider, task, { store, noMemory: !memoryEnabled });
  if ("error" in planned) { warn(`planner failed: ${planned.error}`); return; }
  const plan = planned.plan;
  if (plan.actions.length === 0) { info(plan.rationale ?? "empty plan"); return; }
  if (planned.source === "memory") console.log(C.green(`  ⚡ recalled from memory — $0.00`));
  else console.log(C.dim(`  ✓ planned via ${provider.label}`));
  const opts = { ...makeOpts({ ...flags, mode: flags.mode === "auto" ? "dry-run" : flags.mode }), memory: memoryEnabled };
  const results = await runTypedPlan(store, plan, opts);
  const okCount = results.filter((r) => r.result.ok && !r.result.skipped).length;
  const skipped = results.filter((r) => r.result.skipped).length;
  const failed = results.filter((r) => !r.result.ok && !r.result.skipped).length;
  console.log(""); console.log(C.dim(`  → ${okCount} executed · ${skipped} skipped · ${failed} failed`));
  if (opts.mode === "dry-run") info(`Dry-run only. Re-run with --yes or --step to execute.`);
}

// ---- browser ----
async function cmdBrowser(store: Store, flags: ParsedFlags): Promise<void> {
  const sub = flags.rest[0];
  if (!sub || sub === "status") {
    const s = browserStatus();
    banner(); console.log(C.bold("🌐 Browser Backend (Playwright)"));
    console.log(`  installed ........ ${s.installed ? C.green("✓ yes") : C.red("✗ no")} ${s.reason ? C.dim(`(${s.reason})`) : ""}`);
    console.log(`  active session ... ${s.active ? C.green("✓ open") : C.dim("(none)")}`);
    if (s.url) console.log(`  current url ...... ${C.cyan(s.url)}`);
    if (!s.installed) info(`Install with: xr control browser install`);
    return;
  }
  if (sub === "install") {
    banner(); console.log(C.bold("📦 Installing Playwright + Chromium…"));
    const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
    const pm = hasBun ? ["bun", ["add", "playwright"]] : ["npm", ["install", "playwright"]];
    const r1 = spawnSync(pm[0] as string, pm[1] as string[], { stdio: "inherit" });
    if (r1.status !== 0) { warn("playwright install failed"); return; }
    const r2 = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    if (r2.status !== 0) { warn("chromium install failed"); return; }
    ok("Playwright + Chromium installed."); return;
  }
  if (sub === "close") { await shutdownBrowser(); ok("browser closed"); return; }
  warn(`unknown browser subcommand: ${sub}`);
}

// ---- permissions ----
async function cmdPermissions(): Promise<void> {
  const { listPermissions, grantPermission, revokePermission } = await import("./permissions.ts");
  const args = process.argv.slice(3);
  const sub = args[1] || "list";
  if (sub === "list") { console.log("granted:", listPermissions().join(", ") || "(none)"); console.log("available: desktop, browser, files_read, files_write, system, clipboard, vision_cloud"); return; }
  if (sub === "grant" && args[2]) { grantPermission(args[2] as any); ok(`granted ${args[2]}`); return; }
  if (sub === "revoke" && args[2]) { revokePermission(args[2] as any); ok(`revoked ${args[2]}`); return; }
  console.log("usage: xr control permissions [list|grant <scope>|revoke <scope>]");
}

// ---- help ----
function printHelp(): void {
  banner();
  console.log(`${C.bold("xr control")} — safe computer automation (Stage 9)

${C.bold("Setup")}
  xr control status          capabilities + permissions
  xr control start           enable control
  xr control stop            disable control
  xr control permissions list
  xr control permissions grant desktop|browser|files_read|files_write|system|clipboard|vision_cloud

${C.bold("Desktop")}
  xr control app "<name>"         launch app
  xr control close "<name>"       close app
  xr control focus "<name>"       focus window
  xr control type "<text>"        type text
  xr control click <x,y>          click
  xr control drag <x1,y1> <x2,y2> drag & drop
  xr control scroll <dir> [n]
  xr control key "<ctrl+c>"
  xr control screenshot

${C.bold("Files / Editor")}
  xr control file list ~/ 
  xr control file read <path>
  xr control file write <path> <content>
  xr control file move <src> <dest>
  xr control file delete <path>
  xr control file mkdir <path>
  xr control editor <file> [line]

${C.bold("Browser")}
  xr control browser status
  xr control browser install
  xr control browser close

${C.bold("AI")}
  xr control plan "<task>" [--dry-run|--step|--yes]
  xr control computer "<task>"    screenshot → reason → act loop

${C.bold("Flags")}
  --dry-run  --step  --yes  --no-memory  --delay <ms>
`);
}

// ---- entry ----
export async function handleControlCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));
  if (!sub || sub === "help") return printHelp();
  if (sub === "status") return cmdStatus();
  if (sub === "start") return cmdStart();
  if (sub === "stop") return cmdStop();
  if (sub === "app") return cmdApp(store, flags);
  if (sub === "close") return cmdClose(store, flags);
  if (sub === "open") return cmdOpen(store, flags);
  if (sub === "type") return cmdType(store, flags);
  if (sub === "click") return cmdClick(store, flags);
  if (sub === "drag") return cmdDrag(store, flags);
  if (sub === "move") return cmdMove(store, flags);
  if (sub === "scroll") return cmdScroll(store, flags);
  if (sub === "key") return cmdKey(store, flags);
  if (sub === "focus") return cmdFocus(store, flags);
  if (sub === "file") return cmdFile(store, flags);
  if (sub === "editor") return cmdEditor(store, flags);
  if (sub === "screenshot") return cmdScreenshot(store, flags);
  if (sub === "system") return cmdSystem(store, flags);
  if (sub === "computer") return cmdComputer(store, flags);
  if (sub === "plan") return cmdPlan(store, flags);
  if (sub === "browser") return cmdBrowser(store, flags);
  if (sub === "permissions") return cmdPermissions();
  warn(`unknown subcommand: ${sub}`); printHelp();
}
