/**
 * XR Stage 6 — `xr memory …` command.
 *
 * A thin Command-registry adapter that delegates to the shared
 * `handleMemoryCommand` handler. This is what finally makes the entire v0.9
 * memory CLI surface reachable from the top-level `xr` entrypoint (it was
 * previously defined but never wired into the registry, so `xr memory …` fell
 * through to the agent and ran the subcommand as a task).
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/workspace-store.ts";

/** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
function legacyStore(ctx: CommandContext): Store {
  return ctx.container.resolve<Store>("store");
}

export class MemoryCommand implements Command {
  name = "memory";
  description = "durable, inspectable, user-controlled memory";
  usage =
    'xr memory [status|list|add|edit|remove|search|recall|reindex|summarize|prune|health|export|import|clear|summaries]';

  async execute(ctx: CommandContext): Promise<void> {
    const { handleMemoryCommand } = await import("../memory/cli.ts");
    await handleMemoryCommand(ctx.args, legacyStore(ctx));
  }
}
