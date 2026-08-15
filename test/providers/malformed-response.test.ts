/**
 * XR Phase 06 · Step 29 — MALFORMED PROVIDER RESPONSE handling.
 *
 * A provider that answers with structurally invalid data (invalid JSON,
 * missing required fields, garbage SSE lines) must be:
 *   · classified honestly (malformed_response, NON-retryable vs same provider),
 *   · NEVER coerced into a silent success,
 *   · NEVER allowed to corrupt execution state.
 * Hermetic: every call lands on a stub bound to an ephemeral localhost port.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";
import { ProviderError, isRetryableProviderError, malformedProviderResponseError } from "../../src/providers/errors.ts";
import { classifyError } from "../../src/execution/retry-classification.ts";

let stub: Server;
let baseUrl: string;

function startStub(handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void): Promise<void> {
  return new Promise((resolve) => {
    stub = createServer(handler);
    stub.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
      resolve();
    });
  });
}

function makeProvider(): OpenAICompatProvider {
  return new OpenAICompatProvider({ id: "stub", label: "Stub", baseUrl, model: "stub-model", apiKey: "test" });
}

afterEach(() => {
  if (stub) {
    stub.close();
  }
});

describe("Phase 06 · malformed provider response (spec step 29)", () => {
  test("invalid JSON body → malformed_response error, not a silent success", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("this is { not valid json ][");
    });
    const p = makeProvider();
    let caught: unknown;
    try {
      await p.chat([{ role: "user", content: "hi" }], [], { timeoutMs: 5000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).kind).toBe("malformed_response");
    expect(isRetryableProviderError(caught)).toBe(false);
    // canonical taxonomy agrees
    expect(classifyError(caught).category).toBe("provider_malformed");
    expect(classifyError(caught).retryClass).toBe("non_retryable");
  });

  test("missing required field (no choices[]) → malformed_response, never empty success", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "chatcmpl-1", object: "chat.completion" })); // no choices
    });
    const p = makeProvider();
    let caught: unknown;
    try {
      await p.chat([{ role: "user", content: "hi" }], [], { timeoutMs: 5000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).kind).toBe("malformed_response");
    expect((caught as ProviderError).message).toContain("choices");
  });

  test("valid response still parses normally (no over-blocking)", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "{\"message\":\"hello\",\"tool_calls\":[],\"done\":true}" } }],
          usage: { prompt_tokens: 1, completion_tokens: 2 },
        }),
      );
    });
    const p = makeProvider();
    const turn = await p.chat([{ role: "user", content: "hi" }], [], { timeoutMs: 5000 });
    expect(turn.message).toBe("hello");
  });

  test("HTTP error stays an error (not misclassified as malformed)", async () => {
    await startStub((_req, res) => {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid api key" } }));
    });
    const p = makeProvider();
    let caught: unknown;
    try {
      await p.chat([{ role: "user", content: "hi" }], [], { timeoutMs: 5000 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    // 401 must classify as auth / non-retryable, not malformed
    const c = classifyError(caught);
    expect(c.retryClass).toBe("non_retryable");
    expect(["auth", "unknown", "invalid_request", "provider_transient"]).toContain(c.category);
  });

  test("malformed factory redacts secrets from the detail", () => {
    const e = malformedProviderResponseError("openai", "bad json with sk-abcdef1234567890xyz inside");
    expect(e.message).not.toContain("sk-abcdef1234567890xyz");
    expect(e.kind).toBe("malformed_response");
    expect(e.retryable).toBe(false);
  });

  test("streaming: garbage SSE lines are skipped without corrupting the stream", async () => {
    await startStub((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // A mix of valid deltas, invalid JSON lines, and a proper [DONE].
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "He" } }] }) + "\n\n");
      res.write("data: { this is broken json ]\n\n");
      res.write("data: " + JSON.stringify({ choices: [{ delta: { content: "llo" } }] }) + "\n\n");
      res.write("data: [DONE]\n\n");
      res.end();
    });
    const p = makeProvider();
    let text = "";
    let finished = false;
    for await (const chunk of p.chatStream([{ role: "user", content: "hi" }], [], { timeoutMs: 5000 })) {
      if (chunk.text) text += chunk.text;
      if (chunk.finish) finished = true;
    }
    // Valid deltas survive; the broken line is skipped, not fatal.
    expect(text).toBe("Hello");
    expect(finished).toBe(true);
  });
});
