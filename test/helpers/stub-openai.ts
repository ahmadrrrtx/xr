/**
 * XR — stub OpenAI-compatible provider (Phase 0 verification harness).
 *
 * A controllable, in-tree replacement for the one-off repro stub that
 * reproduced Audit B's fake-completion live. This is the shared instrument
 * for the black-box CLI suites (test/e2e-blackbox/*) and for the Phase 1
 * provider-integrity proofs: every scenario serves deterministically and
 * records exactly what the client sent (stream field, tools field, model,
 * body head), so a violated capability declaration is a provable fact, not
 * an inference.
 *
 * Scenarios (all respond to POST /chat/completions; GET /models is always
 * served so provider health/model probes succeed):
 *
 *   sse-ok             spec-compliant SSE stream of the envelope protocol
 *                      ({message, tool_calls, done}); yields a done turn.
 *   non-sse-body       responds with 200 + application/json EVEN when the
 *                      client sent stream:true (Audit B's fake-completion
 *                      trigger, reproduced). Content = valid envelope.
 *   empty-body         200 + JSON with empty message content (M-06 route).
 *   no-usage           sse-ok but with NO usage field in any chunk (F-13:
 *                      a provider omitting usage must not meter $0 silently
 *                      — Phase 1 adds the estimate fallback; Phase 0 pins
 *                      the observed behavior).
 *   native-tool-calls  request #1 → native OpenAI tool_calls (streaming
 *                      deltas with a complete args payload, or
 *                      message.tool_calls when stream:false); request #2+ →
 *                      sse-ok done turn. Executes one real tool call and
 *                      then completes.
 *   hanging            accepts the request and never responds (timeout /
 *                      cancel matrix).
 *   500                HTTP 500 (provider error classification).
 *   slow               delays SCENARIO_SLOW_MS (default 800ms) then serves
 *                      sse-ok (latency matrix).
 *
 * Hygiene contract (M-07): close() closes the server AND destroys all live
 * sockets (keep-alive sockets are the classic leaked-listener source), and
 * the server handle is unref'd so a forgotten stub can never pin the test
 * process open. The suites assert zero listeners remain after the run.
 *
 * Key hygiene: Authorization headers are recorded as "<redacted>" — the stub
 * must never be the place a key leaks into test artifacts.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";

export type StubScenario =
  | "sse-ok"
  | "non-sse-body"
  | "empty-body"
  | "no-usage"
  | "native-tool-calls"
  | "hanging"
  | "500"
  | "slow";

export const STUB_SCENARIOS: readonly StubScenario[] = [
  "sse-ok",
  "non-sse-body",
  "empty-body",
  "no-usage",
  "native-tool-calls",
  "hanging",
  "500",
  "slow",
];

export const STUB_MODEL = "stub-model";
export const SCENARIO_SLOW_MS = 800;

/** One recorded chat/completions request (what the client ACTUALLY sent). */
export interface StubRequestRecord {
  seq: number;
  method: string;
  url: string;
  /** true when the JSON body carried "stream": true. */
  streamField: boolean;
  /** true when the JSON body carried a native "tools" array. */
  toolsField: boolean;
  /** true when the JSON body carried "tool_choice". */
  toolChoiceField: boolean;
  /** the model field as sent (null when absent). */
  modelField: string | null;
  /** first 200 chars of the raw body (key material never sits in the body). */
  bodyHead: string;
  /** request headers; Authorization is always "<redacted>". */
  headers: Record<string, string>;
  receivedAt: number;
}

export interface StubOpenAIOptions {
  scenario?: StubScenario;
  /** fixed port (tests that need a known port); default ephemeral. */
  port?: number;
  model?: string;
  /** body of the envelope "message" for sse-ok / non-sse-body. */
  message?: string;
}

export interface StubOpenAIHandle {
  port: number;
  baseUrl: string;
  scenario: StubScenario;
  model: string;
  /** every request the stub has received (models + chat). */
  requests: StubRequestRecord[];
  /** chat/completions requests only. */
  chatRequests(): StubRequestRecord[];
  /** resolve when at least `count` chat requests have arrived (deterministic sync points). */
  waitForChatRequests(count: number, timeoutMs?: number): Promise<StubRequestRecord[]>;
  /** switch scenario mid-test (e.g. hanging → sse-ok for cancel/resume flows). */
  setScenario(s: StubScenario): void;
  isClosed(): boolean;
  close(): Promise<void>;
}

function recordHeaders(raw: IncomingMessage["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    const val = Array.isArray(v) ? v.join(",") : String(v);
    out[k] = /authorization|api[-_]?key|token/i.test(k) ? "<redacted>" : val;
  }
  return out;
}

const ENVELOPE = (message: string): string =>
  JSON.stringify({ message, tool_calls: [], done: true });

