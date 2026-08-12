/**
 * XR — provider request guard (audit GAP-001 · P0).
 *
 * These tests deliberately run against a REAL HTTP server that stalls, rather
 * than a stubbed provider object. The defect being pinned was in the transport
 * layer — `fetch()` called with no `signal` — so a test that mocks the provider
 * would pass while the bug remained. What must be proven is that a socket which
 * never answers cannot hang the runtime, and that Ctrl+C reaches that socket.
 *
 * Pinned behavior:
 *   1. a stalled provider terminates on the timeout instead of hanging;
 *   2. a caller AbortSignal aborts an in-flight call promptly;
 *   3. cancellation and timeout are reported as DIFFERENT, honest causes;
 *   4. an already-aborted signal never opens a connection at all;
 *   5. normal requests are entirely unaffected.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";
import {
  guardedRequest,
  ProviderAbortError,
  isCancellation,
  isTimeout,
  resolveTimeoutMs,
  setConfiguredRequestTimeout,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "../../src/providers/request-guard.ts";

let server: ReturnType<typeof Bun.serve>;
let baseUrl = "";
/** Connections the stalling endpoint is currently holding open. */
let openStalls = 0;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 60,
    async fetch(req) {
      const url = new URL(req.url);

      // Never answers until the client goes away — the exact production
      // failure mode (connection accepted, response never produced).
      if (url.pathname.startsWith("/stall")) {
        openStalls++;
        try {
          await new Promise((resolve) => setTimeout(resolve, 30_000));
        } finally {
          openStalls--;
        }
        return Response.json({ choices: [{ message: { content: "too late" } }] });
      }

      return Response.json({
        id: "ok",
        choices: [
          {
            message: { content: JSON.stringify({ message: "hi", tool_calls: [], done: true }) },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  setConfiguredRequestTimeout(undefined);
  server.stop(true);
});

describe("GAP-001 — timeout resolution", () => {
  test("defaults to the built-in ceiling; never unbounded", () => {
    setConfiguredRequestTimeout(undefined);
    delete process.env.XR_PROVIDER_TIMEOUT_MS;
    expect(resolveTimeoutMs()).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    // Zero/negative are refused rather than treated as "no limit".
    expect(resolveTimeoutMs(0)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
    expect(resolveTimeoutMs(-1)).toBe(DEFAULT_REQUEST_TIMEOUT_MS);
  });

  test("explicit > env > config > default", () => {
    setConfiguredRequestTimeout(5_000);
    expect(resolveTimeoutMs()).toBe(5_000);

    process.env.XR_PROVIDER_TIMEOUT_MS = "7000";
    expect(resolveTimeoutMs()).toBe(7_000);
    expect(resolveTimeoutMs(1_234)).toBe(1_234);

    delete process.env.XR_PROVIDER_TIMEOUT_MS;
    setConfiguredRequestTimeout(undefined);
  });
});

describe("GAP-001 — guardedRequest against a real stalling socket", () => {
  test("a stalled request times out instead of hanging", async () => {
    const started = Date.now();
    const promise = guardedRequest("test-provider", { timeoutMs: 300 }, (signal) =>
      fetch(`${baseUrl}/stall`, { signal }),
    );

    await expect(promise).rejects.toThrow(ProviderAbortError);
    // Bounded: it returns on its own, long before the server's 30s stall.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("timeout is reported as a timeout, not as a cancellation", async () => {
    try {
      await guardedRequest("test-provider", { timeoutMs: 200 }, (signal) =>
        fetch(`${baseUrl}/stall`, { signal }),
      );
      throw new Error("expected the guarded request to reject");
    } catch (e) {
      expect(isTimeout(e)).toBe(true);
      expect(isCancellation(e)).toBe(false);
      expect((e as ProviderAbortError).providerId).toBe("test-provider");
      expect((e as Error).message).toContain("timed out");
    }
  });

  test("a caller signal aborts an in-flight request promptly", async () => {
    const controller = new AbortController();
    const started = Date.now();
    // Generous timeout: the abort — not the deadline — must end this call.
    const promise = guardedRequest("test-provider", { signal: controller.signal, timeoutMs: 30_000 }, (signal) =>
      fetch(`${baseUrl}/stall`, { signal }),
    );
    setTimeout(() => controller.abort(), 150);

    try {
      await promise;
      throw new Error("expected the guarded request to reject");
    } catch (e) {
      expect(isCancellation(e)).toBe(true);
      expect(isTimeout(e)).toBe(false);
      expect((e as Error).message).toContain("cancelled");
    }
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("an already-aborted signal never opens a connection", async () => {
    const before = openStalls;
    const controller = new AbortController();
    controller.abort();

    await expect(
      guardedRequest("test-provider", { signal: controller.signal }, (signal) =>
        fetch(`${baseUrl}/stall`, { signal }),
      ),
    ).rejects.toThrow(ProviderAbortError);

    // No new stalled connection was created.
    expect(openStalls).toBe(before);
  });

  test("successful requests are unaffected", async () => {
    const res = await guardedRequest("test-provider", { timeoutMs: 10_000 }, (signal) =>
      fetch(`${baseUrl}/v1/chat/completions`, { method: "POST", body: "{}", signal }),
    );
    expect(res.ok).toBe(true);
  });
});

describe("GAP-001 — OpenAICompatProvider.chat is bounded and cancellable", () => {
  test("chat() against a stalling endpoint rejects on timeout", async () => {
    const provider = new OpenAICompatProvider({
      id: "stall-test",
      label: "Stall Test",
      baseUrl: `${baseUrl}/stall`,
      model: "test-model",
    });

    const started = Date.now();
    await expect(
      provider.chat([{ role: "user", content: "hello" }], [], { timeoutMs: 300 }),
    ).rejects.toThrow(ProviderAbortError);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  test("chat() honors a caller AbortSignal", async () => {
    const provider = new OpenAICompatProvider({
      id: "stall-test",
      label: "Stall Test",
      baseUrl: `${baseUrl}/stall`,
      model: "test-model",
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);

    try {
      await provider.chat([{ role: "user", content: "hello" }], [], {
        signal: controller.signal,
        timeoutMs: 30_000,
      });
      throw new Error("expected chat() to reject");
    } catch (e) {
      expect(isCancellation(e)).toBe(true);
    }
  });

  test("chat() still works normally with the guard in place", async () => {
    const provider = new OpenAICompatProvider({
      id: "ok-test",
      label: "OK Test",
      baseUrl,
      model: "test-model",
    });

    const turn = await provider.chat([{ role: "user", content: "hello" }], []);
    expect(turn.message).toBe("hi");
    expect(turn.done).toBe(true);
  });
});
