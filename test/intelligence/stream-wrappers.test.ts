/**
 * Phase 14 — the two provider wrappers on the default run path stream.
 *
 * Reproduced live before the fix: `ResilientProvider` and the legacy
 * `FallbackProvider` exposed only `chat()`, so `runModelTurn` fell back to the
 * non-streaming path and the whole reply arrived as ONE token frame after the
 * full generation time. These tests pin the contract that replaced that:
 *
 *   · chunks from the primary are forwarded as they arrive;
 *   · failover happens ONLY when the primary failed before any output;
 *   · a failure after partial output propagates (no stitched answers);
 *   · an abort propagates untouched (no retry of a cancelled turn);
 *   · a fallback without `chatStream` is driven through `chat()`.
 */
import { describe, expect, test } from "bun:test";
import { ResilientProvider } from "../../src/intelligence/degradation.ts";
import { FallbackProvider } from "../../src/intelligence/routing-service.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import { ProviderAbortError } from "../../src/providers/request-guard.ts";
import type { Message, ModelTurn, Provider, ProviderStreamChunk, Tool } from "../../src/core/types.ts";

type Script = Array<ProviderStreamChunk | Error>;

function streaming(id: string, script: Script): Provider & { chatStream: Provider["chat"] extends never ? never : (m: Message[], t: Tool[]) => AsyncGenerator<ProviderStreamChunk> } {
  return {
    id,
    label: id,
    async chat(): Promise<ModelTurn> {
      throw new Error("chat() must not be used when chatStream exists");
    },
    async *chatStream(): AsyncGenerator<ProviderStreamChunk> {
      for (const item of script) {
        if (item instanceof Error) throw item;
        yield item;
      }
    },
    async health() {
      return { ok: true };
    },
  } as unknown as Provider & { chatStream: (m: Message[], t: Tool[]) => AsyncGenerator<ProviderStreamChunk> };
}

function chatOnly(id: string, turn: ModelTurn): Provider {
  return {
    id,
    label: id,
    async chat(): Promise<ModelTurn> {
      return turn;
    },
    async health() {
      return { ok: true };
    },
  } as Provider;
}

async function collect(gen: AsyncGenerator<ProviderStreamChunk>): Promise<ProviderStreamChunk[]> {
  const out: ProviderStreamChunk[] = [];
  for await (const c of gen) out.push(c);
  return out;
}

const MSGS: Message[] = [{ role: "user", content: "count to three" }];

describe("FallbackProvider.chatStream (legacy routing path)", () => {
  test("forwards the primary's chunks as they arrive", async () => {
    const primary = streaming("ollama", [{ text: "one" }, { text: " two" }, { finish: true }]);
    const fallback = streaming("jan", [{ text: "NEVER" }, { finish: true }]);
    const fp = new FallbackProvider(primary, fallback);
    const chunks = await collect(fp.chatStream(MSGS, []));
    expect(chunks.map((c) => c.text ?? (c.finish ? "<finish>" : "?"))).toEqual(["one", " two", "<finish>"]);
  });

  test("fails over only when the primary failed before any output", async () => {
    const primary = streaming("ollama", [new Error("ECONNREFUSED")]);
    const fallback = streaming("jan", [{ text: "from fallback" }, { finish: true }]);
    const fp = new FallbackProvider(primary, fallback);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const chunks = await collect(fp.chatStream(MSGS, []));
      expect(chunks[0]?.text).toBe("from fallback");
    } finally {
      console.warn = warn;
    }
  });

  test("a failure after partial output propagates — never stitches two models", async () => {
    const primary = streaming("ollama", [{ text: "partial" }, new Error("stream reset")]);
    const fallback = streaming("jan", [{ text: "NEVER" }, { finish: true }]);
    const fp = new FallbackProvider(primary, fallback);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const c of fp.chatStream(MSGS, [])) if (c.text) seen.push(c.text);
      })(),
    ).rejects.toThrow("stream reset");
    expect(seen).toEqual(["partial"]);
  });

  test("an abort propagates without consulting the fallback", async () => {
    const primary = streaming("ollama", [new ProviderAbortError("cancelled", "ollama")]);
    let fallbackAsked = false;
    const fallback = {
      ...streaming("jan", [{ text: "NEVER" }, { finish: true }]),
      async *chatStream() {
        fallbackAsked = true;
        yield { text: "NEVER" } as ProviderStreamChunk;
      },
    } as unknown as Provider;
    const fp = new FallbackProvider(primary, fallback);
    await expect(collect(fp.chatStream(MSGS, []))).rejects.toBeInstanceOf(ProviderAbortError);
    expect(fallbackAsked).toBe(false);
  });

  test("a fallback without chatStream is driven through chat()", async () => {
    const primary = streaming("ollama", [new Error("down")]);
    const fallback = chatOnly("jan", {
      message: "complete turn",
      toolCalls: [{ tool: "read_file", args: { path: "a" } }],
      done: true,
      usage: { inTokens: 3, outTokens: 2 },
    });
    const fp = new FallbackProvider(primary, fallback);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const chunks = await collect(fp.chatStream(MSGS, []));
      expect(chunks.find((c) => c.text)?.text).toBe("complete turn");
      expect(chunks.find((c) => c.toolCall)?.toolCall?.tool).toBe("read_file");
      expect(chunks.find((c) => c.usage)?.usage).toEqual({ inTokens: 3, outTokens: 2 });
      expect(chunks.at(-1)?.finish).toBe(true);
    } finally {
      console.warn = warn;
    }
  });
});

describe("ResilientProvider.chatStream (intelligence path)", () => {
  function resilient(primary: Provider, fallback: Provider) {
    return new ResilientProvider(primary, "m1", [{ providerId: "lmstudio", modelId: "m2", reason: "test" }], {
      health: new RoutingHealth(),
      construct: () => fallback,
      localityGuard: () => true,
      sleep: async () => {},
      warn: () => {},
    });
  }

  test("streams the primary token by token", async () => {
    const rp = resilient(
      streaming("ollama", [{ text: "a" }, { text: "b" }, { usage: { inTokens: 1, outTokens: 2 } }, { finish: true }]),
      streaming("lmstudio", [{ text: "NEVER" }, { finish: true }]),
    );
    const chunks = await collect(rp.chatStream(MSGS, []));
    expect(chunks.filter((c) => c.text).map((c) => c.text)).toEqual(["a", "b"]);
    expect(chunks.at(-1)?.finish).toBe(true);
  });

  test("fails over before output, not after it", async () => {
    const before = resilient(
      streaming("ollama", [new Error("ECONNREFUSED")]),
      streaming("lmstudio", [{ text: "fallback" }, { finish: true }]),
    );
    const got = await collect(before.chatStream(MSGS, []));
    expect(got.find((c) => c.text)?.text).toBe("fallback");

    const after = resilient(
      streaming("ollama", [{ text: "half" }, new Error("reset")]),
      streaming("lmstudio", [{ text: "NEVER" }, { finish: true }]),
    );
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const c of after.chatStream(MSGS, [])) if (c.text) seen.push(c.text);
      })(),
    ).rejects.toThrow();
    expect(seen).toEqual(["half"]);
  });
});
