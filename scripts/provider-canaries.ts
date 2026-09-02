#!/usr/bin/env bun
/**
 * XR R-6 (known-limitations register #11) — Provider canaries.
 *
 * A scheduled, HONEST live smoke of *configured* providers. Before this,
 * nothing continuously verified real provider APIs: `xr doctor`'s "ready"
 * means key present + endpoint answering, not key-validated.
 *
 * Rules (claim discipline):
 *   · A provider is probed only when there is something real to probe with —
 *     hosted presets need their API key in env; local runtimes need a CI
 *     endpoint (`XR_CANARY_BASEURL_<ID>`). Otherwise the row is `skip` —
 *     never a fake pass. A sweep of ONLY skips fails the run (exit 2)
 *     unless XR_CANARY_ALLOW_EMPTY=1 (deliberate, audited skip).
 *   · A configured provider that fails `health()` fails the run (exit 1).
 *     No auth-failure is downgraded, no endpoint-error is blessed.
 *   · The probe is the adapter's own `health()` — the same live call
 *     `xr doctor`/`xr status` would make, so canary and doctor can never
 *     drift into two truths (no duplicate HTTP probing here).
 *
 * Cost note: hosted presets are probed health-only. The OpenAI-compatible
 * health probe is, at most, a `max_tokens: 1` completion; Anthropic's is a
 * 1-token messages call. Total per run is bounded by pennies of output
 * tokens, and only for key-configured providers.
 *
 * Usage:
 *   bun run scripts/provider-canaries.ts
 *     [--only groq,openai]        # subset of preset ids
 *     [--timeout 20000]           # per-provider probe budget (ms, default 15000)
 *     [--json /path/report.json]  # also write the machine report
 *
 * Env seam:
 *   XR_CANARY_BASEURL_<ID>   override a preset's endpoint (e.g. a staging or
 *                            local-runtime endpoint). OpenAI-compatible
 *                            presets only — native adapters pin their URLs.
 */

import { PRESETS } from "../src/providers/presets.ts";
import { registry } from "../src/providers/registry.ts";
import "../src/providers/factory.ts"; // registers the builtin presets into the registry
import type { Provider, Tool } from "../src/core/types.ts";
import type { XRConfig } from "../src/config/config.ts";

interface Row {
  id: string;
  label: string;
  kind: string;
  tier: string;
  keyEnv: string | null;
  keyPresent: boolean;
  baseUrl: string | undefined;
  status: "pass" | "fail" | "skip";
  skipReason?: string;
  latencyMs?: number;
  detail: string;
}

interface CanaryReport {
  generatedAt: string;
  results: Row[];
  pass: number;
  fail: number;
  skip: number;
}

function parseArgs(argv: string[]): { only: string[] | null; timeoutMs: number; json: string | null } {
  let only: string[] | null = null;
  let timeoutMs = 15000;
  let json: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--only") only = argv[++i]!.split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--timeout") timeoutMs = Number(argv[++i]);
    else if (a === "--json") json = argv[++i]!;
    else if (a === "--help" || a === "-h") {
      console.log("Usage: bun run scripts/provider-canaries.ts [--only ids] [--timeout ms] [--json path]");
      process.exit(0);
    } else {
      console.error(`unknown flag: ${a} (see --help)`);
      process.exit(2);
    }
  }
  return { only, timeoutMs, json };
}

function overrideBaseUrl(id: string): string | undefined {
  const v = process.env[`XR_CANARY_BASEURL_${id.toUpperCase()}`];
  return v && v.trim() ? v.trim() : undefined;
}

