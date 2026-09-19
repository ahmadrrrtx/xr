/**
 * Phase 2 · G-05 — the engine-owned PTY is a REAL terminal, consent is per
 * session, and every limit the engine can enforce is enforced.
 *
 * Runs against a real shell on every OS in the parity matrix (openpty on
 * Linux/macOS, ConPTY on Windows) — this file is how ConPTY gets proven,
 * not a mock.
 *
 *   · the child sees a TTY (POSIX asserts `stty size` == the requested size;
 *     Windows asserts echo + resize round-trip, since ConPTY re-encodes);
 *   · one approval per session; deny → no process is ever spawned;
 *   · cwd outside the root → 400 before any approval is raised;
 *   · input is written to the shell and its output comes back on the stream;
 *   · resize is applied and clamped;
 *   · DELETE ends the shell AND its foreground job (SIGHUP semantics);
 *   · the session cap is a 429, not a queue;
 *   · closing the stream (client gone) kills the shell — no orphans;
 *   · XR credentials are stripped from the shell's environment.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { makeHandler } from "../../src/daemon/server.ts";
import {
  clampSize,
  defaultShell,
  getPtyRegistry,
  PtySessionRegistry,
  resetPtyRegistryForTests,
  shellEnvironment,
} from "../../src/daemon/pty-sessions.ts";

const TOKEN = "pty-token";
const WIN = process.platform === "win32";

let projectDir = "";
let store: Store;
let h: ReturnType<typeof makeHandler>;
const ORIG_CWD = process.cwd();

beforeAll(() => {
  projectDir = mkdtempSync(join(tmpdir(), "xr-pty-"));
  mkdirSync(join(projectDir, "sub"));
  process.chdir(projectDir);
  process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-pty-home-")), "home");
  store = new Store(join(projectDir, ".xr-test.db"));
  h = makeHandler(store, TOKEN);
  resetPtyRegistryForTests();
});

afterAll(async () => {
  await getPtyRegistry().closeAll();
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
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

async function waitForApproval(timeoutMs = 10_000): Promise<{ id: string; reason?: string; surface?: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await h(req("/api/v1/approvals"));
    const body = (await res.json()) as { pending?: Array<{ id: string; tool: string; reason?: string; surface?: string }> };
    // The public list carries the reason, not the args: the PTY reason is unmistakable.
    const hit = (body.pending ?? []).find((r) => r.tool === "shell" && /interactive terminal/.test(r.reason ?? ""));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`no pending PTY approval within ${timeoutMs}ms`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const decide = (id: string, approved: boolean) =>
  h(req(`/api/v1/approvals/${encodeURIComponent(id)}/decision`, { method: "POST", body: { approved } }));

/** Incremental SSE reader: `next(pred)` resolves with the first event matching `pred`. */
class SseReader {
  private readonly events: Array<Record<string, unknown>> = [];
  private readonly waiters: Array<{ pred: (e: Record<string, unknown>) => boolean; resolve: (e: Record<string, unknown>) => void }> = [];
  done = false;
  private reader: { cancel(): Promise<void> } | null = null;
  constructor(private readonly res: Response) {
    void this.pump();
  }
  private async pump() {
    const reader = this.res.body!.getReader();
    this.reader = reader;
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") {
          this.done = true;
          continue;
        }
        const ev = JSON.parse(payload) as Record<string, unknown>;
        this.events.push(ev);
        for (const w of [...this.waiters]) {
          if (w.pred(ev)) {
            this.waiters.splice(this.waiters.indexOf(w), 1);
            w.resolve(ev);
          }
        }
      }
    }
    this.done = true;
  }
  next(pred: (e: Record<string, unknown>) => boolean, timeoutMs = 15_000): Promise<Record<string, unknown>> {
    const hit = this.events.find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`no SSE event matched within ${timeoutMs}ms; saw ${JSON.stringify(this.events.slice(-5))}`)), timeoutMs);
      this.waiters.push({
        pred,
        resolve: (e) => {
          clearTimeout(t);
          resolve(e);
        },
      });
    });
  }
  /** All output text seen so far. */
  output(): string {
    return this.events
      .filter((e) => e.type === "output")
      .map((e) => String(e.data))
      .join("");
  }
  async waitForOutput(needle: string, timeoutMs = 15_000): Promise<string> {
    if (this.output().includes(needle)) return this.output();
    await this.next(() => this.output().includes(needle), timeoutMs);
    return this.output();
  }
  /** What a closed tab does: the consumer stops reading and releases the stream. */
  cancel(): Promise<void> {
    return this.reader ? this.reader.cancel() : this.res.body!.cancel();
  }
}

