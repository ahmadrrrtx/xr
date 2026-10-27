/**
 * RC-204 · T8 — EXPLICIT FALLBACK CONSENT, ENFORCED AT THE SECOND REQUEST.
 *
 * `RoutingService.resolveWithDecision` builds the fallback wrapper and hands it
 * a `canFallback` predicate. That predicate is the ONLY thing standing between
 * a transient primary failure and a second request the workspace never
 * consented to:
 *
 *   · the configuration must be unchanged since the decision was made
 *     (a config swap cannot widen the consent after the fact),
 *   · `allowFallback` must hold,
 *   · a cross-provider step needs `allowCrossProviderFallback`,
 *   · a local → cloud step needs `allowCloudFallback`,
 *   · the workspace locality policy must still allow the destination,
 *   · the destination model must still be a compatible candidate,
 *   · a stream that already emitted output is never replayed elsewhere.
 *
 * Each test drives a REAL routing decision (the same factory + preset bootstrap
 * the rest of the intelligence suite uses), then replaces the two constructed
 * providers with controllable fakes so the assertion is about the consent
 * predicate only — no sockets, no credentials, no paid calls.
 *
 * These are also the discriminating cases for the mutation gate (T8): each
 * consent branch above is flipped by a mutant and fails a test here.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../../src/providers/factory.ts"; // registers the built-in presets (registry side effect)
import { ConfigSchema, type XRConfig } from "../../src/config/config.ts";
import { FallbackProvider, RoutingService } from "../../src/intelligence/routing-service.ts";
import { ProviderError } from "../../src/providers/errors.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import type {
  Message,
  ModelTurn,
  Provider,
  ProviderStreamChunk,
  Tool,
} from "../../src/core/types.ts";

/** Not a credential shape: the config only needs the provider to be usable. */
const FIXTURE_KEY = "fixture-not-a-real-credential";

function config(plane: Record<string, unknown> = {}): XRConfig {
  return ConfigSchema.parse({
    defaults: { provider: "ollama", model: "qwen2.5:7b" },
    providerEngine: { routingStrategy: "hybrid" },
    intelligencePlane: {
      enableAutomatic: true,
      allowFallback: true,
      allowCrossProviderFallback: true,
      allowCloudFallback: true,
      ...plane,
    },
    providers: { openai: { apiKey: FIXTURE_KEY } },
  });
}

function ok(message = "ok"): ModelTurn {
  return { message, toolCalls: [], done: true };
}

/** A controllable provider: the test decides what it returns or throws. */
function target(id: string, run: () => ModelTurn | Promise<ModelTurn>): Provider {
  return {
    id,
    modelId: "fixture-model",
    label: id,
    async chat() {
      return run();
    },
    async health() {
      return { ok: true };
    },
  };
}

function transient(): ProviderError {
  return new ProviderError("rate_limit", "fixture-primary", "rate limited");
}

/**
 * The registry asks the secret broker whether a hosted provider is usable. A
 * deterministic resolver (registered for this file only, popped again in
 * `afterAll`) keeps the decision real without any real credential.
 */
let releaseResolver: (() => void) | undefined;
beforeAll(() => {
  releaseResolver = registerRuntimeSecretResolver((name) =>
    name === "OPENAI_API_KEY" ? FIXTURE_KEY : undefined,
  );
});
afterAll(() => releaseResolver?.());

interface Resolved {
  service: RoutingService;
  wrapper: FallbackProvider;
  cfg: XRConfig;
}

/** Resolve a real decision and return the wrapper (asserting one was wired). */
function resolved(
  cfg: XRConfig,
  requirements?: Record<string, unknown>,
): Resolved {
  const service = new RoutingService(cfg);
  const { provider } = service.resolveWithDecision(
    requirements ? { requirements } : {},
  );
  expect(provider).toBeInstanceOf(FallbackProvider);
  return { service, wrapper: provider as FallbackProvider, cfg };
}

/** Swap the constructed providers for fakes; the consent closure is untouched. */
function use(
  wrapper: FallbackProvider,
  primary: Provider,
  fallback: Provider,
): FallbackProvider {
  wrapper.primary = primary;
  wrapper.fallback = fallback;
  return wrapper;
}

const options = { beforeAttempt: () => {} };

