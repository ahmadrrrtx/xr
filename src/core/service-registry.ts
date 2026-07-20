/**
 * XR — Service Registry (Strongly-Typed Dependency Injection)
 *
 * Permanent runtime DI container. Services are registered under typed tokens,
 * optionally participate in lifecycle, and declare lifecycle dependencies so
 * XRApp can initialize/start/stop them deterministically without manual hook
 * registration.
 */

import { isLifecycleHook, type LifecycleHook, type LifecycleParticipant } from "./lifecycle.ts";

/** Unique, type-carrying identifier for a service. */
export interface ServiceToken<T> {
  readonly id: string;
  readonly description?: string;
  readonly __serviceType?: T;
}

export function token<T>(id: string, description?: string): ServiceToken<T> {
  return { id, description } as ServiceToken<T>;
}

export type ServiceScope = "value" | "singleton" | "transient";

export interface RegisterOptions {
  dependsOn?: ReadonlyArray<ServiceToken<unknown>>;
  lifecycle?: boolean;
  description?: string;
}

export type LifecycleRegisterOptions = Omit<RegisterOptions, "lifecycle"> & { lifecycle: true };

export interface RegistryEntry {
  id: string;
  scope: ServiceScope;
  lifecycle: boolean;
  dependsOn: string[];
  resolved: boolean;
  description?: string;
}

interface Descriptor {
  readonly token: ServiceToken<unknown>;
  readonly id: string;
  readonly scope: ServiceScope;
  readonly factory: ((registry: ServiceRegistry) => unknown) | null;
  instance: unknown;
  resolved: boolean;
  readonly dependsOn: ReadonlyArray<ServiceToken<unknown>>;
  readonly lifecycle: boolean;
  readonly description?: string;
}

export class ServiceRegistry {
  private readonly descriptors = new Map<string, Descriptor>();

  get size(): number {
    return this.descriptors.size;
  }

  registerValue<T extends LifecycleHook>(serviceToken: ServiceToken<T>, instance: T, options: LifecycleRegisterOptions): this;
  registerValue<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this;
  registerValue<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this {
    this.descriptors.set(serviceToken.id, {
      token: serviceToken as ServiceToken<unknown>,
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

  register<T extends LifecycleHook>(serviceToken: ServiceToken<T>, instance: T, options: LifecycleRegisterOptions): this;
  register<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this;
  register<T>(serviceToken: ServiceToken<T>, instance: T, options?: RegisterOptions): this {
    return this.registerValue(serviceToken, instance, options as RegisterOptions | undefined);
  }

  registerSingleton<T extends LifecycleHook>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options: LifecycleRegisterOptions,
  ): this;
  registerSingleton<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this;
  registerSingleton<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this {
    this.descriptors.set(serviceToken.id, {
      token: serviceToken as ServiceToken<unknown>,
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

  registerTransient<T extends LifecycleHook>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options: LifecycleRegisterOptions,
  ): this;
  registerTransient<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this;
  registerTransient<T>(
    serviceToken: ServiceToken<T>,
    factory: (registry: ServiceRegistry) => T,
    options?: RegisterOptions,
  ): this {
    this.descriptors.set(serviceToken.id, {
      token: serviceToken as ServiceToken<unknown>,
      id: serviceToken.id,
      scope: "transient",
      factory: factory as (registry: ServiceRegistry) => unknown,
      instance: null,
      resolved: false,
      dependsOn: options?.dependsOn ?? [],
      lifecycle: options?.lifecycle ?? false,
      description: options?.description ?? serviceToken.description,
    });
    return this;
  }

  resolve<T>(serviceToken: ServiceToken<T>): T {
    const descriptor = this.descriptors.get(serviceToken.id);
    if (!descriptor) throw new Error(`Service ${serviceToken.id} not found in registry.`);
    return this.instantiate(descriptor) as T;
  }

  tryResolve<T>(serviceToken: ServiceToken<T>): T | undefined {
    const descriptor = this.descriptors.get(serviceToken.id);
    if (!descriptor) return undefined;
    return this.instantiate(descriptor) as T | undefined;
  }

  has(serviceToken: ServiceToken<unknown>): boolean {
    return this.descriptors.has(serviceToken.id);
  }

  unregister(serviceToken: ServiceToken<unknown>): this {
    this.descriptors.delete(serviceToken.id);
    return this;
  }

  clear(): this {
    this.descriptors.clear();
    return this;
  }

  /** Lifecycle tokens in dependency-respecting topological order. */
  lifecycleTokens(): ServiceToken<unknown>[] {
    return this.orderedLifecycleDescriptors().map((descriptor) => descriptor.token);
  }

  /** Lifecycle participants resolved and validated, ready for LifecycleManager. */
  lifecycleParticipants(): LifecycleParticipant[] {
    return this.orderedLifecycleDescriptors().map((descriptor) => {
      const instance = this.instantiate(descriptor);
      if (!isLifecycleHook(instance)) {
        throw new Error(
          `Service ${descriptor.id} is registered with lifecycle: true but does not implement onInit/onStart/onStop.`,
        );
      }
      return { name: descriptor.id, hook: instance };
    });
  }

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

  keys(): string[] {
    return [...this.descriptors.keys()];
  }

  private orderedLifecycleDescriptors(): Descriptor[] {
    const participants = [...this.descriptors.values()].filter((d) => d.lifecycle);
    if (participants.length === 0) return [];

    const participantIds = new Set(participants.map((d) => d.id));
    const indegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const descriptor of participants) {
      indegree.set(descriptor.id, 0);
      adjacency.set(descriptor.id, []);
    }

    for (const descriptor of participants) {
      for (const dependency of descriptor.dependsOn) {
        if (!participantIds.has(dependency.id)) continue;
        adjacency.get(dependency.id)!.push(descriptor.id);
        indegree.set(descriptor.id, (indegree.get(descriptor.id) ?? 0) + 1);
      }
    }

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
      const unresolved = participants.filter((d) => !ordered.includes(d.id)).map((d) => d.id);
      throw new Error(`Circular lifecycle dependency detected among services: ${unresolved.join(", ")}.`);
    }

    return ordered.map((id) => this.descriptors.get(id)!);
  }

  private instantiate(descriptor: Descriptor): unknown {
    if (descriptor.scope === "value") return descriptor.instance;
    if (descriptor.scope === "singleton") {
      if (descriptor.resolved) return descriptor.instance;
      const instance = descriptor.factory!(this);
      descriptor.instance = instance;
      descriptor.resolved = true;
      return instance;
    }
    return descriptor.factory!(this);
  }
}
