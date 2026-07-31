/**
 * XR Phase 2 · T1 — surface entry into the execution envelope.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 *
 * `src/services/extensibility-bridge.ts` (Phase 0 · T8) gave the three
 * interactive surfaces the same TOOLS as the CLI, but each surface still called
 * `runAgent` itself and hand-built `AgentDeps`. Phase 0's own header said why:
 * *"Phase 0 explicitly forbids unifying the execution envelope — that is
 * Phase 2."* This module is that unification.
 *
 * ── Why a separate entry from `AgentService.execute()` ──────────────────────
 *
 * `AgentService` requires a booted kernel (typed service registry, lifecycle,
 * workspace binding). Shell, Telegram and Voice are long-lived surfaces that
 * own their own `WorkspaceStore` and deliberately do NOT boot the kernel — that
 * is XR's lazy-boot guarantee (Art. VI.4 / Art. XII), and booting a kernel per
 * keystroke would regress startup.
 *
 * So this module assembles THE SAME envelope from a surface-owned store. It is
 * not a second execution path: it constructs the same `ExecutionEnvelope`, uses
 * the same `buildToolRegistry`, and calls the same `runEnvelope` — the single
 * function that owns the loop. The architectural test treats
 * `core/execution/runner.ts` as the only loop caller, and this module goes
 * through it like everything else.
 *
 * When a kernel IS available, callers should prefer `AgentService.execute()`.
 */

import type { ApprovalRequest, Mode, Provider } from "../core/types.ts";
import type { Store } from "../state/workspace-store.ts";
import type { MemoryStore } from "../context/memory/store.ts";
import {
  assembleEnvelope,
  newEvidence,
  type EnvelopeOutcome,
  type SurfaceId,
} from "../core/execution/envelope.ts";
import { runEnvelope, type EnvelopeContext } from "../core/execution/runner.ts";
import { buildToolRegistry } from "../tools/registry-builder.ts";

export interface SurfaceExecuteRequest {
  readonly task: string;
  readonly mode: Mode;
  readonly surface: SurfaceId;
  readonly store: Store;
  readonly provider: Provider;
  /** Model id for the PLAN phase record. Surfaces know it from their config. */
  readonly modelId: string;
  readonly cwd?: string;
  readonly maxSteps?: number;
  readonly systemPrompt?: string;
  readonly budget: { maxUsd?: number; maxTokens?: number };
  readonly pricing: { inPerMTok: number; outPerMTok: number };
  readonly egressAllowlist?: readonly string[];
  readonly dryRun?: boolean;
  readonly say?: (line: string) => void;
  readonly approve: (req: ApprovalRequest) => Promise<boolean>;
  readonly onOverBudget?: (
    meter: string,
    reason: string,
  ) => Promise<{ usd?: number; tokens?: number } | null>;
  readonly memory?: { enabled: boolean; recallLimit?: number; semantic?: boolean };
  readonly memoryStore?: MemoryStore;
  readonly sessionSummary?: { enabled: boolean; minTurns?: number };
  /** Surface-side hook so the UI can show degradations (missing plugin, etc.). */
  readonly onDiagnostic?: (note: string) => void;
}

/**
 * Run a task from an interactive surface through the canonical envelope.
 *
 * Returns the full `EnvelopeOutcome` (a superset of the old `AgentResult`), so
 * surfaces keep reading `.stopped`, `.finalMessage`, `.steps`, `.meter`
 * unchanged — the parity the interface-parity test asserts.
 */
export async function executeOnSurface(
  request: SurfaceExecuteRequest,
): Promise<EnvelopeOutcome> {
  const cwd = request.cwd ?? process.cwd();

  // PLACEMENT — the one registry, populated identically to the CLI path.
  const { registry, diagnostics } = await buildToolRegistry({
    store: request.store,
    task: request.task,
  });
  for (const note of diagnostics) request.onDiagnostic?.(note);

  const skillPrompt = registry.skillPrompt();
  const systemPrompt = [skillPrompt, request.systemPrompt]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join("\n\n");

  const evidence = newEvidence(diagnostics);
  const collisions = registry.listCollisions();
  if (collisions.length > 0) {
    // Same security-relevant event the kernel path audits.
    try {
      request.store.audit("tools.collision", {
        envelopeId: evidence.envelopeId,
        surface: request.surface,
        collisions,
      });
    } catch (err) {
      request.onDiagnostic?.(
        `collision audit degraded: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const envelope = assembleEnvelope({
    intent: { task: request.task, mode: request.mode, surface: request.surface, cwd },
    plan: {
      provider: request.provider,
      providerId: request.provider.id,
      modelId: request.modelId,
      maxSteps: request.maxSteps ?? 12,
      ...(systemPrompt ? { systemPrompt } : {}),
    },
    policy: {
      budget: request.budget,
      pricing: request.pricing,
      egressAllowlist: request.egressAllowlist ?? [],
      dryRun: request.dryRun ?? false,
      approve: request.approve,
    },
    placement: {
      placement: "in_process",
      registry,
      tools: registry.discover({ mode: request.mode }),
      collisions,
    },
    observation: {
      say: request.say ?? (() => {}),
      ...(request.onOverBudget ? { onOverBudget: request.onOverBudget } : {}),
    },
    evidence,
  });

  const context: EnvelopeContext = {
    ...(request.memory ? { memory: request.memory } : {}),
    ...(request.memoryStore ? { memoryStore: request.memoryStore } : {}),
    ...(request.sessionSummary ? { sessionSummary: request.sessionSummary } : {}),
  };

  return await runEnvelope(envelope, { store: request.store }, context);
}
