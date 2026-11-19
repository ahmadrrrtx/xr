/**
 * Phase 6 — B17: deleting a workspace that is still open.
 *
 * The old deleteWorkspace unlinked the database and rmSync'ed the directory with
 * no lock and no liveness check: on POSIX a daemon kept writing into an unlinked
 * file (silent data loss), on Windows the unlink failed half-way and the CLI said
 * "not found". Now, under the database's cross-process migration lock, deletion
 * refuses while any process (this one included) holds the database open, and a
 * free workspace is tombstoned (database moved out of reach) before removal.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceInUseError, WorkspaceManager } from "../../src/core/workspace.ts";
import { Store } from "../../src/state/workspace-store.ts";
import { XR_HOME } from "../../src/config/config.ts";
import { databaseIdle } from "../../src/state/db-liveness.ts";

const REPO = join(import.meta.dir, "../..");
const WORKSPACES = join(XR_HOME, "workspaces");
const scratch: string[] = [];
afterEach(() => { for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true }); });

function provision(wm: WorkspaceManager, prefix: string): { id: string; dbPath: string } {
  const id = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const store = wm.getStore(id);
  store.audit("seed.row", { keep: true });
  const dbPath = wm.listWorkspaces().find((w) => w.id === id)!.dbPath;
  store.close();
  return { id, dbPath };
}

/** A second process that opens the workspace store and keeps it open until killed. */
async function holdInChild(id: string, dbPath: string) {
  const dir = mkdtempSync(join(tmpdir(), "xr-ws-holder-"));
  scratch.push(dir);
  const script = join(dir, "holder.ts");
  writeFileSync(script, `
    import { Store } from ${JSON.stringify(join(REPO, "src/state/workspace-store.ts"))};
    const store = new Store(process.argv[2], process.argv[3]);
    store.audit("child.hold", {});
    console.log("ready");
    setInterval(() => {}, 1000);
  `);
  const proc = Bun.spawn([process.execPath, script, id, dbPath], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
  const reader = proc.stdout.getReader();
  let out = "";
  while (!out.includes("ready")) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`holder exited early: ${await new Response(proc.stderr).text()}`);
    out += new TextDecoder().decode(value);
  }
  return { stop: async () => { proc.kill(); await proc.exited; } };
}

const auditRows = (id: string, dbPath: string) => {
  const s = new Store(id, dbPath);
  try { return s.auditCount(); } finally { s.close(); }
};

describe("B17 — deleteWorkspace refuses a live workspace and tombstones a free one", () => {
  test("another process holding the database blocks deletion, every byte survives, and deletion succeeds after it exits", async () => {
    const wm = new WorkspaceManager();
    const { id, dbPath } = provision(wm, "held");
    const holder = await holdInChild(id, dbPath);
    try {
      expect(databaseIdle(dbPath)).toBe(false);
      expect(() => wm.deleteWorkspace(id)).toThrow(WorkspaceInUseError);
      expect(() => wm.deleteWorkspace(id)).toThrow(/running XR process/);
      expect(existsSync(dbPath)).toBe(true);
      expect(auditRows(id, dbPath)).toBeGreaterThanOrEqual(2); // the seed row and the child's row
    } finally {
      await holder.stop();
    }
    expect(wm.deleteWorkspace(id)).toBe(true);
    expect(existsSync(join(WORKSPACES, id))).toBe(false);
    expect(wm.listWorkspaces().some((w) => w.id === id)).toBe(false);
    const trash = join(XR_HOME, ".deleted-workspaces");
    expect(existsSync(trash) ? readdirSync(trash).filter((n) => n.startsWith(`${id}-`)) : []).toEqual([]);
  }, 30_000);

  test("the active workspace, open in this process, is refused with a switch-first message", () => {
    const wm = new WorkspaceManager();
    const { id, dbPath } = provision(wm, "active");
    wm.setActiveId(id);
    const kernelStore = new Store(id, dbPath); // what a CLI command's kernel holds for the active workspace
    try {
      expect(() => wm.deleteWorkspace(id)).toThrow(/active workspace and is open; switch first/);
      expect(existsSync(dbPath)).toBe(true);
    } finally {
      kernelStore.close();
    }
    wm.setActiveId("default");
    expect(wm.deleteWorkspace(id)).toBe(true);
    expect(wm.getActiveId()).toBe("default");
  });

  test("unknown and default ids return false and create nothing", () => {
    const wm = new WorkspaceManager();
    const ghost = `ghost-${Date.now()}`;
    expect(wm.deleteWorkspace(ghost)).toBe(false);
    expect(existsSync(join(WORKSPACES, ghost))).toBe(false);
    expect(wm.deleteWorkspace("default")).toBe(false);
  });
});
