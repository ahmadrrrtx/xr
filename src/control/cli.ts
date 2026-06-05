/**
 * XR v0.8 — Computer Control: CLI handlers.
 *
 * All `xr control …` subcommands route here.  The handlers stay thin: they
 * parse flags, build an Action, and hand it to the service.
 */

import type { Store } from "../state/db.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { detectCapabilities, isControlReady } from "./adapter.ts";
import { isDisabled, runAction, runPlan, runTypedPlan } from "./service.ts";
import type { Action, ControlOptions, ExecutionMode } from "./types.ts";
import { planActions } from "./planner.ts";
import { browserStatus, shutdownBrowser } from "./browser.ts";
import { listRemembered, forgetPlan, clearAllMemory, fingerprintTask } from "./memory.ts";
import { buildProvider } from "../providers/factory.ts";
import { spawnSync } from "node:child_process";

// ── flag helpers ────────────────────────────────────────────────────────────

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

// ── subcommands ─────────────────────────────────────────────────────────────

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
  console.log(`  default mode ..... ${C.cyan(config.control?.defaultMode ?? "auto")}`);

  if (caps.missing.length) {
    console.log("");
    console.log(C.amber("  Install these for full capability:"));
    for (const m of caps.missing) console.log(`    • ${m}`);
  }

  console.log("");
  console.log(C.bold("  Supported actions:"));
  for (const line of [
    "app   — launch an application",
    "open  — open a URL or file path",
    "type  — type text into the focused window",
    "click — left/right/double click at coordinates",
    "move  — move the cursor",
    "scroll — scroll up / down / left / right",
    "key   — press a key combination",
    "focus — bring an existing window to the front",
  ]) console.log(`    • ${C.dim(line)}`);

  if (!isControlReady(caps)) {
    console.log("");
    warn("Control is partially unavailable on this machine. Some actions will refuse.");
  } else if (!kill.disabled) {
    console.log("");
    ok("Computer control is ready.");
  }
}

async function cmdTest(store: Store, flags: ParsedFlags): Promise<void> {
  banner();
  console.log(C.bold("🧪 Computer Control: self-test"));
  info("Running a safe, dependency-only probe — no clicks, no keys are sent.");

  // 1) capability probe
  const caps = detectCapabilities();
  console.log(`  platform .. ${caps.os}`);
  console.log(`  launcher .. ${caps.tools.launcher ? "ok" : "missing"}`);
  console.log(`  keyboard .. ${caps.tools.keyboard ? "ok" : "missing"}`);

  // 2) dry-run a representative plan so the user sees the *exact* preview UX
  const opts: ControlOptions = { mode: "dry-run", autoApproveSensitive: false, delayMs: 0 };
  const sample: Action[] = [
    { type: "focus", name: "Finder" },
    { type: "open",  target: "https://example.com" },
    { type: "type",  text: "hello from xr control test" },
    { type: "key",   keys: ["enter"] },
  ];
  console.log("");
  console.log(C.bold("  Dry-run plan:"));
  await runPlan(store, sample, opts);

  console.log("");
  ok("self-test complete. Nothing was executed.");
  if (caps.missing.length) {
    warn(`Some tools are missing — see "xr control status" for install hints.`);
  }
}

async function cmdStart(): Promise<void> {
  // "start" simply enables the feature in config.  Persistent listener loops
  // belong in the voice/agent layer, not here, to keep responsibilities clean.
  const { config } = loadConfig();
  if (!config.control) (config as any).control = {};
  config.control!.enabled = true;
  saveConfig(config);
  ok("computer control enabled (config.control.enabled = true)");
  info('Run "xr control status" to verify capabilities.');
}

async function cmdStop(): Promise<void> {
  const { config } = loadConfig();
  if (!config.control) (config as any).control = {};
  config.control!.enabled = false;
  saveConfig(config);
  ok("computer control disabled. Every `xr control` action will now refuse.");
}

