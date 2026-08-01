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
   * Phase 3 · T1 — lazy command loaders. The loader is a factory that returns
   * the command module's export; it must use a STATIC (literal-path) dynamic
   * import so the Bun `--compile` tracer can resolve it at build time
   * (Global Rule 7). Loading happens on first execution of that command only.
   */
  private lazy = new Map<string, { description: string; load: () => Promise<Command> }>();
  private loading = new Map<string, Promise<Command>>();

  /**
   * Register a command.
   */
  register(command: Command): this {
    this.commands.set(command.name, command);
    return this;
  }

  /**
   * Phase 3 · T1 — register a command by lazy loader. The command module is
   * imported on first execution, so a CLI invocation never loads command
   * modules it does not run (Commandment 11).
   */
  registerLazy(name: string, description: string, load: () => Promise<Command>): this {
    if (this.commands.has(name)) {
      throw new Error(`CommandRegistry: "${name}" already registered eagerly`);
    }
    this.lazy.set(name, { description, load });
    return this;
  }

  /** Number of pending lazy commands (diagnostics/boot-profile). */
  get lazyCount(): number {
    return this.lazy.size;
  }

  /** Names that would materialize on execution (diagnostics/boot-profile). */
  lazyNames(): string[] {
    return [...this.lazy.keys()];
  }

  /** Force-materialize a lazy command (used by tests and boot profile). */
  async materialize(name: string): Promise<Command | undefined> {
    const entry = this.lazy.get(name);
    if (!entry) return this.commands.get(name);
    let inflight = this.loading.get(name);
    if (!inflight) {
      inflight = entry.load().then((cmd) => {
        this.commands.set(name, cmd);
        this.lazy.delete(name);
        return cmd;
      });
      this.loading.set(name, inflight);
    }
    const cmd = await inflight;
    this.loading.delete(name);
    return cmd;
  }

  /**
   * Execute a command by its name.
   * Throws if the command is not found.
   */
  async run(name: string, args: string[], context: CommandContext): Promise<void> {
    let cmd = this.commands.get(name);
    if (!cmd && this.lazy.has(name)) {
      cmd = await this.materialize(name);
    }
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
   * Whether a command is registered (eagerly or as a lazy loader).
   */
  has(name: string): boolean {
    return this.commands.has(name) || this.lazy.has(name);
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
