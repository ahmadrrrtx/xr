/**
 * Phase 12 — chat tool-approval waiters.
 *
 * Fail closed: unknown ids, abort, and timeout all deny. The model never
 * resolves a waiter.
 */
import { describe, expect, test } from "bun:test";
import {
  waitForChatApproval,
  resolveChatApproval,
  cancelChatApprovals,
  pendingChatApprovalCount,
} from "../../src/daemon/chat-approvals.ts";
import { chatRoutes } from "../../src/daemon/routes/chat.routes.ts";

describe("Phase 12 · chat approval waiters", () => {
  test("resolveChatApproval delivers the human decision", async () => {
    const p = waitForChatApproval("a1", "run_1", "write_file", undefined, 5_000);
    expect(pendingChatApprovalCount()).toBe(1);
    expect(resolveChatApproval("a1", true)).toBe(true);
    expect(await p).toBe(true);
    expect(pendingChatApprovalCount()).toBe(0);
  });

  test("unknown id is a no-op (fail closed)", () => {
    expect(resolveChatApproval("nope", true)).toBe(false);
  });

  test("abort denies without throwing", async () => {
    const c = new AbortController();
    const p = waitForChatApproval("a2", "run_2", "shell", c.signal, 5_000);
    c.abort();
    expect(await p).toBe(false);
  });

  test("cancelChatApprovals denies every waiter for that run", async () => {
    const p1 = waitForChatApproval("b1", "run_x", "write_file", undefined, 5_000);
    const p2 = waitForChatApproval("b2", "run_x", "shell", undefined, 5_000);
    const other = waitForChatApproval("b3", "run_y", "read_file", undefined, 5_000);
    cancelChatApprovals("run_x");
    expect(await p1).toBe(false);
    expect(await p2).toBe(false);
    expect(resolveChatApproval("b3", true)).toBe(true);
    expect(await other).toBe(true);
  });

  test("timeout denies", async () => {
    const p = waitForChatApproval("slow", "run_t", "write_file", undefined, 20);
    expect(await p).toBe(false);
  });
});

describe("Phase 12 · chat.approve.post route", () => {
  test("the route is registered next to chat.stream.post", () => {
    const ids = chatRoutes().map((r) => r.id);
    expect(ids).toContain("chat.stream.post");
    expect(ids).toContain("chat.approve.post");
  });

  test("missing id is 400; unknown id is 404 fail-closed", async () => {
    const approve = chatRoutes().find((r) => r.id === "chat.approve.post")!;
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    const audit: unknown[] = [];
    const ctx = {
      json,
      req: new Request("http://x/api/chat/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved: true }),
      }),
      state: { store: { audit: (e: string, d: unknown) => audit.push({ e, d }) } },
    } as any;
    const missing = await approve.handle(ctx);
    expect(missing!.status).toBe(400);

    ctx.req = new Request("http://x/api/chat/approve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "ghost", approved: true }),
    });
    const ghost = await approve.handle(ctx);
    expect(ghost!.status).toBe(404);
    const body = (await ghost!.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
