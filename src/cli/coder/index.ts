/**
 * Phase 23 — `xr` (the coding agent). Entry point called by the router.
 *
 *   xr                    interactive REPL (TTY)
 *   xr "task"             one turn, then exit
 *   xr ask "task"         same as xr "task" (the router drops the word `ask`)
 *   echo x | xr "task"    piped stdin is attached to the task
 *   xr -p "question"      print mode: answer on stdout, read-only tools
 *   xr -d "task"          diff mode: every change is proposed, none is written
 *   xr --json "task"      JSON Lines events on stdout
 *
 * Returns an exit code; never calls process.exit (src/index.ts does that).
 */
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { GlobalFlags } from "../flags.ts";
import { ApprovalGate } from "./approvals.ts";
import { colorizeDiff } from "./diff.ts";
import { CODER_EXIT } from "./exit-codes.ts";
import { expandReferences, gatherProjectContext } from "./context.ts";
import { historyPath } from "./history.ts";
import { KeyInput } from "./key-input.ts";
import { bannerLines, summaryLine } from "./renderer.ts";
import { runRepl } from "./repl.ts";
import { isOnboarded, markOnboarded, runWizard, typedYes, xrHome } from "./setup.ts";
import { Sink, type SinkMode } from "./sink.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { exitCodeFor, runTurn, type CoderContext, type TurnSummary } from "./turn.ts";

export interface CoderInput {
  flags: GlobalFlags;
  /** Positional words after the global flags (the prompt; `ask` already removed). */
  words: string[];
  /** The router saw a free-form task (a non-command word), so a near-miss tip may apply. */
  fromTask?: boolean;
}

/** Tools the coding agent may use. The engine's approval plane governs each one. */
export const CODING_TOOLS = ["read_file", "list_dir", "search_code", "write_file", "patch_file", "delete_file", "shell", "fetch_url", "web_search"] as const;
/** Print mode's default: nothing that changes the project or runs a command. */
export const READ_ONLY_TOOLS = ["read_file", "list_dir", "search_code", "fetch_url", "web_search"] as const;

