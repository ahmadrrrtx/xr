/**
 * XR — Service Registry (Strongly-Typed Dependency Injection)
 *
 * The permanent runtime DI container. Replaces the earlier weak, string-keyed
 * registry with a token-based system that is:
 *
 *   • Strongly typed — a ServiceToken<T> carries its service type, so
 *     resolve(token) returns T with no manual <T> annotation and no chance of
 *     a wrong-type cast at the call site.
 *   • Token-addressed — service identities are first-class values declared
 *     once in src/core/tokens.ts. There are no magic strings at call sites,
 *     so a typo is a compile error instead of a runtime "not found".
 *   • Multi-scoped — value (pre-built instance), singleton (lazy + memoized),
 *     and transient (fresh instance per resolve).
 *   • Lifecycle-aware — descriptors opt into onInit/onStart/onStop and declare
 *     their dependencies, so the bootstrap can initialize them in correct
 *     topological order without any manual registration bookkeeping.
 *   • Fail-safe — a throwing singleton factory is never memoized, so the next
 *     resolve retries cleanly (no poisoned slot).
 *
 * This module is intentionally dependency-free: it imports nothing, so it can
 * sit at the very bottom of the dependency graph as the runtime foundation.
 */

/** Unique, type-carrying identifier for a service. */
export interface ServiceToken<T> {
  /** Stable string id used internally as the map key. */
  readonly id: string;
  /** Human-readable label for diagnostics and error messages. */
  readonly description?: string;
  /**
   * Phantom type slot — never read at runtime. Exists only so TypeScript
   * propagates the service type T from the token through resolve().
   */
  readonly __serviceType?: T;
}

/**
 * Declare a service token. Tokens are values, so they are declared exactly
 * once (see src/core/tokens.ts) and referenced everywhere by identity.
 */
export function token<T>(id: string, description?: string): ServiceToken<T> {
  return { id, description } as ServiceToken<T>;
}

/** Lifecycle scope of a registered service. */
export type ServiceScope = "value" | "singleton" | "transient";

/** Options accepted by every register* method. */
export interface RegisterOptions {
  /**
   * Tokens this service depends on. Used only to order lifecycle
   * (onInit/onStart/onStop) participants; resolution itself is lazy. Non-
   * lifecycle dependencies are ignored for ordering.
   */
  dependsOn?: ReadonlyArray<ServiceToken<unknown>>;
  /**
   * When true, the resolved instance participates in the runtime lifecycle
   * (its onInit/onStart/onStop are invoked in dependency order). The instance
   * is expected to implement LifecycleHook from ./lifecycle.ts.
   */
  lifecycle?: boolean;
  /** Human-readable description, surfaced in diagnostics. */
  description?: string;
}

/** An introspection record returned by ServiceRegistry.entries(). */
export interface RegistryEntry {
  id: string;
  scope: ServiceScope;
  lifecycle: boolean;
  dependsOn: string[];
  resolved: boolean;
  description?: string;
}

/** Internal registration record. */
interface Descriptor {
  readonly id: string;
  readonly scope: ServiceScope;
  readonly factory: ((registry: ServiceRegistry) => unknown) | null;
  instance: unknown;
  /** True once a singleton factory has produced its cached instance. */
  resolved: boolean;
  readonly dependsOn: ReadonlyArray<ServiceToken<unknown>>;
  readonly lifecycle: boolean;
  readonly description?: string;
}

/**
 * Typed dependency-injection container.
 *
 * One instance lives on XRApp and is the single source of truth for every
 * service in the runtime. Services and commands resolve their collaborators
 * through typed tokens:
 *
 *   const config = registry.resolve(Tokens.Config); // ConfigService, typed
 */
export class ServiceRegistry {
  private readonly descriptors = new Map<string, Descriptor>();

  /** Number of registered services. */
  get size(): number {
    return this.descriptors.size;
  }

  /**
   * Register a pre-built instance (value scope). Re-registration overwrites.
   */
  registerValue<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this {
    this.descriptors.set(serviceToken.id, {
      id: serviceToken.id,
      scope: "value",
      factory: null,
      instance,
      resolved: true,
      dependsOn: options?.dependsOn ?? [],
      lifecycle: options?.lifecycle ?? false,
      description: options?.description ?? serviceToken.description,
    });
    return this;
  }

  /**
   * Alias for registerValue — the most common registration shape. Kept short
   * so call sites read naturally: registry.register(Tokens.Config, config).
   */
  register<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this {
    return this.registerValue(serviceToken, instance, options);
  }

  /**
   * Register a lazily-constructed singleton. The factory runs on first
   * resolve() and the result is memoized for all subsequent resolves. If the
   * factory throws, the failure is NOT cached — the next resolve retries.
   */
  registerSingleton<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this {
    this.descriptors.set(serviceToken.id, {
      id: serviceToken.id,
      scope: "singleton",
      factory: factory as (registry: ServiceRegistry) => unknown,
      instance: null,
      resolved: false,
      dependsOn: options?.dependsOn ?? [],
      lifecycle: options?.lifecycle ?? false,
      description: options?.description ?? serviceToken.description,
    });
    return this;
  }

