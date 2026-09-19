/**
 * Phase 2 · G-06 — hunk-level review over the engine's diff.
 *
 * Real git repository, real `git diff`, real `git apply -R`: a file with two
 * separated edits produces two hunks; reverting ONE leaves the other edit in
 * place byte-for-byte; ids survive the revert of a sibling hunk; stale ids
 * are refused; a denial changes nothing; the approval preview shows the
 * hunks that will be reverted, not a whole-file rewrite.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import { buildHunkPatch, hunkId, parseUnifiedDiff } from "../../src/daemon/hunks.ts";
import { runCommand } from "../../src/util/process.ts";

const TOKEN = "hunks-token";
let projectDir = "";
let store: Store;
let h: ReturnType<typeof makeHandler>;
const ORIG_CWD = process.cwd();

const BASE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";

async function git(args: string[]) {
  const r = await runCommand("git", args, { cwd: projectDir, timeoutMs: 10_000 });
  if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

beforeAll(async () => {
  projectDir = mkdtempSync(join(tmpdir(), "xr-hunks-"));
  await git(["init", "-q"]);
  await git(["config", "user.email", "t@example.com"]);
  await git(["config", "user.name", "t"]);
  await git(["config", "commit.gpgsign", "false"]);
  writeFileSync(join(projectDir, "notes.txt"), BASE, "utf8");
  await git(["add", "notes.txt"]);
  await git(["commit", "-q", "-m", "base"]);
  process.chdir(projectDir);
  process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-hunks-home-")), "home");
  store = new Store(join(projectDir, ".xr-test.db"));
  h = makeHandler(store, TOKEN);
});

afterAll(() => {
  try {
    store.close();
  } catch {
    /* already closed */
  }
  try {
    process.chdir(ORIG_CWD);
  } catch {
    /* ignore */
  }
});

const req = (p: string, init?: { method?: string; body?: unknown }) =>
  new Request(`http://127.0.0.1:7842${p}`, {
    method: init?.method ?? "GET",
    headers: { authorization: `Bearer ${TOKEN}`, ...(init?.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function pendingPatchApproval(timeoutMs = 10_000): Promise<{ id: string; reason: string; preview?: { kind: string; sections: Array<{ title: string; body: string }> } }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const body = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: Array<{ id: string; tool: string; reason: string; preview?: { kind: string; sections: Array<{ title: string; body: string }> } }> };
    const hit = (body.pending ?? []).find((r) => r.tool === "patch");
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error("no pending patch approval");
    await new Promise((r) => setTimeout(r, 25));
  }
}
const decide = (id: string, approved: boolean) => h(req(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approved } }));

/** Two edits far apart → two hunks. */
function writeTwoEdits() {
  const lines = BASE.split("\n");
  lines[2] = "line 3 EDITED-A";
  lines[24] = "line 25 EDITED-B";
  writeFileSync(join(projectDir, "notes.txt"), lines.join("\n"), "utf8");
}

const FIXTURE = `diff --git a/notes.txt b/notes.txt
index 1111111..2222222 100644
--- a/notes.txt
+++ b/notes.txt
@@ -1,5 +1,5 @@
 line 1
 line 2
-line 3
+line 3 EDITED-A
 line 4
 line 5
@@ -22,7 +22,8 @@ line 21
 line 22
 line 23
 line 24
-line 25
+line 25 EDITED-B
+line 25b
 line 26
 line 27
 line 28
`;

describe("unified diff → addressed hunks (pure)", () => {
  test("parses headers, counts, and bodies; ids are content-addressed and stable", () => {
    const p = parseUnifiedDiff(FIXTURE);
    expect(p.fileHeader).toEqual(["diff --git a/notes.txt b/notes.txt", "index 1111111..2222222 100644", "--- a/notes.txt", "+++ b/notes.txt"]);
    expect(p.hunks).toHaveLength(2);
    const [a, b] = p.hunks;
    expect(a!.oldStart).toBe(1);
    expect(a!.newLines).toBe(5);
    expect(a!.added).toBe(1);
    expect(a!.removed).toBe(1);
    expect(b!.header).toBe("@@ -22,7 +22,8 @@ line 21");
    expect(b!.added).toBe(2);
    expect(b!.removed).toBe(1);
    expect(a!.id).toBe(hunkId(1, a!.lines));
    expect(a!.id).not.toBe(b!.id);
    // The same body at the same old position → the same id (a re-render must not lose selection).
    expect(parseUnifiedDiff(FIXTURE).hunks[1]!.id).toBe(b!.id);
    // A changed body → a different id (a stale selection must be refused).
    expect(hunkId(22, [...b!.lines, "+one more"])).not.toBe(b!.id);
  });

  test("a subset patch keeps the file header and the chosen hunks in file order", () => {
    const p = parseUnifiedDiff(FIXTURE);
    const patch = buildHunkPatch(p, [p.hunks[1]!, p.hunks[0]!]);
    expect(patch.startsWith("diff --git a/notes.txt b/notes.txt\n")).toBe(true);
    expect(patch.indexOf("@@ -1,5 +1,5 @@")).toBeLessThan(patch.indexOf("@@ -22,7 +22,8 @@"));
    expect(patch.endsWith("\n")).toBe(true);
    const only = buildHunkPatch(p, [p.hunks[1]!]);
    expect(only).not.toContain("EDITED-A");
    expect(only).toContain("EDITED-B");
  });

  test("empty and whitespace diffs parse to zero hunks", () => {
    expect(parseUnifiedDiff("").hunks).toEqual([]);
    expect(parseUnifiedDiff("\n  \n").hunks).toEqual([]);
  });
});

