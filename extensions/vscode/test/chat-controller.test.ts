import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatController, MAX_APPROVALS_PER_SESSION, type ChatTransport, type EditorSnapshot } from "../src/chat/controller";
import { DaemonHttpError, type ChatEvent, type ChatRequest } from "../src/daemon/client";
import type { DaemonStatus, ToWebview } from "../src/shared/protocol";
import type { XrDiagnostic } from "../src/chat/diagnostics";

const CONNECTED: DaemonStatus = { state: "connected", model: "m" };

function transportOf(
  events: ChatEvent[],
  rec: { bodies?: ChatRequest[]; decisions?: Array<[string, boolean]> } = {},
): ChatTransport {
  return {
    chat(body, signal) {
      rec.bodies?.push(body);
      return (async function* () {
        for (const e of events) {
        if (signal.aborted) return;
          yield e;
        }
      })();
    },
    async decideApproval(id, approved) {
      rec.decisions?.push([id, approved]);
    },
  };
}

function harness(opts: {
  transport: ChatTransport | null;
  editor?: EditorSnapshot | null;
  approve?: boolean;
  onDiagnostics?: (items: XrDiagnostic[]) => void;
}) {
  const published: ToWebview[] = [];
  const confirms: string[] = [];
  const controller = new ChatController({
    transport: () => opts.transport,
    mode: () => "ask",
    editor: () => (opts.editor === undefined ? null : opts.editor),
    confirmApproval: async (req) => {
      confirms.push(req.tool);
      return opts.approve ?? true;
    },
    publish: (m) => published.push(m),
    onDiagnostics: opts.onDiagnostics,
    status: () => CONNECTED,
  });
  return { controller, published, confirms };
}

test("streams token deltas into one assistant message and clears busy", async () => {
  const { controller, published } = harness({
    transport: transportOf([
      { kind: "status", status: "provider_ready", provider: "groq", model: "llama" },
      { kind: "token", text: "Hel" },
      { kind: "token", text: "lo" },
      { kind: "done", fullText: "Hello", finishReason: "stop" },
    ]),
  });

  await controller.send("hi");

  const snap = controller.snapshot();
  assert.equal(snap.messages.length, 2);
  assert.equal(snap.messages[0].role, "user");
  assert.equal(snap.messages[1].role, "assistant");
  assert.equal(snap.messages[1].text, "Hello");
  assert.equal(snap.messages[1].streaming, false);
  assert.equal(controller.busy, false);
  const deltas = published.filter((m) => m.type === "delta").map((m) => (m as { text: string }).text);
  assert.deepEqual(deltas, ["Hel", "lo"]);
  assert.ok(published.some((m) => m.type === "busy" && m.busy === true));
  assert.ok(published.some((m) => m.type === "busy" && m.busy === false));
});

test("without a daemon, sends nothing and says XR must be running", async () => {
  const { controller } = harness({ transport: null });
  await controller.send("hi");
  const notes = controller.snapshot().messages.filter((m) => m.role === "system");
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /XR must be running on your computer for chat to respond\./);
  assert.equal(controller.busy, false);
});

test("a second send while busy is refused with a note, not queued", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const slow: ChatTransport = {
    chat(_body, signal) {
      return (async function* () {
        await gate;
        if (!signal.aborted) yield { kind: "done", fullText: "ok" } as ChatEvent;
      })();
    },
    async decideApproval() {},
  };
  const { controller } = harness({ transport: slow });
  const first = controller.send("one");
  await controller.send("two");
  release();
  await first;
  const texts = controller.snapshot().messages.map((m) => m.text);
  assert.ok(!texts.includes("two"), "second prompt must not be sent");
  assert.ok(controller.snapshot().messages.some((m) => m.role === "system" && /still answering/.test(m.text)));
});

test("stop() aborts the stream and marks the run stopped", async () => {
  const { controller } = harness({
    transport: {
      chat(_body, signal) {
        return (async function* () {
          yield { kind: "token", text: "partial" } as ChatEvent;
          controller.stop();
          if (signal.aborted) return;
          yield { kind: "token", text: " more" } as ChatEvent;
        })();
      },
      async decideApproval() {},
    },
  });
  await controller.send("go");
  const reply = controller.snapshot().messages[1];
  assert.equal(reply.text, "partial");
  assert.ok(reply.activity.some((a) => a.text === "Stopped"));
});

test("sends the selection as a fenced block only when attached", async () => {
  const bodies: ChatRequest[] = [];
  const editor: EditorSnapshot = {
    file: "src/a.ts",
    languageId: "typescript",
    selection: { text: "const x = 1;", startLine: 3, endLine: 3 },
  };
  const { controller } = harness({ transport: transportOf([{ kind: "done", fullText: "" }], { bodies }), editor });

  await controller.send("explain");
  assert.ok(!bodies[0].message.includes("```"), "no block without attach");

  controller.setAttachSelection(true);
  await controller.send("explain again");
  assert.match(bodies[1].message, /```typescript\nconst x = 1;\n```/);
  assert.equal(bodies[1].sessionId, "vscode");
  assert.match(bodies[1].context ?? "", /Active file: src\/a\.ts/);
});

