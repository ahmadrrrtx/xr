/**
 * V1-P5-001 — mobile companion read/act API against the REAL dispatcher
 * (makeHandler with a LAN context, like the shipping serve({lan}) path).
 *
 * Pins the contract the shipped PWA speaks, which previously existed only in
 * the reference harness:
 *   · GET  /api/mobile/models    → { models: [{id,label,provider,local?}] }
 *   · GET  /api/mobile/budget    → cents summary (NO fabricated daily cap)
 *   · GET  /api/mobile/approvals → { approvals } from the SAME durable store
 *   · POST /api/mobile/approvals/:id {decision:"approve"|"deny"} → the SHARED
 *     decide path (first decision wins from ANY surface; actor derived at the
 *     auth seam, never from the body)
 *   · off-LAN the group answers 404; anonymous answers 401.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOME = mkdtempSync(join(tmpdir(), "xr-companion-"));
process.env.XR_HOME = join(process.env.HOME, "xr-home");
process.env.XR_AUDIT_LOG_DIR = join(process.env.HOME, "audit");

const TOKEN = "mobile-companion-token-0123456789";
const BASE = "http://127.0.0.1:7847";
const auth = { authorization: `Bearer ${TOKEN}` };

let store!: import("../../src/state/workspace-store.ts").Store;
type Dispatch = ReturnType<typeof import("../../src/daemon/server.ts").makeHandler>;
let handler!: Dispatch;
let offLan!: Dispatch;
let getApprovalStore!: typeof import("../../src/control/approval-store.ts").getApprovalStore;
beforeAll(async () => {
  const { prepareLan } = await import("../../src/cli/serve-lan.ts");
  const { makeHandler } = await import("../../src/daemon/server.ts");
  const { Store } = await import("../../src/state/workspace-store.ts");
  ({ getApprovalStore } = await import("../../src/control/approval-store.ts"));
  // The mobile chat store resolves $HOME per call; pin it to this suite's tmp
  // home and start from a clean slate (state must never leak between runs).
  await (await import("../../src/daemon/mobile-chats.ts")).resetMobileChatsForTest();
  const lan = await prepareLan(0);
  store = new Store(join(process.env.HOME!, "companion.db"));
  handler = makeHandler(store, TOKEN, { lan: { cert: lan.cert } });
  offLan = makeHandler(new Store(join(process.env.HOME!, "offlan.db")), TOKEN);
});

afterAll(() => {
  rmSync(process.env.HOME!, { recursive: true, force: true });
});

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { headers });
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("V1-P5-001 · companion models", () => {
  test("bearer reads {models}; the effective selection is always listed", async () => {
    const res = await handler(get("/api/mobile/models", auth));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models?: { id: string; label: string; provider: string; local?: boolean }[] };
    expect(Array.isArray(body.models)).toBe(true);
    expect(body.models!.length).toBeGreaterThan(0);
    for (const m of body.models!) {
      expect(typeof m.id).toBe("string");
      expect(typeof m.label).toBe("string");
      expect(typeof m.provider).toBe("string");
    }
  });

  test("off-LAN the group answers 404; anonymous answers 401", async () => {
    const off = await offLan(get("/api/mobile/models", auth));
    expect(off.status).toBe(404);
    const anon = await handler(get("/api/mobile/models"));
    expect(anon.status).toBe(401);
  });
});

describe("V1-P5-001 · companion budget", () => {
  test("cents summary is truthful: no fabricated daily cap; per-task + monthly caps are real", async () => {
    const res = await handler(get("/api/mobile/budget", auth));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.spentTodayCents).toBe("number");
    expect(typeof body.spentMonthCents).toBe("number");
    expect(typeof body.monthCapCents).toBe("number");
    expect(typeof body.perTaskCents).toBe("number");
    expect(body.currency).toBe("USD");
    // The governed budget has NO daily cap — the route must not invent one.
    expect(body.dailyCapCents).toBeUndefined();
  });
});

describe("V1-P5-001 · companion approvals (shared store, shared decide path)", () => {
  test("list maps the durable pending records into the companion shape", async () => {
    const handle = getApprovalStore(store).request({ tool: "shell", reason: "run a build", surface: "daemon", ttlMs: 60_000 });
    const res = await handler(get("/api/mobile/approvals", auth));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { approvals?: { id: string; title: string; summary: string; workspace: string; createdAt: number; status: string }[] };
    const mine = body.approvals?.find((a) => a.id === handle.id);
    expect(mine).toBeTruthy();
    expect(mine!.title).toBe("shell");
    expect(mine!.summary).toBe("run a build");
    expect(mine!.workspace).toBe("daemon");
    expect(mine!.status).toBe("pending");
    expect(typeof mine!.createdAt).toBe("number");
  });

  test("decide {decision:'approve'} resolves the SAME durable record; actor is the seam-derived identity", async () => {
    const handle = getApprovalStore(store).request({ tool: "shell", reason: "ship it", surface: "daemon", ttlMs: 60_000 });
    const res = await handler(post(`/api/mobile/approvals/${handle.id}`, { decision: "approve" }, auth));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; decision?: string };
    expect(body.ok).toBe(true);
    expect(body.decision).toBe("approved");
    expect((await handle.outcome).approved).toBe(true);
    expect(getApprovalStore(store).get(handle.id)?.decidedBy?.userId).toBe("local:token");
  });

  test("first decision wins across surfaces: mobile decide then desktop decide → 409", async () => {
    const handle = getApprovalStore(store).request({ tool: "shell", reason: "one shot", surface: "daemon", ttlMs: 60_000 });
    const mobile = await handler(post(`/api/mobile/approvals/${handle.id}`, { decision: "deny" }, auth));
    expect(mobile.status).toBe(200);
    expect((await handle.outcome).approved).toBe(false);
    const desktop = await handler(post(`/api/approvals/${handle.id}/decision`, { approved: true }, auth));
    expect(desktop.status).toBe(409);
  });

  test("invalid decision body → 400; unknown id → 404", async () => {
    const handle = getApprovalStore(store).request({ tool: "shell", reason: "validation", surface: "daemon", ttlMs: 60_000 });
    const bad = await handler(post(`/api/mobile/approvals/${handle.id}`, { decision: "maybe" }, auth));
    expect(bad.status).toBe(400);
    const missing = await handler(post("/api/mobile/approvals/does-not-exist", { decision: "approve" }, auth));
    expect(missing.status).toBe(404);
  });
});

describe("V1-P5-001 · companion chat sync (mobile-scoped store)", () => {
  test("create → list → messages round-trip; local-first ids are adopted on append", async () => {
    const { createChat, appendMessage, listChats, listMessages } = await import("../../src/daemon/mobile-chats.ts");
    const created = await handler(post("/api/mobile/chats", { title: "Release check" }, auth));
    expect(created.status).toBe(201);
    const row = (await created.json()) as { id: string; title: string };
    expect(row.id).toMatch(/^mcht_/);
    expect(row.title).toBe("Release check");

    // A phone-local id that never round-tripped is adopted on first append.
    await appendMessage("chat_localfirst", "user", "hello from the phone");
    await appendMessage("chat_localfirst", "assistant", "hi");

    const list = await handler(get("/api/mobile/chats?limit=10", auth));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { chats?: { id: string; title: string; lastMessage: string; messageCount: number }[] };
    const ids = body.chats!.map((c) => c.id);
    expect(ids).toContain(row.id);
    expect(ids).toContain("chat_localfirst");
    const local = body.chats!.find((c) => c.id === "chat_localfirst")!;
    expect(local.messageCount).toBe(2);
    expect(local.lastMessage).toBe("hi");

    const msgs = await handler(get(`/api/mobile/chats/${row.id}/messages`, auth));
    expect(msgs.status).toBe(200);
    expect(((await msgs.json()) as { messages: unknown[] }).messages).toEqual([]);
    const localMsgs = await handler(get("/api/mobile/chats/chat_localfirst/messages", auth));
    const localBody = (await localMsgs.json()) as { messages: { role: string; content: string }[] };
    expect(localBody.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("send reaches the ONE /api/chat path and passes its honest state through", async () => {
    // No provider is configured in this environment: the adapter must surface
    // the real pipeline's 503 (or stream if one exists) — never a fabricated
    // reply — and must NOT persist the user turn on a failed run.
    const { listMessages } = await import("../../src/daemon/mobile-chats.ts");
    const res = await handler(post("/api/mobile/chat", { chatId: "chat_probe", content: "ping" }, auth));
    expect([200, 503]).toContain(res.status);
    if (res.status === 503) {
      const body = (await res.json()) as { error?: string };
      expect(typeof body.error).toBe("string");
      expect(await listMessages("chat_probe", 10)).toEqual([]);
    }
  });

  test("invalid chat body → 400; anonymous chat → 401", async () => {
    const bad = await handler(post("/api/mobile/chat", { chatId: "", content: "" }, auth));
    expect(bad.status).toBe(400);
    const anon = await handler(post("/api/mobile/chat", { chatId: "c", content: "hi" }));
    expect(anon.status).toBe(401);
  });
});