async function cmdApp(store: Store, flags: ParsedFlags): Promise<void> {
  const name = flags.rest.join(" ").trim();
  if (!name) { warn(`usage: xr control app "<app name>"`); return; }
  const r = await runAction(store, { type: "app", name }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdOpen(store: Store, flags: ParsedFlags): Promise<void> {
  const target = flags.rest.join(" ").trim();
  if (!target) { warn(`usage: xr control open "<url or path>"`); return; }
  const r = await runAction(store, { type: "open", target }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdType(store: Store, flags: ParsedFlags): Promise<void> {
  const text = flags.rest.join(" ");
  if (!text) { warn(`usage: xr control type "<text>"`); return; }
  const r = await runAction(store, { type: "type", text }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdClick(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim();
  if (!raw) { warn(`usage: xr control click "<x,y>" [--right|--double]`); return; }
  const m = raw.match(/^\(?\s*(\d+)\s*[, ]\s*(\d+)\s*\)?$/);
  if (!m) {
    warn(`v0.8 click requires coordinates like "640,480". Use "xr --computer" for vision-based targets.`);
    return;
  }
  const button: "left" | "right" | "double" =
    flags.rest.includes("--right") ? "right" :
    flags.rest.includes("--double") ? "double" : "left";
  const r = await runAction(store, { type: "click", x: Number(m[1]), y: Number(m[2]), button }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdMove(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim();
  const m = raw.match(/^\(?\s*(\d+)\s*[, ]\s*(\d+)\s*\)?$/);
  if (!m) { warn(`usage: xr control move "<x,y>"`); return; }
  const r = await runAction(store, { type: "move", x: Number(m[1]), y: Number(m[2]) }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdScroll(store: Store, flags: ParsedFlags): Promise<void> {
  const dir = (flags.rest[0] ?? "").toLowerCase();
  if (!["up", "down", "left", "right"].includes(dir)) {
    warn(`usage: xr control scroll <up|down|left|right> [amount]`);
    return;
  }
  const amount = Math.max(1, Math.min(50, Number(flags.rest[1]) || 3));
  const r = await runAction(store, { type: "scroll", direction: dir as any, amount }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdKey(store: Store, flags: ParsedFlags): Promise<void> {
  const raw = flags.rest.join(" ").trim();
  if (!raw) { warn(`usage: xr control key "<ctrl+c | cmd+tab | enter>"`); return; }
  const keys = raw.split(/[+\s]+/).filter(Boolean);
  const r = await runAction(store, { type: "key", keys }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

async function cmdFocus(store: Store, flags: ParsedFlags): Promise<void> {
  const name = flags.rest.join(" ").trim();
  if (!name) { warn(`usage: xr control focus "<window name>"`); return; }
  const r = await runAction(store, { type: "focus", name }, makeOpts(flags));
  finish(r.result.ok, r.result.message);
}

function finish(success: boolean, msg: string): void {
  if (success) ok(msg);
  else warn(msg);
}

// ── plan / run (multi-step) ────────────────────────────────────────────────

async function cmdPlan(store: Store, flags: ParsedFlags): Promise<void> {
  const task = flags.rest.join(" ").trim();
  if (!task) { warn(`usage: xr control plan "<task>"  [--dry-run|--step|--yes] [--no-memory]`); return; }
  banner();
  console.log(C.bold(`🧭 Planning: ${task}`));

  const { config } = loadConfig();
  const provider = buildProvider(config, {});
  const memoryEnabled = config.control?.memory?.enabled !== false && !flags.noMemory;
  const planned = await planActions(provider, task, { store, noMemory: !memoryEnabled });
  if ("error" in planned) {
    warn(`planner failed: ${planned.error}`);
    return;
  }
  const plan = planned.plan;
  if (plan.actions.length === 0) {
    info(plan.rationale ?? "planner returned an empty plan");
    return;
  }

  // Show source so the user knows when LLM cost was spent vs cached.
  if (planned.source === "memory") {
    console.log(C.green(`  ⚡ recalled from memory — no LLM call`));
  } else {
    console.log(C.dim(`  ✓ planned via ${provider.label}`));
  }

  // Default to dry-run for `plan` unless user passed an explicit flag.
  const opts = { ...makeOpts({ ...flags, mode: flags.mode === "auto" ? "dry-run" : flags.mode }), memory: memoryEnabled };
  const results = await runTypedPlan(store, plan, opts);

  const okCount = results.filter((r) => r.result.ok && !r.result.skipped).length;
  const skipped = results.filter((r) => r.result.skipped).length;
  const failed = results.filter((r) => !r.result.ok && !r.result.skipped).length;
  console.log("");
  console.log(C.dim(`  → ${okCount} executed · ${skipped} skipped · ${failed} failed`));
  if (opts.mode === "dry-run") {
    info(`Dry-run only. Re-run with "xr control plan \\"${task}\\" --yes" or "--step" to execute.`);
  } else if (okCount === plan.actions.length && memoryEnabled && planned.source === "llm") {
    info(`Remembered. Next time you run this task XR will skip the LLM.`);
  }
}

async function cmdRun(store: Store, flags: ParsedFlags): Promise<void> {
  // Read a JSON Action[] from stdin and execute through the safety pipeline.
  const stdin = await readAllStdin();
  if (!stdin.trim()) {
    warn(`usage: cat plan.json | xr control run [--dry-run|--step|--yes]`);
    return;
  }
  let parsed: any;
  try { parsed = JSON.parse(stdin); } catch (e) {
    warn(`invalid JSON: ${(e as Error).message}`);
    return;
  }
  const actions: unknown[] = Array.isArray(parsed) ? parsed
    : Array.isArray(parsed?.actions) ? parsed.actions
    : [];
  if (!actions.length) {
    warn("no actions found in input (expected JSON array, or { actions: [...] })");
    return;
  }
  await runPlan(store, actions, makeOpts(flags));
}

async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin as any) data += chunk;
  return data;
}

// ── browser subcommands ───────────────────────────────────────────────────

// ── memory subcommands ────────────────────────────────────────────────────

async function cmdMemory(store: Store, flags: ParsedFlags): Promise<void> {
  const sub = flags.rest[0];

  if (!sub || sub === "list") {
    banner();
    console.log(C.bold("🧠 Remembered Computer-Control Plans"));
    const entries = listRemembered(store);
    if (!entries.length) {
      info("nothing remembered yet — successful plans get cached automatically.");
      return;
    }
    for (const e of entries) {
      const when = new Date(e.rememberedAt).toISOString().replace("T", " ").slice(0, 19);
      console.log(`  ${C.cyan(e.baselineId)} ${C.dim("·")} ${C.bold(e.task)} ${C.dim(`(${e.actions.length} steps · ${e.hits} hits · ${when})`)}`);
    }
    console.log("");
    info(`use "xr control memory show <id>" to inspect, or "forget <id|task>" to delete.`);
    return;
  }

  if (sub === "show") {
    const key = flags.rest.slice(1).join(" ").trim();
    if (!key) { warn(`usage: xr control memory show <baseline-id|task>`); return; }
    const all = listRemembered(store);
    const match = all.find((e) => e.baselineId === key || e.skillId === key || e.task === key)
      ?? all.find((e) => e.skillId === fingerprintTask(key));
    if (!match) { warn(`no remembered plan matches: ${key}`); return; }
    banner();
    console.log(C.bold("🧠 ") + match.task);
    console.log(C.dim(`  ${match.baselineId} · ${match.actions.length} steps · ${match.hits} hits`));
    console.log("");
    for (let i = 0; i < match.actions.length; i++) {
      console.log(`  ${C.dim(String(i + 1).padStart(2) + ".")} ${JSON.stringify(match.actions[i])}`);
    }
    return;
  }

  if (sub === "forget") {
    const key = flags.rest.slice(1).join(" ").trim();
    if (!key) { warn(`usage: xr control memory forget <baseline-id|task>`); return; }
    const res = forgetPlan(store, key);
    if (res.ok) ok(res.reason); else warn(res.reason);
    return;
  }

  if (sub === "clear") {
    const { confirm } = await import("../interfaces/cli.ts");
    const yes = flags.yes || await confirm("Forget ALL remembered control plans?", false);
    if (!yes) { info("cancelled."); return; }
    const n = clearAllMemory(store);
    ok(`forgot ${n} entr${n === 1 ? "y" : "ies"}.`);
    return;
  }

  warn(`unknown memory subcommand: ${sub}. Use list, show, forget, or clear.`);
}

async function cmdBrowser(store: Store, flags: ParsedFlags): Promise<void> {
  const sub = flags.rest[0];
  if (!sub || sub === "status") {
    const s = browserStatus();
    banner();
    console.log(C.bold("🌐 Browser Backend (Playwright)"));
    console.log(`  installed ........ ${s.installed ? C.green("✓ yes") : C.red("✗ no")} ${s.reason ? C.dim(`(${s.reason})`) : ""}`);
    console.log(`  active session ... ${s.active ? C.green("✓ open") : C.dim("(none)")}`);
    if (s.url) console.log(`  current url ...... ${C.cyan(s.url)}`);
    if (!s.installed) {
      console.log("");
      info(`Install with: xr control browser install`);
    }
    return;
  }
  if (sub === "install") {
    banner();
    console.log(C.bold("📦 Installing Playwright + Chromium…"));
    info("This downloads ~150 MB and takes 1–2 minutes.");
    // Use bun if available, otherwise npm. Always at the project root.
    const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;
    const pmInstall = hasBun ? ["bun", ["add", "playwright"]] : ["npm", ["install", "playwright"]];
    const r1 = spawnSync(pmInstall[0] as string, pmInstall[1] as string[], { stdio: "inherit" });
    if (r1.status !== 0) { warn("playwright install failed"); return; }
    const r2 = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit" });
    if (r2.status !== 0) { warn("chromium install failed"); return; }
    ok("Playwright + Chromium installed.");
    info(`Try: xr control plan "open github.com and search for ahmadrrrtx" --yes`);
    return;
  }
  if (sub === "close") {
    await shutdownBrowser();
    ok("browser closed");
    return;
  }
  warn(`unknown browser subcommand: ${sub}. Use status, install, or close.`);
}

function printHelp(): void {
  banner();
  console.log(`${C.bold("xr control")} — safe, explicit computer automation

${C.bold("Setup")}
  xr control status                         show capabilities + missing deps
  xr control test                           dry-run a self-test plan
  xr control start                          enable control in config
  xr control stop                           disable control completely

${C.bold("Actions")}
  xr control app   "<app name>"             launch an application
  xr control open  "<url or path>"          open a URL or local path
  xr control type  "<text>"                 type into the focused window
  xr control click "<x,y>" [--right|--double]
  xr control move  "<x,y>"                  move the cursor
  xr control scroll <up|down|left|right> [n]
  xr control key   "<ctrl+c>"               press a key combo
  xr control focus "<window>"               focus an existing window

${C.bold("Multi-step")}
  xr control plan  "<task>"                 LLM plans → preview (dry-run default)
  xr control plan  "<task>" --yes           plan and execute (with approvals)
  cat plan.json | xr control run            execute a pre-built JSON plan

${C.bold("Browser")}
  xr control browser status                 check Playwright availability
  xr control browser install                install playwright + chromium
  xr control browser close                  close the active browser session

${C.bold("Memory")}
  xr control memory list                    list remembered plans
  xr control memory show <id|task>          inspect a remembered plan
  xr control memory forget <id|task>        delete one entry
  xr control memory clear                   forget everything (asks confirmation)

${C.bold("Flags (any subcommand)")}
  --dry-run         show the plan, execute nothing
  --step            confirm every single action
  --yes, -y         auto-approve SENSITIVE actions only
                    (destructive actions always prompt)
  --no-memory       skip memory recall + don't remember this plan
  --delay <ms>      pause between actions in a plan

${C.bold("Disable everything")}
  xr control stop                           or  XR_CONTROL_DISABLED=1
`);
}

// ── entry point ─────────────────────────────────────────────────────────────

export async function handleControlCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];
  const flags = parseFlags(argv.slice(1));

  if (!sub || sub === "help" || sub === "--help" || sub === "-h") return printHelp();
  if (sub === "status") return cmdStatus();
  if (sub === "test")   return cmdTest(store, flags);
  if (sub === "start")  return cmdStart();
  if (sub === "stop")   return cmdStop();
  if (sub === "app")    return cmdApp(store, flags);
  if (sub === "open")   return cmdOpen(store, flags);
  if (sub === "type")   return cmdType(store, flags);
  if (sub === "click")  return cmdClick(store, flags);
  if (sub === "move")   return cmdMove(store, flags);
  if (sub === "scroll") return cmdScroll(store, flags);
  if (sub === "key")    return cmdKey(store, flags);
  if (sub === "focus")   return cmdFocus(store, flags);
  if (sub === "plan")    return cmdPlan(store, flags);
  if (sub === "run")     return cmdRun(store, flags);
  if (sub === "browser") return cmdBrowser(store, flags);
  if (sub === "memory")  return cmdMemory(store, flags);

  warn(`unknown subcommand: ${sub}`);
  printHelp();
}
