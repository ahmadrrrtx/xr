/**
 * XR 3.1.5 (Helios) — RunAgent Command
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

export class RunAgentCommand implements Command {
  name = "run";
  description = "run a task (default mode)";
  usage =
    'xr run "<task>" [--mode agent|plan|ask] [--budget usd] [--model name] [--provider id] [--max-tokens n] [--dry-run]';

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
      } else if (a) {
        taskArgs.push(a);
      }
    }

    const task = taskArgs.join(" ").trim();
    if (!task) {
      throw usageError(
        "No task provided",
        'xr run "your task"   or   xr "your task"',
        ["xr help run", "xr ask", "xr plan"],
      );
    }

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

    try {
      const result = await agentService.runTask(task, mode, overrides);
      console.log();
      if (result.stopped === "done") ok(`done in ${result.steps} step(s)`);
      else warn(`ended: ${result.finalMessage}`);
      if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      error(msg);
      if (process.env.XR_DEBUG === "1" && e instanceof Error) {
        console.error(xrDim(e.stack ?? ""));
      } else {
        tip("For a stack trace: XR_DEBUG=1 xr …");
      }
      process.exitCode = 1;
    }
  }
}
