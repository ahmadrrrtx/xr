/**
 * Phase 2B — editor save (files.write) + workspace terminal (terminal.run).
 *
 * The two routes that unblock the XR Desktop Workspace:
 *   · T-1 files.write — approval-gated, scope-enforced, staleness-guarded,
 *     audited. NEVER touches disk without an explicit human decision.
 *   · T-2 terminal.run — deterministic policy first (dangerous commands are
 *     blocked before any human is asked), durable approval with the canonical
 *     command breakdown, SSE-streamed output, time-boxed, output-capped,
 *     audited. Honest v1: line-based command runner, NOT a PTY.
 *
 * Harness mirrors test/daemon/phase-g.test.ts (route-level, temp project dir).
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";

const TOKEN = "p2b-token";

let projectDir = "";
let store: Store;
let h: ReturnType<typeof makeHandler>;
const ORIG_CWD = process.cwd();

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "xr-p2b-"));
  writeFileSync(join(projectDir, "notes.txt"), "original\n", "utf8");
  process.chdir(projectDir);
  process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-p2b-home-")), "home");
  store = new Store(join(projectDir, ".xr-test.db"));
  h = makeHandler(store, TOKEN);
});

afterAll(() => {
  try { process.chdir(ORIG_CWD); } catch { /* ignore */ }
});

const req = (p: string, init?: { method?: string; body?: unknown }) =>
  new Request(`http://127.0.0.1:7842${p}`, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

/** Poll the durable approvals endpoint until a pending request for `tool` appears. */
async function waitForApproval(tool: string, timeoutMs = 10_000): Promise<{ id: string; reason?: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await h(req("/api/v1/approvals"));
    const body: any = await res.json();
    const pending: any[] = body.pending ?? [];
    const hit = pending.find((r) => r.tool === tool);
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no pending approval for ${tool} within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const decide = (id: string, approved: boolean) =>
  h(req(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approved } }));

/** Consume an SSE response into parsed `data:` payloads (stops at [DONE]). */
async function readSse(res: Response): Promise<any[]> {
  const events: any[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") return events;
        try { events.push(JSON.parse(payload)); } catch { /* keepalive */ }
      }
    }
  }
  return events;
}

const auditEvents = () => store.recentAudit(500).map((e: any) => e.event ?? e.event_type ?? e.type);

// ── T-1 · files.write ────────────────────────────────────────────────────────

describe("Phase 2B · T-1 — files.write is approval-gated and scope-enforced", () => {
  test("rejects path traversal BEFORE raising any approval", async () => {
    const res = await h(req("/api/v1/files/write", { method: "POST", body: { path: "../escape.txt", content: "x" } }));
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(String(body.error)).toContain("escapes");
  });

  test("rejects oversized content (413) without an approval", async () => {
    const res = await h(req("/api/v1/files/write", { method: "POST", body: { path: "big.txt", content: "a".repeat(1024 * 1024 + 10) } }));
    expect(res.status).toBe(413);
  });

  test("nothing touches disk until a human approves; approval → applied + audited", async () => {
    const target = join(projectDir, "notes.txt");
    const before = readFileSync(target, "utf8");
    const post = h(req("/api/v1/files/write", { method: "POST", body: { path: "notes.txt", content: "edited by desktop\n" } }));
    const approval = await waitForApproval("write_file");
    // Still original while the decision is outstanding.
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(approval.reason ?? "").toContain("notes.txt");
    const dres = await decide(approval.id, true);
    expect(dres.status).toBe(200);
    const body: any = await post;
    const result: any = await body.json();
    expect(result.applied).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("edited by desktop\n");
    expect(typeof result.mtimeMs).toBe("number");
    expect(auditEvents()).toContain("files.write.applied");
  });

  test("denial is fail-closed: applied=false, disk untouched, audited", async () => {
    const target = join(projectDir, "notes.txt");
    const before = readFileSync(target, "utf8");
    const post = h(req("/api/v1/files/write", { method: "POST", body: { path: "notes.txt", content: "should never land\n" } }));
    const approval = await waitForApproval("write_file");
    await decide(approval.id, false);
    const result: any = await (await post).json();
    expect(result.applied).toBe(false);
    expect(result.decision).toBe("denied");
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(auditEvents()).toContain("files.write.denied");
  });

  test("staleness guard: a wrong baseMtimeMs is a 409, no approval raised", async () => {
    const res = await h(req("/api/v1/files/write", {
      method: "POST",
      body: { path: "notes.txt", content: "clobber attempt\n", baseMtimeMs: 1_000_000 },
    }));
    expect(res.status).toBe(409);
    const body: any = await res.json();
    expect(body.stale).toBe(true);
  });

  test("creates new files (and parent dirs) only after approval", async () => {
    const post = h(req("/api/v1/files/write", { method: "POST", body: { path: "gen/report.md", content: "# report\n" } }));
    const approval = await waitForApproval("write_file");
    await decide(approval.id, true);
    const result: any = await (await post).json();
    expect(result.applied).toBe(true);
    expect(existsSync(join(projectDir, "gen", "report.md"))).toBe(true);
    expect(readFileSync(join(projectDir, "gen", "report.md"), "utf8")).toBe("# report\n");
  });
});

// ── T-2 · terminal.run ───────────────────────────────────────────────────────

describe("Phase 2B · T-2 — terminal.run is policy-first, approval-gated, streamed", () => {
  test("dangerous commands are blocked by policy BEFORE any human is asked (403)", async () => {
    const res = await h(req("/api/v1/terminal/run", { method: "POST", body: { cmd: "rm -rf /tmp/something-important" } }));
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.blocked).toBe(true);
    expect(auditEvents()).toContain("terminal.run.blocked");
  });

  test("empty command is a 400", async () => {
    const res = await h(req("/api/v1/terminal/run", { method: "POST", body: { cmd: "   " } }));
    expect(res.status).toBe(400);
  });

  test("approved command streams output + exit over SSE and is audited", async () => {
    const post = h(req("/api/v1/terminal/run", { method: "POST", body: { cmd: "echo p2b-hello" } }));
    const res = await post;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const approval = await waitForApproval("shell");
    expect(approval.reason ?? "").toContain("echo p2b-hello");
    await decide(approval.id, true);
    const events = await readSse(res);
    const kinds = events.map((e) => e.type);
    expect(kinds[0]).toBe("status");
    expect(events[0].status).toBe("approval_required");
    expect(kinds).toContain("output");
    const text = events.filter((e) => e.type === "output").map((e) => e.text).join("");
    expect(text).toContain("p2b-hello");
    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeTruthy();
    expect(exit.code).toBe(0);
    expect(exit.timedOut).toBe(false);
    expect(auditEvents()).toContain("terminal.run.applied");
    expect(auditEvents()).toContain("terminal.run.requested");
  });

  test("denial streams a denied status and never spawns anything", async () => {
    const post = h(req("/api/v1/terminal/run", { method: "POST", body: { cmd: "touch should-not-exist" } }));
    const res = await post;
    const approval = await waitForApproval("shell");
    await decide(approval.id, false);
    const events = await readSse(res);
    const denied = events.find((e) => e.type === "status" && (e.status === "denied" || e.status === "timed_out"));
    expect(denied).toBeTruthy();
    expect(events.some((e) => e.type === "output")).toBe(false);
    expect(existsSync(join(projectDir, "should-not-exist"))).toBe(false);
    expect(auditEvents()).toContain("terminal.run.denied");
  });
});
