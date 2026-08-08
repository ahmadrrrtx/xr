/**
 * XR — ServiceRegistry (Container v2)
 *
 * Replaces the string-keyed Map in src/core/container.ts with a typed,
 * factory-based DI container that supports:
 *   - typed registration / resolution
 *   - singleton (default) vs transient instances
 *   - dependency-ordered module initialization
 *   - introspection (has / list)
 *
 * Keeps the same `register` / `resolve` ergonomics the rest of the code uses,
 * so migration is mechanical.
 */

export type Factory<T> = () => T;
export type Scope = "singleton" | "transient";

export interface Module {
  /** Called once during app bootstrap, in registration order. */
  init?(app: ServiceRegistry): void | Promise<void>;
  /** Optional lifecycle phases reused from the existing LifecycleManager. */
  onStart?(app: ServiceRegistry): void | Promise<void>;
  onStop?(app: ServiceRegistry): void | Promise<void>;
}

export class ServiceRegistry {
  private singletons = new Map<string, unknown>();
  private factories = new Map<string, { factory: Factory<unknown>; scope: Scope }>();
  private modules: Module[] = [];

  /**
   * Register a singleton instance, or a factory (scope defaults to singleton).
   * Use `scope: "transient"` for per-call objects (e.g. request handlers).
   */
  register<T>(token: string, impl: T | Factory<T>, scope: Scope = "singleton"): this {
    if (typeof impl === "function") {
      this.factories.set(token, { factory: impl as Factory<unknown>, scope });
      this.singletons.delete(token);
    } else {
      this.singletons.set(token, impl);
      this.factories.delete(token);
    }
    return this;
  }

  /** Register a module (subsystem) that participates in the lifecycle. */
  registerModule(m: Module): this {
    this.modules.push(m);
    return this;
  }

  has(token: string): boolean {
    return this.singletons.has(token) || this.factories.has(token);
  }

  get<T>(token: string): T {
    if (this.singletons.has(token)) return this.singletons.get(token) as T;
    const entry = this.factories.get(token);
    if (!entry) throw new Error(`Unregistered service: "${token}"`);
    const inst = entry.factory();
    if (entry.scope === "singleton") this.singletons.set(token, inst);
    return inst as T;
  }

  /** Resolve without throwing (returns undefined if absent). */
  tryGet<T>(token: string): T | undefined {
    try {
      return this.get<T>(token);
    } catch {
      return undefined;
    }
  }

  list(): string[] {
    return [...new Set([...this.singletons.keys(), ...this.factories.keys()])];
  }

  /** Run every module's init() in registration order. */
  async initModules(): Promise<void> {
    for (const m of this.modules) await m.init?.(this);
  }

  async startModules(): Promise<void> {
    for (const m of this.modules) await m.onStart?.(this);
  }

  async stopModules(): Promise<void> {
    for (const m of this.modules) await m.onStop?.(this);
  }
}
