/**
 * XR — Block 8 tests: MCP client, cron scheduler, webhooks.
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/db.ts";
import { McpClient, wrapMcpTool } from "../src/mcp/client.ts";
import { parseSchedule, isDue, describe } from "../src/automation/cron.ts";
import { sendWebhook } from "../src/automation/webhook.ts";
import type { ToolContext } from "../src/core/types.ts";

let tmp: string;
let store: Store;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-eco-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "e.db"));
});

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { cwd: tmp, approve: async () => true, audit: () => {}, egressAllowlist: [], dryRun: false, ...overrides };
}

// ---- MCP client ----
function mcpFetch(handler: (method: string, params: any) => any): typeof fetch {
  return (async (_url: string, init?: any) => {
    const body = JSON.parse(init.body);
    const result = handler(body.method, body.params);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

test("McpClient lists and calls tools", async () => {
  const f = mcpFetch((method, params) => {
    if (method === "tools/list") return { tools: [{ name: "query", description: "run sql" }] };
    if (method === "tools/call") return { content: [{ type: "text", text: "rows: 3 (" + params.arguments.q + ")" }] };
    return {};
  });
  const client = new McpClient({ id: "db", url: "http://x" }, f);
  const tools = await client.listTools();
  expect(tools[0].name).toBe("query");
  const out = await client.callTool("query", { q: "SELECT 1" });
  expect(out.toString()).toContain("rows: 3");
});

test("wrapped MCP tool is approval-gated (denied = no call)", async () => {
  const f = mcpFetch(() => ({ content: [{ text: "should not happen" }] }));
  const client = new McpClient({ id: "db", url: "http://x" }, f);
  const tool = wrapMcpTool(client, "db", { name: "query", description: "sql" });
  expect(tool.name).toBe("mcp.db.query");
  expect(tool.requiresApproval).toBe(true);
  const r = await tool.run({ q: "x" }, ctx({ approve: async () => false }));
  expect(r.ok).toBe(false);
  expect(r.output).toContain("denied");
});

test("wrapped MCP tool dry-run does not call out", async () => {
  let called = false;
  const f = mcpFetch(() => {
    called = true;
    return { content: [{ text: "x" }] };
  });
  const client = new McpClient({ id: "db", url: "http://x" }, f);
  const tool = wrapMcpTool(client, "db", { name: "query", description: "sql" });
  const r = await tool.run({ q: "x" }, ctx({ dryRun: true }));
  expect(r.output).toContain("[dry-run]");
  expect(called).toBe(false);
});

// ---- cron parsing ----
test("parseSchedule: weekly with time", () => {
  const s = parseSchedule("every monday at 9am: run security audit", "c1")!;
  expect(s.kind).toBe("weekly");
  expect(s.weekday).toBe(1);
  expect(s.hour).toBe(9);
  expect(s.task).toBe("run security audit");
});

test("parseSchedule: interval and daily", () => {
  const i = parseSchedule("every 30 minutes: poll", "c2")!;
  expect(i.kind).toBe("interval");
  expect(i.everyMinutes).toBe(30);
  const h = parseSchedule("every 2 hours: sync", "c3")!;
  expect(h.everyMinutes).toBe(120);
  const d = parseSchedule("daily at 6:30pm: report", "c4")!;
  expect(d.kind).toBe("daily");
  expect(d.hour).toBe(18);
  expect(d.minute).toBe(30);
});

// ---- cron due-check (deterministic) ----
test("isDue: daily fires at the right minute, once", () => {
  const s = parseSchedule("daily at 09:00: x", "c5")!;
  const at9 = new Date(2026, 5, 1, 9, 0, 0); // Mon Jun 1 2026 09:00
  const at10 = new Date(2026, 5, 1, 10, 0, 0);
  expect(isDue(s, at9)).toBe(true);
  expect(isDue(s, at10)).toBe(false);
  // After running this minute, it should not re-fire the same minute.
  s.lastRun = at9.getTime();
  expect(isDue(s, at9)).toBe(false);
});

test("isDue: weekly only on its weekday", () => {
  const s = parseSchedule("every monday at 09:00: x", "c6")!;
  const mon = new Date(2026, 5, 1, 9, 0, 0); // Monday
  const tue = new Date(2026, 5, 2, 9, 0, 0); // Tuesday
  expect(isDue(s, mon)).toBe(true);
  expect(isDue(s, tue)).toBe(false);
});

test("isDue: disabled never fires; interval respects elapsed", () => {
  const s = parseSchedule("every 60 minutes: x", "c7")!;
  expect(isDue(s, new Date())).toBe(true); // no lastRun
  s.lastRun = Date.now();
  expect(isDue(s, new Date())).toBe(false);
  s.enabled = false;
  s.lastRun = undefined;
  expect(isDue(s, new Date())).toBe(false);
});

test("schedule persistence round-trips", () => {
  const s = parseSchedule("daily at 9am: report", "c8")!;
  store.saveSchedule(s.id, JSON.stringify(s));
  const rows = store.listSchedules();
  expect(rows.length).toBe(1);
  expect(JSON.parse(rows[0].spec).task).toBe("report");
  store.deleteSchedule(s.id);
  expect(store.listSchedules().length).toBe(0);
});

// ---- webhooks (egress-gated) ----
test("webhook blocked when host not allow-listed", async () => {
  const r = await sendWebhook("https://hooks.slack.com/x", { ok: 1 }, ["github.com"]);
  expect(r.ok).toBe(false);
  expect(r.detail).toContain("egress blocked");
});

test("webhook sends when allow-listed", async () => {
  let sent = false;
  const f = (async () => {
    sent = true;
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const r = await sendWebhook("https://hooks.slack.com/x", { ok: 1 }, ["slack.com"], f);
  expect(r.ok).toBe(true);
  expect(sent).toBe(true);
});