  /**
   * Register a transient factory: every resolve() produces a fresh instance.
   * The factory receives the registry so it can resolve collaborators.
   */
  registerTransient<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this {
    this.descriptors.set(serviceToken.id, {
      id: serviceToken.id,
      scope: "transient",
      factory: factory as (registry: ServiceRegistry) => T,
      instance: null,
      resolved: false,
      dependsOn: options?.dependsOn ?? [],
      lifecycle: options?.lifecycle ?? false,
      description: options?.description ?? serviceToken.description,
    });
    return this;
  }

  /**
   * Resolve a service by token. The return type T is inferred from the token,
   * so call sites never annotate it manually. Throws a precise, fail-fast
   * error if the token is unknown.
   */
  resolve<T>(serviceToken: ServiceToken<T>): T {
    const descriptor = this.descriptors.get(serviceToken.id);
    if (!descriptor) {
      throw new Error(`Service ${serviceToken.id} not found in registry.`);
    }
    return this.instantiate(descriptor) as T;
  }

  /**
   * Resolve a service, returning undefined instead of throwing when it is not
   * registered. Useful for optional collaborators (e.g. a feature that may
   * be disabled).
   */
  tryResolve<T>(serviceToken: ServiceToken<T>): T | undefined {
    const descriptor = this.descriptors.get(serviceToken.id);
    if (!descriptor) return undefined;
    return this.instantiate(descriptor) as T | undefined;
  }

  /** True if a service is registered under this token. */
  has(serviceToken: ServiceToken<unknown>): boolean {
    return this.descriptors.has(serviceToken.id);
  }

  /** Remove a service registration (instance and/or factory). */
  unregister(serviceToken: ServiceToken<unknown>): this {
    this.descriptors.delete(serviceToken.id);
    return this;
  }

  /** Remove every registration. */
  clear(): this {
    this.descriptors.clear();
    return this;
  }

  /**
   * Tokens of all lifecycle participants, returned in dependency-respecting
   * topological order (ties broken by registration order). XRApp uses this to
   * drive onInit/onStart/onStop without manual bookkeeping. Throws on cycles.
   */
  lifecycleTokens(): ServiceToken<unknown>[] {
    const participants = [...this.descriptors.values()].filter((d) => d.lifecycle);
    if (participants.length === 0) return [];

    const participantIds = new Set(participants.map((d) => d.id));
    const indegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const descriptor of participants) {
      indegree.set(descriptor.id, 0);
      adjacency.set(descriptor.id, []);
    }

    // Only edges between lifecycle participants affect lifecycle ordering.
    for (const descriptor of participants) {
      for (const dependency of descriptor.dependsOn) {
        if (participantIds.has(dependency.id)) {
          adjacency.get(dependency.id)!.push(descriptor.id);
          indegree.set(descriptor.id, (indegree.get(descriptor.id) ?? 0) + 1);
        }
      }
    }

    // Kahn's algorithm, seeded in registration order for deterministic output.
    const ordered: string[] = [];
    const ready = participants
      .filter((d) => (indegree.get(d.id) ?? 0) === 0)
      .map((d) => d.id);

    while (ready.length > 0) {
      const id = ready.shift()!;
      ordered.push(id);
      for (const next of adjacency.get(id) ?? []) {
        indegree.set(next, (indegree.get(next) ?? 0) - 1);
        if (indegree.get(next) === 0) ready.push(next);
      }
    }

    if (ordered.length !== participants.length) {
      const unresolved = participants
        .filter((d) => !ordered.includes(d.id))
        .map((d) => d.id);
      throw new Error(
        `Circular lifecycle dependency detected among services: ${unresolved.join(", ")}.`,
      );
    }

    return ordered.map((id) => this.descriptors.get(id)!.id).map(
      (id) => this.descriptorToken(id),
    );
  }

  /** Introspection snapshot for diagnostics, debugging, and `xr doctor`. */
  entries(): RegistryEntry[] {
    return [...this.descriptors.values()].map((d) => ({
      id: d.id,
      scope: d.scope,
      lifecycle: d.lifecycle,
      dependsOn: d.dependsOn.map((dep) => dep.id),
      resolved: d.resolved,
      description: d.description,
    }));
  }

  /** Stable list of registered ids, in insertion order. */
  keys(): string[] {
    return [...this.descriptors.keys()];
  }

  // ── internal ────────────────────────────────────────────────────────────

  private instantiate(descriptor: Descriptor): unknown {
    if (descriptor.scope === "value") {
      return descriptor.instance;
    }
    if (descriptor.scope === "singleton") {
      if (descriptor.resolved) return descriptor.instance;
      // Fail-safe: a throwing factory must NOT cache its failure.
      const instance = descriptor.factory!(this);
      descriptor.instance = instance;
      descriptor.resolved = true;
      return instance;
    }
    // transient — always fresh
    return descriptor.factory!(this);
  }

  /**
   * Reconstructs the token value for a descriptor id. Tokens are keyed by id,
   * so we can rebuild a minimal token carrying the same id for the lifecycle
   * ordering API without storing token references on every descriptor.
   */
  private descriptorToken(id: string): ServiceToken<unknown> {
    return token(id);
  }
}