/** Open a session through the real route and approve it. */
async function openSession(body: Record<string, unknown> = {}): Promise<{ sse: SseReader; sessionId: string; approvalId: string }> {
  const res = await h(req("/api/v1/terminal/pty", { method: "POST", body: { cols: 100, rows: 30, ...body } }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const sse = new SseReader(res);
  const requested = await sse.next((e) => e.status === "approval_required");
  const approval = await waitForApproval();
  expect(approval.id).toBe(String(requested.approvalId));
  await decide(approval.id, true);
  const open = await sse.next((e) => e.status === "open");
  return { sse, sessionId: String(open.sessionId), approvalId: approval.id };
}

const auditEvents = () => store.recentAudit(400).map((r) => r.event);

describe("PTY sessions — pure helpers", () => {
  test("clampSize keeps the child's view inside sane bounds", () => {
    expect(clampSize(undefined, undefined)).toEqual({ cols: 80, rows: 24 });
    expect(clampSize(0, 0)).toEqual({ cols: 2, rows: 1 });
    expect(clampSize(10_000, 10_000)).toEqual({ cols: 500, rows: 300 });
    expect(clampSize(119.6, 39.4)).toEqual({ cols: 120, rows: 39 });
  });

  test("the shell environment is the user's own, minus XR credentials, plus a truthful TERM", () => {
    const env = shellEnvironment({
      PATH: "/usr/bin",
      HOME: "/home/u",
      XR_DEV_TOKEN: "secret-1",
      XR_AUDIT_KEY_PASSPHRASE: "secret-2",
      XR_SOMETHING_SECRET: "secret-3",
      OPENAI_API_KEY: "user-owned",
      TERM: "dumb",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.OPENAI_API_KEY).toBe("user-owned"); // the user's own env is theirs
    expect(env.XR_DEV_TOKEN).toBeUndefined();
    expect(env.XR_AUDIT_KEY_PASSPHRASE).toBeUndefined();
    expect(env.XR_SOMETHING_SECRET).toBeUndefined();
    expect(env.TERM).toBe("xterm-256color");
    expect(env.XR_TERMINAL).toBe("1");
  });

  test("defaultShell mirrors the platform: ComSpec on Windows, $SHELL (if real) else /bin/sh on POSIX", () => {
    expect(defaultShell({ ComSpec: "C:\\Windows\\system32\\cmd.exe" }, "win32")).toEqual(["C:\\Windows\\system32\\cmd.exe"]);
    expect(defaultShell({}, "win32")).toEqual(["cmd.exe"]);
    expect(defaultShell({ SHELL: "/definitely/not/here" }, "linux")).toEqual(["/bin/sh"]);
    expect(defaultShell({}, "darwin")).toEqual(["/bin/sh"]);
  });

  test("the registry refuses a session past its cap (429 material, not a queue)", () => {
    const tiny = new PtySessionRegistry(0);
    expect(() => tiny.open({ cwd: projectDir, cols: 80, rows: 24, onData() {}, onExit() {} })).toThrow(/cap reached/);
  });
});

describe("terminal.pty — a real TTY, consent per session, limits enforced", () => {
  test("cwd outside the project root is refused BEFORE any approval exists", async () => {
    const before = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: unknown[] };
    const res = await h(req("/api/v1/terminal/pty", { method: "POST", body: { cwd: "../../" } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/escapes/);
    const after = (await (await h(req("/api/v1/approvals"))).json()) as { pending?: unknown[] };
    expect((after.pending ?? []).length).toBe((before.pending ?? []).length);
    const res2 = await h(req("/api/v1/terminal/pty", { method: "POST", body: { cwd: "does-not-exist" } }));
    expect(res2.status).toBe(400);
  });

  test("a denied approval spawns nothing: no session, no pid, audit says denied", async () => {
    resetPtyRegistryForTests();
    const res = await h(req("/api/v1/terminal/pty", { method: "POST", body: {} }));
    const sse = new SseReader(res);
    const requested = await sse.next((e) => e.status === "approval_required");
    expect(String(requested.riskTier)).toBe("high");
    const approval = await waitForApproval();
    expect(approval.reason ?? "").toMatch(/does not see those keystrokes/); // the preview tells the truth
    await decide(approval.id, false);
    const denied = await sse.next((e) => e.status === "denied");
    expect(denied.status).toBe("denied");
    expect(getPtyRegistry().size).toBe(0);
    expect(auditEvents()).toContain("terminal.pty.denied");
    expect(auditEvents()).not.toContain("terminal.pty.opened");
  }, 20_000);

  test("approved session: the child has a TTY, input reaches it, output streams back, resize is applied", async () => {
    const { sse, sessionId } = await openSession({ cwd: "sub" });
    expect(auditEvents()).toContain("terminal.pty.opened");
    const list = (await (await h(req("/api/v1/terminal/pty"))).json()) as { sessions: Array<{ id: string; alive: boolean; cwd: string }>; cap: number };
    expect(list.sessions.some((s) => s.id === sessionId && s.alive)).toBe(true);
    expect(list.cap).toBe(8);

    // Input → shell → output. The marker is split so the echo of the command
    // itself cannot satisfy the assertion; only the shell's OUTPUT can.
    const cmd = WIN ? "echo xr-pty-%CD:~-3%-ok\r" : 'printf "xr-pty-%s-ok\\n" "$(basename "$PWD")"\n';
    const w = await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: cmd } }));
    expect(w.status).toBe(200);
    const out = await sse.waitForOutput("xr-pty-sub-ok");
    expect(out).toContain("xr-pty-sub-ok");

    if (!WIN) {
      // A real TTY reports the requested size to the child (100x30 at open).
      await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: 'printf "size:%s\\n" "$(stty size | tr " " x)"\n' } }));
      await sse.waitForOutput("size:30x100");
    }

    const r = await h(req(`/api/v1/terminal/pty/${sessionId}/resize`, { method: "POST", body: { cols: 132, rows: 43 } }));
    expect(await r.json()).toEqual({ ok: true, cols: 132, rows: 43 });
    if (!WIN) {
      await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: 'printf "size2:%s\\n" "$(stty size | tr " " x)"\n' } }));
      await sse.waitForOutput("size2:43x132");
    }
    // Out-of-range sizes are refused at the published schema boundary (the
    // contract is the law; clampSize() behind it is defense in depth).
    const r2 = await h(req(`/api/v1/terminal/pty/${sessionId}/resize`, { method: "POST", body: { cols: 99_999, rows: 0 } }));
    expect(r2.status).toBe(400);
    expect(getPtyRegistry().get(sessionId)?.cols).toBe(132); // untouched

    // Oversized input is refused whole (schema 400 / engine 413), never partially written.
    const big = await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: "x".repeat(70_000) } }));
    expect([400, 413]).toContain(big.status);

    // DELETE ends the shell and its foreground job.
    if (!WIN) await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: "sleep 30\n" } }));
    const del = await h(req(`/api/v1/terminal/pty/${sessionId}`, { method: "DELETE" }));
    expect(del.status).toBe(200);
    const exit = await sse.next((e) => e.type === "exit");
    if (!WIN) expect(exit.signal === "SIGHUP" || exit.signal === "SIGKILL" || typeof exit.code === "number").toBe(true);
    expect(getPtyRegistry().get(sessionId)).toBeUndefined();
    expect(auditEvents()).toContain("terminal.pty.killed");
    // After exit: input/resize are 409 or 404 (session gone), never a silent success.
    const late = await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: "echo late\n" } }));
    expect([404, 409]).toContain(late.status);
  }, 30_000);

  test("the client going away kills the shell — no orphaned processes", async () => {
    const { sse, sessionId } = await openSession();
    const session = getPtyRegistry().get(sessionId)!;
    expect(session.alive).toBe(true);
    await sse.cancel(); // tab closed / app quit
    const deadline = Date.now() + 10_000;
    while (getPtyRegistry().get(sessionId) && Date.now() < deadline) await Bun.sleep(25);
    expect(getPtyRegistry().get(sessionId)).toBeUndefined();
    expect(session.alive).toBe(false);
    expect(auditEvents()).toContain("terminal.pty.killed");
  }, 20_000);

  test("XR credentials never reach the shell's environment (measured in the child)", async () => {
    const prevToken = process.env.XR_DEV_TOKEN;
    process.env.XR_DEV_TOKEN = "must-not-leak";
    try {
      const { sse, sessionId } = await openSession();
      const probe = WIN ? "echo tok=[%XR_DEV_TOKEN%] term=[%XR_TERMINAL%]\r" : 'printf "tok=[%s] term=[%s]\\n" "$XR_DEV_TOKEN" "$XR_TERMINAL"\n';
      await h(req(`/api/v1/terminal/pty/${sessionId}/input`, { method: "POST", body: { data: probe } }));
      const out = await sse.waitForOutput("term=[1]");
      expect(out).not.toContain("must-not-leak");
      expect(out).toContain(WIN ? "tok=[%XR_DEV_TOKEN%]" : "tok=[]");
      await h(req(`/api/v1/terminal/pty/${sessionId}`, { method: "DELETE" }));
    } finally {
      if (prevToken === undefined) delete process.env.XR_DEV_TOKEN;
      else process.env.XR_DEV_TOKEN = prevToken;
    }
  }, 30_000);

  test("the per-daemon session cap answers 429 before raising an approval", async () => {
    const registry = getPtyRegistry();
    const baseline = registry.size;
    const opened: string[] = [];
    try {
      while (registry.size < registry.maxSessions) {
        const { sessionId } = await openSession();
        opened.push(sessionId);
      }
      const res = await h(req("/api/v1/terminal/pty", { method: "POST", body: {} }));
      expect(res.status).toBe(429);
    } finally {
      for (const id of opened) await h(req(`/api/v1/terminal/pty/${id}`, { method: "DELETE" }));
    }
    expect(registry.size).toBe(baseline);
  }, 60_000);
});
