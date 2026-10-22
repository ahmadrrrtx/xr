/**
 * XR-LAUNCH-034 — the extension survives a daemon restart without re-pairing.
 *
 * Covers the pure pieces the session composes: the token-file reader (with its
 * ownership/permission guards), source precedence with fall-through, the
 * connect loop, the client's 401 hook, and the controller's one-shot retry.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { daemonTokenPath, describeTokenFileProblem, readDaemonTokenFile } from "../src/daemon/token-file";
import { resolveTokens } from "../src/daemon/token";
import { connectWithTokens } from "../src/daemon/connect";
import { DaemonClient, DaemonHttpError, parseChatEvent, type ChatEvent } from "../src/daemon/client";
import { ChatController, toolFailureText, type ChatTransport } from "../src/chat/controller";
import type { DaemonStatus, ToWebview } from "../src/shared/protocol";

const POSIX = process.platform !== "win32";
const TOKEN_A = "tokA_0123456789abcdef0123456789";
const TOKEN_B = "tokB_fedcba9876543210fedcba9876";

function xrHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "xr-vscode-034-"));
}
function writeToken(home: string, value: string, mode = 0o600): string {
  const dir = path.join(home, "daemon");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "token");
  fs.writeFileSync(file, `${value}\n`, { mode });
  if (POSIX) fs.chmodSync(file, mode);
  return file;
}

// ── token file ────────────────────────────────────────────────────────────────

test("token file: path follows XR_HOME, else ~/.xr (same rule as the daemon)", () => {
  assert.equal(daemonTokenPath({ XR_HOME: "/x/home" }, "/u"), path.join("/x/home", "daemon", "token"));
  assert.equal(daemonTokenPath({}, "/u"), path.join("/u", ".xr", "daemon", "token"));
  assert.equal(daemonTokenPath({ XR_HOME: "  " }, "/u"), path.join("/u", ".xr", "daemon", "token"));
});

test("token file: an owner-only file is read and trimmed; a missing file is quiet", () => {
  const home = xrHome();
  assert.deepEqual(readDaemonTokenFile({ env: { XR_HOME: home } }).ok, false);
  assert.equal(describeTokenFileProblem(readDaemonTokenFile({ env: { XR_HOME: home } })), null);
  writeToken(home, TOKEN_A);
  const r = readDaemonTokenFile({ env: { XR_HOME: home } });
  assert.ok(r.ok && r.token === TOKEN_A);
});

test("token file: group/other-readable, foreign-owned, symlinked, oversized or empty files are ignored", { skip: !POSIX }, () => {
  const home = xrHome();
  const file = writeToken(home, TOKEN_A, 0o644);
  let r = readDaemonTokenFile({ env: { XR_HOME: home } });
  assert.ok(!r.ok && r.reason === "too-open");
  const problem = describeTokenFileProblem(r) ?? "";
  assert.match(problem, /readable by other users/);
  assert.ok(!problem.includes(TOKEN_A), "a problem message never contains the token");

  fs.chmodSync(file, 0o600);
  r = readDaemonTokenFile({ env: { XR_HOME: home }, uid: (process.getuid?.() ?? 0) + 1 });
  assert.ok(!r.ok && r.reason === "not-owner");

  const real = path.join(home, "elsewhere");
  fs.writeFileSync(real, TOKEN_A, { mode: 0o600 });
  fs.rmSync(file);
  fs.symlinkSync(real, file);
  r = readDaemonTokenFile({ env: { XR_HOME: home } });
  assert.ok(!r.ok && r.reason === "not-a-file");

  fs.rmSync(file);
  fs.writeFileSync(file, "x".repeat(4096), { mode: 0o600 });
  r = readDaemonTokenFile({ env: { XR_HOME: home } });
  assert.ok(!r.ok && r.reason === "too-large");

  fs.writeFileSync(file, "  \n", { mode: 0o600 });
  r = readDaemonTokenFile({ env: { XR_HOME: home } });
  assert.ok(!r.ok && r.reason === "empty");
});

test("token file: on Windows the POSIX mode/owner checks are skipped (ACL inherited)", () => {
  const home = xrHome();
  writeToken(home, TOKEN_A, 0o644);
  const r = readDaemonTokenFile({ env: { XR_HOME: home }, platform: "win32", uid: 999999 });
  assert.ok(r.ok && r.token === TOKEN_A);
});

// ── precedence + connect loop ────────────────────────────────────────────────

test("tokens: precedence is setting, environment, session, daemon file, secret storage; duplicates collapse", () => {
  const list = resolveTokens({ setting: "s", environment: "e", session: "x", daemonFile: "x", secretStorage: "k" });
  assert.deepEqual(list.map((t) => t.source), ["setting", "environment", "session", "secret-storage"]);
  assert.deepEqual(resolveTokens({ daemonFile: ` ${TOKEN_A} ` }), [{ token: TOKEN_A, source: "daemon-file" }]);
});

function fakeDaemon(current: () => string) {
  const ok = { usage: { dayUsd: 0, monthUsd: 0, totalUsd: 0 } };
  const providers = { primary: "p", model: "m", providers: [] };
  return (token: string) => ({
    async budget() {
      if (token !== current()) throw new DaemonHttpError(401, "unauthorized");
      return ok;
    },
    async providers() {
      if (token !== current()) throw new DaemonHttpError(401, "unauthorized");
      return providers;
    },
  });
}

test("connect: a stale stored token falls through to the daemon's current token file", async () => {
  const tokens = resolveTokens({ setting: "stale-setting-token-123456", daemonFile: TOKEN_B, secretStorage: TOKEN_A });
  const r = await connectWithTokens(tokens, fakeDaemon(() => TOKEN_B));
  assert.equal(r.kind, "connected");
  assert.ok(r.kind === "connected" && r.token.source === "daemon-file");
});

test("connect: all rejected reports source names only; no token reports no-token; other errors stop", async () => {
  const r = await connectWithTokens(resolveTokens({ setting: TOKEN_A, secretStorage: TOKEN_B }), fakeDaemon(() => "other"));
  assert.deepEqual(r, { kind: "rejected", sources: ["xr.token setting", "VS Code secret storage"] });
  assert.ok(!JSON.stringify(r).includes(TOKEN_A));
  assert.deepEqual(await connectWithTokens([], fakeDaemon(() => TOKEN_A)), { kind: "no-token" });
  let calls = 0;
  const broken = () => ({
    async budget(): Promise<never> {
      calls++;
      throw new DaemonHttpError(500, "boom");
    },
    async providers(): Promise<never> {
      throw new DaemonHttpError(500, "boom");
    },
  });
  const e = await connectWithTokens(resolveTokens({ setting: TOKEN_A, secretStorage: TOKEN_B }), broken);
  assert.equal(e.kind, "error");
  assert.equal(calls, 1, "a non-auth failure does not try further tokens");
});

// ── client 401 hook ──────────────────────────────────────────────────────────

test("client: 401/403 call onUnauthorized (JSON and chat); 500 does not", async () => {
  let hits = 0;
  let status = 401;
  const fetchImpl = (async () => new Response(JSON.stringify({ error: "no" }), { status })) as unknown as typeof fetch;
  const c = new DaemonClient("http://127.0.0.1:3141", TOKEN_A, fetchImpl, () => hits++);
  await assert.rejects(c.budget(), (e: unknown) => e instanceof DaemonHttpError && e.status === 401);
  status = 403;
  await assert.rejects(
    (async () => {
      for await (const _ of c.chat({ message: "x", mode: "ask" }, new AbortController().signal)) void _;
    })(),
    (e: unknown) => e instanceof DaemonHttpError && e.status === 403,
  );
  status = 500;
  await assert.rejects(c.providers());
  assert.equal(hits, 2);
  assert.equal(c.bearer, TOKEN_A);
});

test("client: tool_result frames keep reason and next (XR-LAUNCH-024)", () => {
  const e = parseChatEvent({ type: "tool_result", id: "1", tool: "read_file", ok: false, error: "path escapes the project root", reason: "denied:escape", next: "Use a path inside." });
  assert.deepEqual(e, { kind: "tool_result", id: "1", tool: "read_file", ok: false, error: "path escapes the project root", reason: "denied:escape", next: "Use a path inside." });
  assert.equal(
    toolFailureText({ tool: "read_file", error: "path escapes the project root", reason: "denied:escape", next: "Use a path inside." }),
    "read_file failed: path escapes the project root [denied:escape] Use a path inside.",
  );
  assert.equal(toolFailureText({ tool: "shell" }), "shell failed");
});

// ── controller one-shot retry ────────────────────────────────────────────────

function chatTransport(token: string, current: () => string, calls: string[], events: ChatEvent[] = [{ kind: "token", text: "hi" }, { kind: "done", fullText: "hi" }]): ChatTransport {
  return {
    chat() {
      calls.push(token);
      return (async function* () {
        if (token !== current()) throw new DaemonHttpError(401, "unauthorized");
        for (const e of events) yield e;
      })();
    },
    async decideApproval() {},
  };
}

function controllerWith(transport: ChatTransport, reconnect?: () => Promise<ChatTransport | null>) {
  const published: ToWebview[] = [];
  const status: DaemonStatus = { state: "connected" };
  const controller = new ChatController({
    transport: () => transport,
    reconnect,
    mode: () => "ask",
    editor: () => null,
    confirmApproval: async () => false,
    publish: (m) => published.push(m),
    status: () => status,
  });
  return { controller, published };
}

test("chat after a daemon restart: 401 → reconnect re-reads the token → the same message succeeds once", async () => {
  let current = TOKEN_A;
  const calls: string[] = [];
  const stale = chatTransport(TOKEN_A, () => current, calls);
  current = TOKEN_B; // daemon restarted with a new token
  let reconnects = 0;
  const { controller } = controllerWith(stale, async () => {
    reconnects++;
    return chatTransport(TOKEN_B, () => current, calls);
  });
  await controller.send("hello");
  const reply = controller.snapshot().messages[1]!;
  assert.equal(reply.error, undefined);
  assert.equal(reply.text, "hi");
  assert.equal(reconnects, 1);
  assert.deepEqual(calls, [TOKEN_A, TOKEN_B], "exactly one retry, with the new token");
});

test("chat: no retry when reconnect finds nothing; the error names the next step", async () => {
  const calls: string[] = [];
  const { controller, published } = controllerWith(chatTransport(TOKEN_A, () => TOKEN_B, calls), async () => null);
  await controller.send("hello");
  assert.deepEqual(calls, [TOKEN_A]);
  assert.match(controller.snapshot().messages[1]!.error ?? "", /XR: Set daemon token/);
  const s = [...published].reverse().find((m) => m.type === "status");
  assert.ok(s && s.type === "status" && s.status.state === "unauthorized");
});

test("chat: a failure after the run started is never retried (no duplicate runs)", async () => {
  let reconnects = 0;
  const transport: ChatTransport = {
    chat() {
      return (async function* () {
        yield { kind: "token", text: "partial" } as ChatEvent;
        throw new DaemonHttpError(401, "unauthorized");
      })();
    },
    async decideApproval() {},
  };
  const { controller } = controllerWith(transport, async () => {
    reconnects++;
    return null;
  });
  await controller.send("hello");
  assert.equal(reconnects, 0);
  assert.equal(controller.snapshot().messages[1]!.text, "partial");
});