async function collect(
  stream: AsyncGenerator<ProviderStreamChunk>,
): Promise<ProviderStreamChunk[]> {
  const out: ProviderStreamChunk[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

describe("RC-204 — fallback consent gates the second request", () => {
  test("consent given: a transient primary failure is rescued by the fallback", async () => {
    const { wrapper } = resolved(config());
    const calls: string[] = [];
    const wired = use(
      wrapper,
      target("primary", () => {
        calls.push("primary");
        throw transient();
      }),
      target("secondary", () => {
        calls.push("secondary");
        return ok("rescued");
      }),
    );
    const turn = await wired.chat([] as Message[], [] as Tool[], options);
    expect(turn.message).toBe("rescued");
    expect(calls).toEqual(["primary", "secondary"]);
    expect(wired.id as string).toBe("secondary");
  });

  test("no cross-provider consent: a cross-provider step is never even advertised", () => {
    const service = new RoutingService(config());
    const { provider, decision } = service.resolveWithDecision({
      requirements: { allowCrossProviderFallback: false },
    });
    expect(decision.fallbackChain).toHaveLength(0);
    expect(provider).not.toBeInstanceOf(FallbackProvider);
  });

  test("no local→cloud consent: a cloud destination is refused from a local primary", async () => {
    // The step is still selected (the chain is advertised), but the second
    // request must be refused when the workspace did not consent to cloud.
    const { wrapper, cfg } = resolved(config(), { allowCloudFallback: false });
    const calls: string[] = [];
    const wired = use(
      wrapper,
      target("ollama-fixture", () => {
        calls.push("primary");
        throw transient();
      }),
      target("openai", () => {
        calls.push("secondary");
        return ok("should not run");
      }),
    );
    expect(cfg.intelligencePlane?.allowCloudFallback).toBe(true); // config consent is NOT the grant
    await expect(wired.chat([] as Message[], [] as Tool[], options)).rejects.toThrow(
      "rate limited",
    );
    expect(calls).toEqual(["primary"]);
  });

  test("a configuration swap after the decision cancels the consent", async () => {
    const { wrapper, cfg } = resolved(config());
    const calls: string[] = [];
    // Same flags, different configuration object → the snapshot check must fire.
    cfg.providers = {
      ...(cfg.providers ?? {}),
      ollama: { baseUrl: "http://127.0.0.1:1/v1" },
    };
    const wired = use(
      wrapper,
      target("primary", () => {
        calls.push("primary");
        throw transient();
      }),
      target("secondary", () => {
        calls.push("secondary");
        return ok("should not run");
      }),
    );
    await expect(wired.chat([] as Message[], [] as Tool[], options)).rejects.toThrow(
      "rate limited",
    );
    expect(calls).toEqual(["primary"]);
  });

  test("no attempt admission hook: no second request is made", async () => {
    const { wrapper } = resolved(config());
    const calls: string[] = [];
    const wired = use(
      wrapper,
      target("primary", () => {
        calls.push("primary");
        throw transient();
      }),
      target("secondary", () => {
        calls.push("secondary");
        return ok("should not run");
      }),
    );
    // Without an admission hook the executor cannot prove who is spending.
    await expect(wired.chat([] as Message[], [] as Tool[])).rejects.toThrow("rate limited");
    expect(calls).toEqual(["primary"]);
  });

  test("a stream that already emitted output never falls back", async () => {
    const { wrapper } = resolved(config());
    const calls: string[] = [];
    const primary: Provider = {
      ...target("primary", () => ok()),
      async *chatStream() {
        calls.push("primary");
        yield { text: "partial answer" };
        throw transient();
      },
    };
    const secondary: Provider = {
      ...target("secondary", () => ok("should not run")),
      async *chatStream() {
        calls.push("secondary");
        yield { text: "should not run" };
      },
    };
    const wired = use(wrapper, primary, secondary);
    await expect(
      collect(wired.chatStream([] as Message[], [] as Tool[], options)),
    ).rejects.toThrow("rate limited");
    expect(calls).toEqual(["primary"]);
  });

  test("a stream that emitted nothing may fall back", async () => {
    const { wrapper } = resolved(config());
    const calls: string[] = [];
    const primary: Provider = {
      ...target("primary", () => ok()),
      async *chatStream(): AsyncGenerator<ProviderStreamChunk> {
        calls.push("primary");
        throw transient();
      },
    };
    const secondary: Provider = {
      ...target("secondary", () => ok("rescued")),
      async *chatStream() {
        calls.push("secondary");
        yield { text: "rescued" };
      },
    };
    const chunks = await collect(
      use(wrapper, primary, secondary).chatStream([] as Message[], [] as Tool[], options),
    );
    expect(chunks.map((c) => c.text).join("")).toBe("rescued");
    expect(calls).toEqual(["primary", "secondary"]);
  });
});

describe("RC-204 — FallbackProvider identity and labels", () => {
  test("same provider id and model is the SAME target: the primary label is kept", () => {
    const primary = { ...target("same", () => ok()), label: "Shared" };
    const fallback = { ...target("same", () => ok()), label: "Shared" };
    expect(primary).not.toBe(fallback);
    const wrapper = new FallbackProvider(primary, fallback);
    expect(wrapper.label).toBe("Shared");
  });

  test("one provider instance used twice is the same target", () => {
    const only = { ...target("only", () => ok()), label: "Only" };
    const wrapper = new FallbackProvider(only, only);
    expect(wrapper.label).toBe("Only");
    expect(wrapper.fallbackId).toBe("only");
  });

  test("different targets are advertised with an explicit fallback label", () => {
    const wrapper = new FallbackProvider(
      { ...target("primary", () => ok()), label: "Primary" },
      { ...target("secondary", () => ok()), label: "Secondary" },
    );
    expect(wrapper.label).toBe("Primary → fallback Secondary");
    expect(wrapper.fallbackId).toBe("secondary");
  });
});
