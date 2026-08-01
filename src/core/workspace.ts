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
  /** Phase 3 · T3 — true once async load() has run (kernel boot path). */
  private loaded = false;

  constructor() {
    // Single cached config read — the config substrate's canonical load
    // (documented owned exception in docs/perf/PERF-BUDGETS.md). No other
    // sync I/O happens here: state read/provisioning moved to async load().
    this.globalConfig = loadConfig().config;
  }

  /**
   * Phase 3 · T3 — async state load + provisioning. Called by XRApp.bootstrap
   * BEFORE any provider runs, so the kernel boot path performs no synchronous
   * filesystem I/O. Standalone consumers that never call load() fall back to
   * the previous synchronous behavior via ensureLoadedSync().
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    const { mkdir } = await import("node:fs/promises");
    await mkdir(XR_HOME, { recursive: true });
    await mkdir(WORKSPACES_ROOT, { recursive: true });

    let state: WorkspaceStateFile = { activeWorkspaceId: "default" };
    try {
      const file = Bun.file(WORKSPACE_STATE_PATH);
      if (await file.exists()) {
        const parsed = (await file.json()) as Partial<WorkspaceStateFile>;
        state = { activeWorkspaceId: parsed.activeWorkspaceId || "default" };
      }
    } catch {
      state = { activeWorkspaceId: "default" }; // corrupt state → default (same as sync path)
    }
    this.activeWorkspaceId = state.activeWorkspaceId || "default";
    await this.provision("default", "Default Workspace");
    if (this.activeWorkspaceId !== "default") {
      await this.provision(this.activeWorkspaceId, this.activeWorkspaceId);
    }
    // Persist only when the file is missing or the active id changed — the
    // boot path never rewrites an unchanged state file.
    if (state.activeWorkspaceId !== this.activeWorkspaceId) {
      try {
        await Bun.write(
          WORKSPACE_STATE_PATH,
          JSON.stringify({ activeWorkspaceId: this.activeWorkspaceId }, null, 2),
        );
      } catch {
        /* best-effort persist */
      }
    }
    this.loaded = true;
  }

  /** Async provisioning of a workspace's root dirs + config overlay. */
  private async provision(id: string, name: string): Promise<void> {
    const rootDir = id === "default" ? XR_HOME : join(WORKSPACES_ROOT, id);
    const dbPath = join(rootDir, id === "default" ? "xr.db" : `xr-${id}.db`);
    const configPath = join(rootDir, "config.json");
    const pluginsDir = join(rootDir, "plugins");
    const skillsDir = join(rootDir, "skills");
    const memoriesDir = join(rootDir, "memories");

    const { mkdir, writeFile } = await import("node:fs/promises");
    for (const dir of [rootDir, pluginsDir, skillsDir, memoriesDir]) {
      await mkdir(dir, { recursive: true });
    }
    try {
      const file = Bun.file(configPath);
      if (!(await file.exists())) {
        await writeFile(
          configPath,
          JSON.stringify({ ...this.globalConfig, workspaceId: id, workspaceName: name }, null, 2),
          "utf8",
        );
      }
    } catch {
      /* best-effort provisioning */
    }

    this.workspaces.set(id, {
      id,
      name,
      rootDir,
      configPath,
      dbPath,
      pluginsDir,
      skillsDir,
      memoriesDir,
    });
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
   * Standalone consumers that never call load(): restore the pre-Phase-3
   * synchronous state behavior on first access.
   */
  private ensureLoadedSync(): void {
    if (this.loaded) return;
    this.ensureRoots();
    this.activeWorkspaceId = this.readState().activeWorkspaceId || "default";
    this.ensureWorkspace("default", "Default Workspace");
    this.ensureWorkspace(this.activeWorkspaceId, this.activeWorkspaceId === "default" ? "Default Workspace" : this.activeWorkspaceId);
    this.loaded = true;
  }

  /**
   * Get the active workspace ID.
   */
  getActiveId(): string {
    this.ensureLoadedSync();
    return this.activeWorkspaceId;
  }

  /**
   * Set the active workspace ID and persist it.
   */
  setActiveId(id: string): void {
    this.ensureLoadedSync();
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
    this.ensureLoadedSync();
    return this.ensureWorkspace(this.activeWorkspaceId, this.activeWorkspaceId === "default" ? "Default Workspace" : this.activeWorkspaceId);
  }

  /**
   * Get context for a specific workspace.
   */
  getContext(id: string): WorkspaceContext | undefined {
    this.ensureLoadedSync();
    return this.workspaces.get(id);
  }

  /**
   * List all provisioned workspaces.
   */
  listWorkspaces(): WorkspaceContext[] {
    this.ensureLoadedSync();
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
    this.ensureLoadedSync();
    const ctx = this.ensureWorkspace(id, id === "default" ? "Default Workspace" : id);
    return new Store(ctx.dbPath);
  }

  /**
   * Delete/clean up a workspace.
   */
  deleteWorkspace(id: string): boolean {
    this.ensureLoadedSync();
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
