/**
 * XR — Service Registry (Typed Dependency Injection)
 * Proper typed DI container replacing the weak string-based Container.
 */

export interface ServiceRegistry {
  register<T>(id: string, instance: T): void;
  registerFactory<T>(id: string, factory: () => T): void;
  resolve<T>(id: string): T;
  unregister(id: string): void;
  clear(): void;
}

export class ServiceRegistryImpl implements ServiceRegistry {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  register<T>(id: string, instance: T): void {
    this.services.set(id, instance);
  }

  registerFactory<T>(id: string, factory: () => T): void {
    this.factories.set(id, factory);
  }

  resolve<T>(id: string): T {
    if (this.services.has(id)) {
      return this.services.get(id) as T;
    }

    const factory = this.factories.get(id);
    if (factory) {
      const instance = factory();
      this.services.set(id, instance);
      return instance as T;
    }

    throw new Error(`Service ${id} not found in registry.`);
  }

  unregister(id: string): void {
    this.services.delete(id);
    this.factories.delete(id);
  }

  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}
