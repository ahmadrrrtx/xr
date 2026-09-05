/**
 * XR — RunAgent Command
 * Default command to execute a task via the AI agent.
 *
 * Human-readable by default; never dumps raw stacks without --debug.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { AgentService } from "../services/agent-service.ts";
import { Mode } from "../core/types.ts";
import {
  ok,
  warn,
  error,
  statusHeader,
  tip,
  xrCyan,
  xrDim,
  colors as C,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";
import { EXIT } from "../cli/flags.ts";

export class RunAgentCommand implements Command {
  name = "run";
  description = "run a task (default mode)";
  usage =
    'xr run "<task>" [--mode agent|plan|ask] [--budget usd] [--model name] [--provider id] [--max-tokens n] [--dry-run] [--resume <taskId>]';

  async execute(ctx: CommandContext): Promise<void> {
    const { registry, args } = ctx;
    const agentService = registry.resolve(Tokens.Agent);

    const taskArgs: string[] = [];
    const overrides: Record<string, unknown> = {};

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--mode") overrides.mode = args[++i];
      else if (a === "--budget") overrides.budget = Number(args[++i]);
      else if (a === "--max-tokens") overrides.maxTokens = Number(args[++i]);
      else if (a === "--provider") overrides.provider = args[++i];
      else if (a === "--model") overrides.model = args[++i];
      else if (a === "--dry-run") overrides.dryRun = true;
      else if (a === "--resume") overrides.resume = args[++i];
      else if (a === "--help" || a === "-h") {
        console.log(`Usage: ${this.usage}`);
        tip('Example: xr "summarize this repository" --budget 0.25');
        tip("Modes: --mode agent | plan | ask");
        return;
      } else if (a?.startsWith("-")) {
        /**
         * Phase 0 · T11 — global flags are not task text.
         *
         * The router re-injects consumed global flags (`--json`, `--no-color`,
         * `--quiet`, …) onto the command's argv. Because every unrecognised
         * token was pushed into `taskArgs`, `xr run` with no task became the
         * task "--no-color": XR then executed a nonsense task instead of
         * reporting the usage error, so a genuine mistake exited 1 (task
         * failure) rather than 2 (usage), and `xr run --json` would have run
         * "--json" as a prompt.
         *
         * Global flags are handled by the output layer, so they are skipped
         * here; their values are consumed with them.
         */
        if (a === "--workspace" || a === "-w" || a === "--format" || a === "--output" || a === "-o") i++;
      } else if (a) {
        taskArgs.push(a);
      }
    }

    const task = taskArgs.join(" ").trim();
    if (!task && !overrides.resume) {
      throw usageError(
        "No task provided",
        'xr run "your task"   or   xr "your task"   or   xr run --resume <taskId>',
        ["xr help run", "xr ask", "xr plan"],
      );
    }

    const taskText = task || `(resumed ${String(overrides.resume)})`;
    const mode = (overrides.mode as Mode) ?? "agent";
    if (mode !== "agent" && mode !== "plan" && mode !== "ask") {
      throw usageError(
        `Invalid mode: ${String(overrides.mode)}`,
        "Use --mode agent | plan | ask",
        ["xr help modes"],
      );
    }

    statusHeader({
      mode,
      provider: overrides.provider as string | undefined,
      model: overrides.model as string | undefined,
    });

    /**
     * A-19 — Ctrl+C stops the run cooperatively. The first SIGINT aborts this
     * run's signal: the loop wraps up honestly at its next checkpoint (session
     * audited, `stopped: "cancelled"`, exit 130) instead of dying mid-write
     * with no evidence. A second SIGINT force-exits immediately (POSIX 130).
     * The listener is scoped to this execute() call and always removed.
     */
    const runController = new AbortController();
    let forceExitArmed = false;
    const onSigint = (): void => {
      if (forceExitArmed) process.exit(EXIT.INTERRUPT);
      forceExitArmed = true;
      runController.abort();
      console.log();
      warn("interrupted — stopping at the next step (Ctrl+C again to force-quit)");
    };
    process.on("SIGINT", onSigint);

    try {
      const result = await agentService.runTask(taskText, mode, {
        ...overrides,
        signal: runController.signal,
      });
      console.log();
      if (result.stopped === "done") {
        ok(`done in ${result.steps} step(s)`);
      } else if (result.stopped === "cancelled") {
        warn("interrupted by user");
        process.exitCode = EXIT.INTERRUPT;
      } else {
        warn(`ended: ${result.finalMessage}`);
        /**
         * Phase 0 · T11 — a task that did not finish must not exit 0.
         *
         * Previously only a *thrown* error set an exit code; a returned
         * AgentResult with stopped==="error" printed a warning and exited 0, so
         * every CI pipeline wrapping XR was silently green on failure.
         *
         * Exit codes follow the documented contract:
         *   error    → 1 (EXIT.ERROR)      something went wrong
         *   budget   → 1                   work incomplete, ceiling reached
         *   approval → 1                   work incomplete, awaiting a human
         *   max_steps→ 1                   work incomplete, loop limit hit
         *   cancelled→ 130 (EXIT.INTERRUPT) stopped by the user (POSIX SIGINT,
         *                                   handled in its own branch above)
         */
        process.exitCode = EXIT.ERROR;
      }
      if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));
      // Phase 6 · Step 6 — a plain run is checkpointed per step, so an
      // INCOMPLETE end is a PAUSE, not a loss: the resume handle is printed
      // with the durable id (the task runtime's own key).
      if (result.stopped !== "done" && result.sessionId) {
        tip(`incomplete run checkpointed — continue with: xr run --resume ${result.sessionId}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error(msg);
      if (process.env.XR_DEBUG === "1" && e instanceof Error) {
        console.error(xrDim(e.stack ?? ""));
      } else {
        tip("For a stack trace: XR_DEBUG=1 xr …");
      }
      process.exitCode = 1;
    } finally {
      process.off("SIGINT", onSigint);
    }
  }
}
