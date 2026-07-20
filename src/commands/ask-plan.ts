/**
 * XR 3.1.5 (Helios) — Ask & Plan convenience commands
 *
 * xr ask  "<question>"  → run with --mode ask
 * xr plan "<task>"      → run with --mode plan
 *
 * Spec: IA §1.3–1.4 verbs and modes
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { AgentService } from "../services/agent-service.ts";
import type { Mode } from "../core/types.ts";
import {
  ok,
  warn,
  statusHeader,
  xrCyan,
  xrDim,
  colors as C,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";

function parseTaskArgs(args: string[]): {
  task: string;
  overrides: Record<string, unknown>;
} {
  const taskArgs: string[] = [];
  const overrides: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--mode") {
      overrides.mode = args[++i];
    } else if (a === "--budget") {
      overrides.budget = Number(args[++i]);
    } else if (a === "--max-tokens") {
      overrides.maxTokens = Number(args[++i]);
    } else if (a === "--provider") {
      overrides.provider = args[++i];
    } else if (a === "--model") {
      overrides.model = args[++i];
    } else if (a === "--dry-run") {
      overrides.dryRun = true;
    } else if (a) {
      taskArgs.push(a);
    }
  }

  return { task: taskArgs.join(" ").trim(), overrides };
}

async function runInMode(
  ctx: CommandContext,
  forcedMode: Mode,
  emptyUsage: string,
): Promise<void> {
  const agentService = ctx.registry.resolve(Tokens.Agent);
  const { task, overrides } = parseTaskArgs(ctx.args);

  if (!task) {
    throw usageError(`Missing ${forcedMode === "ask" ? "question" : "task"}`, emptyUsage, [
      "xr help run",
      'xr "your task"',
    ]);
  }

  overrides.mode = forcedMode;

  try {
    statusHeader({
      mode: forcedMode,
      provider: overrides.provider as string | undefined,
      model: overrides.model as string | undefined,
    });

    const result = await agentService.runTask(task, forcedMode, overrides);
    console.log();
    if (result.stopped === "done") ok(`done in ${result.steps} step(s)`);
    else warn(`ended: ${result.finalMessage}`);
    if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(C.red("fatal error:"), msg);
    if (process.env.XR_DEBUG === "1" && e instanceof Error) console.error(e.stack);
    process.exitCode = 1;
  }
}

export class AskCommand implements Command {
  name = "ask";
  description = "answer a question without tools (read-only)";
  usage = 'xr ask "<question>" [--model name] [--provider id]';

  async execute(ctx: CommandContext): Promise<void> {
    await runInMode(ctx, "ask", 'xr ask "what does this error mean?"');
  }
}

export class PlanCommand implements Command {
  name = "plan";
  description = "produce a plan without executing tools";
  usage = 'xr plan "<task>" [--model name] [--provider id]';

  async execute(ctx: CommandContext): Promise<void> {
    await runInMode(ctx, "plan", 'xr plan "ship OAuth safely"');
  }
}
