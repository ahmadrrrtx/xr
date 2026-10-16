/**
 * A1 F03/FS08–FS11: Builder routes share the filesystem authority.
 * Real handler + real approval store (same harness as builder-routes.test.ts).
 * Outside canaries are generated per run; they must never appear in responses
 * and outside bytes must never change without an approved in-root operation.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { resetBuilderProjectsForTests } from "../../src/daemon/builder-projects.ts";
import { staticFileFor, realDetectFs } from "../../src/daemon/dev-servers.ts";

const TOKEN = "builder-authority-token";
const CANARY = `A1_BUILDER_CANARY_${Math.random().toString(36).slice(2)}`;
let ws = "", outside = "", projectId = "", h: ReturnType<typeof makeHandler>;

beforeAll(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "a1-builder-")));
  ws = join(base, "workspace"); outside = join(base, "outside");
  mkdirSync(ws); mkdirSync(outside); mkdirSync(join(ws, "sub"));
  process.env.XR_HOME = join(base, "xr-home");
  writeFileSync(join(outside, "marker.txt"), CANARY);
  writeFileSync(join(ws, ".env"), `SECRET=${CANARY}`);
  writeFileSync(join(ws, "safe.txt"), "BUILDER_SAFE_POSITIVE");
  writeFileSync(join(ws, "sub", "file.txt"), "IN_ROOT_ORIGINAL");
  symlinkSync(outside, join(ws, "linked"), "dir");
  linkSync(join(outside, "marker.txt"), join(ws, "hard.txt"));
  resetBuilderProjectsForTests();
  h = makeHandler(new Store(join(base, "store.db")), TOKEN);
});

const req = (p: string, init?: { method?: string; body?: unknown }) =>
  new Request(`http://127.0.0.1:7842${p}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function openProject(): Promise<string> {
  const res = await h(req("/api/v1/builder/projects", { method: "POST", body: { path: ws, name: "authority" } }));
  expect(res.status).toBe(200);
  projectId = ((await res.json()) as { id: string }).id;
  return projectId;
}

/** Match the approval for THIS target path; earlier red cases may leave other approvals pending. */
async function pendingFor(tool: string, pathFragment: string, timeoutMs = 10_000): Promise<{ id: string; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: Array<{ id: string; tool: string; reason: string }> };
    const hit = (body.pending ?? []).find((r) => r.tool === tool && r.reason.includes(pathFragment));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no pending ${tool}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const decide = (id: string, approved: boolean) => h(req(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approved } }));
const frames = (text: string) => text.split("\n\n").map((l) => l.replace(/^data: /, "").trim()).filter((l) => l && l !== "[DONE]").map((l) => JSON.parse(l) as Record<string, unknown>);

// Windows refuses to rename a directory while a handle bound by a pending approval or
// retained read is open. That refusal is the stronger guarantee; the swap then never happens.
function trySwapDir(from: string, to: string): boolean {
  try { renameSync(from, to); return true; } catch (e) {
    if (process.platform === "win32" && (e as NodeJS.ErrnoException).code === "EPERM") return false;
    throw e;
  }
}