const USAGE_CHUNK = (json: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 } })}\n\n`;

const NATIVE_TOOL_CHUNK = (): string =>
  `data: ${JSON.stringify({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: `call_stub_${randomUUID().slice(0, 8)}`,
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "package.json" }),
              },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  })}\n\n`;

export function startStubOpenAI(opts: StubOpenAIOptions = {}): Promise<StubOpenAIHandle> {
  const scenario: StubScenario = opts.scenario ?? "sse-ok";
  const model = opts.model ?? STUB_MODEL;
  const message = opts.message ?? "Hello from stub";

  const requests: StubRequestRecord[] = [];
  let seq = 0;
  let closed = false;
  let currentScenario: StubScenario = scenario;
  const sockets = new Set<import("node:net").Socket>();

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (closed) return;
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const url = req.url ?? "";
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : null;
      } catch {
        parsed = null;
      }

      requests.push({
        seq: ++seq,
        method: req.method ?? "GET",
        url,
        streamField: parsed?.stream === true,
        toolsField: Array.isArray(parsed?.tools),
        toolChoiceField: parsed?.tool_choice !== undefined,
        modelField: typeof parsed?.model === "string" ? (parsed.model as string) : null,
        bodyHead: rawBody.slice(0, 200),
        headers: recordHeaders(req.headers),
        receivedAt: Date.now(),
      });

      const respondJson = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };

      // Model list — provider health/listModels probes.
      if (/\/models$/.test(url)) {
        respondJson(200, { object: "list", data: [{ id: model }] });
        return;
      }

      if (!/\/chat\/completions$/.test(url)) {
        respondJson(404, { error: { message: `stub: unhandled path ${url}` } });
        return;
      }

      const streamWanted = parsed?.stream === true;

      switch (currentScenario) {
        case "sse-ok": {
          if (!streamWanted) {
            respondJson(200, {
              choices: [
                {
                  message: { role: "assistant", content: ENVELOPE(message) },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
            });
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: ENVELOPE(message) } }] })}\n\n`);
          res.write(USAGE_CHUNK(""));
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        case "no-usage": {
          if (!streamWanted) {
            respondJson(200, {
              choices: [
                { message: { role: "assistant", content: ENVELOPE(message) }, finish_reason: "stop" },
              ],
            });
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: ENVELOPE(message) } }] })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        case "non-sse-body": {
          // THE F-02 trigger: a stream:true request answered with a non-SSE
          // JSON body. Real OpenAI-compatible servers do this when the
          // stream field is ignored (or the server lies about its support).
          respondJson(200, {
            choices: [
              {
                message: { role: "assistant", content: ENVELOPE(message) },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
          });
          return;
        }

        case "empty-body": {
          respondJson(200, {
            choices: [{ message: { role: "assistant", content: "" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
          });
          return;
        }

        case "native-tool-calls": {
          // request #1 → native tool call; request #2+ → done turn (lets the
          // loop execute the tool, then finish normally). The counter counts
          // CHAT requests only (/models probes are recorded too, so they
          // must not advance the turn sequence).
          const chatCount = requests.filter((r) => /\/chat\/completions$/.test(r.url)).length;
          const isToolTurn = chatCount === 1;
          if (!streamWanted) {
            // Non-stream native shape: message.tool_calls (F-04 surface).
            if (isToolTurn) {
              respondJson(200, {
                choices: [
                  {
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: `call_stub_${chatCount}`,
                          type: "function",
                          function: {
                            name: "read_file",
                            arguments: JSON.stringify({ path: "package.json" }),
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
              });
            } else {
              respondJson(200, {
                choices: [
                  { message: { role: "assistant", content: ENVELOPE(message) }, finish_reason: "stop" },
                ],
                usage: { prompt_tokens: 6, completion_tokens: 7, total_tokens: 13 },
              });
            }
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          if (isToolTurn) {
            res.write(NATIVE_TOOL_CHUNK());
          } else {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: ENVELOPE(message) } }] })}\n\n`);
            res.write(USAGE_CHUNK(""));
          }
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        case "hanging": {
          // Never responds; socket stays open until the client gives up.
          req.socket.on("close", () => {});
          return;
        }

        case "500": {
          respondJson(500, { error: { message: "stub: deliberate 500", type: "server_error" } });
          return;
        }

        case "slow": {
          setTimeout(() => {
            if (closed) return;
            res.writeHead(200, {
              "content-type": "text/event-stream",
              "cache-control": "no-cache",
              connection: "keep-alive",
            });
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", content: ENVELOPE(message) } }] })}\n\n`);
            res.write(USAGE_CHUNK(""));
            res.write("data: [DONE]\n\n");
            res.end();
          }, SCENARIO_SLOW_MS);
          return;
        }
      }
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      // Unref'd so a leaked handle can never hold the test process open (M-07).
      server.unref();

      resolve({
        port,
        baseUrl: `http://127.0.0.1:${port}/v1`,
        scenario: currentScenario,
        model,
        requests,
        chatRequests: () => requests.filter((r) => /\/chat\/completions$/.test(r.url)),
        waitForChatRequests: (count, timeoutMs = 15_000) =>
          new Promise((res, rej) => {
            const deadline = Date.now() + timeoutMs;
            const tick = (): void => {
              const got = requests.filter((r) => /\/chat\/completions$/.test(r.url));
              if (got.length >= count) {
                res(got.slice(0, count));
                return;
              }
              if (Date.now() > deadline) {
                rej(
                  new Error(
                    `stub: waited ${timeoutMs}ms for ${count} chat request(s), saw ${got.length}; ` +
                      `urls=${JSON.stringify(got.map((r) => r.url))}`,
                  ),
                );
                return;
              }
              setTimeout(tick, 25);
            };
            tick();
          }),
        setScenario: (s) => {
          currentScenario = s;
        },
        isClosed: () => closed,
        close: () =>
          new Promise<void>((res) => {
            if (closed) {
              res();
              return;
            }
            closed = true;
            for (const s of sockets) s.destroy();
            sockets.clear();
            server.close(() => res());
            // A hanging request may keep `close` waiting on destroyed
            // sockets; destroy() above guarantees progress. Belt-and-braces:
            setTimeout(() => res(), 250).unref?.();
          }),
      });
    });
  });
}

export function describeStub(): string {
  return `stub-openai scenarios: ${STUB_SCENARIOS.join(", ")}`;
}
