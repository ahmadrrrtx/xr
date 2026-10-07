/**
 * XR Phase 18 — build `ResearchEngineDeps` for a daemon-hosted run.
 *
 * The same recipe `src/research/cli.ts` uses (`buildEngine`): provider from
 * config, Governor-driven local fallback when the global budget is spent,
 * egress-gated search built from the real allow-list, governed budget for
 * cloud / soft step cap for local. Two additions for the desktop:
 *   • a usage tracker so the UI shows the tokens/cost the provider actually
 *     reported (never a guess; unknown pricing → `usd: null`);
 *   • the run's AbortSignal threaded into the tool context, the search
 *     capability and the model calls.
 */

import type { XRConfig } from "../config/config.ts";
import type { Store } from "../state/workspace-store.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, pricingLabel, isLocal } from "../cost/pricing.ts";
import { WebSearchCapability } from "./search.ts";
import { GovernedResearchBudget, LocalResearchBudget, governedProviderRoute } from "./budget.ts";
import type { ResearchBudgetGuard, ResearchEngineDeps } from "./engine.ts";
import type { RunEventSink, RunUsage } from "./run-events.ts";

export interface RunDepsOptions {
  provider?: string;
  model?: string;
  /** Research-only public-web fetch path (config.research.allowPublicWeb unless overridden). */
  allowPublicWeb?: boolean;
  perTaskBudgetUsd?: number;
  signal?: AbortSignal;
  say?: (line: string) => void;
  onEvent?: RunEventSink;
}

export interface BuiltRunDeps {
  deps: ResearchEngineDeps;
  providerId: string;
  model: string;
  /** Live usage snapshot (tokens from provider usage frames, USD from the price table). */
  usage: () => RunUsage;
  /** True when the search host is in the egress allow-list. */
  searchAvailable: boolean;
  publicWeb: boolean;
  /** Set when the Governor routed the run to the local model (global cap). */
  fallbackReason: string | null;
}

export function buildRunDeps(store: Store, config: XRConfig, opts: RunDepsOptions = {}): BuiltRunDeps {
  const requested = opts.provider ?? config.defaults.provider;
  const model = opts.model ?? config.defaults.model;

  // Budget-aware fallback to local — the decision runs INSIDE the Governor
  // (Phase 2 · F-12), through the same helper the CLI uses.
  const { providerId, fallbackReason } = governedProviderRoute(
    store,
    { maxUsd: opts.perTaskBudgetUsd ?? config.budget.perTaskUsd, maxTokens: config.budget.perTaskTokens },
    priceFor(requested, model),
    requested,
    isLocal(requested),
  );

  const provider = buildProvider(config, { provider: providerId, model });
  const publicWeb = opts.allowPublicWeb ?? config.research.allowPublicWeb;

  const toolCtx = {
    cwd: process.cwd(),
    approve: async () => false, // research never needs approval to read public web
    audit: (event: string, detail: Record<string, unknown>) => store.audit(event, detail),
    egressAllowlist: config.security.egressAllowlist,
    allowedHosts: config.security.allowedHosts,
    dryRun: false,
    signal: opts.signal,
  };
  const search = new WebSearchCapability(toolCtx, { allowPublicWeb: publicWeb });

  const inner: ResearchBudgetGuard = isLocal(providerId)
    ? new LocalResearchBudget()
    : new GovernedResearchBudget(
        store,
        { maxUsd: opts.perTaskBudgetUsd ?? config.budget.perTaskUsd, maxTokens: config.budget.perTaskTokens },
        priceFor(providerId, model),
      );

  const price = priceFor(providerId, model);
  const priceKnown = isLocal(providerId) || pricingLabel(providerId, model) !== "unknown";
  let inTokens = 0;
  let outTokens = 0;
  const budget: ResearchBudgetGuard = {
    allow: () => inner.allow(),
    record: (i, o) => {
      inTokens += Math.max(0, i || 0);
      outTokens += Math.max(0, o || 0);
      inner.record(i, o);
    },
    meter: () => inner.meter(),
    reason: () => inner.reason(),
  };
  const usage = (): RunUsage => ({
    inTokens,
    outTokens,
    usd: isLocal(providerId) ? 0 : priceKnown ? (inTokens / 1_000_000) * price.inPerMTok + (outTokens / 1_000_000) * price.outPerMTok : null,
    local: isLocal(providerId),
  });

  const deps: ResearchEngineDeps = {
    provider,
    store,
    search,
    budget,
    say: opts.say ?? (() => {}),
    audit: (event, detail) => store.audit(event, detail),
    onEvent: opts.onEvent,
    signal: opts.signal,
  };

  return { deps, providerId, model, usage, searchAvailable: search.available(), publicWeb, fallbackReason };
}