describe("A1 builder filesystem authority", () => {
  test("FS08 builder read positive: in-root file returns content", async () => {
    const id = await openProject();
    const res = await h(req(`/api/v1/builder/projects/${id}/file?path=safe.txt`));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { content: string }).content).toBe("BUILDER_SAFE_POSITIVE");
  });

  test("FS01/FS08 builder read: symlink escape is denied and returns no outside canary", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file?path=linked/marker.txt`));
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(CANARY);
  });

  test("FS04 builder read: sensitive .env is denied with no secret echo", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file?path=.env`));
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(CANARY);
  });

  test("FS04 builder read: hardlink alias to outside bytes is denied", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file?path=hard.txt`));
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(CANARY);
  });

  test("FS02 builder write: escaping destination is refused before any approval is requested", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/write`, { method: "POST", body: { path: "linked/new.txt", content: "ESCAPE" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(outside, "new.txt"))).toBe(false);
  });

  test("FS02 builder create: escaping destination is refused before approval", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/create`, { method: "POST", body: { path: "linked/x.txt", kind: "file" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(outside, "x.txt"))).toBe(false);
  });

  test("FS09 builder delete: escaping target is refused and outside marker survives", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/delete`, { method: "POST", body: { path: "linked" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(readFileSync(join(outside, "marker.txt"), "utf8")).toBe(CANARY);
  });

  test("FS04/FS09 builder rename: moving a sensitive file out of its name is refused", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/rename`, { method: "POST", body: { from: ".env", to: "env-copy.txt" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(ws, ".env"))).toBe(true);
    expect(existsSync(join(ws, "env-copy.txt"))).toBe(false);
  });

  test("FS09 builder rename: escaping destination is refused", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/rename`, { method: "POST", body: { from: "safe.txt", to: "linked/moved.txt" } }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(existsSync(join(outside, "moved.txt"))).toBe(false);
    expect(existsSync(join(ws, "safe.txt"))).toBe(true);
  });

  test("FS11 builder write: parent swapped to a symlink after approval is requested never writes outside", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/write`, { method: "POST", body: { path: "sub/file.txt", content: "APPROVED_NEW" } }));
    const pendingWrite = pendingFor("write_file", "sub/file.txt");
    // Deterministic swap between approval request and commit.
    const approval = await pendingWrite;
    const swapped = trySwapDir(join(ws, "sub"), join(ws, "sub-original"));
    if (swapped) symlinkSync(outside, join(ws, "sub"), "dir");
    await decide(approval.id, true);
    const text = await res.text();
    expect(existsSync(join(outside, "file.txt"))).toBe(false);
    if (swapped) {
      expect(frames(text).at(-1)?.type).not.toBe("applied");
      expect(readFileSync(join(ws, "sub-original", "file.txt"), "utf8")).toBe("IN_ROOT_ORIGINAL");
    } else {
      // OS refused the swap; the approved write must land in the bound in-root directory.
      expect(frames(text).at(-1)?.type).toBe("applied");
      expect(readFileSync(join(ws, "sub", "file.txt"), "utf8")).toBe("APPROVED_NEW");
    }
    if (swapped) {
      rmSync(join(ws, "sub"), { force: true });
      renameSync(join(ws, "sub-original"), join(ws, "sub"));
    } else rmSync(join(ws, "sub", "file.txt"), { force: true });
  });

  test("FS04/FS09 apply-diff: protected .env cannot be patched (no read, no approval, no secret echo)", async () => {
    // The patch matches the real bytes, so an unguarded implementation would reach consent.
    const patch = `@@ -1 +1 @@\n-SECRET=${CANARY}\n+SECRET=changed\n`;
    const res = await h(req(`/api/v1/builder/projects/${projectId}/apply-diff`, { method: "POST", body: { path: ".env", patch } }));
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(CANARY);
    expect(readFileSync(join(ws, ".env"), "utf8")).toBe(`SECRET=${CANARY}`);
  });

  test("FS01/FS09 apply-diff through symlink: outside bytes are never read into conflict output or changed", async () => {
    const patch = `@@ -1 +1 @@\n-${CANARY}\n+changed\n`;
    const res = await h(req(`/api/v1/builder/projects/${projectId}/apply-diff`, { method: "POST", body: { path: "linked/marker.txt", patch } }));
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain(CANARY);
    expect(readFileSync(join(outside, "marker.txt"), "utf8")).toBe(CANARY);
  });

  test("FS08 positive: approved in-root write lands and is audited as applied", async () => {
    const res = await h(req(`/api/v1/builder/projects/${projectId}/file/write`, { method: "POST", body: { path: "sub/file.txt", content: "APPROVED_NEW" } }));
    const approval = await pendingFor("write_file", "sub/file.txt");
    await decide(approval.id, true);
    expect(frames(await res.text()).at(-1)?.type).toBe("applied");
    expect(readFileSync(join(ws, "sub", "file.txt"), "utf8")).toBe("APPROVED_NEW");
  });
});

describe("A1 dev-server preview and detection are authority-bound", () => {
  test("FS04/FS01 static preview never resolves .env or a symlink escape (no outside or secret bytes served)", () => {
    expect(staticFileFor(ws, "/.env")).toBeNull();
    expect(staticFileFor(ws, "/linked/marker.txt")).toBeNull();
    expect(staticFileFor(ws, "/safe.txt")).toBe(join(ws, "safe.txt"));
  });

  test("FS14 detection reads package.json through the authority; secrets and escapes are not read", () => {
    const fsd = realDetectFs(ws);
    expect(fsd.readText(".env")).toBeNull();
    expect(fsd.readText("linked/marker.txt")).toBeNull();
    expect(fsd.exists("linked/marker.txt")).toBe(false);
  });
});
