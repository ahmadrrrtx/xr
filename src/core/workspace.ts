/**
 * XR 3.0 — Workspace Manager
 * Implements Phase 7: Workspace isolation.
 * Isolates settings, providers, memories, skills, plugins, and databases.
 */

import { join } from "node:path";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { XR_HOME, loadConfig, saveConfig, type XRConfig } from "../config/config.ts";
import { Store } from "../state/db.ts";

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

export class WorkspaceManager {
  private activeWorkspaceId: string = "default";
  private workspaces = new Map<string, WorkspaceContext>();
  private globalConfig: XRConfig;

  constructor() {
    this.globalConfig = loadConfig().config;
    this.ensureWorkspace("default", "Default Workspace");
  }

  /**
   * Get the active workspace ID.
   */
  getActiveId(): string {
    return this.activeWorkspaceId;
  }

  /**
   * Set the active workspace ID.
   */
  setActiveId(id: string): void {
    if (!this.workspaces.has(id)) {
      this.ensureWorkspace(id, id);
    }
    this.activeWorkspaceId = id;
  }

  /**
   * Ensure a workspace exists and is provisioned.
   */
  ensureWorkspace(id: string, name: string): WorkspaceContext {
    const rootDir = id === "default" ? XR_HOME : join(XR_HOME, "workspaces", id);
    const dbPath = join(rootDir, id === "default" ? "xr.db" : `xr-${id}.db`);
    const configPath = join(rootDir, "config.json");
    const pluginsDir = join(rootDir, "plugins");
    const skillsDir = join(rootDir, "skills");
    const memoriesDir = join(rootDir, "memories");

    // Provision folders
    for (const dir of [rootDir, pluginsDir, skillsDir, memoriesDir]) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    // Default configuration overlay
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
    return this.workspaces.get(this.activeWorkspaceId)!;
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
    const defaultCtx = this.workspaces.get("default")!;
    const list = [defaultCtx];

    const workspacesDir = join(XR_HOME, "workspaces");
    if (existsSync(workspacesDir)) {
      const dirents = require("node:fs").readdirSync(workspacesDir, { withFileTypes: true });
      for (const ent of dirents) {
        if (ent.isDirectory() && ent.name !== "default") {
          list.push(this.ensureWorkspace(ent.name, ent.name));
        }
      }
    }
    return list;
  }

  /**
   * Retrieve a localized SQLite store for the workspace.
   */
  getStore(id: string): Store {
    const ctx = this.ensureWorkspace(id, id);
    return new Store(ctx.dbPath);
  }

  /**
   * Delete/clean up a workspace.
   */
  deleteWorkspace(id: string): boolean {
    if (id === "default") return false;
    const ctx = this.workspaces.get(id);
    if (!ctx) return false;

    // Delete database, config, and recursively workspace folders
    try {
      if (existsSync(ctx.dbPath)) require("node:fs").unlinkSync(ctx.dbPath);
      if (existsSync(ctx.configPath)) require("node:fs").unlinkSync(ctx.configPath);
      require("node:fs").rmSync(ctx.rootDir, { recursive: true, force: true });
      this.workspaces.delete(id);
      if (this.activeWorkspaceId === id) {
        this.activeWorkspaceId = "default";
      }
      return true;
    } catch {
      return false;
    }
  }
}
