/**
 * Phase 17 · Builder — engine half.
 *
 * Real temp folders, the real handler, the real approval store: a project is
 * registered, escapes are refused at the boundary, every write streams an
 * approval first and touches disk only after a decision, diffs land by
 * content (not by line numbers), conflicts are refused before anyone is
 * asked, undo restores the backup, a static site is served on a loopback
 * port and stopped again.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { applyUnifiedDiff, normalisePatch } from "../../src/daemon/builder-patch.ts";
import { projectIdFor, resetBuilderProjectsForTests, validateProjectRoot } from "../../src/daemon/builder-projects.ts";
import { detectDevServer, parseReadyUrl, resetDevServersForTests, staticFileFor, type DetectFs } from "../../src/daemon/dev-servers.ts";
import { gitBadges, walkTree } from "../../src/daemon/routes/builder.routes.ts";

const TOKEN = "builder-token";
let projectDir = "";
let xrHome = "";
let store: Store;
let h: ReturnType<typeof makeHandler>;
let projectId = "";

beforeAll(() => {
  projectDir = realpathSync(mkdtempSync(join(tmpdir(), "xr-builder-")));
  xrHome = join(mkdtempSync(join(tmpdir(), "xr-builder-home-")), "home");
  process.env.XR_HOME = xrHome;
  mkdirSync(join(projectDir, "src"), { recursive: true });
  mkdirSync(join(projectDir, "node_modules", "left-pad"), { recursive: true });
  writeFileSync(join(projectDir, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(projectDir, "index.html"), "<!doctype html><title>hi</title><h1>Hello</h1>\n");
  writeFileSync(join(projectDir, "src", "app.ts"), ["const a = 1;", "const b = 2;", "", "export function sum() {", "  return a + b;", "}", ""].join("\n"));
  writeFileSync(join(projectDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  resetBuilderProjectsForTests();
  resetDevServersForTests();
  store = new Store(join(projectDir, ".xr-test.db"));
  h = makeHandler(store, TOKEN);
});

afterAll(() => {
  resetDevServersForTests();
  resetBuilderProjectsForTests();
  try {
    store.close();
  } catch {
    /* closed */
  }
});

const req = (p: string, init?: { method?: string; body?: unknown }) =>
  new Request(`http://127.0.0.1:7842${p}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function pending(tool: string, timeoutMs = 10_000): Promise<{ id: string; args?: Record<string, unknown>; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: Array<{ id: string; tool: string; reason: string; args?: Record<string, unknown> }> };
    const hit = (body.pending ?? []).find((r) => r.tool === tool);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no pending ${tool} approval`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const decide = (id: string, approved: boolean) => h(req(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approved } }));

