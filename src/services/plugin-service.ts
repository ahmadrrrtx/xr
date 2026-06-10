/**
 * XR — Plugin Service
 * Manages the lifecycle, installation, and activation of XR plugins.
 */

import { PluginManager, type LoadedPlugin, type InstallResult } from "../plugins/manager.ts";
import { Container } from "../core/container.ts";
import { ConfigService } from "./config-service.ts";
import { LifecycleHook } from "../core/lifecycle.ts";
import type { PluginManifest, PermissionScope } from "../plugins/types.ts";
import type { Tool } from "../core/types.ts";

export class PluginService implements LifecycleHook {
  private manager: PluginManager;

  constructor(container: Container) {
    const configService = container.resolve<ConfigService>("config");
    const config = configService.get();
    // We use the session store for audit logs
    const sessionStore = container.resolve<any>("sessionStore"); 

    this.manager = new PluginManager(
      sessionStore as any,
      process.cwd(),
      config
    );
  }

  /**
   * Load all enabled plugins.
   */
  async loadEnabled(): Promise<void> {
    await this.manager.loadEnabled();
  }

  /**
   * Get tools contributed by loaded plugins.
   */
  getPluginTools(): Tool[] {
    return this.manager.pluginTools();
  }

  /**
   * Inspect a plugin source or installed plugin.
   */
  inspect(idOrDir: string) {
    return this.manager.inspect(idOrDir);
  }

  /**
   * Prepare a plugin for installation.
   */
  prepareInstall(source: string): InstallResult {
    return this.manager.prepareInstall(source);
  }

  /**
   * Commit plugin installation after approval.
   */
  commitInstall(
    source: string,
    grantedPermissions: PermissionScope[],
    opts?: { enable?: boolean; updateSource?: string },
  ): InstallResult {
    return this.manager.commitInstall(source, grantedPermissions, opts);
  }

  /**
   * Remove a plugin.
   */
  async remove(id: string) {
    return await this.manager.remove(id);
  }

  /**
   * Enable a plugin.
   */
  enable(id: string) {
    return this.manager.enable(id);
  }

  /**
   * Disable a plugin.
   */
  async disable(id: string) {
    return await this.manager.disable(id);
  }

  /**
   * Update a plugin.
   */
  update(id: string, source?: string) {
    return this.manager.update(id, source);
  }

  /**
   * Set permissions for a plugin.
   */
  setPermissions(id: string, perms: PermissionScope[]) {
    return this.manager.setPermissions(id, perms);
  }

  /**
   * Get list of installed plugins.
   */
  listInstalled() {
    return this.manager.listInstalled();
  }

  /**
   * Get a specific plugin entry.
   */
  getEntry(id: string) {
    return this.manager.getEntry(id);
  }

  /**
   * Health status for all plugins.
   */
  health() {
    return this.manager.health();
  }

  /**
   * Summary of plugin ecosystem.
   */
  summary() {
    return this.manager.summary();
  }

  async onInit(): Promise<void> {
    // Plugins are usually loaded during start or on demand
  }

  async onStart(): Promise<void> {
    await this.loadEnabled();
  }

  async onStop(): Promise<void> {}
}
