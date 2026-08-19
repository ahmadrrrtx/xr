/**
 * XR Phase 10 — research observability (structured counters).
 *
 * Uses the EXISTING metrics registry (src/observability/metrics.ts), not a
 * second metrics system. Counters are registered lazily and defensively: the
 * test hook `resetMetrics()` clears the shared registry, so each accessor
 * re-registers when its name is missing (the handle stays valid across
 * resets).
 */

import { Counter, metric, registerMetric } from "../observability/metrics.ts";

function counter(name: string, help: string): Counter {
  const existing = metric(name);
  if (existing instanceof Counter) return existing;
  try {
    return registerMetric(new Counter(name, help));
  } catch {
    const again = metric(name);
    if (again instanceof Counter) return again;
    // Last resort: a detached counter (renders nowhere, still counts).
    return new Counter(name, help);
  }
}

function getResearchJobsTotal(): Counter {
  return counter("xr_research_jobs_total", "Research jobs started by outcome (started|completed|partial|failed|cancelled|budget_exhausted).");
}
function getResearchPagesTotal(): Counter {
  return counter("xr_research_pages_total", "Research pages processed by outcome (retrieved|failed).");
}
function getResearchSsrBlocked(): Counter {
  return counter("xr_research_ssrf_blocked_total", "Research target URLs refused by the SSRF/URL guard.");
}
function getResearchInjectionDetected(): Counter {
  return counter("xr_research_injection_detected_total", "Research content chunks that matched prompt-injection signatures.");
}
function getResearchBudgetExhausted(): Counter {
  return counter("xr_research_budget_exhausted_total", "Research runs that stopped because a budget/limit was exhausted.");
}
function getResearchProviderLatency(): Counter {
  return counter("xr_research_provider_latency_ms_total", "Cumulative research provider operation latency (ms) by provider/capability.");
}

export const researchMetrics = {
  job(outcome: string): void {
    getResearchJobsTotal().inc({ outcome });
  },
  page(outcome: string, provider = ""): void {
    getResearchPagesTotal().inc({ outcome, provider });
  },
  ssrfBlocked(provider = ""): void {
    getResearchSsrBlocked().inc({ provider });
  },
  injectionDetected(kind = ""): void {
    getResearchInjectionDetected().inc({ kind });
  },
  budgetExhausted(reason = ""): void {
    getResearchBudgetExhausted().inc({ reason: reason.slice(0, 48) });
  },
  providerLatency(provider: string, capability: string, ms: number): void {
    getResearchProviderLatency().inc({ provider, capability }, ms);
  },
};
