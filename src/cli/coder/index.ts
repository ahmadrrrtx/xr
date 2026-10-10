/**
 * `xr` — the coding agent entry point.
 *
 * Modes (chosen from TTY-ness, flags and arguments):
 *   REPL      no prompt, interactive stdin and stdout  → line editor + turns
 *   one-shot  a prompt (argument, -p, or piped stdin)  → one turn, then exit
 *   print     -p / --print                             → read-only tools
 *   diff      --diff                                   → proposed diffs only
 *   json      --json                                   → JSON Lines events
 *
 * Exit codes follow the repo-wide table in src/cli/flags.ts (EXIT): 0 ok,
 * 1 error or budget/step limit, 2 usage, 4 approval denied (a non-interactive
 * run could not get approval), 130 interrupted.
 */

import { openSync, readSync, closeSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { AgentResult } from "../../core/agent.ts";
import { EXIT } from "../flags.ts";
import { CoderSession, type AgentPort } from "./session.ts";
import type { ConsentWrap } from "./consent.ts";
import {
  DEFAULT_TOOLS,
  READ_ONLY_TOOLS,
  resolveToolList,
  type ApprovalMode,
  type PermissionRules,
} from "./permissions.ts";
import {
  buildSystemPrompt,
  detectProjectType,
  gitState,
  listProjectFiles,
  loadProjectRules,
  type RulesFile,
} from "./context.ts";
import { resolveMentions, withAttachments } from "./mentions.ts";
import {
  cliConfigPath,
  historyPath,
  loadCliConfig,
  providerChoices,
  providerWithKey,
  registerEnvSecrets,
  resolveSettings,
  type CoderConfig,
} from "./config.ts";
import { JsonUI, TtyUI, type CoderUI } from "./ui.ts";
import { appendHistory, loadHistory, readLine, Terminal } from "./tty.ts";
import { style, out, err, initStyle } from "./style.ts";
import { runWizard } from "./wizard.ts";
import { secretBrokerSync } from "../../security/secret-broker.ts";

export interface CoderRequest {
  /** Positional prompt words (joined with spaces). */
  prompt?: string;
  /** Value of -p/--print when a prompt was given with the flag. */
  printPrompt?: string;
  /** `-p` with no value: the prompt comes from stdin. */
  print: boolean;
  json: boolean;
  diffOnly: boolean;
  approveAll: boolean;
  tools?: string;
  noHistory: boolean;
  noColor: boolean;
  cwd: string;
  model?: string;
  provider?: string;
  configPath?: string;
  /** Piped stdin, read before the run (only when stdin is not a TTY). */
  stdinText?: string;
  maxSteps?: number;
  /** Token budget for the whole task (`--max-tokens`); the engine stops the task when it is spent. */
  maxTokens?: number;
}

export interface CoderDeps {
  agent: AgentPort;
  term: Terminal;
  /** Durable-store consent wrapper (see consent.ts). */
  consent?: ConsentWrap;
  /** Read the typed confirmation for --approve-all when stdin is not a terminal. */
  readTypedConfirm?: () => string | null;
}

const MAX_STDIN_BYTES = 1_000_000;

export async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > MAX_STDIN_BYTES) break;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, MAX_STDIN_BYTES);
}

