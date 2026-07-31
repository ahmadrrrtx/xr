/**
 * XR 4.5 — `xr context …` command.
 *
 * Thin Command-registry adapter over `src/context/cli.ts`, mirroring how
 * `MemoryCommand` delegates to `src/context/memory/cli.ts`.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { Store } from "../state/workspace-store.ts";

/** Storage unification: always resolve from the container, never construct. */
function unifiedStore(ctx: CommandContext): Store {
  return ctx.registry.resolve(Tokens.Store);
}

export class ContextCommand implements Command {
  name = "context";
  description = "inspect and control what XR knows (provenance, consent, trust)";
  usage =
    'xr context [status|list|inspect|explain|pending|legacy|approve|revoke|correct|export|prune]';

  async execute(ctx: CommandContext): Promise<void> {
    const { handleContextCommand } = await import("../context/cli.ts");
    await handleContextCommand(ctx.args, unifiedStore(ctx));
  }
}