describe("files.diff + files.hunks.revert — git is the applier, the human is the gate", () => {
  test("files.diff exposes the two hunks of a two-edit change", async () => {
    writeTwoEdits();
    const res = await h(req("/api/v1/files/diff?path=notes.txt"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tracked: boolean; hunks: Array<{ id: string; added: number; removed: number; lines: string[] }> };
    expect(body.tracked).toBe(true);
    expect(body.hunks).toHaveLength(2);
    expect(body.hunks[0]!.lines.join("\n")).toContain("+line 3 EDITED-A");
    expect(body.hunks[1]!.lines.join("\n")).toContain("+line 25 EDITED-B");
  });

  test("path escape and bad bodies are refused before any approval", async () => {
    expect((await h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "../x", hunkIds: ["abc"] } }))).status).toBe(400);
    expect((await h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "notes.txt", hunkIds: [] } }))).status).toBe(400);
    expect((await h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "nope.txt", hunkIds: ["abc"] } }))).status).toBe(404);
  });

  test("a stale hunk id is a 409 with the live hunks, never a guess", async () => {
    const res = await h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "notes.txt", hunkIds: ["deadbeef0000"] } }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { missing: string[]; hunks: unknown[] };
    expect(body.missing).toEqual(["deadbeef0000"]);
    expect(body.hunks).toHaveLength(2);
  });

  test("denied → nothing changes on disk", async () => {
    const before = readFileSync(join(projectDir, "notes.txt"), "utf8");
    const diff = (await (await h(req("/api/v1/files/diff?path=notes.txt"))).json()) as { hunks: Array<{ id: string }> };
    const pending = h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "notes.txt", hunkIds: [diff.hunks[0]!.id] } }));
    const approval = await pendingPatchApproval();
    await decide(approval.id, false);
    const body = (await (await pending).json()) as { applied: boolean; decision: string };
    expect(body.applied).toBe(false);
    expect(body.decision).toBe("denied");
    expect(readFileSync(join(projectDir, "notes.txt"), "utf8")).toBe(before);
    expect(store.recentAudit(50).map((r) => r.event)).toContain("files.hunks.denied");
  });

  test("approve → exactly the chosen hunk is reverted; the sibling keeps its id; audit records it", async () => {
    const diff = (await (await h(req("/api/v1/files/diff?path=notes.txt"))).json()) as { hunks: Array<{ id: string; lines: string[] }> };
    const [hunkA, hunkB] = diff.hunks;
    const pending = h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "notes.txt", hunkIds: [hunkB!.id] } }));
    const approval = await pendingPatchApproval();
    expect(approval.reason).toMatch(/revert 1 of 2 hunks in notes\.txt/);
    // The preview shows the hunk that goes away — and only that one.
    expect(approval.preview?.kind).toBe("diff");
    const shown = approval.preview?.sections.map((s) => s.body).join("\n") ?? "";
    expect(shown).toContain("EDITED-B");
    expect(shown).not.toContain("EDITED-A");
    await decide(approval.id, true);
    const body = (await (await pending).json()) as { applied: boolean; reverted: number; hunks: Array<{ id: string }>; added: number; removed: number };
    expect(body.applied).toBe(true);
    expect(body.reverted).toBe(1);
    expect(body.added).toBe(1);
    expect(body.removed).toBe(1);
    const after = readFileSync(join(projectDir, "notes.txt"), "utf8");
    expect(after).toContain("line 3 EDITED-A"); // kept
    expect(after).not.toContain("EDITED-B"); // reverted
    expect(after.split("\n")[24]).toBe("line 25"); // restored byte-for-byte
    expect(body.hunks).toHaveLength(1);
    expect(body.hunks[0]!.id).toBe(hunkA!.id); // sibling id survived the revert
    expect(store.recentAudit(50).map((r) => r.event)).toContain("files.hunks.reverted");
  });

  test("baseMtimeMs guards against reviewing a file that moved on", async () => {
    const diff = (await (await h(req("/api/v1/files/diff?path=notes.txt"))).json()) as { hunks: Array<{ id: string }> };
    const res = await h(req("/api/v1/files/hunks/revert", { method: "POST", body: { path: "notes.txt", hunkIds: [diff.hunks[0]!.id], baseMtimeMs: 1 } }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { stale: boolean }).stale).toBe(true);
  });
});
