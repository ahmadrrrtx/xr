/**
 * XR Stage 9 — Computer Control: CLI handlers.
 */
import type { Store } from "../state/db.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { detectCapabilities } from "./adapter.ts";
import { isDisabled, runAction, runTypedPlan, runComputerUse } from "./service.ts";
import type { Action, ControlOptions, ExecutionMode } from "./types.ts";
import { planActions } from "./planner.ts";
import { browserStatus, shutdownBrowser } from "./browser.ts";
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

// ---- Commands ----

async function cmdStatus(): Promise<void> {
  banner();
  const caps = detectCapabilities();
  const kill = isDisabled();
  const b = browserStatus();
  console.log(C.bold("🖥  Computer Control Status"));
  console.log(`  enabled .......... ${kill.disabled ? C.red(`✗ ${kill.reason}`) : C.green("✓ yes")}`);
  console.log(`  platform ......... ${C.cyan(caps.os)}`);
  console.log(`  keyboard ......... ${caps.tools.keyboard ? C.green("✓") : C.red("✗")}`);
  console.log(`  mouse ............ ${caps.tools.mouse ? C.green("✓") : C.red("✗")}`);
  console.log(`  browser .......... ${b.installed ? C.green("✓ installed") : C.amber("! missing playwright")}`);
  if (b.active) console.log(`  browser session .. ${C.green("● active")} (${b.tabs} tabs)`);
  console.log("");
}

async function cmdTest(store: Store): Promise<void> {
  banner();
  console.log(C.bold("🧪 Control Self-Test"));
  const actions: Action[] = [
    { type: "system", op: "notify", title: "XR Test", value: "Starting control test..." },
    { type: "wait_ms", ms: 500 }
  ];
  for (const a of actions) {
    const res = await runAction(store, a, { mode: "auto" });
    if (!res.result.ok) { warn(`test failed: ${res.result.message}`); return; }
  }
  ok("Self-test passed.");
}

async function cmdPlan(store: Store, flags: ParsedFlags): Promise<void> {
  const task = flags.rest.join(" ").trim();
  if (!task) { warn("usage: xr control plan \"<task>\""); return; }
  
  const { config } = loadConfig();
  const provider = buildProvider(config, {});
  
  info(`Planning: ${task}...`);
  const planned = await planActions(provider, task, { store, noMemory: flags.noMemory });
  if ("error" in planned) { warn(planned.error); return; }

  const opts = { ...makeOpts(flags), memory: !flags.noMemory };
  await runTypedPlan(store, planned.plan, opts);
}

async function cmdComputer(store: Store, flags: ParsedFlags): Promise<void> {
  const task = flags.rest.join(" ").trim();
  if (!task) { warn("usage: xr control computer \"<task>\""); return; }
  
  const { config } = loadConfig();
  const provider = buildProvider(config, {});
  banner();
  const result = await runComputerUse({ provider, store, task });
  console.log("");
  ok(`Task Complete: ${result}`);
}

async function cmdBrowser(flags: ParsedFlags): Promise<void> {
  const sub = flags.rest[0];
  if (sub === "install") {
    info("Installing browser dependencies...");
    spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    ok("Browser engine ready.");
  } else if (sub === "close") {
    await shutdownBrowser();
    ok("Browser closed.");
  } else {
    const s = browserStatus();
    console.log(`Browser status: ${s.installed ? "Installed" : "Not installed"}, Session: ${s.active ? "Active" : "None"}`);
  }
}

export async function handleControlCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));

  switch (sub) {
    case "status": return cmdStatus();
    case "start": {
      const { config } = loadConfig(); 
      if (!config.control) (config as any).control = { enabled: true };
      else config.control.enabled = true;
      saveConfig(config);
      return ok("Computer control enabled.");
    }
    case "stop": {
      const { config } = loadConfig();
      if (config.control) config.control.enabled = false;
      saveConfig(config);
      return ok("Computer control disabled.");
    }
    case "test": return cmdTest(store);
    case "plan": return cmdPlan(store, flags);
    case "preview": return cmdPlan(store, { ...flags, mode: "dry-run" });
    case "execute": return cmdPlan(store, { ...flags, mode: "auto", yes: true });
    case "computer": return cmdComputer(store, flags);
    case "browser": return cmdBrowser(flags);
    case "desktop": return cmdStatus(); // Alias for status in desktop context
    case "app": return void (await runAction(store, { type: "app", name: flags.rest.join(" ") }, makeOpts(flags)));
    case "open": return void (await runAction(store, { type: "open", target: flags.rest.join(" ") }, makeOpts(flags)));
    case "click": {
      const m = flags.rest[0]?.match(/(\d+),(\d+)/);
      if (!m) return warn("usage: xr control click x,y");
      return void (await runAction(store, { type: "click", x: Number(m[1]), y: Number(m[2]), button: "left" }, makeOpts(flags)));
    }
    case "type": return void (await runAction(store, { type: "type", text: flags.rest.join(" ") }, makeOpts(flags)));
    default:
      console.log(`
XR Computer Control
  xr control status          check status
  xr control start/stop      enable/disable
  xr control test            run self-test
  xr control plan "<task>"   plan and execute
  xr control computer "<t>"  agentic vision loop
  xr control browser install install playwright
  
  xr control app <name>      launch app
  xr control open <url>      open url
  xr control click <x,y>     click coordinates
  xr control type <text>     type text
      `);
  }
}
