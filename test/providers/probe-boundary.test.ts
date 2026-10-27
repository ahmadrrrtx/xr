import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigSchema } from "../../src/config/config.ts";
import { ServiceRegistry } from "../../src/core/service-registry.ts";
import { Tokens } from "../../src/core/tokens.ts";
import { IntelligenceService } from "../../src/intelligence/service.ts";
import { RoutingHealth } from "../../src/intelligence/health.ts";
import { BehavioralStore } from "../../src/intelligence/behavioral.ts";
import { RoutingSlo } from "../../src/intelligence/slo.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import { CohereProvider } from "../../src/providers/native/cohere.ts";
import { OpenAICompatProvider } from "../../src/providers/openai-compat.ts";
import "../../src/providers/factory.ts";
let dir: string,
  store: WorkspaceStore,
  unregister: () => void,
  savedHome: string | undefined;
const nativeFetch = globalThis.fetch;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-probe-boundary-"));
  savedHome = process.env.XR_HOME;
  process.env.XR_HOME = join(dir, "home");
  store = new WorkspaceStore("default", join(dir, "state.db"));
  unregister = registerRuntimeSecretResolver(() => "deterministic-fake-key");
});
afterEach(() => {
  globalThis.fetch = nativeFetch;
  unregister();
  store.close();
  rmSync(dir, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = savedHome;
});
function service() {
  const r = new ServiceRegistry();
  const cfg = ConfigSchema.parse({
    defaults: { provider: "openai", model: "gpt-6.1-sol" },
  });
  r.registerValue(Tokens.Config, { get: () => cfg } as any);
  r.registerValue(Tokens.Store, store);
  return new IntelligenceService(
    r,
    {},
    {
      health: new RoutingHealth({ file: null }),
      behavioral: new BehavioralStore({ file: null }),
      slo: new RoutingSlo({ file: null }),
    },
  );
}
test("measurement without explicit live AND one exact target is offline, with zero requests", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("must not request");
  }) as unknown as typeof fetch;
  const s = service();
  for (const f of [
    {},
    { providerId: "openai", modelId: "gpt-6.1-sol" },
    { live: true, providerId: "openai" },
  ]) {
    const result = await s.measureModels(f);
    expect(result.measured).toHaveLength(0);
    expect(result.skipped[0].reason).toContain("No probes sent");
  }
  expect(calls).toBe(0);
});
test("explicit synthetic live-contract probe uses bounded output, records every request and saves only actual weak outcomes", async () => {
  const bodies: any[] = [];
  globalThis.fetch = (async (_u: any, init: any) => {
    bodies.push(JSON.parse(init.body));
    return new Response(
      JSON.stringify({
        status: "completed",
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: "synthetic benign answer (not a measured external model)",
              },
            ],
          },
        ],
        usage: { input_tokens: 30, output_tokens: 10 },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  const s = service(),
    result = await s.measureModels({
      providerId: "openai",
      modelId: "gpt-6.1-sol",
      live: true,
    });
  expect(result.skipped).toHaveLength(0);
  expect(result.measured).toHaveLength(1);
  expect(bodies).toHaveLength(7);
  expect(bodies.every((b) => b.max_output_tokens === 1024)).toBe(true);
  expect(result.measured[0].structuredOutputFidelity).toBe(0);
  expect(result.measured[0].toolUseFidelity).toBe(0);
  expect(
    (store.prepare("SELECT COUNT(*) n FROM cost_events").get() as any).n,
  ).toBe(7);
  expect(store.verifyChain().valid).toBe(true);
});
test("failed probe does not continue traffic or store a fake fidelity measurement", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new Response("UNSAFE_REFLECTED_BODY", { status: 401 });
  }) as unknown as typeof fetch;
  const s = service(),
    result = await s.measureModels({
      providerId: "openai",
      modelId: "gpt-6.1-sol",
      live: true,
    });
  expect(result.measured).toHaveLength(0);
  expect(result.skipped).toHaveLength(1);
  expect(calls).toBe(1);
  expect(s.behavioral.contract("openai", "gpt-6.1-sol")).toBeUndefined();
  expect(JSON.stringify(result)).not.toContain("UNSAFE_REFLECTED_BODY");
});
test("Cohere auth failure cannot silently downgrade to a second v1 endpoint or expose its body", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (u: any) => {
    requests.push(String(u));
    return new Response("PRIVATE_PROMPT_OR_CREDENTIAL_BODY", { status: 401 });
  }) as typeof fetch;
  await expect(
    new CohereProvider().chat([{ role: "user", content: "synthetic" }], []),
  ).rejects.toMatchObject({ kind: "authentication_failure" });
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toContain("/v1/");
});
test("real loopback redirect never forwards a model prompt/credential to another endpoint", async () => {
  globalThis.fetch = nativeFetch;
  let received = 0;
  const destination = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      received++;
      return new Response("forbidden");
    },
  });
  const redirector = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.redirect(
        `http://127.0.0.1:${destination.port}/capture`,
        307,
      );
    },
  });
  try {
    const p = new OpenAICompatProvider({
      id: "redirect-fixture",
      label: "fixture",
      model: "m",
      baseUrl: `http://127.0.0.1:${redirector.port}`,
      apiKeyEnv: "FIXTURE_KEY",
    });
    await expect(
      p.chat([{ role: "user", content: "SYNTHETIC_PRIVATE_PROMPT" }], [], {
        timeoutMs: 500,
      }),
    ).rejects.toThrow();
    expect(received).toBe(0);
  } finally {
    redirector.stop(true);
    destination.stop(true);
  }
});
