/**
 * UX Phase G — workspace files & coding surface (experimental, honest).
 *
 *   · G-1 — a REAL, scope-enforced file browser behind /api/files (list /
 *     read / diff). The old Files panel was a static placeholder that claimed
 *     "No produced artifacts present"; it now shows the actual project.
 *   · G-2 — per-file real git status, a file viewer, and a real `git diff`
 *     (untracked files honestly report no diff).
 *   · G-4 — future surfaces are honestly labeled (no fake terminal/3D/mic).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { DASHBOARD_PAGE, DASHBOARD_SCRIPT, DASHBOARD_CSS } from "../../src/daemon/dashboard.ts";

const TOKEN = "g-token";

// ── route-level harness against a temp project dir ───────────────────────
let projectDir = "";
let h: ReturnType<typeof makeHandler>;
// Captured BEFORE any chdir so afterAll can restore it on ANY host (the
// earlier hardcoded "/home/user/repo" only existed in the sandbox — on CI it
// leaked the temp cwd into sibling test files in the same bun worker and
// broke repo-relative scans: single-writer, SBOM, skills-count).
const ORIG_CWD = process.cwd();

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "xr-g-proj-"));
  mkdirSync(join(projectDir, "sub"), { recursive: true });
  writeFileSync(join(projectDir, "hello.txt"), "hello xr\n", "utf8");
  writeFileSync(join(projectDir, "sub", "nested.md"), "# nested\n", "utf8");
  writeFileSync(join(projectDir, "blob.bin"), Buffer.from([0, 1, 2, 3, 255]));
  // The files routes resolve the project root from process.cwd() at request
  // time (same authority as /api/overview). bun isolates each test FILE in
  // its own worker process, so chdir is scoped to this file — keep it.
  process.chdir(projectDir);
  process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-g-home-")), "home");
  const store = new Store(join(projectDir, ".xr-test.db"));
  h = makeHandler(store, TOKEN);
});

// bun batches multiple test files into shared workers: the chdir above MUST
// be restored or the temp cwd leaks into the next file in the same worker
// (breaking repo-relative scans like the single-writer / SBOM / skills-count
// gates). Restore to the captured original cwd — host-agnostic.
afterAll(() => {
  try { process.chdir(ORIG_CWD); } catch { /* ignore */ }
});
const get = (p: string) =>
  new Request(`http://127.0.0.1:7842${p}`, { headers: { authorization: `Bearer ${TOKEN}` } });

describe("G-1 — files.list is real and scope-enforced", () => {
  test("lists the project root with real entries", async () => {
    const res = await h(get("/api/v1/files"));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    // macOS: /var is a symlink to /private/var, so process.cwd() (used by the
    // route as its root authority) returns the PHYSICAL path while the raw
    // mkdtemp path keeps the symlink. Normalize both sides so the assertion is
    // host-agnostic (no-op on Linux/Windows).
    expect(body.root).toBe(realpathSync(projectDir));
    const names = (body.entries || []).map((e: any) => e.name);
    expect(names).toContain("hello.txt");
    expect(names).toContain("sub");
    expect(body.truncated).toBe(false);
  });

  test("a subdirectory is browsable via ?path=", async () => {
    const res = await h(get("/api/v1/files?path=" + encodeURIComponent("sub")));
    const body: any = await res.json();
    expect(body.cwd).toBe("sub");
    expect((body.entries || []).map((e: any) => e.name)).toContain("nested.md");
  });

  test("path traversal is rejected (.. and absolute)", async () => {
    const r1 = await h(get("/api/v1/files?path=" + encodeURIComponent("..")));
    expect(r1.status).toBe(400);
    const r2 = await h(get("/api/v1/files?path=" + encodeURIComponent("/etc")));
    expect(r2.status).toBe(400);
  });
});

