/**
 * XR 3.1 — Workspace Manager
 *
 * Responsibilities:
 *  - provision workspace folders and isolated database paths
 *  - persist the active workspace selection across launches
 *  - expose a stable source of truth for CLI, TUI, and daemon surfaces
 */

import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { XR_HOME, loadConfig, type XRConfig } from "../config/config.ts";
import { Store } from "../state/workspace-store.ts";

export interface WorkspaceContext {
  id: string;
  name: string;
  rootDir: string;
  configPath: string;
  dbPath: string;
  pluginsDir: string;
  skillsDir: string;
  memoriesDir: string;
}

interface WorkspaceStateFile {
  activeWorkspaceId: string;
}

const WORKSPACES_ROOT = join(XR_HOME, "workspaces");
const WORKSPACE_STATE_PATH = join(WORKSPACES_ROOT, "state.json");

export class WorkspaceManager {
  private activeWorkspaceId = "default";
  private workspaces = new Map<string, WorkspaceContext>();
  private globalConfig: XRConfig;

  constructor() {
    this.globalConfig = loadConfig().config;
    this.ensureWorkspace("default", "Default Workspace");
    this.activeWorkspaceId = this.readState().activeWorkspaceId || "default";
    this.ensureWorkspace(this.activeWorkspaceId, this.activeWorkspaceId === "default" ? "Default Workspace" : this.activeWorkspaceId);
    this.writeState();
  }

  private ensureRoots(): void {
    mkdirSync(XR_HOME, { recursive: true });
    mkdirSync(WORKSPACES_ROOT, { recursive: true });
  }

  private readState(): WorkspaceStateFile {
    this.ensureRoots();
    if (!existsSync(WORKSPACE_STATE_PATH)) return { activeWorkspaceId: "default" };
    try {
      const parsed = JSON.parse(readFileSync(WORKSPACE_STATE_PATH, "utf8")) as Partial<WorkspaceStateFile>;
      return { activeWorkspaceId: parsed.activeWorkspaceId || "default" };
    } catch {
      return { activeWorkspaceId: "default" };
    }
  }

  private writeState(): void {
    this.ensureRoots();
    writeFileSync(WORKSPACE_STATE_PATH, JSON.stringify({ activeWorkspaceId: this.activeWorkspaceId }, null, 2), "utf8");
  }

  /**
   * Get the active workspace ID.
   */
  getActiveId(): string {
    return this.activeWorkspaceId;
  }

  /**
   * Set the active workspace ID and persist it.
   */
  setActiveId(id: string): void {
    if (!this.workspaces.has(id)) {
      this.ensureWorkspace(id, id === "default" ? "Default Workspace" : id);
    }
    this.activeWorkspaceId = id;
    this.writeState();
  }

  /**
   * Ensure a workspace exists and is provisioned.
   */
  ensureWorkspace(id: string, name: string): WorkspaceContext {
    if (this.workspaces.has(id)) return this.workspaces.get(id)!;

    const rootDir = id === "default" ? XR_HOME : join(WORKSPACES_ROOT, id);
    const dbPath = join(rootDir, id === "default" ? "xr.db" : `xr-${id}.db`);
    const configPath = join(rootDir, "config.json");
    const pluginsDir = join(rootDir, "plugins");
    const skillsDir = join(rootDir, "skills");
    const memoriesDir = join(rootDir, "memories");

    for (const dir of [rootDir, pluginsDir, skillsDir, memoriesDir]) {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(configPath)) {
      const overlayConfig = {
        ...this.globalConfig,
        workspaceId: id,
        workspaceName: name,
      };
      writeFileSync(configPath, JSON.stringify(overlayConfig, null, 2), "utf8");
    }

    const ctx: WorkspaceContext = {
      id,
      name,
      rootDir,
      configPath,
      dbPath,
      pluginsDir,
      skillsDir,
      memoriesDir,
    };

    this.workspaces.set(id, ctx);
    return ctx;
  }

  /**
   * Get context of active workspace.
   */
  getActiveContext(): WorkspaceContext {
    return this.ensureWorkspace(this.activeWorkspaceId, this.activeWorkspaceId === "default" ? "Default Workspace" : this.activeWorkspaceId);
  }

  /**
   * Get context for a specific workspace.
   */
  getContext(id: string): WorkspaceContext | undefined {
    return this.workspaces.get(id);
  }

  /**
   * List all provisioned workspaces.
   */
  listWorkspaces(): WorkspaceContext[] {
    const list: WorkspaceContext[] = [this.ensureWorkspace("default", "Default Workspace")];

    if (existsSync(WORKSPACES_ROOT)) {
      const dirents = readdirSync(WORKSPACES_ROOT, { withFileTypes: true });
      for (const ent of dirents) {
        if (!ent.isDirectory()) continue;
        if (ent.name === "default") continue;
        list.push(this.ensureWorkspace(ent.name, ent.name));
      }
    }

    const seen = new Set<string>();
    return list.filter((ws) => {
      if (seen.has(ws.id)) return false;
      seen.add(ws.id);
      return true;
    });
  }

  /**
   * Retrieve a localized SQLite store for the workspace.
   *
   * 0.2 Storage Unification: WARNING — this creates a NEW Store instance
   * each time it's called. Prefer resolving the kernel's single "store"
   * from the DI container instead. This method exists only for standalone
   * CLI usage outside the kernel lifecycle.
   */
  getStore(id: string): Store {
    const ctx = this.ensureWorkspace(id, id === "default" ? "Default Workspace" : id);
    return new Store(ctx.dbPath);
  }

  /**
   * Delete/clean up a workspace.
   */
  deleteWorkspace(id: string): boolean {
    if (id === "default") return false;
    const ctx = this.ensureWorkspace(id, id);

    try {
      if (existsSync(ctx.dbPath)) unlinkSync(ctx.dbPath);
      if (existsSync(ctx.configPath)) unlinkSync(ctx.configPath);
      rmSync(ctx.rootDir, { recursive: true, force: true });
      this.workspaces.delete(id);
      if (this.activeWorkspaceId === id) {
        this.activeWorkspaceId = "default";
        this.writeState();
      }
      return true;
    } catch {
      return false;
    }
  }
}
