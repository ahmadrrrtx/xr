/**
 * XR Phase 5 · T2 — Measured provider behavioral contracts.
 *
 * Constitution Charter §9.8: a provider's BEHAVIOR (structured-output
 * fidelity, tool-use fidelity, refusal patterns, context retention) is
 * measured and recorded, so portability means behavioral portability.
 * Art. IV.5 / Part 19: the metadata is recorded from OBSERVED OUTCOMES of
 * bounded probes — never from vendor claims — and evaluation runs
 * OFFLINE/ASYNC (operator-triggered or in tests), never on the routing hot
 * path. `route()` only reads the persisted store (TTL-cached).
 *
 * Storage: $XR_HOME/cache/intelligence/behavioral.json (schema v1, atomic
 * tmp+rename writes, no secrets, no prompt/response CONTENT — probe ids,
 * counts, scores and timestamps only).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Message, Provider, Tool } from "../core/types.ts";

const XR_HOME_DIR = () => process.env.XR_HOME ?? join(homedir(), ".xr");
const STORE_DIR = () => join(XR_HOME_DIR(), "cache", "intelligence");
const STORE_FILE = () => join(STORE_DIR(), "behavioral.json");

// ── Contract ────────────────────────────────────────────────────────────────

export type ContractSource = "measured" | "declared";

export interface BehavioralContract {
  /** `${providerId}/${modelId}` */
  key: string;
  providerId: string;
  modelId: string;
  /** 0..1 — valid structured outputs / structured probes. */
  structuredOutputFidelity: number;
  /** 0..1 — correct tool calls (name + valid JSON args) / tool probes. */
  toolUseFidelity: number;
  /** 0..1 — benign prompts refused / benign prompts (false-refusal rate). */
  refusalRate: number;
  /** Refusal phrase classes observed (bounded, e.g. "apology", "policy"). */
  refusalPatterns: string[];
  /** 0..1 — anchor facts recalled after distractor turns. */
  contextRetention: number;
  /** 0..1 — weighted blend (weights in OVERALL_WEIGHTS). */
  overallFidelity: number;
  /** Total probe observations behind this contract. */
  samples: number;
  /** When measured (epoch ms). */
  measuredAt: number;
  /** "measured" = observed outcomes; "declared" = cold-start static prior. */
  source: ContractSource;
  /** 0..1 — coverage confidence (confidenceFromSamples curve). */
  confidence: number;
  version: 1;
}

/** Inspectable blend weights (Art. VII.3 — explainable). */
export const OVERALL_WEIGHTS = {
  toolUse: 0.3,
  structuredOutput: 0.25,
  contextRetention: 0.25,
  nonRefusal: 0.2,
} as const;

interface StoreFile {
  version: 1;
  contracts: Record<string, BehavioralContract>;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class BehavioralStore {
  private cache: { at: number; data: StoreFile } | null = null;
  private readonly ttlMs: number;
  private readonly file: string | null;

  constructor(opts: { file?: string | null; ttlMs?: number } = {}) {
    this.file = opts.file === undefined ? STORE_FILE() : opts.file;
    this.ttlMs = opts.ttlMs ?? 5_000;
  }

  private load(): StoreFile {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.ttlMs) return this.cache.data;
    let data: StoreFile = { version: 1, contracts: {} };
    if (!this.file) {
      this.cache = { at: now, data };
      return data;
    }
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, "utf8")) as StoreFile;
        if (raw && raw.version === 1 && raw.contracts && typeof raw.contracts === "object") {
          data = raw;
        }
      }
    } catch {
      // Corrupt store: fail closed to EMPTY (routing falls back to static
      // priors) — never to a parse crash on the hot path.
      data = { version: 1, contracts: {} };
    }
    this.cache = { at: now, data };
    return data;
  }

  contract(providerId: string, modelId: string): BehavioralContract | undefined {
    return this.load().contracts[`${providerId}/${modelId}`];
  }

  all(): BehavioralContract[] {
    return Object.values(this.load().contracts);
  }

  /** Atomic write (tmp + rename) — half-written stores are never observed. */
  save(contract: BehavioralContract): void {
    const data = this.load();
    data.contracts[contract.key] = contract;
    if (!this.file) {
      this.cache = { at: Date.now(), data };
      return;
    }
    mkdirSync(STORE_DIR(), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.file);
    this.cache = { at: Date.now(), data };
  }

  invalidate(): void {
    this.cache = null;
  }
}

