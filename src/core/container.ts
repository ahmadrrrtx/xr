/**
 * XR — Service Container
 * A lightweight Dependency Injection container for the XR Core Runtime.
 */

export type ServiceConstructor<T = any> = new (...args: any[]) => T;

export class Container {
  private services = new Map<string, any>();
  private factories = new Map<string, () => any>();

  /**
   * Register a singleton instance of a service.
   */
  register<T>(id: string, instance: T): void {
    this.services.set(id, instance);
  }

  /**
   * Register a factory function to create a service instance.
   * The service is instantiated lazily on first resolution.
   */
  registerFactory<T>(id: string, factory: () => T): void {
    this.factories.set(id, factory);
  }

  /**
   * Resolve a service by its ID.
   * Throws if the service is not registered.
   */
  resolve<T>(id: string): T {
    if (this.services.has(id)) {
      return this.services.get(id);
    }

    const factory = this.factories.get(id);
    if (factory) {
      const instance = factory();
      this.services.set(id, instance);
      return instance;
    }

    throw new Error(`Service ${id} not found in container.`);
  }

  /**
   * Remove a service from the container.
   */
  unregister(id: string): void {
    this.services.delete(id);
    this.factories.delete(id);
  }

  /**
   * Clear all registered services and factories.
   */
  clear(): void {
    this.services.clear();
    this.factories.clear();
  }
}