function frames(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n\n")
    .map((l) => l.replace(/^data: /, "").trim())
    .filter((l) => l && l !== "[DONE]")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Run a consent stream: approve/deny the first approval it raises, return every frame. */
async function consent(path: string, body: unknown, approve: boolean, tool: string) {
  const res = await h(req(path, { method: "POST", body }));
  if (res.headers.get("content-type")?.includes("json")) return { status: res.status, json: await res.json(), frames: [] as Array<Record<string, unknown>> };
  const text = res.text();
  const a = await pending(tool);
  await decide(a.id, approve);
  return { status: res.status, json: null, frames: frames(await text), approval: a };
}

describe("project registry", () => {
  test("refuses what must never be a project", () => {
    expect(validateProjectRoot("relative/path").ok).toBe(false);
    expect(validateProjectRoot(join(projectDir, "missing")).ok).toBe(false);
    expect(validateProjectRoot(join(projectDir, "index.html")).ok).toBe(false);
    expect(validateProjectRoot("/").ok).toBe(false);
    expect(validateProjectRoot(homedir()).ok).toBe(false);
    mkdirSync(xrHome, { recursive: true });
    expect(validateProjectRoot(xrHome).ok).toBe(false);
    const ok = validateProjectRoot(projectDir);
    expect(ok.ok).toBe(true);
    expect(projectIdFor(projectDir)).toHaveLength(16);
    expect(projectIdFor(projectDir)).toBe(projectIdFor(projectDir));
  });

  test("POST /api/builder/projects registers and audits; bad paths → 400", async () => {
    expect((await h(req("/api/v1/builder/projects", { method: "POST", body: { path: "nope" } }))).status).toBe(400);
    const res = await h(req("/api/v1/builder/projects", { method: "POST", body: { path: projectDir, name: "demo" } }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; name: string; root: string };
    expect(body.id).toBe(projectIdFor(projectDir));
    expect(body.name).toBe("demo");
    projectId = body.id;
    const list = (await (await h(req("/api/v1/builder/projects"))).json()) as { projects: Array<{ id: string }> };
    expect(list.projects.some((p) => p.id === projectId)).toBe(true);
  });

  test("tree lists files, keeps heavy folders shallow, flags binaries on read", async () => {
    const tree = (await (await h(req(`/api/v1/builder/projects/${projectId}/tree`))).json()) as { entries: Array<{ rel: string; type: string; heavy?: true }>; truncated: boolean };
    const rels = tree.entries.map((e) => e.rel);
    expect(rels).toContain("src/app.ts");
    expect(rels).toContain("node_modules");
    expect(rels).not.toContain("node_modules/left-pad");
    expect(tree.entries.find((e) => e.rel === "node_modules")?.heavy).toBe(true);
    expect(tree.truncated).toBe(false);
    const png = (await (await h(req(`/api/v1/builder/projects/${projectId}/file?path=logo.png`))).json()) as { isText: boolean; content: string };
    expect(png.isText).toBe(false);
    expect(png.content).toBe("");
    const ts = (await (await h(req(`/api/v1/builder/projects/${projectId}/file?path=src/app.ts`))).json()) as { isText: boolean; content: string; mtimeMs: number };
    expect(ts.isText).toBe(true);
    expect(ts.content).toContain("export function sum()");
  });

  test("walkTree caps breadth-first and gitBadges bubbles to folders", () => {
    const capped = walkTree(projectDir, 2);
    expect(capped.truncated).toBe(true);
    expect(capped.entries).toHaveLength(2);
    const badges = gitBadges(" M src/app.ts\n?? new.txt\nA  added.ts\n");
    expect(badges["src/app.ts"]).toBe("modified");
    expect(badges.src).toBe("modified");
    expect(badges["new.txt"]).toBe("untracked");
    expect(badges["added.ts"]).toBe("added");
  });

  test("every path is scope-enforced: escapes answer 400, unknown project 404", async () => {
    expect((await h(req(`/api/v1/builder/projects/${projectId}/file?path=../etc/passwd`))).status).toBe(400);
    expect((await h(req(`/api/v1/builder/projects/${projectId}/file?path=/etc/passwd`))).status).toBe(400);
    expect((await h(req(`/api/v1/builder/projects/${projectId}/file/write`, { method: "POST", body: { path: "../x.txt", content: "" } }))).status).toBe(400);
    expect((await h(req(`/api/v1/builder/projects/${projectId}/apply-diff`, { method: "POST", body: { path: "src/../../x", patch: "@@ -1 +1 @@\n-a\n+b\n" } }))).status).toBe(400);
    expect((await h(req(`/api/v1/builder/projects/${projectId}/file/delete`, { method: "POST", body: { path: "." } }))).status).toBe(400);
    expect((await h(req(`/api/v1/builder/projects/0123456789abcdef/tree`))).status).toBe(404);
    expect((await h(req(`/api/v1/terminal/pty`, { method: "POST", body: { projectId: "0123456789abcdef" } }))).status).toBe(404);
    const pending0 = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: unknown[] };
    expect(pending0.pending ?? []).toHaveLength(0);
  });
});

describe("consent streams", () => {
  test("save: approval_required first, bytes land only after approval; denial changes nothing", async () => {
    const denied = await consent(`/api/v1/builder/projects/${projectId}/file/write`, { path: "notes.md", content: "# no\n" }, false, "write_file");
    expect(denied.frames[0]?.approval_required).toBeDefined();
    expect(denied.frames.at(-1)?.type).toBe("denied");
    expect(existsSync(join(projectDir, "notes.md"))).toBe(false);

    const ok = await consent(`/api/v1/builder/projects/${projectId}/file/write`, { path: "notes.md", content: "# yes\n" }, true, "write_file");
    const first = ok.frames[0]?.approval_required as { args: Record<string, unknown>; tool: string };
    expect(first.tool).toBe("write_file");
    expect(first.args.scope).toBe("demo (Builder)");
    expect(first.args.path).toBe("notes.md");
    expect(first.args.content).toBeUndefined();
    expect(ok.frames.at(-1)?.type).toBe("applied");
    expect(readFileSync(join(projectDir, "notes.md"), "utf8")).toBe("# yes\n");
  });

  test("create / rename / delete go through the same plane", async () => {
    const created = await consent(`/api/v1/builder/projects/${projectId}/file/create`, { path: "src/util.ts", kind: "file" }, true, "create_file");
    expect(created.frames.at(-1)?.type).toBe("applied");
    expect(existsSync(join(projectDir, "src", "util.ts"))).toBe(true);
    const renamed = await consent(`/api/v1/builder/projects/${projectId}/file/rename`, { from: "src/util.ts", to: "src/helpers.ts" }, true, "rename_file");
    expect(renamed.frames.at(-1)?.type).toBe("applied");
    expect(existsSync(join(projectDir, "src", "helpers.ts"))).toBe(true);
    const deleted = await consent(`/api/v1/builder/projects/${projectId}/file/delete`, { path: "src/helpers.ts" }, true, "delete_file");
    expect(deleted.frames.at(-1)?.type).toBe("applied");
    expect(existsSync(join(projectDir, "src", "helpers.ts"))).toBe(false);
  });

  test("apply-diff: dry-run conflict → 409 with no approval; clean → approval → backup → undo", async () => {
    const bad = await h(req(`/api/v1/builder/projects/${projectId}/apply-diff`, { method: "POST", body: { path: "src/app.ts", patch: "@@ -1,2 +1,2 @@\n-nothing like this\n+x\n const b = 2;\n" } }));
    expect(bad.status).toBe(409);
    expect(((await bad.json()) as { error: string }).error).toContain("Couldn't apply cleanly");
    expect((((await (await h(req("/api/v1/approvals"))).json()) as { pending?: unknown[] }).pending ?? []).length).toBe(0);

    const patch = ["--- a/src/app.ts", "+++ b/src/app.ts", "@@ -4,3 +4,3 @@", " export function sum() {", "-  return a + b;", "+  return a + b + 1;", " }", ""].join("\n");
    const applied = await consent(`/api/v1/builder/projects/${projectId}/apply-diff`, { path: "src/app.ts", patch }, true, "patch");
    const last = applied.frames.at(-1) as { type: string; content: string; backupId: string };
    expect(last.type).toBe("applied");
    expect(last.content).toContain("return a + b + 1;");
    expect(readFileSync(join(projectDir, "src", "app.ts"), "utf8")).toBe(last.content);
    expect(last.backupId).toMatch(/^[0-9a-f]{16}\//);
    expect(applied.approval?.reason).toContain("Apply 1 hunk");

    const undone = await consent(`/api/v1/builder/projects/${projectId}/undo`, { path: "src/app.ts", backupId: last.backupId }, true, "write_file");
    expect(undone.frames.at(-1)?.type).toBe("applied");
    expect(readFileSync(join(projectDir, "src", "app.ts"), "utf8")).toContain("return a + b;\n");
    expect((await h(req(`/api/v1/builder/projects/${projectId}/undo`, { method: "POST", body: { path: "src/app.ts", backupId: "0000000000000000/x.bak" } }))).status).toBe(404);
  });
});

describe("diff applier", () => {
  const base = "a\nb\nc\nd\ne\n";
  test("applies by content when line numbers are wrong", () => {
    const r = applyUnifiedDiff(base, "@@ -40,3 +40,3 @@\n b\n-c\n+C\n d\n");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("a\nb\nC\nd\ne\n");
    expect(r.fuzzy).toBe(1);
  });
  test("tolerates trimmed whitespace, loose headers and fenced wrappers", () => {
    const r = applyUnifiedDiff("  x = 1\n  y = 2\n", "```diff\n@@ ... @@\n-x = 1\n+x = 10\n y = 2\n```\n");
    expect(r.ok).toBe(true);
    expect(r.content).toBe("x = 10\n  y = 2\n");
    expect(normalisePatch("@@ -1 +1 @@\n").startsWith("@@ -1 +1 @@")).toBe(true);
  });
  test("selected hunks only; the rest are reported as skipped", () => {
    const patch = "@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -4,2 +4,2 @@\n-d\n+D\n e\n";
    const r = applyUnifiedDiff(base, patch, [1]);
    expect(r.ok).toBe(true);
    expect(r.content).toBe("a\nb\nc\nD\ne\n");
    expect(r.applied).toEqual([1]);
    expect(r.skipped).toEqual([0]);
  });
  test("conflicts refuse the whole patch and keep the content", () => {
    const r = applyUnifiedDiff(base, "@@ -1,2 +1,2 @@\n-a\n+A\n b\n@@ -4,2 +4,2 @@\n-zzz\n+D\n e\n");
    expect(r.ok).toBe(false);
    expect(r.content).toBe(base);
    expect(r.conflicts[0]?.index).toBe(1);
  });
  test("new files and trailing newline markers", () => {
    expect(applyUnifiedDiff("", "@@ -0,0 +1,2 @@\n+one\n+two\n").content).toBe("one\ntwo\n");
    const r = applyUnifiedDiff("one\n", "@@ -1 +1 @@\n-one\n+uno\n\\ No newline at end of file\n");
    expect(r.content).toBe("uno");
  });
});

describe("dev server detection + readiness", () => {
  const fs = (files: Record<string, string | true>, bins: string[] = ["npm", "bun", "pnpm", "yarn", "python3", "cargo"]): DetectFs => ({
    exists: (rel) => rel in files,
    readText: (rel) => (typeof files[rel] === "string" ? (files[rel] as string) : null),
    which: (bin) => bins.includes(bin),
  });
  test("matrix", () => {
    const vite = detectDevServer(fs({ "package.json": JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "^5" } }), "bun.lock": true }));
    expect(vite.kind).toBe("vite");
    expect(vite.argv).toEqual(["bun", "run", "dev"]);
    expect(vite.needsInstall).toBe(true);
    const next = detectDevServer(fs({ "package.json": JSON.stringify({ scripts: { dev: "next dev" }, dependencies: { next: "15" } }), node_modules: true, "pnpm-lock.yaml": true }));
    expect(next.kind).toBe("next");
    expect(next.argv).toEqual(["pnpm", "run", "dev"]);
    expect(next.needsInstall).toBe(false);
    const cra = detectDevServer(fs({ "package.json": JSON.stringify({ scripts: { start: "react-scripts start" }, dependencies: { "react-scripts": "5" } }) }));
    expect(cra.kind).toBe("cra");
    expect(cra.argv).toEqual(["npm", "run", "start"]);
    expect(detectDevServer(fs({ "package.json": JSON.stringify({ scripts: { start: "node server.js" } }) })).kind).toBe("node");
    expect(detectDevServer(fs({ "Cargo.toml": true })).argv).toEqual(["cargo", "run"]);
    expect(detectDevServer(fs({ "manage.py": true })).kind).toBe("django");
    expect(detectDevServer(fs({ "requirements.txt": "flask==3\n" })).kind).toBe("flask");
    expect(detectDevServer(fs({ "index.html": true })).kind).toBe("static");
    expect(detectDevServer(fs({})).kind).toBe("none");
    // lockfile says pnpm but it is not installed → fall back to npm
    expect(detectDevServer(fs({ "package.json": "{}", "pnpm-lock.yaml": true, "index.html": true }, ["npm"])).pm).toBe("npm");
  });
  test("ready-line parser normalises hosts and strips ANSI", () => {
    expect(parseReadyUrl("  \u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m")).toEqual({ port: 5173, url: "http://localhost:5173/" });
    expect(parseReadyUrl("Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...")).toEqual({ port: 8000, url: "http://localhost:8000/" });
    expect(parseReadyUrl("Starting development server at http://127.0.0.1:8000/")?.port).toBe(8000);
    expect(parseReadyUrl("compiled successfully")).toBeNull();
  });
  test("static file resolution never leaves the root", () => {
    expect(staticFileFor(projectDir, "/")).toBe(join(projectDir, "index.html"));
    expect(staticFileFor(projectDir, "/../../etc/passwd")).toBeNull();
    expect(staticFileFor(projectDir, "/%2e%2e/%2e%2e/etc/passwd")).toBeNull();
    expect(staticFileFor(projectDir, "/missing.css")).toBeNull();
  });
});

