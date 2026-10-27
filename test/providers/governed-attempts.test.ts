/** RC-204/206/302: real envelope, registry tools, SQLite audit/cost rows;
 * deterministic HTTP only. These are NOT live provider or OS-sandbox claims. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import {
  assembleEnvelope,
  newEvidence,
} from "../../src/core/execution/envelope.ts";
import { runEnvelope } from "../../src/core/execution/runner.ts";
import { ToolRegistryService } from "../../src/tools/registry-service.ts";
import { coreToolContributions } from "../../src/tools/registry.ts";
import { OpenAIResponsesProvider } from "../../src/providers/native/openai-responses.ts";
import { AnthropicProvider } from "../../src/providers/native/anthropic.ts";
import { GoogleProvider } from "../../src/providers/native/google.ts";
import { registerRuntimeSecretResolver } from "../../src/security/secret-broker.ts";
import { ConfigSchema } from "../../src/config/config.ts";
import { buildCatalog } from "../../src/intelligence/catalog.ts";
import { IntelligenceRouter } from "../../src/intelligence/router.ts";
import {
  localityForKind,
  descriptorFromPreset,
} from "../../src/intelligence/capability.ts";
import { resolveFallbackChain } from "../../src/providers/fallback-chain.ts";
import { FallbackProvider } from "../../src/intelligence/routing-service.ts";
import { CostGovernor, type Budget } from "../../src/cost/governor.ts";
import { priceFor } from "../../src/cost/pricing.ts";
import { attemptControls } from "../../src/core/model-accounting.ts";
import { chatAttempt, streamAttempt } from "../../src/providers/attempts.ts";
import type { ModelTurn, Provider } from "../../src/core/types.ts";
import "../../src/providers/factory.ts";
let dir: string, store: WorkspaceStore;
let unregister: () => void;
const originalFetch = globalThis.fetch;
let savedHome: string | undefined;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "xr-governed-native-"));
  savedHome = process.env.XR_HOME;
  process.env.XR_HOME = join(dir, "home");
  store = new WorkspaceStore("default", join(dir, "state.db"));
  unregister = registerRuntimeSecretResolver(
    () => "deterministic-fake-credential",
  );
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  unregister();
  store.close();
  rmSync(dir, { recursive: true, force: true });
  if (savedHome === undefined) delete process.env.XR_HOME;
  else process.env.XR_HOME = savedHome;
});
function scripted(
  id: string,
  modelId: string,
  run: () => Promise<ModelTurn> | ModelTurn,
): Provider {
  return {
    id,
    modelId,
    label: id,
    async chat() {
      return run();
    },
    async health() {
      return { ok: true };
    },
  };
}
function controlsFor(
  provider: Provider,
  budget: Budget = { maxUsd: 1, maxTokens: 50_000 },
  rates = priceFor(provider.id, provider.modelId!),
) {
  const governor = new CostGovernor(budget, rates);
  const costs: any[] = [],
    events: any[] = [];
  const controls = attemptControls({
    provider,
    pricingTarget: { id: provider.id, model: provider.modelId },
    pricing: rates,
    governor,
    budget,
    sessionId: "unit",
    step: 0,
    messages: [{ role: "user", content: "synthetic request" }],
    tools: [],
    audit: (event, detail) => events.push({ event, ...detail }),
    recordCost: (provider, model, input, output, usd, source) =>
      costs.push({ provider, model, input, output, usd, source }),
  });
  return { controls, governor, costs, events };
}
for (const kind of ["openai", "anthropic", "google"] as const) {
  test(`${kind}: governed two-turn native tool roundtrip executes/correlates BOTH identical calls and settles twice`, async () => {
    const target = join(dir, "native-effect.txt"),
      args = { path: target, content: "real native tool effect" },
      ids = ["native_A", "native_B"];
    const providers = {
      openai: new OpenAIResponsesProvider({ model: "gpt-6.1-sol" }),
      anthropic: new AnthropicProvider(),
      google: new GoogleProvider(),
    };
    const p = providers[kind],
      bodies: any[] = [];
    const responses =
      kind === "openai"
        ? [
            {
              status: "completed",
              output: [
                {
                  type: "reasoning",
                  encrypted_content: "OPAQUE_NATIVE",
                  summary: [],
                },
                ...ids.map((call_id) => ({
                  type: "function_call",
                  call_id,
                  id: `fc_${call_id}`,
                  name: "write_file",
                  arguments: JSON.stringify(args),
                })),
              ],
              usage: { input_tokens: 40, output_tokens: 10 },
            },
            {
              status: "completed",
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "native completed" }],
                },
              ],
              usage: { input_tokens: 60, output_tokens: 12 },
            },
          ]
        : kind === "anthropic"
          ? [
              {
                content: [
                  {
                    type: "thinking",
                    thinking: "",
                    signature: "OPAQUE_NATIVE",
                  },
                  ...ids.map((id) => ({
                    type: "tool_use",
                    id,
                    name: "write_file",
                    input: args,
                  })),
                ],
                stop_reason: "tool_use",
                usage: { input_tokens: 40, output_tokens: 10 },
              },
              {
                content: [{ type: "text", text: "native completed" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 60, output_tokens: 12 },
              },
            ]
          : [
              {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: {
                      parts: ids.map((id) => ({
                        functionCall: { id, name: "write_file", args },
                        thoughtSignature: "OPAQUE_NATIVE",
                      })),
                    },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 40,
                  candidatesTokenCount: 10,
                  thoughtsTokenCount: 3,
                },
              },
              {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: "native completed" }] },
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 60,
                  candidatesTokenCount: 12,
                },
              },
            ];
    globalThis.fetch = (async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(responses.shift()), {
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;
    const tools = new ToolRegistryService();
    tools.registerTools(coreToolContributions());
    let approvals = 0;
    const env = assembleEnvelope({
      intent: {
        task: "write the same disposable fixture twice",
        mode: "agent",
        surface: "test",
        cwd: dir,
      },
      plan: { provider: p, providerId: p.id, modelId: p.modelId, maxSteps: 3 },
      policy: {
        budget: { maxUsd: 0.25, maxTokens: 30_000 },
        pricing: priceFor(p.id, p.modelId),
        egressAllowlist: [],
        dryRun: false,
        toolsAllow: ["write_file"],
        approve: async () => {
          approvals++;
          return true;
        },
      },
      placement: {
        placement: "in_process",
        registry: tools,
        tools: tools.discover({ mode: "agent" }),
        collisions: [],
      },
      observation: { say() {} },
      evidence: newEvidence(),
    });
    const result = await runEnvelope(env, { store });
    expect(result.stopped).toBe("done");
    expect(result.finalMessage).toBe("native completed");
    expect(readFileSync(target, "utf8")).toBe("real native tool effect");
    expect(approvals).toBe(2);
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain("OPAQUE_NATIVE");
    for (const id of ids) expect(JSON.stringify(bodies[1])).toContain(id);
    const rows = store
      .prepare(
        "SELECT provider,model,in_tokens,out_tokens,usage_source AS source FROM cost_events WHERE session_id=?",
      )
      .all(result.sessionId) as any[];
    expect(rows).toHaveLength(2);
    expect(
      rows.every(
        (r) =>
          r.provider === p.id &&
          r.model === p.modelId &&
          r.source === "provider",
      ),
    ).toBe(true);
    expect(rows[0].out_tokens).toBe(kind === "google" ? 13 : 10);
    expect(store.verifyChain().valid).toBe(true);
    expect(
      (
        store
          .prepare(
            "SELECT COUNT(*) n FROM audit_log WHERE event='provider.attempt.settled'",
          )
          .get() as any
      ).n,
    ).toBe(2);
  });
}
test("failed primary and admitted fallback settle independently under their actual prices, not final-model repricing", async () => {
  const primary = scripted("openai", "gpt-6.1-sol", () => {
    throw new Error("HTTP 503");
  });
  const fallback = scripted("anthropic", "claude-sonnet-5-5", () => ({
    message: "recovered",
    done: true,
    toolCalls: [],
    usage: { inTokens: 10, outTokens: 20 },
  }));
  const wrapper = new FallbackProvider(primary, fallback, {
    canFallback: () => true,
  });
  const { controls, costs, governor } = controlsFor(wrapper);
  const t = await wrapper.chat([], [], controls);
  expect(t.executing).toEqual({
    providerId: "anthropic",
    modelId: "claude-sonnet-5-5",
  });
  expect(costs.map((c) => [c.provider, c.source])).toEqual([
    ["openai", "estimated"],
    ["anthropic", "provider"],
  ]);
  expect(costs[0].output).toBe(4096);
  const r = priceFor("anthropic", "claude-sonnet-5-5");
  expect(costs[1].usd).toBe((10 * r.inPerMTok + 20 * r.outPerMTok) / 1e6);
  expect(governor.snapshot().usd).toBeCloseTo(costs[0].usd + costs[1].usd, 10);
  governor.close();
});
test("unknown price or estimated budget refusal sends ZERO requests and records no fictional usage", async () => {
  let calls = 0;
  for (const [pid, mid, maxUsd] of [
    ["unknown-price", "m", 1],
    ["unknown-price", "m", undefined],
    ["openai", "gpt-6.1-sol", 0.000001],
  ] as const) {
    const p = scripted(pid, mid, () => {
      calls++;
      return { message: "never", done: true, toolCalls: [] };
    });
    const { controls, costs, governor } = controlsFor(p, {
      maxUsd,
      maxTokens: 50_000,
    });
    await expect(chatAttempt(p, [], [], controls)).rejects.toMatchObject({
      name: "ProviderBudgetAdmissionError",
    });
    expect(costs).toHaveLength(0);
    governor.close();
  }
  expect(calls).toBe(0);
});
test("revoked fallback consent stops a second request; a hook alone is not consent", async () => {
  let primaryCalls = 0,
    secondaryCalls = 0;
  const a = scripted("openai", "gpt-6.1-sol", () => {
    primaryCalls++;
    throw new Error("HTTP 503");
  });
  const b = scripted("anthropic", "claude-sonnet-5-5", () => {
    secondaryCalls++;
    return { message: "never", toolCalls: [], done: true };
  });
  const p = new FallbackProvider(a, b, { canFallback: () => false });
  const { controls, costs, governor } = controlsFor(p);
  await expect(p.chat([], [], controls)).rejects.toThrow();
  expect(primaryCalls).toBe(1);
  expect(secondaryCalls).toBe(0);
  expect(costs).toHaveLength(1);
  governor.close();
});
test("cost/audit settlement failure is terminal, even if its cause says unavailable", async () => {
  let fallbackCalls = 0;
  const a = scripted("a", "m", () => ({
    message: "paid",
    done: true,
    toolCalls: [],
  }));
  const b = scripted("b", "m", () => {
    fallbackCalls++;
    return { message: "never", done: true, toolCalls: [] };
  });
  await expect(
    new FallbackProvider(a, b, { canFallback: () => true }).chat([], [], {
      beforeAttempt() {},
      afterAttempt() {
        throw new Error("database unavailable");
      },
    }),
  ).rejects.toMatchObject({ name: "ProviderAccountingError" });
  expect(fallbackCalls).toBe(0);
});
test("consumer-stopped stream is accounted as incomplete estimated usage, not a free successful turn", async () => {
  const p: Provider = {
    ...scripted("fixture", "m", () => ({
      message: "unused",
      toolCalls: [],
      done: true,
    })),
    capabilities: {
      streaming: true,
      toolUse: false,
      functionCalling: false,
      jsonMode: false,
    },
    async *chatStream() {
      yield { text: "partial" };
      yield { finish: true };
    },
  };
  const { controls, costs, governor } = controlsFor(p, undefined, {
    inPerMTok: 1,
    outPerMTok: 2,
    source: "deterministic explicit fixture rates",
  });
  for await (const _c of streamAttempt(p, [], [], controls)) break;
  expect(costs).toHaveLength(1);
  expect(costs[0].source).toBe("estimated");
  expect(costs[0].output).toBe(4096);
  governor.close();
});
test("request any never relaxes workspace local_only; offline fallback options are restrictive too", async () => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error("forbidden request");
  }) as unknown as typeof fetch;
  const config = ConfigSchema.parse({
    defaults: { provider: "openai", model: "gpt-6.1-sol" },
    intelligencePlane: { localityPolicy: "local_only" },
  });
  const d = new IntelligenceRouter().route(config, {
    provider: "openai",
    model: "gpt-6.1-sol",
    requirements: { localityPolicy: "any" },
  }).decision;
  expect(d.unavailable).toBe(true);
  expect(
    d.rejected.some((r) => r.reasons.some((x) => x.code === "locality_policy")),
  ).toBe(true);
  const any = ConfigSchema.parse({ defaults: config.defaults });
  expect(
    (await resolveFallbackChain(any, { localityPolicy: "local_only" })).steps,
  ).toHaveLength(0);
  expect(calls).toBe(0);
});
test("public custom/.local and remote Ollama overrides are not private/local/free; credentials are not health", () => {
  for (const baseUrl of [
    "https://public.example/v1",
    "http://service.local/v1",
  ])
    expect(
      descriptorFromPreset(
        {
          id: "custom",
          label: "Custom",
          kind: "custom",
          tier: "cheap",
          baseUrl,
          defaultModel: "m",
          knownModels: ["m"],
          capabilities: { chat: true },
        },
        true,
      ).locality.locality,
    ).toBe("cloud");
  expect(
    localityForKind("local", "ollama", "https://public.example/v1").locality,
  ).toBe("cloud");
  expect(
    localityForKind("local", "ollama", "http://127.0.0.1:11434/v1").locality,
  ).toBe("local");
  const c = ConfigSchema.parse({
    providers: { ollama: { baseUrl: "https://public.example/v1" } },
  });
  const remote = buildCatalog(c).models.find(
    (m) => m.providerId === "ollama" && m.modelId === c.defaults.model,
  )!;
  expect(remote.locality.locality).toBe("cloud");
  expect(remote.cost.free).toBe(false);
  expect(remote.cost.inPerMTok).toBeUndefined();
  const cloud = buildCatalog(
    ConfigSchema.parse({
      defaults: { provider: "openai", model: "gpt-6.1-sol" },
    }),
  ).models.find((m) => m.key === "openai/gpt-6.1-sol")!;
  expect(cloud.credentialAvailable).toBe(true);
  expect(cloud.health?.authOk).toBeUndefined();
  expect(cloud.health?.ok).toBeUndefined();
  expect(cloud.evidence?.reachable).toBe("unknown");
});

test("metrics decorator preserves managed attempts/actual fallback identity; telemetry failure cannot replay or double-settle",async()=>{
  const {withTurnMetrics}=await import('../../src/providers/stream-metrics');
  let primaryCalls=0,fallbackCalls=0;
  const primary=scripted('openai','gpt-6.1-sol',()=>{primaryCalls++;throw Object.assign(new Error('opaque transport failure'),{code:'ConnectionRefused'});});
  const fallback=scripted('anthropic','claude-sonnet-5-5',()=>{fallbackCalls++;return {message:'decorated recovery',done:true,toolCalls:[],usage:{inTokens:10,outTokens:20}};});
  const decorated=withTurnMetrics(new FallbackProvider(primary,fallback,{canFallback:()=>true}),{record(){throw new Error('metrics unavailable, not a provider failure');}} as any,'gpt-6.1-sol');
  expect(decorated.managesAttempts).toBe(true);
  const registry=new ToolRegistryService();
  const e=assembleEnvelope({intent:{task:'decorated fixture',mode:'ask',surface:'test',cwd:dir},plan:{provider:decorated,providerId:primary.id,modelId:primary.modelId!,maxSteps:2},policy:{budget:{maxUsd:1,maxTokens:100_000},pricing:priceFor(primary.id,primary.modelId!),egressAllowlist:[],dryRun:false,approve:async()=>false},placement:{placement:'in_process',registry,tools:[],collisions:[]},observation:{say(){}},evidence:newEvidence()});
  const events:any[]=[];const result=await runEnvelope(e,{store},{onStreamEvent:e=>events.push(e)});
  expect(result.stopped).toBe('done');expect(result.finalMessage).toBe('decorated recovery');expect([primaryCalls,fallbackCalls]).toEqual([1,1]);
  expect(decorated.id).toBe(fallback.id);expect(decorated.modelId).toBe(fallback.modelId);
  const rows=store.prepare('SELECT provider,model,usage_source FROM cost_events WHERE session_id=? ORDER BY id').all(result.sessionId);
  expect(rows).toEqual([{provider:'openai',model:'gpt-6.1-sol',usage_source:'estimated'},{provider:'anthropic',model:'claude-sonnet-5-5',usage_source:'provider'}]);
  expect(events.filter(e=>e.type==='usage')).toHaveLength(2);expect(store.verifyChain().valid).toBe(true);
});
