import { afterEach, describe, expect, test } from "bun:test";
import { AnthropicProvider } from "../../src/providers/native/anthropic.ts";
import {
  redactText,
  normalizeProviderError,
} from "../../src/providers/errors.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import {
  guardedRequest,
  isCancellation,
  isTimeout,
} from "../../src/providers/request-guard.ts";

const originalFetch = globalThis.fetch;
const unregister: Array<() => void> = [];
const oldKey = process.env.XR_TEST_ANTHROPIC_KEY;
const oldBase = process.env.ANTHROPIC_BASE_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const f of unregister.splice(0)) f();
  if (oldKey === undefined) delete process.env.XR_TEST_ANTHROPIC_KEY;
  else process.env.XR_TEST_ANTHROPIC_KEY = oldKey;
  if (oldBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = oldBase;
});

describe("RC-203 credential and complete-request boundary", () => {
  test("auth/rate/server errors never send vendor credentials or prompts to ANTHROPIC_BASE_URL", async () => {
    const key = "fixture-unpatterned-vendor-credential-981";
    unregister.push(
      registerRuntimeSecretResolver((name) =>
        name === "XR_TEST_ANTHROPIC_KEY" ? key : undefined,
      ),
    );
    process.env.ANTHROPIC_BASE_URL = "https://unselected.example/v1";
    for (const status of [401, 429, 503]) {
      const urls: string[] = [];
      globalThis.fetch = (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(key, { status });
      }) as typeof fetch;
      const p = new AnthropicProvider({ apiKeyEnv: "XR_TEST_ANTHROPIC_KEY" });
      let caught: unknown;
      try {
        await p.chat([{ role: "user", content: "private fixture" }], []);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(String(caught)).not.toContain(key);
      expect(urls).toEqual(["https://api.anthropic.com/v1/messages"]);
    }
  });
  test("redacting api_key=value never reinserts the secret as a replacement capture", () => {
    const secret = "UNPATTERNED_VALUE_12345678901234567890";
    expect(redactText(`api_key=${secret}`)).not.toContain(secret);
    expect(
      JSON.stringify(
        normalizeProviderError(
          new Error(`invalid request token=${secret}`),
          "test",
        ),
      ),
    ).not.toContain(secret);
  });
  test("deadline extends beyond response headers through a stalled body", async () => {
    const response = await guardedRequest(
      "fixture",
      { timeoutMs: 30 },
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new TextEncoder().encode('{"partial":'));
            },
          }),
        ),
    );
    let caught: unknown;
    try {
      await response.json();
    } catch (e) {
      caught = e;
    }
    expect(isTimeout(caught)).toBe(true);
  });
  test("cancellation after headers aborts body consumption and remains cancellation", async () => {
    const c = new AbortController();
    const response = await guardedRequest(
      "fixture",
      { signal: c.signal },
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([123]));
            },
          }),
        ),
    );
    c.abort();
    let caught: unknown;
    try {
      await response.text();
    } catch (e) {
      caught = e;
    }
    expect(isCancellation(caught)).toBe(true);
  });
});