describe("dev server lifecycle (static)", () => {
  test("status detects static; start needs consent; serves index.html; stop frees it", async () => {
    const status = (await (await h(req(`/api/v1/builder/projects/${projectId}/dev-server`))).json()) as { detected: { kind: string }; status: null | { state: string } };
    expect(status.detected.kind).toBe("static");
    const started = await consent(`/api/v1/builder/projects/${projectId}/dev-server/start`, {}, true, "serve_static");
    const applied = started.frames.at(-1) as { type: string; status: { state: string; url: string; port: number } };
    expect(applied.type).toBe("applied");
    expect(applied.status.state).toBe("running");
    const html = await (await fetch(`http://127.0.0.1:${applied.status.port}/`)).text();
    expect(html).toContain("<h1>Hello</h1>");
    expect((await fetch(`http://127.0.0.1:${applied.status.port}/%2e%2e/%2e%2e/etc/passwd`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${applied.status.port}/node_modules/left-pad/index.js`)).status).toBe(200);
    const again = await h(req(`/api/v1/builder/projects/${projectId}/dev-server/start`, { method: "POST", body: {} }));
    expect(again.status).toBe(409);
    const stopped = (await (await h(req(`/api/v1/builder/projects/${projectId}/dev-server/stop`, { method: "POST", body: {} }))).json()) as { stopped: boolean; status: { state: string } };
    expect(stopped.stopped).toBe(true);
    expect(stopped.status.state).toBe("stopped");
  });

  test("events feed says hello and closes on abort", async () => {
    const ac = new AbortController();
    const res = await h(new Request(`http://127.0.0.1:7842/api/v1/builder/projects/${projectId}/events`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: ac.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('"type":"hello"');
    ac.abort();
    await reader.cancel().catch(() => {});
  });
});
