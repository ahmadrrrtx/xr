/**
 * XR — operator-declared rates reach the research governor (offline).
 *
 * The 2026-10-30 live Groq leg exposed the gap: agent-service honored
 * config.providerEngine.providerCapabilities cost declarations, but the
 * research pipeline (daemon run-deps + CLI) priced models without them, so a
 * governed research run on any model absent from the sourced registry
 * stopped on "price unavailable" even when the operator had declared rates.
 * These tests pin the fix: declarations reach every priceFor on the research
 * path, and without one the run still fails closed (never invents a price).
 *
 * The provider is a synthetic loopback custom provider (no key, no network —
 * nothing is called); only routing/pricing wiring is under test.
 */

import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { ConfigSchema } from "../../src/config/config.ts";
import { buildRunDeps } from "../../src/research/run-deps.ts";
import { operatorRateFor } from "../../src/research/budget.ts";

const PROVIDER = "rates-loopback";
const MODEL = "stub-model";

function config(declared: boolean) {
  return ConfigSchema.parse({
    defaults: { provider: PROVIDER, model: MODEL },
    providerEngine: {
      customProviders: [
        {
          id: PROVIDER,
          label: "Synthetic rates fixture",
          baseUrl: "http://127.0.0.1:9/v1",
          defaultModel: MODEL,
          capabilities: { chat: true, streaming: false },
        },
      ],
      providerCapabilities: declared
        ? {
            [PROVIDER]: {
              models: {
                [MODEL]: {
                  cost: { source: "test-only operator document", inPerMTok: 0.15, outPerMTok: 0.6 },
                },
              },
            },
          }
        : {},
    },
  });
}

function freshStore() {
  return new Store(join(mkdtempSync(join(tmpdir(), "xr-rates-")), "xr.db"));
}

test("operatorRateFor extracts only a well-formed declaration", () => {
  const cfg = config(true);
  expect(operatorRateFor(cfg, PROVIDER, MODEL)).toMatchObject({ inPerMTok: 0.15, outPerMTok: 0.6 });
  expect(operatorRateFor(cfg, PROVIDER, "missing-model")).toBeUndefined();
  expect(operatorRateFor(cfg, "other-provider", MODEL)).toBeUndefined();
  expect(operatorRateFor(config(false), PROVIDER, MODEL)).toBeUndefined();
});

test("a governed research run admits an operator-declared rate and meters USD with it", () => {
  const store = freshStore();
  try {
    const built = buildRunDeps(store, config(true), {});
    expect(built.fallbackReason).toBeNull();
    expect(built.providerId).toBe(PROVIDER);
    expect(built.deps.budget.allow()).toBe(true);
    built.deps.budget.record(1_000_000, 1_000_000);
    expect(built.usage().usd).toBeCloseTo(0.75, 6); // 1M in × $0.15 + 1M out × $0.60
  } finally {
    store.close();
  }
});

test("without a declaration the same run still fails closed on price", () => {
  const store = freshStore();
  try {
    const built = buildRunDeps(store, config(false), {});
    expect(built.deps.budget.allow()).toBe(false);
    expect(built.deps.budget.reason()).toContain("price unavailable");
  } finally {
    store.close();
  }
});
