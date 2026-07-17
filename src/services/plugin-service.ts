/** XR Stage 10 — Plugin Service. */
import { PluginManager, type InstallResult } from "../plugins/manager.ts";
import { Container } from "../core/container.ts";
import { ConfigService } from "./config-service.ts";
import type { LifecycleHook } from "../core/lifecycle.ts";
import type { PermissionScope } from "../plugins/types.ts";
import type { Tool } from "../core/types.ts";
import { Store } from "../state/workspace-store.ts";

export class PluginService implements LifecycleHook {
  private manager: PluginManager;
  private loaded = false;

  constructor(private container: Container) {
    const configService = container.resolve<ConfigService>("config");
    const config = configService.get();
    /** 0.2 Storage Unification: Always resolve the single workspace store from container. */
    const store = container.resolve<Store>("store");
    this.manager = new PluginManager(store, process.cwd(), config);
  }

  async loadEnabled(): Promise<void> {
    await this.manager.loadEnabled();
    this.loaded = true;
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.loadEnabled();
  }

  getPluginTools(): Tool[] { return this.manager.pluginTools(); }
  getPluginSkills() { return this.manager.pluginSkills(); }
  inspect(idOrDir: string) { return this.manager.inspect(idOrDir); }
  prepareInstall(source: string): InstallResult { return this.manager.prepareInstall(source); }
  commitInstall(source: string, grantedPermissions: PermissionScope[], opts?: { enable?: boolean; updateSource?: string }): InstallResult {
    this.loaded = false;
    return this.manager.commitInstall(source, grantedPermissions, opts);
  }
  async remove(id: string) { this.loaded = false; return await this.manager.remove(id); }
  enable(id: string) { this.loaded = false; return this.manager.enable(id); }
  async disable(id: string) { this.loaded = false; return await this.manager.disable(id); }
  update(id: string, source?: string) { this.loaded = false; return this.manager.update(id, source); }
  setPermissions(id: string, perms: PermissionScope[]) { this.loaded = false; return this.manager.setPermissions(id, perms); }
  listInstalled() { return this.manager.listInstalled(); }
  getEntry(id: string) { return this.manager.getEntry(id); }
  health() { return this.manager.health(); }
  summary() { return this.manager.summary(); }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> { await this.loadEnabled(); }
  async onStop(): Promise<void> {}
}
