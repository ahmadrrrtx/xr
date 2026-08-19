/**
 * XR Phase 11 — `xr repo` command (thin adapter).
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { handleRepoCommand, storeFrom } from "../repo/cli.ts";

export class RepoCommand implements Command {
  name = "repo";
  description = "repository intelligence: map, search, symbols, dependencies, diff";
  usage = "xr repo [status|index|map|search|symbol|deps|diff] [query] [--json] [--force]";

  async execute(ctx: CommandContext): Promise<void> {
    await handleRepoCommand(ctx.args, storeFrom(ctx), ctx.cwd);
  }
}
