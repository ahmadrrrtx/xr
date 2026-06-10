/**
 * XR — RunAgent Command
 * The default command to execute a task via the AI agent.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { AgentService } from "../services/agent-service.ts";
import { Mode } from "../core/types.ts";
import { colors as C } from "../interfaces/cli.ts";
import { banner, ok, warn } from "../interfaces/cli.ts";

export class RunAgentCommand implements Command {
  name = "run";
  description = "run a task (default mode)";
  usage = "xr \"your task\" [--mode agent|plan|ask] [--budget usd] [--max-tokens n]";

  async execute(ctx: CommandContext): Promise<void> {
    const { container, args } = ctx;
    const agentService = container.resolve<AgentService>("agent");
    
    // Very basic arg parsing for the 'run' command specifically
    // In a real system, this would be handled by a better parser
    const taskArgs: string[] = [];
    const overrides: any = {};
    
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--mode") overrides.mode = args[++i];
      else if (args[i] === "--budget") overrides.budget = Number(args[++i]);
      else if (args[i] === "--max-tokens") overrides.maxTokens = Number(args[++i]);
      else if (args[i] === "--provider") overrides.provider = args[++i];
      else if (args[i] === "--model") overrides.model = args[++i];
      else if (args[i] === "--dry-run") overrides.dryRun = true;
      else taskArgs.push(args[i]);
    }

    const task = taskArgs.join(" ").trim();
    if (!task) {
      console.log(C.yellow(`Usage: ${this.usage}`));
      return;
    }

    const mode = (overrides.mode as Mode) ?? "agent";
    
    try {
      const result = await agentService.runTask(task, mode, overrides);
      console.log();
      if (result.stopped === "done") ok(`done in ${result.steps} step(s)`);
      else warn(`ended: ${result.finalMessage}`);
      if (result.finalMessage) console.log(C.cyan("\n" + result.finalMessage));
    } catch (e) {
      console.error(C.red("fatal error:"), e);
    }
  }
}