/** Narrow read view consumed by the router (composition, not coupling). */
export interface BehavioralView {
  contract(providerId: string, modelId: string): BehavioralContract | undefined;
}

export function behavioralView(store: BehavioralStore): BehavioralView {
  return { contract: (p, m) => store.contract(p, m) };
}

// ── Offline evaluator ───────────────────────────────────────────────────────

export interface ProbeOutcome {
  probe: string;
  ok: boolean;
  /** Safe detail (no content). */
  detail: string;
}

export interface EvaluateOptions {
  /** Per-probe call timeout, ms. */
  timeoutMs?: number;
  /** Anchors used for the context-retention probe (synthetic facts). */
  retentionAnchors?: { fact: string; question: string }[];
}

const RETENTION_ANCHORS = [
  { fact: "XR-ANCHOR-7741", question: "What anchor token did I give you earlier? Reply with just the token." },
];

function refusalClass(text: string): string | null {
  if (/\b(i('m| am) sorry|i apologize|unfortunately,? i (can(not|'t)|won't))\b/i.test(text)) return "apology-refusal";
  if (/\b(policy|guidelines|terms of use|not allowed|forbidden|against the rules)\b/i.test(text)) return "policy-refusal";
  if (/\b(as an ai\b|i (can not|cannot|can't|am unable to) (assist|help|comply|provide)|i must decline)\b/i.test(text)) return "capability-refusal";
  return null;
}

async function withTimeout<T>(fn: Promise<T>, ms: number, what: string): Promise<T> {
  return await Promise.race([
    fn,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)),
  ]);
}

/**
 * Offline, async behavioral evaluator. Probes are bounded (small fixed
 * counts) and validated against EXPECTED shapes/anchors — the fidelity
 * numbers are observed outcomes, never vendor claims. Contains no live-model
 * requirement: tests drive it with scripted providers.
 */
export class BehavioralEvaluator {
  constructor(private readonly opts: EvaluateOptions = {}) {}

  async evaluate(provider: Provider, modelId: string): Promise<BehavioralContract> {
    const timeoutMs = this.opts.timeoutMs ?? 15_000;
    const outcomes: ProbeOutcome[] = [];
    let structuredHits = 0, structuredTotal = 0;
    let toolHits = 0, toolTotal = 0;
    let refusals = 0, benignTotal = 0;
    const refusalPatterns = new Set<string>();
    let retentionHits = 0, retentionTotal = 0;
    /**
     * Art. IV guard: transport failure is NOT measured capability. A probe
     * that THROWS (connection refused, auth, HTTP error) never produced a
     * model turn; a live-but-bad model RETURNS bad turns. If no probe ever
     * returned a turn the provider is unreachable and there is nothing to
     * measure — evaluate() throws and the caller records an honest skip
     * instead of saving a false "fidelity 0" contract to the store.
     */
    let answeredTurns = 0;
    let firstTransportError: string | null = null;

    const call = async (messages: Message[], tools?: Tool[]) => {
      try {
        const turn = await withTimeout(provider.chat(messages, tools ?? []), timeoutMs, "probe");
        answeredTurns++;
        return turn;
      } catch (e) {
        firstTransportError ??= (e as Error).message;
        throw e;
      }
    };

    // 1. Structured-output fidelity ───────────────────────────────────────
    for (let i = 0; i < 2; i++) {
      structuredTotal++;
      try {
        const turn = await call([
          { role: "user", content: `Reply with ONLY a JSON object (no prose) matching {"name": string, "count": number}. Use name="probe${i}" and count=${i + 1}.` },
        ]);
        const parsed = JSON.parse((turn.message ?? "").trim());
        const ok = parsed && typeof parsed.name === "string" && typeof parsed.count === "number";
        if (ok) structuredHits++;
        outcomes.push({ probe: "structured-output", ok, detail: ok ? "valid JSON with required fields" : "invalid shape" });
      } catch (e) {
        outcomes.push({ probe: "structured-output", ok: false, detail: `unparseable: ${(e as Error).message.slice(0, 80)}` });
      }
    }

    // 2. Tool-use fidelity ────────────────────────────────────────────────
    const echoTool: Tool = {
      name: "xr_probe.echo",
      description: "Echo back the given text verbatim.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      requiresApproval: false,
      run: async (args) => ({ ok: true, output: String(args.text ?? "") }),
    };
    for (let i = 0; i < 2; i++) {
      toolTotal++;
      try {
        const turn = await call(
          [{ role: "user", content: `Call the tool xr_probe.echo with text "ping-${i}". Do not answer in prose.` }],
          [echoTool],
        );
        const call0 = turn.toolCalls?.[0];
        // ToolCall.args is already parsed by the provider adapter (core contract).
        const ok = !!call0 && call0.tool === "xr_probe.echo" && typeof call0.args?.text === "string";
        if (ok) toolHits++;
        outcomes.push({ probe: "tool-use", ok, detail: ok ? "correct tool + valid args" : "missing/incorrect tool call" });
      } catch (e) {
        outcomes.push({ probe: "tool-use", ok: false, detail: `error: ${(e as Error).message.slice(0, 80)}` });
      }
    }

    // 3. Refusal behavior (benign prompts MUST NOT be refused) ───────────
    const benign = [
      "What is the capital of France? Answer in one word.",
      "List two primary colors.",
    ];
    for (const b of benign) {
      benignTotal++;
      try {
        const turn = await call([{ role: "user", content: b }]);
        const cls = refusalClass(turn.message ?? "");
        if (cls) {
          refusals++;
          refusalPatterns.add(cls);
          outcomes.push({ probe: "refusal", ok: false, detail: `false refusal (${cls})` });
        } else {
          outcomes.push({ probe: "refusal", ok: true, detail: "benign request answered" });
        }
      } catch (e) {
        // A thrown refusal/error on a benign probe counts as a behavioral failure.
        refusals++;
        refusalPatterns.add("error-refusal");
        outcomes.push({ probe: "refusal", ok: false, detail: `error: ${(e as Error).message.slice(0, 80)}` });
      }
    }

    // 4. Context retention ────────────────────────────────────────────────
    const anchors = this.opts.retentionAnchors ?? RETENTION_ANCHORS;
    for (const a of anchors) {
      retentionTotal++;
      try {
        const history: Message[] = [
          { role: "user", content: `Remember this anchor token exactly: ${a.fact}. Acknowledge with "ok".` },
          { role: "assistant", content: "ok" },
          { role: "user", content: "Distractor: give me a one-line fun fact about the ocean." },
          { role: "assistant", content: "The ocean covers about 71% of Earth's surface." },
          { role: "user", content: a.question },
        ];
        const turn = await call(history);
        const ok = (turn.message ?? "").includes(a.fact);
        if (ok) retentionHits++;
        outcomes.push({ probe: "context-retention", ok, detail: ok ? "anchor recalled" : "anchor lost" });
      } catch (e) {
        outcomes.push({ probe: "context-retention", ok: false, detail: `error: ${(e as Error).message.slice(0, 80)}` });
      }
    }

    if (answeredTurns === 0) {
      throw new Error(
        `provider unreachable: no probe returned a model turn ` +
          `(first error: ${(firstTransportError ?? "unknown").slice(0, 120)}). ` +
          `Transport failure is not measured capability — not saving a contract.`,
      );
    }

    const structuredOutputFidelity = structuredTotal ? structuredHits / structuredTotal : 0;
    const toolUseFidelity = toolTotal ? toolHits / toolTotal : 0;
    const refusalRate = benignTotal ? refusals / benignTotal : 0;
    const contextRetention = retentionTotal ? retentionHits / retentionTotal : 0;
    const nonRefusal = 1 - refusalRate;
    const overall =
      OVERALL_WEIGHTS.toolUse * toolUseFidelity +
      OVERALL_WEIGHTS.structuredOutput * structuredOutputFidelity +
      OVERALL_WEIGHTS.contextRetention * contextRetention +
      OVERALL_WEIGHTS.nonRefusal * nonRefusal;

    const samples = structuredTotal + toolTotal + benignTotal + retentionTotal;
    const round2 = (n: number) => Math.round(n * 1000) / 1000;

    return {
      key: `${provider.id}/${modelId}`,
      providerId: provider.id,
      modelId,
      structuredOutputFidelity: round2(structuredOutputFidelity),
      toolUseFidelity: round2(toolUseFidelity),
      refusalRate: round2(refusalRate),
      refusalPatterns: [...refusalPatterns],
      contextRetention: round2(contextRetention),
      overallFidelity: round2(overall),
      samples,
      measuredAt: Date.now(),
      source: "measured",
      confidence: round2(confidenceFromProbeSamples(samples)),
      version: 1,
    };
  }
}

/** Same coverage curve as routing metrics — inspectable, not ML. */
export function confidenceFromProbeSamples(n: number): number {
  if (n <= 0) return 0;
  if (n < 4) return 0.3;
  if (n < 8) return 0.6;
  if (n < 16) return 0.8;
  return 1;
}