export async function runCoderCommand(input: CoderInput): Promise<number> {
  const { flags } = input;
  const cwdArg = flags.cwd;

  // ── Environment that must be set before any engine module loads ────────────
  if (flags.configPath) {
    const target = resolve(flags.configPath);
    // A `.json` file selects its directory as the XR home; anything else is the home itself.
    process.env.XR_HOME = target.endsWith(".json") ? resolve(target, "..") : target;
  }
  if (cwdArg) {
    const dir = resolve(cwdArg);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      process.stderr.write(`error: --cwd is not a directory: ${cwdArg}\n`);
      return CODER_EXIT.ERROR;
    }
    process.chdir(dir);
  }
  // The coder runs its own shell tool. The engine's hardened mode blocks every shell
  // command without an isolated runner, so the coder turns it off unless the user has
  // set XR_TRUST_HARDENED. Approvals still gate every command.
  if (process.env.XR_TRUST_HARDENED === undefined) process.env.XR_TRUST_HARDENED = "0";

  const cwd = process.cwd();
  const stdinTTY = Boolean(process.stdin.isTTY);
  const stdoutTTY = Boolean(process.stdout.isTTY);
  const prompt = input.words.join(" ").trim();

  // ── Mode ───────────────────────────────────────────────────────────────────
  const interactive = stdinTTY && stdoutTTY && !prompt && !flags.print && !flags.diff && !flags.json;
  const sinkMode: SinkMode = flags.json ? "json" : stdoutTTY && !flags.print ? "tty" : "plain";
  const sink = new Sink(sinkMode, !flags.noColor && !process.env.NO_COLOR);
  const p = sink.p;

  if (input.fromTask && input.words.length === 1) await nearMissTip(input.words[0]!);

  // Piped stdin becomes part of the task (`git diff | xr "review this"`).
  const piped = stdinTTY ? "" : await readStdin();
  let task = prompt;
  if (piped.trim()) task = prompt ? `${prompt}\n\n<stdin>\n${piped.trim()}\n</stdin>` : piped.trim();

  if (!interactive && !task) {
    sink.error('no task given. Try: xr "your task", or run xr in a terminal for the REPL.');
    return CODER_EXIT.ERROR;
  }

  const toolsAllow = resolveTools(flags.tools, flags.print);
  if (!toolsAllow) {
    sink.error(`--tools: unknown tool in "${flags.tools}"`);
    return CODER_EXIT.ERROR;
  }

  // Caps are validated before anything boots: a bad cap must never silently mean "no cap".
  if (flags.maxSteps !== undefined && !(Number.isInteger(flags.maxSteps) && flags.maxSteps >= 1 && flags.maxSteps <= 200)) {
    sink.error(`--max-steps must be a whole number from 1 to 200 (got "${flags.maxSteps}")`);
    return CODER_EXIT.ERROR;
  }
  if (flags.budget !== undefined && !(flags.budget > 0)) {
    sink.error(`--budget must be a positive USD amount (got "${flags.budget}")`);
    return CODER_EXIT.ERROR;
  }

  const approveAll = flags.approveAll && !flags.diff;
  if (approveAll && !interactive) {
    // Non-interactive --approve-all: a red warning, then a typed `yes` read from the terminal.
    process.stderr.write(`${p.red(p.bold("! --approve-all: every edit and command will run without asking."))}\n`);
    process.stderr.write(`${p.red("  Dangerous commands (rm -rf, sudo, curl | sh, paths under ~) still ask.")}\n`);
    if (!(await typedYes("Approve everything for this run?", p))) {
      sink.error("--approve-all was not confirmed. Nothing was run.");
      return CODER_EXIT.ERROR;
    }
  }

  // ── Boot the engine (profile: coder → agent) ───────────────────────────────
  const { bootKernelForCommand } = await import("../kernel-boot.ts");
  let kernel: Awaited<ReturnType<typeof bootKernelForCommand>>["kernel"];
  try {
    ({ kernel } = await bootKernelForCommand("coder"));
  } catch (err) {
    sink.error(`could not start the engine: ${(err as Error).message}`);
    return CODER_EXIT.ERROR;
  }

  try {
    const { Tokens } = await import("../../core/tokens.ts");
    const agent = kernel.registry.resolve(Tokens.Agent);
    const config = kernel.registry.resolve(Tokens.Config);
    const providers = kernel.registry.resolve(Tokens.Providers);
    const store = kernel.registry.resolve(Tokens.Store);

    const home = xrHome();
    if (stdinTTY && stdoutTTY && !isOnboarded(home)) {
      const done = await runWizard(providers, p, (s) => sink.line(s));
      if (!done) {
        sink.error("setup was not completed. Run xr again to finish it.");
        return CODER_EXIT.ERROR;
      }
      markOnboarded(home, { provider: done.provider, model: done.model });
    }

    const modelLabel = flags.model ?? config.get().defaults.model;
    const { ctx: projectCtx, large } = await gatherProjectContext(cwd, { deepTree: false });
    const systemPrompt = buildSystemPrompt(projectCtx, undefined);

    // Approvals: the keyboard when there is one; decisions go through the engine's durable store.
    const keys = stdinTTY ? new KeyInput() : null;
    const gate = new ApprovalGate({
      sink,
      keys,
      approveAll,
      diffOnly: flags.diff,
      cwd,
      store,
      approvalTtl: { defaultTtlMs: 10 * 60_000 },
      audit: (event, detail) => {
        try {
          store.audit(event, detail);
        } catch {
          /* the audit trail must not break a turn */
        }
      },
    });

    const base = {
      sink,
      agent,
      gate,
      systemPrompt,
      modelLabel,
      keys,
      approve: gate.decide,
      maxSteps: flags.maxSteps ?? 20,
      ...(flags.model ? { model: flags.model } : {}),
      ...(flags.budget !== undefined ? { budget: flags.budget } : {}),
    } satisfies Omit<CoderContext, "toolsAllow" | "printOnly">;

    if (large) sink.warn("large project: the file map is abbreviated. Use list_dir and search_code to look around.");

    if (interactive) {
      for (const line of bannerLines(modelLabel, cwd, p)) sink.line(line);
      if (approveAll) sink.line(p.red("  ! approve-all is on: edits and commands run without asking (dangerous commands still ask)"));
      sink.line();
      return await runRepl({
        sink,
        keys: keys!,
        base,
        toolsAllow: [...CODING_TOOLS],
        cwd,
        historyFile: flags.noHistory ? null : historyPath(),
        onSetup: async () => {
          const done = await runWizard(providers, p, (s) => sink.line(s));
          if (done) markOnboarded(home, { provider: done.provider, model: done.model });
        },
      });
    }

    // ── One-shot, print, diff, json ─────────────────────────────────────────
    const expanded = await expandReferences(task, cwd);
    for (const miss of expanded.missing) sink.warn(`no such file or folder: @${miss} (sent as plain text)`);
    const printOnly = flags.print;
    if (sinkMode === "tty" && !printOnly) for (const line of bannerLines(modelLabel, cwd, p)) sink.line(line);

    const ctx: CoderContext = { ...base, toolsAllow, printOnly, keys };
    const summary = await runTurn(ctx, expanded.prompt, []);
    emitResult(summary, gate, sink, printOnly, flags.diff);

    if (!sink.json) {
      const line = summaryLine(summary, p);
      if (printOnly) {
        // Print mode keeps stdout to the answer; the status line only appears when the turn did not finish.
        if (summary.stopped !== "done") process.stderr.write(`${line}\n`);
      } else {
        sink.line(`  ${line}`);
      }
      if (gate.denied && !approveAll && !flags.diff) {
        sink.warn(`${gate.denied} approval${gate.denied === 1 ? "" : "s"} denied (no terminal to ask). Run in a terminal, or pass --approve-all and type yes.`);
      }
    }
    return exitCodeFor(summary.stopped);
  } catch (err) {
    sink.error((err as Error).message);
    return CODER_EXIT.ERROR;
  } finally {
    await kernel.shutdown();
  }
}

