/**
 * XR — Command Registry
 * Decouples CLI command parsing from command implementation.
 *
 * Commands receive a strongly-typed CommandContext whose `registry` is the
 * XR ServiceRegistry. Commands resolve collaborators through typed tokens,
 * e.g. `const store = ctx.registry.resolve(Tokens.Store)`.
 */

import { ServiceRegistry } from "./service-registry.ts";

export interface CommandContext {
  /** The typed runtime service registry. */
  registry: ServiceRegistry;
  args: string[];
  cwd: string;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  /**
   * Execute the command.
   * @param ctx Execution context including the service registry and arguments.
   */
  execute(ctx: CommandContext): Promise<void> | void;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  /**
   * Register a command.
   */
  register(command: Command): this {
    this.commands.set(command.name, command);
    return this;
  }

  /**
   * Execute a command by its name.
   * Throws if the command is not found.
   */
  async run(name: string, args: string[], context: CommandContext): Promise<void> {
    const cmd = this.commands.get(name);
    if (!cmd) {
      throw new Error(`Unknown command: ${name}`);
    }
    await cmd.execute(context);
  }

  /**
   * Get a list of all registered commands for help generation.
   */
  list(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get a specific command.
   */
  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * Remove a command.
   */
  unregister(name: string): this {
    this.commands.delete(name);
    return this;
  }

  /** Number of registered commands. */
  get size(): number {
    return this.commands.size;
  }
}