/** Typed confirmation read from /dev/tty when stdin is a pipe. Null if no terminal is reachable. */
export function readTtyLine(): string | null {
  try {
    const fd = openSync("/dev/tty", "r");
    try {
      const buf = Buffer.alloc(64);
      const n = readSync(fd, buf, 0, buf.length, null);
      return buf.subarray(0, n).toString("utf8").split(/\r?\n/)[0] ?? "";
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
}

const NETWORK_ERROR = /unable to connect|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|timed? ?out|network/i;

/**
 * Exit codes (Accessibility §4.7): 0 done, 1 error, 2 usage (handled before the
 * run), 3 network/provider unreachable, 4 an action needed approval and was
 * refused, 130 cancelled. A `done` run with auto-denied actions is 4, because
 * the task may be incomplete. Exit 0 never proves the task succeeded.
 */
export function exitCodeFor(result: AgentResult, autoDenied: number): number {
  if (result.stopped === "cancelled") return EXIT.INTERRUPT;
  if (result.stopped === "done") return autoDenied > 0 ? EXIT.DENIED : EXIT.OK;
  if (result.stopped === "approval") return EXIT.DENIED;
  if (result.stopped === "error" && NETWORK_ERROR.test(result.finalMessage ?? "")) return EXIT.NETWORK;
  return EXIT.ERROR;
}

export function describeStop(result: AgentResult): string {
  switch (result.stopped) {
    case "budget":
      return "budget limit reached (raise it in the desktop app or `xr run --budget`)";
    case "max_steps":
      return "step limit reached before the task finished";
    case "approval":
      return "stopped waiting for approval";
    case "error":
      return result.finalMessage || "the model returned an error";
    default:
      return result.stopped;
  }
}

export async function runCoder(req: CoderRequest, deps: CoderDeps): Promise<number> {
  const interactiveTty = deps.term.isTTY && Boolean(process.stdout.isTTY) && !req.json;
  const isRepl = !req.prompt && !req.printPrompt && !req.print && !req.stdinText && interactiveTty;
  initStyle({ isTTY: Boolean(process.stdout.isTTY), noColor: req.noColor });

  const cfgPath = cliConfigPath(req.configPath);
  let cfg: CoderConfig;
  try {
    cfg = loadCliConfig(cfgPath);
  } catch (e) {
    err(`${style.red("✕")} ${(e as Error).message}`);
    return EXIT.ERROR;
  }
  registerEnvSecrets();

  if (!cfg.provider && !providerWithKey() && !process.env.XR_PROVIDER && !req.provider) {
    if (!isRepl) {
      err(
        `${style.red("✕")} No model is configured.\n` +
          "  Run `xr` in a terminal to set one up, or set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY.",
      );
      return EXIT.ERROR;
    }
    if (!deps.term.isTTY) return EXIT.ERROR;
    deps.term.start();
    try {
      const created = await runWizard(deps.term, cfgPath);
      if (!created) return EXIT.USAGE;
      cfg = created;
    } finally {
      deps.term.stop();
    }
  }

  const settings = resolveSettings({ provider: req.provider, model: req.model }, cfg);
  const choice = providerChoices().find((c) => c.id === settings.provider);
  if (settings.provider && choice?.keyEnv && !secretBrokerSync(choice.keyEnv)) {
    err(
      `${style.red("✕")} No API key for ${choice.label}.\n` +
        `  Set ${choice.keyEnv} in your environment, or run \`xr\` and re-run setup.`,
    );
    return EXIT.ERROR;
  }

  // Approval mode. --approve-all needs a typed confirmation and is never allowed to bypass dangerous commands.
  let mode: ApprovalMode = "default";
  if (req.approveAll) {
    const confirmed = await confirmApproveAll(deps);
    if (!confirmed) return EXIT.USAGE;
    mode = "yolo";
  }

  const readOnly = req.print;
  const base = readOnly ? READ_ONLY_TOOLS : DEFAULT_TOOLS;
  const tools = resolveToolList(req.tools, base);
  if (tools.length === 0) {
    err(`${style.red("✕")} --tools selected no available tools (available: ${base.join(", ")}).`);
    return EXIT.USAGE;
  }

  const cwd = resolve(req.cwd);
  const rules = loadProjectRules(cwd);
  const project = detectProjectType(cwd);
  const git = gitState(cwd);
  const files = listProjectFiles(cwd);
  const systemPrompt = buildSystemPrompt({ cwd, rules, project, git, files, readOnly });

  const statusToStderr = !process.stdout.isTTY || req.json;
  const ui: CoderUI = req.json ? new JsonUI() : new TtyUI(deps.term, statusToStderr);

  if (isRepl) {
    return runRepl({ req, deps, ui, cwd, settings, tools, mode, rules, permissions: cfg.permissions ?? {}, systemPrompt, git, files, project });
  }

  // One-shot: build the prompt from argument, -p value, and piped stdin.
  let prompt = [req.prompt, req.printPrompt].filter(Boolean).join(" ").trim();
  if (req.stdinText) {
    const body = req.stdinText.trimEnd();
    prompt = prompt
      ? `${prompt}\n\n<stdin>\n${body}\n</stdin>`
      : body;
  }
  if (!prompt) {
    err(`${style.red("✕")} No prompt. Usage: xr "your task"   or   xr -p "question"   or   cat file | xr "explain"`);
    return EXIT.USAGE;
  }

  if (req.json) ui.banner([`xr ${settings.provider ?? ""}/${settings.model ?? ""}`, `cwd ${cwd}`]);
  if (rules) ui.notice(`Loaded ${rules.source} as project rules`);

  const mentions = resolveMentions(cwd, prompt);
  for (const note of mentions.notes) ui.notice(note, "warn");
  const fullPrompt = withAttachments(prompt, mentions.attachments);

  const session = new CoderSession(deps.agent, ui, {
    cwd,
    systemPrompt,
    tools,
    ...(deps.consent ? { consent: deps.consent } : {}),
    ...(settings.provider ? { provider: settings.provider } : {}),
    ...(settings.model ? { model: settings.model } : {}),
    mode,
    rules: cfg.permissions ?? {},
    interactive: deps.term.isTTY && !req.json,
    diffOnly: req.diffOnly,
    maxSteps: req.maxSteps ?? 16,
    ...(req.maxTokens ? { maxTokens: req.maxTokens } : {}),
    editorHooks: { suspend: () => deps.term.stop(), resume: () => deps.term.start() },
  });

  const controller = new AbortController();
  let interrupts = 0;
  const onInterrupt = (): void => {
    interrupts++;
    if (interrupts >= 2) process.exit(EXIT.INTERRUPT);
    controller.abort();
    err(style.yellow("interrupted — stopping at the next step (Ctrl+C again to force quit)"));
  };
  process.on("SIGINT", onInterrupt);
  const unkey = deps.term.isTTY ? deps.term.on((k) => (k.name === "ctrl-c" ? onInterrupt() : undefined)) : () => {};
  if (deps.term.isTTY) deps.term.start();

  let result: AgentResult;
  try {
    result = await session.turn(fullPrompt, controller.signal);
  } catch (e) {
    ui.notice(e instanceof Error ? e.message : String(e), "error");
    return EXIT.ERROR;
  } finally {
    process.off("SIGINT", onInterrupt);
    unkey();
    if (deps.term.isTTY) deps.term.stop();
  }

  if (req.diffOnly) {
    if (session.proposedDiffs.length === 0) ui.notice("no edits proposed");
    for (const d of session.proposedDiffs) ui.diff(d.path, d.patch);
  }
  if (result.stopped !== "done" && result.stopped !== "cancelled") {
    ui.notice(describeStop(result), "error");
  }
  ui.finish?.();
  return exitCodeFor(result, session.autoDeniedCount);
}

async function confirmApproveAll(deps: CoderDeps): Promise<boolean> {
  err(style.red("Auto-approval ON. XR will edit files and run commands without asking. Dangerous commands still ask."));
  if (deps.term.isTTY) {
    deps.term.start();
    try {
        const answer = await readLine(deps.term, style.red("Type 'yes' to continue: "), []);
      return answer.kind === "line" && answer.text.trim() === "yes";
    } finally {
      deps.term.stop();
    }
  }
  const typed = deps.readTypedConfirm ? deps.readTypedConfirm() : readTtyLine();
  if (typed === null) {
    err(`${style.red("✕")} --approve-all needs a terminal to confirm (type "yes"). Refusing to run unattended.`);
    return false;
  }
  if (typed.trim() !== "yes") {
    err(`${style.red("✕")} confirmation not given; --approve-all cancelled.`);
    return false;
  }
  return true;
}

interface ReplContext {
  req: CoderRequest;
  deps: CoderDeps;
  ui: CoderUI;
  cwd: string;
  settings: { provider?: string; model?: string };
  tools: string[];
  mode: ApprovalMode;
  rules: RulesFile | null;
  permissions: PermissionRules;
  systemPrompt: string;
  git: ReturnType<typeof gitState>;
  files: string[];
  project: ReturnType<typeof detectProjectType>;
}

async function runRepl(c: ReplContext): Promise<number> {
  const { deps, ui, cwd, settings } = c;
  const term = deps.term;
  const history = c.req.noHistory ? [] : loadHistory(historyPath());
  const session = new CoderSession(deps.agent, ui, {
    cwd,
    ...(deps.consent ? { consent: deps.consent } : {}),
    systemPrompt: c.systemPrompt,
    tools: c.tools,
    ...(settings.provider ? { provider: settings.provider } : {}),
    ...(settings.model ? { model: settings.model } : {}),
    mode: c.mode,
    rules: c.permissions,
    interactive: true,
    diffOnly: false,
    maxSteps: c.req.maxSteps ?? 16,
    ...(c.req.maxTokens ? { maxTokens: c.req.maxTokens } : {}),
    editorHooks: { suspend: () => term.stop(), resume: () => term.start() },
  });

  const rel = relative(process.env.HOME ?? "", cwd);
  const shownCwd = rel && !rel.startsWith("..") ? `~/${rel}` : cwd;
  const banner = [
    `xr v1.0 · coding agent · ${settings.provider ?? "?"}/${settings.model ?? "?"} · cwd: ${shownCwd}`,
    "Type a task or @file to add context. Ctrl+C cancel, Ctrl+D exit.",
  ];
  if (c.mode === "yolo") ui.notice("Auto-approval ON (--approve-all).", "warn");
  ui.banner(banner);
  if (c.rules) ui.notice(`Loaded ${c.rules.source} as project rules`);
  if (c.git.isRepo) ui.notice(`git: ${c.git.branch ?? "detached"}${c.git.status.length ? ` · ${c.git.status.length} changed` : ""}`);

  term.start();
  let lastInterrupt = 0;
  const prompt = style.cyan(style.bold("❯ "));
  try {
    for (;;) {
      const line = await readLine(term, prompt, history);
      if (line.kind === "eof") break;
      if (line.kind === "interrupt") {
        if (Date.now() - lastInterrupt < 2000) break;
        lastInterrupt = Date.now();
        ui.notice("press Ctrl+C again to exit (or Ctrl+D)");
        continue;
      }
      lastInterrupt = 0;
      const text = line.text.trim();
      if (!text) continue;
      if (!c.req.noHistory) appendHistory(historyPath(), text, history);
      if (text.startsWith("/")) {
        const handled = handleSlash(text, session, ui);
        if (handled === "exit") break;
        continue;
      }

      const mentions = resolveMentions(cwd, text);
      for (const note of mentions.notes) ui.notice(note, "warn");
      const fullPrompt = withAttachments(text, mentions.attachments);

      const controller = new AbortController();
      const unkey = term.on((k) => {
        if (k.name === "ctrl-c") {
          controller.abort();
          ui.notice("cancelling…");
        }
      });
      try {
        const result = await session.turn(fullPrompt, controller.signal);
        if (result.stopped === "cancelled") ui.notice("(cancelled)");
        else if (result.stopped !== "done") ui.notice(describeStop(result), "warn");
      } catch (e) {
        ui.notice(e instanceof Error ? e.message : String(e), "error");
      } finally {
        unkey();
      }
    }
  } finally {
    term.stop();
  }
  out(`${style.dim("bye")}\n`);
  return EXIT.OK;
}

function handleSlash(text: string, session: CoderSession, ui: CoderUI): "exit" | "continue" {
  const cmd = text.split(/\s+/)[0];
  switch (cmd) {
    case "/exit":
    case "/quit":
      return "exit";
    case "/clear":
      session.clear();
      out("\x1b[2J\x1b[H");
      return "continue";
    case "/help":
      ui.banner([
        "/clear  forget this conversation     /exit  quit",
        "@file   attach a file   @dir/  attach a folder   @file:10-40  attach lines",
        "Approvals: y yes · n no · a always this session · d show diff · v edit in $EDITOR · k stop turn",
      ]);
      return "continue";
    default:
      ui.notice(`unknown command ${cmd} (try /help)`, "warn");
      return "continue";
  }
}

/** Exported for tests. */