/** Print the answer (print mode) and the proposed changes (diff mode), or the json events. */
function emitResult(summary: TurnSummary, gate: ApprovalGate, sink: Sink, printOnly: boolean, diffMode: boolean): void {
  const p = sink.p;
  if (diffMode) {
    if (sink.json) {
      for (const pr of gate.proposals) sink.event({ type: "proposal", ...pr });
    } else {
      if (!gate.proposals.length) sink.line(p.dim("no changes proposed"));
      for (const pr of gate.proposals) {
        if ("diff" in pr) {
          sink.line(colorizeDiff(pr.diff, p));
          sink.line(p.dim(`  ${pr.path}: +${pr.added} -${pr.removed}`));
        } else {
          sink.line(`${p.cyan("▶")} would run: ${pr.shell}`);
        }
      }
      sink.line();
    }
  }
  if (printOnly && !sink.json) {
    // Tokens streamed to stdout already. Only a non-streamed answer needs printing here.
    if (!summary.streamed && summary.finalMessage) process.stdout.write(`${summary.finalMessage}\n`);
    if (summary.error && summary.stopped !== "done") process.stderr.write(`error: ${summary.error}\n`);
  }
}

/** Read all of piped stdin (capped at 200 KB), or "" when stdin is a terminal. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = Buffer.from(chunk as Buffer);
    size += b.length;
    chunks.push(b);
    if (size > 200_000) break;
  }
  return Buffer.concat(chunks).toString("utf8").slice(0, 200_000);
}

/** Tool set for this run. `--tools a,b` overrides; print mode is read-only by default. */
export function resolveTools(spec: string | undefined, printMode: boolean): string[] | null {
  if (!spec) return printMode ? [...READ_ONLY_TOOLS] : [...CODING_TOOLS];
  const names = spec.split(",").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return null;
  const known = new Set<string>([...CODING_TOOLS, ...READ_ONLY_TOOLS]);
  return names.every((n) => known.has(n)) ? names : null;
}

/**
 * A single unknown word that is one edit away from a command gets a hint, never a
 * refusal: `xr statsu` still runs as a task, with a "did you mean" tip.
 */
async function nearMissTip(head: string): Promise<void> {
  const { didYouMean, editDistance, tip } = await import("../output.ts");
  const { allAliasesAndNames } = await import("../catalog.ts");
  if (head.length >= 24 || head.includes(" ")) return;
  const suggestions = didYouMean(head, allAliasesAndNames().filter((n) => !n.startsWith("-")));
  const nearest = suggestions[0];
  if (nearest && nearest !== head && editDistance(head.toLowerCase(), nearest.toLowerCase()) <= 2) {
    tip(`Running "${head}" as a task. Did you mean the command \`xr ${nearest}\`?`);
  }
}