describe("G-1 — files.read is real and text-capped", () => {
  test("reads a text file", async () => {
    const res = await h(get("/api/v1/files/read?path=" + encodeURIComponent("hello.txt")));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.content).toBe("hello xr\n");
    expect(body.isText).toBe(true);
    expect(body.truncated).toBe(false);
  });

  test("refuses binary files (text-only preview)", async () => {
    const res = await h(get("/api/v1/files/read?path=" + encodeURIComponent("blob.bin")));
    expect(res.status).toBe(415);
  });

  test("rejects traversal on read", async () => {
    const res = await h(get("/api/v1/files/read?path=" + encodeURIComponent("../../etc/passwd")));
    expect(res.status).toBe(400);
  });
});

describe("G-2 — files.diff is real", () => {
  test("untracked files honestly report no diff (tracked:false)", async () => {
    const res = await h(get("/api/v1/files/diff?path=" + encodeURIComponent("hello.txt")));
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.tracked).toBe(false);
    expect(typeof body.diff).toBe("string");
  });

  test("rejects traversal on diff", async () => {
    const res = await h(get("/api/v1/files/diff?path=" + encodeURIComponent("../../x")));
    expect(res.status).toBe(400);
  });
});

describe("G-1/G-2 — dashboard surfaces", () => {
  test("the Files panel is a real two-pane browser, not the placeholder", () => {
    expect(DASHBOARD_PAGE).toContain('id="files-breadcrumb"');
    expect(DASHBOARD_PAGE).toContain('id="files-list"');
    expect(DASHBOARD_PAGE).toContain('id="files-viewer"');
    expect(DASHBOARD_PAGE).not.toContain("No produced artifacts present");
    expect(DASHBOARD_PAGE).toContain("Workspace Files");
    expect(DASHBOARD_PAGE).toContain("experimental");
  });

  test("the client loads real data and navigates the tree", () => {
    expect(DASHBOARD_SCRIPT).toContain('async function loadFiles()');
    expect(DASHBOARD_SCRIPT).toContain('api("/api/files")');
    expect(DASHBOARD_SCRIPT).toContain('api("/api/files/read?path="');
    expect(DASHBOARD_SCRIPT).toContain('api("/api/files/diff?path="');
    expect(DASHBOARD_SCRIPT).toContain('case "files": loadFiles(); break;');
    expect(DASHBOARD_SCRIPT).toContain('act("filesEnterDir", e.rel)');
    expect(DASHBOARD_SCRIPT).toContain('act("filesSelect", e.rel)');
  });

  test("files actions are allowlisted", () => {
    const allow = DASHBOARD_SCRIPT.match(/var XR_ACTIONS = new Set\(\[([^\]]+)\]/)?.[1] ?? "";
    for (const fn of ["loadFiles", "filesEnterDir", "filesSelect", "filesShowDiff", "filesCopy", "filesAsk"]) {
      expect(allow).toContain(`"${fn}"`);
    }
  });

  test("browser CSS exists and is responsive", () => {
    expect(DASHBOARD_CSS).toContain(".files-browser");
    expect(DASHBOARD_CSS).toContain(".files-row.dir");
    expect(DASHBOARD_CSS).toContain(".files-code");
    expect(DASHBOARD_CSS).toContain("@media (max-width: 900px)");
  });
});

describe("G-4 — future surfaces are honestly labeled, never faked", () => {
  test("the About panel lists planned surfaces with real reasons", () => {
    expect(DASHBOARD_PAGE).toContain("Embedded web terminal (xterm.js)");
    expect(DASHBOARD_PAGE).toContain("3D avatar");
    expect(DASHBOARD_PAGE).toContain("Floating companion mode");
    expect(DASHBOARD_PAGE).toContain("In-browser voice mic");
    expect(DASHBOARD_PAGE).toContain("needs a PTY route");
    expect(DASHBOARD_PAGE).toContain("needs an authored GLB rig");
    expect(DASHBOARD_PAGE).toContain("needs a daemon event path");
  });

  test("no fake terminal/3D/mic controls exist in the dashboard", () => {
    expect(DASHBOARD_PAGE).not.toContain("data-xr-action=\"openTerminal()\"");
    expect(DASHBOARD_PAGE).not.toContain("data-xr-action=\"start3DAvatar()\"");
    expect(DASHBOARD_PAGE).not.toContain("data-xr-action=\"startMic()\"");
  });
});
