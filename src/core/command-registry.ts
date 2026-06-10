/**
 * XR — Command Registry
 * Decouples CLI command parsing from command implementation.
 */

import { Container } from "./container.ts";

export interface CommandContext {
  container: Container;
  args: string[];
  cwd: string;
}

export interface Command {
  name: string;
  description: string;
  usage?: string;
  /**
   * Execute the command.
   * @param ctx Execution context including services and arguments.
   */
  execute(ctx: CommandContext): Promise<void>;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  /**
   * Register a command.
   */
  register(command: Command): void {
    this.commands.set(command.name, command);
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
  unregister(name: string): void {
    this.commands.delete(name);
  }
}