test("attachment resets after each turn", async () => {
  const bodies: ChatRequest[] = [];
  const editor: EditorSnapshot = { file: "a.ts", selection: { text: "x", startLine: 1, endLine: 1 } };
  const { controller } = harness({ transport: transportOf([{ kind: "done", fullText: "" }], { bodies }), editor });
  controller.setAttachSelection(true);
  await controller.send("one");
  await controller.send("two");
  assert.match(bodies[0].message, /```/);
  assert.ok(!bodies[1].message.includes("```"));
});

test("history carries earlier turns and skips errored ones", async () => {
  const bodies: ChatRequest[] = [];
  const { controller } = harness({
    transport: transportOf([{ kind: "token", text: "A1" }, { kind: "done", fullText: "A1" }], { bodies }),
  });
  await controller.send("Q1");
  await controller.send("Q2");
  const history = bodies[1].history ?? [];
  assert.deepEqual(
    history.map((h) => [h.role, h.content]),
    [
      ["user", "Q1"],
      ["assistant", "A1"],
    ],
  );
});

test("publishes validated diagnostics from an xr-diagnostics block only", async () => {
  const got: XrDiagnostic[][] = [];
  const answer = [
    "The file has an issue on line 4, src/a.ts:4, but this is prose and must not become a problem.",
    "```xr-diagnostics",
    '[{"file":"src/a.ts","line":4,"severity":"warning","message":"unused variable"},{"file":"../etc/passwd","line":1,"severity":"error","message":"bad"}]',
    "```",
  ].join("\n");
  const { controller } = harness({
    transport: transportOf([{ kind: "done", fullText: answer }]),
    onDiagnostics: (items) => got.push(items),
  });
  await controller.send("review");
  assert.equal(got.length, 1);
  assert.deepEqual(got[0], [{ file: "src/a.ts", line: 4, severity: "warning", message: "unused variable" }]);
});

test("does not publish diagnostics from a failed run", async () => {
  const got: XrDiagnostic[][] = [];
  const answer = '```xr-diagnostics\n[{"file":"a.ts","line":1,"severity":"error","message":"x"}]\n```';
  const { controller } = harness({
    transport: transportOf([{ kind: "done", fullText: answer, finishReason: "error" }]),
    onDiagnostics: (items) => got.push(items),
  });
  await controller.send("review");
  assert.equal(got.length, 0);
});

test("a finish with reason error surfaces as an error on the reply", async () => {
  const { controller } = harness({
    transport: transportOf([{ kind: "done", fullText: "provider failed", finishReason: "error" }]),
  });
  await controller.send("x");
  assert.equal(controller.snapshot().messages[1].error, "provider failed");
});

test("401 maps to a token message and an unauthorized status", async () => {
  const { controller, published } = harness({
    transport: {
      chat() {
        return (async function* () {
          throw new DaemonHttpError(401, "nope");
        })();
      },
      async decideApproval() {},
    },
  });
  await controller.send("x");
  assert.equal(controller.snapshot().messages[1].error, "The daemon rejected the token. Run XR: Set daemon token.");
  const status = [...published].reverse().find((m) => m.type === "status");
  assert.ok(status && status.type === "status" && status.status.state === "unauthorized");
});

test("429 maps to a busy message", async () => {
  const { controller } = harness({
    transport: {
      chat() {
        return (async function* () {
          throw new DaemonHttpError(429, "slow down");
        })();
      },
      async decideApproval() {},
    },
  });
  await controller.send("x");
  assert.match(controller.snapshot().messages[1].error ?? "", /busy with another run/);
});

test("a dropped connection gives the offline copy", async () => {
  const { controller } = harness({
    transport: {
      chat() {
        return (async function* () {
          throw new TypeError("fetch failed");
        })();
      },
      async decideApproval() {},
    },
  });
  await controller.send("x");
  assert.match(controller.snapshot().messages[1].error ?? "", /XR must be running on your computer for chat to respond\./);
});

test("approval: Approve sends true, Deny sends false, and both are recorded", async () => {
  const decisions: Array<[string, boolean]> = [];
  const events: ChatEvent[] = [
    { kind: "approval", id: "a1", tool: "shell", reason: "run tests" },
    { kind: "done", fullText: "" },
  ];
  const yes = harness({ transport: transportOf(events, { decisions }), approve: true });
  await yes.controller.send("run");
  assert.deepEqual(decisions, [["a1", true]]);
  assert.deepEqual(yes.confirms, ["shell"]);

  decisions.length = 0;
  const no = harness({ transport: transportOf(events, { decisions }), approve: false });
  await no.controller.send("run");
  assert.deepEqual(decisions, [["a1", false]]);
});

test("approvals are capped per session without asking again", async () => {
  const decisions: Array<[string, boolean]> = [];
  const events: ChatEvent[] = Array.from({ length: MAX_APPROVALS_PER_SESSION + 1 }, (_, i) => ({
    kind: "approval" as const,
    id: `a${i}`,
    tool: "t",
    reason: "r",
  }));
  events.push({ kind: "done", fullText: "" });
  const { controller, confirms } = harness({ transport: transportOf(events, { decisions }), approve: true });
  await controller.send("many");
  assert.equal(confirms.length, MAX_APPROVALS_PER_SESSION);
  const last = decisions[decisions.length - 1];
  assert.deepEqual(last, [`a${MAX_APPROVALS_PER_SESSION}`, false]);
});

test("clear() empties the conversation and tells the webview", async () => {
  const { controller, published } = harness({ transport: transportOf([{ kind: "done", fullText: "ok" }]) });
  await controller.send("x");
  controller.clear();
  assert.equal(controller.snapshot().messages.length, 0);
  assert.ok(published.some((m) => m.type === "clear"));
});