/** The minimal config shape the provider factory reads — nothing else is touched. */
function canaryConfig(id: string): XRConfig {
  const baseUrl = overrideBaseUrl(id);
  return {
    providers: baseUrl ? { [id]: { baseUrl } } : {},
    localModels: { runtimes: {} },
  } as unknown as XRConfig;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} exceeded ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export async function canaryOne(id: string, opts: { timeoutMs: number; env?: NodeJS.ProcessEnv }): Promise<Row> {
  const env = opts.env ?? process.env;
  const preset = PRESETS[id];
  if (!preset) {
    return {
      id,
      label: "(unknown)",
      kind: "?",
      tier: "?",
      keyEnv: null,
      keyPresent: false,
      baseUrl: undefined,
      status: "fail",
      detail: `unknown provider preset: ${id}`,
    };
  }
  const keyEnv = preset.apiKeyEnv ?? null;
  const keyPresent = keyEnv ? Boolean(env[keyEnv]?.trim()) : false;
  const base: Omit<Row, "status" | "detail"> = {
    id: preset.id,
    label: preset.label,
    kind: preset.kind,
    tier: preset.tier,
    keyEnv,
    keyPresent,
    baseUrl: overrideBaseUrl(id) ?? preset.baseUrl,
  };

  // Local runtimes have no key concept; they are canaried only when a CI
  // endpoint is explicitly supplied.
  if (preset.kind === "local" && !overrideBaseUrl(id)) {
    return { ...base, status: "skip", skipReason: `local runtime (no CI endpoint — set XR_CANARY_BASEURL_${id.toUpperCase()} to canary it)`, detail: "not configured" };
  }
  // AWS bedrock authenticates through the ambient AWS chain, not a single key env var.
  if (preset.authType === "aws") {
    return { ...base, status: "skip", skipReason: "aws auth chain — ambient credentials not canaried by key presence", detail: "not configured" };
  }
  if (keyEnv && !keyPresent) {
    return { ...base, status: "skip", skipReason: `no ${keyEnv} in env — canary not configured`, detail: "not configured" };
  }

  const start = Date.now();
  let provider: Provider;
  try {
    provider = registry.createProvider(preset.id, canaryConfig(id), preset.defaultModel);
  } catch (e) {
    return { ...base, status: "fail", detail: `construction failed: ${(e as Error).message}` };
  }
  try {
    const health = await withTimeout(provider.health(), opts.timeoutMs, preset.id);
    return {
      ...base,
      status: health.ok ? "pass" : "fail",
      latencyMs: health.latencyMs ?? Date.now() - start,
      detail: health.detail ?? "",
    };
  } catch (e) {
    return { ...base, status: "fail", latencyMs: Date.now() - start, detail: (e as Error).message };
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const ids = args.only ?? Object.keys(PRESETS);
  const results: Row[] = [];
  for (const id of ids) results.push(await canaryOne(id, args));

  const report: CanaryReport = {
    generatedAt: new Date().toISOString(),
    results,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
  };

  for (const r of results) {
    const mark = r.status === "pass" ? "✓" : r.status === "fail" ? "✗" : "·";
    const head = `${mark} ${r.id.padEnd(13)} ${r.status.toUpperCase().padEnd(4)}`;
    const info = r.status === "skip" ? r.skipReason : `${r.latencyMs ?? "?"}ms · ${r.detail}`;
    console.log(`${head} ${info}`);
  }
  console.log(
    `canaries: ${report.pass} pass / ${report.fail} fail / ${report.skip} skip — ${results.length} presets (${report.generatedAt})`,
  );

  if (args.json) {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(args.json), { recursive: true });
    writeFileSync(args.json, JSON.stringify(report, null, 2));
  }
  // GitHub step summary (present only under Actions).
  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    const { appendFileSync } = await import("node:fs");
    const lines = [
      "## Provider canaries\n",
      `_${report.generatedAt} — ${report.pass} pass / ${report.fail} fail / ${report.skip} skip_\n`,
      "| provider | status | detail |",
      "|---|---|---|",
      ...results.map((r) => `| ${r.id} | ${r.status} | ${r.status === "skip" ? r.skipReason : `${r.latencyMs ?? "?"}ms · ${r.detail}`} |`),
    ];
    appendFileSync(stepSummary, lines.join("\n") + "\n");
  }
  const configured = report.pass + report.fail;
  if (configured === 0) {
    if (process.env.XR_CANARY_ALLOW_EMPTY === "1") {
      console.warn(
        "XR_CANARY_ALLOW_EMPTY=1 — audited skip of zero-provider canary (no live probe ran)",
      );
      return 0;
    }
    console.error(
      "no providers configured — set at least one canary secret (or XR_CANARY_ALLOW_EMPTY=1 for a deliberate, audited skip)",
    );
    return 2;
  }
  return report.fail > 0 ? 1 : 0;
}

if (import.meta.main) {
  process.exit(await main());
}
