/**
 * XR Stage 11 — MCP Service (lifecycle integration)
 */
import { McpManager } from "../mcp/manager.ts";
import { Container } from "../core/container.ts";
import type { LifecycleHook } from "../core/lifecycle.ts";
import type { Tool } from "../core/types.ts";
import { Store } from "../state/workspace-store.ts";

export class McpService implements LifecycleHook {
  private manager: McpManager;
  private loaded = false;

  constructor(private container: Container) {
    /** 0.2 Storage Unification: Always resolve the single workspace store from container. */
    const store = container.resolve<Store>("store");
    this.manager = new McpManager(store, process.cwd());
  }

  async loadEnabled(): Promise<void> {
    await this.manager.loadEnabled();
    this.loaded = true;
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.loadEnabled();
  }

  getMcpTools(): Tool[] {
    return this.manager.mcpTools();
  }

  getSummary() { return this.manager.summary(); }
  listServers() { return this.manager.listServers(); }
  inspect(id: string) { return this.manager.inspect(id); }
  healthCheck(id?: string) { return this.manager.healthCheck(id); }

  async addServer(input: any) { return this.manager.addServer(input); }
  enable(id: string) { return this.manager.enable(id); }
  async disable(id: string) { return this.manager.disable(id); }
  remove(id: string) { return this.manager.remove(id); }

  async onInit(): Promise<void> {}
  async onStart(): Promise<void> { await this.loadEnabled(); }
  async onStop(): Promise<void> {}
}
