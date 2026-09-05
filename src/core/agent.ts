/**
 * XR — the agent loop: Observe → Think → Act, repeat until done.
 *
 * ── Phase 2 · T1: this is a LOOP, not an ENTRY POINT ────────────────────────
 *
 * `runAgentLoop` implements the ACTION phase of the canonical execution
 * envelope (src/core/execution/envelope.ts). The ONLY module permitted to call
 * it is src/core/execution/runner.ts; every surface reaches it through
 * `AgentService.execute()`. `test/core/no-bypass.test.ts` fails the build if
 * any other module imports it.
 *
 * The historical name `runAgent` is retained as a deprecated alias for
 * out-of-tree callers and is scheduled for removal in 2.0.0 (ADR-0002).
 */
import { randomUUID, createHash } from "node:crypto";
import type {
  ApprovalRequest,
  Message,
  Mode,
  ModelTurn,
  Provider,
  Tool,
  ToolCall,
  ToolContext,
} from "./types.ts";
import { getTool, toolsForMode } from "../tools/registry.ts";
import { isCancellation } from "../providers/request-guard.ts";
import { frameToolOutput } from "../security/tool-output.ts";
import { repairToTurn } from "../reliability/repair.ts";
import type { SessionRepo } from "../state/repos/session-repo.ts";
import type { AuditRepo } from "../state/repos/audit-repo.ts";
import { CostRepo } from "../state/repos/cost-repo.ts";
import type { UserMemoryRepo } from "../state/repos/user-memory-repo.ts";
import type { WorkspaceStore as Store } from "../state/workspace-store.ts";
import { CostGovernor, type Budget, type Pricing, type PartitionRef } from "../cost/governor.ts";
import type { TaskRunLedger } from "../execution/task-runtime.ts";
import { BudgetManager } from "../cost/manager.ts";
import { ReservationRepo } from "../state/repos/reservation-repo.ts";
import { buildStructuredPreview } from "../control/preview.ts";
import { compact } from "../context/memory/compact.ts";
import { MemoryStore, projectScopeFromCwd } from "../context/memory/store.ts";
import { buildMemoryBlock, buildContextMessages } from "../context/memory/inject.ts";
import type { ContextPackage, InjectionPackage } from "../context/types.ts";

export interface AgentDeps {
  provider: Provider;
  /** Legacy monolithic store (kept for older CLI/test call-sites during the runtime-store migration). */
  store?: Store;
  sessionStore?: SessionRepo;
  auditStore?: AuditRepo;
  costStore?: CostRepo;
  userMemoryStore?: UserMemoryRepo;
  cwd: string;
  /** Extra system guidance for role-scoped or workflow-scoped agents. */
  systemPrompt?: string;
  /** Fine-grained tool scoping for multi-agent workers. */
  tools?: {
    allow?: string[];
    deny?: string[];
  };
  /** UI hook: stream a line to the user. */
  say(line: string): void;
  /**
   * Phase 05 — canonical streaming event sink. When supplied, the loop emits
   * structured token / tool_call / tool_result / status / done / error events
   * as generation progresses (real provider token deltas, never a post-hoc
   * chunk of fullText). Optional: absent callers keep the non-streaming path.
   */
  onStreamEvent?: import("./types.ts").StreamEventSink;
  /** UI hook: ask the human to approve a risky action. */
  approve(req: ApprovalRequest): Promise<boolean>;
  /** UI hook: budget exceeded — ask whether to raise it / stop. Returns extra budget or null to stop. */
  onOverBudget?(meter: string, reason: string): Promise<{ usd?: number; tokens?: number } | null>;
  /** Spend ceiling for this task. */
  budget?: Budget;
  /** Pricing for the active model. */
  pricing?: Pricing;
  /** Safety rail: max loop iterations (prevents runaway). */
  maxSteps?: number;
  /** Domains the agent may contact (egress allow-list). */
  egressAllowlist?: string[];
  /**
   * Phase 2 · F-06 — workspace denied permissions, threaded into every
   * `evaluatePolicy` call at the loop boundary. Sourced from the workspace
   * config (`capabilities.deniedPermissions`); absent only for out-of-tree
   * callers that never loaded a config, in which case the loop treats the
   * list as empty and audits the absence (`capability.policy.deny_list_absent`).
   */
  deniedPermissions?: readonly string[];
  /** Dry-run: simulate side effects, never write/execute. */
  dryRun?: boolean;
  /**
   * v0.9 / Stage 6 — durable memory recall.
   */
  memory?: {
    enabled: boolean;
    /** Max entries to surface. */
    recallLimit?: number;
    /** Use embeddings-based semantic recall. */
    semantic?: boolean;
  };
  /**
   * Stage 6 — the canonical memory engine. When provided, the agent recalls
   * through it (explainable, access-tracked, expiry-aware). Falls back to
   * `userMemoryStore` for older call-sites.
   */
  memoryStore?: MemoryStore;
  /**
   * Stage 6 — optionally fold a finished conversation into a compact session
   * summary (kept in a SEPARATE store, never confused with long-term facts).
   */
  sessionSummary?: {
    enabled: boolean;
    /** Minimum user/assistant turns before a summary is saved. */
    minTurns?: number;
  };
  /**
   * XR 1.0 — extra tools contributed by enabled plugins.
   *
   * @deprecated Phase 2 · T2. Superseded by `toolRegistry`, which namespaces
   * contributions and arbitrates collisions instead of concatenating a flat
   * list whose bare names could shadow core tools. Still honoured for
   * out-of-tree callers; removed in 2.0.0 (ADR-0003).
   */
  extraTools?: Tool[];
  /**
   * Phase 2 · T2 — the single tool registry for this run. When supplied it is
   * the authority for both discovery and call resolution, and `extraTools` is
   * ignored. Supplied by the execution envelope on every in-tree path.
   */
  toolRegistry?: import("../tools/registry-service.ts").ToolRegistryService;
  /** Phase 2 · T1 — envelope identity, recorded on audit entries. */
  envelopeId?: string;
  /** Phase 2 · T1 — originating surface, recorded on audit entries. */
  surface?: string;
  /**
   * Phase 4 · T1 — the Trust service, wired UNCONDITIONALLY on every in-tree
   * path so high-risk tools (shell/code) execute inside an enforced
   * environment or fail closed. Absent only for deprecated out-of-tree
   * callers, whose tools then see `hardened` and act accordingly.
   */
  trust?: import("../runtime/trust/service.ts").TrustService;
  /**
   * Phase 4 · T1 — hardened mode flag (from config). When true, high-risk
   * tools refuse host-authority fallbacks. Defaults to true when unset.
   */
  hardened?: boolean;
  /**
   * Phase 4 · T4 — explicit raw-IP/loopback destinations (local runtimes).
   */
  allowedHosts?: readonly string[];
  /**
   * Phase 4 · T1 — run identity for escalate-only lattice bookkeeping.
   * Defaults to `envelopeId`. Shared by every tool call in this run so the
   * run's isolation can only escalate, never downgrade.
   */
  runId?: string;
  /**
   * Phase 7 · T1 — optional tool-use recorder forwarded into every
   * ToolContext. Wired by the execution envelope from the caller-provided
   * EnvelopeContext; provenance recording is best-effort by design.
   */
  onToolUse?: (info: { tool: string; ok: boolean; error?: string }) => void;
  /**
   * XR 4.4 — routing decision from the Universal Intelligence Plane.
   * Secret-free; safe to audit and attach to execution records.
   */
  routingDecision?: import("../intelligence/types.ts").RoutingDecision;
  /**
   * XR 4.5 — a pre-assembled, scope-filtered context package.
   *
   * When present, the agent injects THIS instead of the legacy memory block:
   * items arrive already authorized, tiered, trust-labelled, and explainable,
   * and untrusted content is delimited in a non-instruction channel.
   *
   * When absent, the agent falls back to the 4.4 recall path unchanged, so
   * `injectionMode: "legacy"` and every older call-site keep working (§10.2).
   */
  contextPackage?: ContextPackage;
  /**
   * XR 4.5 — injection mode. Defaults to "legacy" when no package is supplied
   * so behavior never changes implicitly.
   */
  contextMode?: "legacy" | "context" | "both";
  /** XR 4.5 — receives the rendered injection for inspection/audit surfaces. */
  onContextInjected?(injection: InjectionPackage): void;
  /**
   * XR 7.1.0-RC (audit A-19) — cooperative cancellation.
   *
   * Wired by the execution envelope from the caller-provided signal. The loop
   * checks it at well-defined checkpoints: the top of every step, after a
   * model turn resolves (before its tool calls execute — a cancelled run must
   * not perform new side effects), and between tool calls. A signal raised
   * mid-`provider.chat` takes effect at the next checkpoint; JS cannot
   * universally force-interrupt an in-flight turn, and XR does not fake it —
   * the session ends honestly as `stopped: "cancelled"` once the turn
   * resolves or the next step begins.
   */
  signal?: AbortSignal;

  // ── Phase 6 — task runtime, partitions, and resume ──────────────────────

  /**
   * Phase 6 · Step 2 — the child envelope this run must fit inside. When set,
   * the governor's step admission goes through the partition ledger (child
   * cap + root cap, atomic), and the run's per-task ceilings are the
   * partition's — never a copy of the root request (F-12).
   */
  partition?: PartitionRef;
  /**
   * Phase 6 · Step 6 — pre-allocated session id (a resumed run continues
   * under its original id so checkpoints, session, and audit all chain to
   * the same identity).
   */
  sessionId?: string;
  /**
   * Phase 6 · Step 6 — resume seed: the transcript, step index, usage, and
   * tool-call sequence recovered from the latest durable checkpoint. The
   * model is RE-ASKED from here (documented nondeterminism — XR does not
   * journal provider traffic for replay).
   */
  resumeFrom?: ResumeFrom;
  /** Phase 6 · Step 6 — durable per-step checkpoint sink (task_checkpoints). */
  checkpointSink?: (kind: string, payload: Record<string, unknown>) => void;
  /** Phase 6 · Step 1 — the task ledger for this run (plain runs: 1-node task). */
  taskLedger?: TaskRunLedger;
  /** Phase 6 · Step 3 — the identity this run executes under (attribution). */
  agentIdentity?: import("../agents/identity.ts").AgentIdentity;
}

export interface AgentResult {
  sessionId: string;
  finalMessage: string;
  steps: number;
  stopped: "done" | "max_steps" | "error" | "budget" | "approval" | "cancelled";
  /** Optional token counters for richer UIs when a caller/provider supplies them. */
  inputTokens?: number;
  outputTokens?: number;
  /** Final cost meter string. */
  meter?: string;
  /** XR 4.4 — routing decision id when intelligence plane selected the model. */
  routingDecisionId?: string;
}

/**
 * Phase 05 — run ONE model turn, preferring the provider's streaming variant.
 *
 * When the provider exposes `chatStream`, token deltas are surfaced to the
 * surface via `onStreamEvent({type:"token"})` AS they arrive (real provider
 * streaming — never a post-hoc chunk of fullText). Tool calls are accumulated
 * and the accumulated envelope is parsed at the end for the authoritative
 * `done`/message. When the provider only implements `chat()` (legacy), the
 * exact non-streaming behavior is preserved and the whole message is emitted
 * as a single token event (compatible with consumers that predate streaming).
 *
 * Returns the turn plus whether real streaming was used, so the caller can
 * avoid double-printing the full message via `say`.
 */
/**
 * Phase 1 — a turn is `content | tool_calls | error`, never an empty "done".
 * Build an honest remediation hint for the audit/error surface (never content).
 */
function emptyTurnError(status: ModelTurn["status"]): string {
  if (status === "undecodable") {
    return "model did not produce a decodable turn (undecodable output); check the model/endpoint, or use a local runtime with grammar support";
  }
  return "model did not produce a usable turn (empty response); check the model/endpoint, or use a local runtime with grammar support";
}

/**
 * Audit-safe fingerprint of a turn's tail (last 200 chars). NEVER carries the
 * content itself — only a short hash so the audit can prove "a turn happened"
 * without storing model output.
 */
function tailHash(content: string): string {
  const tail = (content ?? "").slice(-200);
  return createHash("sha256").update(tail).digest("hex").slice(0, 16);
}

/**
 * Phase 1 · F-13 — estimate per-turn usage when the provider omits it, so a
 * buggy/hostile provider cannot silently meter $0. In/out split is a heuristic
 * (~4 chars/token) from this turn's actual content + prompt size.
 */
function estimateTurnUsage(turn: ModelTurn, messages: Message[]): { inTokens: number; outTokens: number } {
  const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const outChars = (turn.message?.length ?? 0) + JSON.stringify(turn.toolCalls ?? []).length;
  return {
    inTokens: Math.ceil(promptChars / 4),
    outTokens: Math.ceil(outChars / 4),
  };
}

/**
 * Apply the Phase 1 strict turn contract: an empty/undecodable turn (no
 * content AND no tool calls) becomes an explicit honest `error` — never a
 * fabricated completion. `done:true` is preserved only when genuinely declared.
 */
function finalizeTurn(turn: ModelTurn): ModelTurn {
  const hasContent = (turn.message ?? "").trim().length > 0;
  const hasToolCalls = (turn.toolCalls ?? []).length > 0;
  if (!hasContent && !hasToolCalls && !turn.error) {
    turn.done = false;
    turn.error = emptyTurnError(turn.status ?? "empty");
  }
  return turn;
}

async function runModelTurn(
  provider: Provider,
  messages: Message[],
  tools: Tool[],
  deps: Pick<AgentDeps, "signal" | "onStreamEvent">,
): Promise<{ turn: ModelTurn; streamed: boolean }> {
  const sink = deps.onStreamEvent;
  const chatStream = (provider as Provider & { chatStream?: (m: Message[], t: Tool[], o?: { signal?: AbortSignal }) => AsyncGenerator<import("./types.ts").ProviderStreamChunk> }).chatStream;

  const caps = provider.capabilities;
  const canStream = typeof chatStream === "function";

  // Phase 1 · F-03 — honor the declared capability catalog. A provider that
  // declares `streaming:false` is never asked to stream.
  const streaming = canStream && (caps === undefined ? true : caps.streaming === true);

  if (streaming) {
    let text = "";
    const toolCalls: ToolCall[] = [];
    let usage: { inTokens: number; outTokens: number } | undefined;
    let finish = false;

    const addToolCall = (tool: string, args: Record<string, unknown>) => {
      const existing = toolCalls.some(
        (t) => t.tool === tool && JSON.stringify(t.args) === JSON.stringify(args),
      );
      if (existing) return;
      toolCalls.push({ tool, args });
      sink?.({ type: "tool_call", id: `tc_${toolCalls.length}`, tool, args });
    };

    for await (const chunk of chatStream.call(provider, messages, tools, { signal: deps.signal })) {
      if (chunk.text) {
        text += chunk.text;
        sink?.({ type: "token", text: chunk.text });
      }
      if (chunk.toolCall) addToolCall(chunk.toolCall.tool, chunk.toolCall.args);
      if (chunk.usage) usage = chunk.usage;
      if (chunk.finish) finish = true;
    }

    // Parse the accumulated envelope for the authoritative done/message/tool calls.
    let done = finish;
    let message = text;
    let status: ModelTurn["status"] = toolCalls.length > 0 ? "parsed" : "empty";
    try {
      const parsed = repairToTurn(text);
      status = parsed.status ?? status;
      if (parsed.toolCalls.length > 0) {
        for (const tc of parsed.toolCalls) addToolCall(tc.tool, tc.args);
      }
      // Phase 1 · turn contract reconciliation: `parsed.done` is authoritative
      // ONLY when we actually decoded an envelope (status === "parsed"). When the
      // transport delivered a complete turn as a PLAIN message (no JSON envelope,
      // e.g. a native/decoded provider that marks finish:true), we keep the
      // transport's completion signal (`finish`) as `done` — the model did
      // produce real content, and overwriting it with repairToTurn's done:false
      // would loop every native/plain provider to max_steps.
      if (typeof parsed.done === "boolean" && parsed.status === "parsed") done = parsed.done;
      if (parsed.message) message = parsed.message;
      usage = usage ?? parsed.usage;
      // If there is real content but it produced no decodable turn, still a turn.
      if (message.trim().length > 0) status = "parsed";
    } catch {
      // Keep accumulated text + finish-based semantics.
    }

    const turn: ModelTurn = finalizeTurn({ message, toolCalls, done, usage, status });
    sink?.({ type: "usage", usage: { inTokens: turn.usage?.inTokens ?? 0, outTokens: turn.usage?.outTokens ?? 0 } });
    return { turn, streamed: true };
  }

  // Non-streaming path (honours streaming:false).
  const turn = await provider.chat(messages, tools, { signal: deps.signal });
  if (turn.message) sink?.({ type: "token", text: turn.message });
  for (const [i, tc] of (turn.toolCalls ?? []).entries()) {
    sink?.({ type: "tool_call", id: `tc_${i + 1}`, tool: tc.tool, args: tc.args });
  }
  if (turn.usage) sink?.({ type: "usage", usage: turn.usage });
  return { turn: finalizeTurn(turn), streamed: false };
}

/**
 * Phase 6 · Step 6 — the resume seed rebuilt from a `run.step` checkpoint.
 * `consumed` re-prices through the SAME CostGovernor, so a resumed run
 * inherits its real spend against the ceiling; `droppedMessages` records how
 * much oldest context the checkpoint's size bound forced away (honest
 * degradation, visible in the resume audit).
 */
export interface ResumeFrom {
  readonly messages: Message[];
  readonly stepIdx: number;
  readonly toolCallSeq: number;
  readonly consumed: { inTokens: number; outTokens: number; usd: number };
  readonly droppedMessages?: number;
}

/** Bound the checkpointed transcript; drop OLDEST messages first, keep recent. */
export function trimMessagesForCheckpoint(
  messages: readonly Message[],
  budgetChars = 40_000,
): { keep: Message[]; dropped: number } {
  const size = (arr: readonly Message[]): number =>
    arr.reduce((n, m) => n + (m.content?.length ?? 0) + 24, 0);
  let dropped = 0;
  const keep = [...messages];
  while (keep.length > 1 && size(keep) > budgetChars) {
    keep.shift();
    dropped++;
  }
  return { keep, dropped };
}

export async function runAgentLoop(
  task: string,
  mode: Mode,
  deps: AgentDeps,
): Promise<AgentResult> {
  const { provider, cwd } = deps;
  // Phase 1 · NO_COLOR — the agent status lines carry hardcoded ANSI escapes
  // (e.g. "\x1b[2m▸ think", "\x1b[33m⚠", "\x1b[36m◆") that bypass the themed
  // printer. When NO_COLOR is set they must not leak to the surface.
  const noColor = (process.env.NO_COLOR ?? "") !== "" || (process.env.FORCE_COLOR ?? "") === "0";
  const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");
  const say = (line: string): void => deps.say(noColor ? stripAnsi(line) : line);
  const sessionStore = deps.sessionStore ?? deps.store;
  const auditStore = deps.auditStore ?? deps.store;
  const costStore = deps.costStore ?? deps.store;
  const userMemoryStore = deps.userMemoryStore ?? deps.store;
  if (!sessionStore || !auditStore || !costStore) {
    throw new Error("Agent requires session/audit/cost stores");
  }
  const maxSteps = deps.maxSteps ?? 12;
  
  const sessionId = deps.sessionId ?? `s_${randomUUID().slice(0, 8)}`;
  if (deps.resumeFrom) {
    // A resumed run re-owns its existing session row (the crash left it
    // 'stopped'); the terminal path re-stamps it honestly. The resume itself
    // is audited as an explicit event — never hidden inside a normal start.
    auditStore.audit(
      "session.resume",
      {
        stepIdx: deps.resumeFrom.stepIdx,
        droppedMessages: deps.resumeFrom.droppedMessages ?? 0,
        note: "model re-asked from checkpoint — resumed context is deterministic, model output is not",
      },
      sessionId,
    );
  } else {
    sessionStore.createSession(sessionId, task.slice(0, 80), mode);
    auditStore.audit("session.start", { task, mode, provider: provider.id }, sessionId);
  }

  const budgetManager = new BudgetManager(costStore);
  // Phase 2 · F-12 — Governor v1: atomic admission over the same workspace
  // store. The reservation layer is wired whenever a cost store exists (it is
  // the same SQLite connection), so global caps are race-safe across
  // processes from the very first step.
  const reservationRepo = new ReservationRepo(costStore instanceof CostRepo ? costStore.store : costStore);
  const governor = new CostGovernor(
    deps.budget ?? {},
    deps.pricing ?? { inPerMTok: 0, outPerMTok: 0 },
    budgetManager,
    reservationRepo,
    sessionId,
  );
  // Phase 6 · F-12 — partitioned admission replaces the per-session
  // reservation layer: the worker's ceiling is its CHILD partition and the
  // ROOT envelope, checked atomically against every sibling's in-flight work.
  if (deps.partition) {
    governor.attachPartitionLedger(deps.partition);
    auditStore.audit("budget.envelope_bound", {
      taskId: deps.partition.taskId,
      childId: deps.partition.childId,
      ceilings: { usd: deps.budget?.maxUsd ?? null, tokens: deps.budget?.maxTokens ?? null },
    }, sessionId);
  }
  /** Phase 6 · Step 6 — seed a resumed run's meter with its settled usage. */
  if (deps.resumeFrom) {
    const c = deps.resumeFrom.consumed;
    governor.addUsage(c.inTokens, c.outTokens, c.usd);
  }
  const fireTask = (event: Parameters<NonNullable<typeof deps.taskLedger>["fire"]>[0], detail?: Record<string, unknown>): void => {
    try {
      deps.taskLedger?.fire(event, { ...(detail ?? {}), ...(deps.agentIdentity ? { agentId: deps.agentIdentity.agentId } : {}) });
    } catch {
      // The ledger is a durability/attribution layer on top of the loop's
      // own honest result; an illegal edge is a bug to surface in tests,
      // never a reason to change the run's outcome here.
    }
  };

  /**
   * Phase 2 · T2 — tool discovery.
   *
   * With a registry (every in-tree path), discovery and call resolution share
   * ONE arbitrated view: a contested bare name is advertised under its
   * qualified id and resolves to exactly one entry, or to nothing. Without a
   * registry (deprecated out-of-tree callers passing `extraTools`), the
   * pre-Phase-2 behaviour is preserved verbatim so nothing breaks.
   */
  const registry = deps.toolRegistry;
  const filteredAllow = deps.tools?.allow ? new Set(deps.tools.allow) : null;
  const filteredDeny = deps.tools?.deny ? new Set(deps.tools.deny) : null;

  let tools: Tool[];
  let resolveTool: (name: string) => Tool | undefined;

  if (registry) {
    tools = registry.discover({
      mode,
      ...(deps.tools?.allow ? { allow: deps.tools.allow } : {}),
      ...(deps.tools?.deny ? { deny: deps.tools.deny } : {}),
    });
    const offered = new Set(tools.map((t) => t.name));
    resolveTool = (name: string) => {
      // Only a name actually offered for this mode may resolve — a shadowed or
      // out-of-mode entry is never reachable, even by qualified id.
      if (!offered.has(name)) return undefined;
      const entry = registry.resolve(name);
      return entry ? entry.tool : tools.find((t) => t.name === name);
    };
  } else {
    const coreTools: Tool[] = toolsForMode(mode);
    const extraTools: Tool[] = mode === "agent" ? deps.extraTools ?? [] : [];
    tools = [...coreTools, ...extraTools].filter((tool) => {
      if (filteredAllow && !filteredAllow.has(tool.name)) return false;
      if (filteredDeny && filteredDeny.has(tool.name)) return false;
      return true;
    });
    const extraToolMap = new Map(extraTools.map((t) => [t.name, t]));
    resolveTool = (name: string) => getTool(name) ?? extraToolMap.get(name);
  }
  /**
   * Phase 4 · T1 — every tool on the canonical path sees the Trust service, so
   * a high-risk tool can demand an enforced environment. The run's identity
   * (`runId`) feeds the escalate-only lattice: isolation can only go up
   * within a run, never down. When no Trust service is wired (deprecated
   * out-of-tree callers), `hardened` still governs whether tools may fall
   * back to host authority at all.
   */
  const runId = deps.runId ?? deps.envelopeId ?? sessionId;
  const hardened = deps.hardened ?? true;
  const toolCtx: ToolContext = {
    cwd,
    // Phase 2 · F-11/F-26 — every approval raised inside the loop carries a
    // structured preview (diff / interpreted command) and the run identity,
    // so the consent plane can persist a durable, decision-ready record and
    // never has to trust raw model prose. The surface's own approve()
    // implementation receives the enriched request.
    approve: (req) => {
      let structuredPreview: import("../control/preview.ts").StructuredPreview | undefined;
      let riskTier: string | undefined = req.riskTier;
      try {
        if (!riskTier) {
          const entry = deps.toolRegistry?.resolve?.(req.tool) as
            | { riskTier?: string; tool?: { riskTier?: string } }
            | undefined;
          riskTier = entry?.riskTier ?? entry?.tool?.riskTier;
        }
        structuredPreview = buildStructuredPreview({
          tool: req.tool,
          args: req.args,
          reason: req.reason,
          cwd,
          riskTier,
        });
      } catch {
        // A preview failure must never block the approval flow itself.
        structuredPreview = undefined;
      }
      return deps.approve({
        ...req,
        structuredPreview,
        riskTier: riskTier ?? req.riskTier,
        sessionId,
        runId,
        taskId: runId,
      });
    },
    audit: (event: string, detail: Record<string, unknown>) =>
      auditStore.audit(event, detail, sessionId),
    egressAllowlist: deps.egressAllowlist ?? [],
    allowedHosts: deps.allowedHosts ?? [],
    dryRun: deps.dryRun ?? false,
    hardened,
    // Phase 06 · Step 15/18 — propagate cancellation into tool execution so a
    // Ctrl+C reaches interruptible subprocesses/network ops, not just the
    // loop's checkpoints. Tools that cannot interrupt safely ignore it.
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.onToolUse ? { onToolUse: deps.onToolUse } : {}),
    ...(deps.trust
      ? {
          runIsolated: async (req, exec) => {
            const ev = await deps.trust!.evaluate({
              request: req,
              runId,
              correlationId: runId,
              workspaceId: cwd,
              actor: "agent-loop",
              capability: `${req.capability.kind}:${req.capability.name}`,
              executable: exec,
            });
            if (ev.outcome.kind === "blocked") {
              return {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: ev.outcome.reason ?? "blocked",
                timedOut: false,
                blocked: true,
                reason: ev.outcome.reason,
                remediation: ev.outcome.remediation,
              };
            }
            if (ev.outcome.kind === "in_process_ok") {
              return {
                ok: false,
                exitCode: null,
                stdout: "",
                stderr: "high-risk action refused: trust gate returned in-process (placement not enforced)",
                timedOut: false,
                blocked: true,
                reason: "high-risk action refused: trust gate returned in-process (placement not enforced)",
              };
            }
            const o = ev.outcome.observation;
            return {
              ok: o.transportOk,
              exitCode: typeof o.statusCode === "number" ? o.statusCode : null,
              stdout: String(o.meta?.stdout ?? ""),
              stderr: (o.logs ?? []).join("\n"),
              timedOut: Boolean(o.meta?.timedOut),
              blocked: false,
              placement: typeof o.meta?.placement === "string" ? o.meta.placement : undefined,
              verified: ev.trust.verification?.verified ?? false,
            };
          },
        }
      : {}),
  };

  const messages: Message[] = [];

  // ── XR 4.5 — context injection ────────────────────────────────────────
  //
  // Two paths, chosen explicitly (never implicitly):
  //   • context package supplied → typed, channel-separated injection
  //   • otherwise                → the unchanged 4.4 memory block
  //
  // The context path is strictly safer: items are already scope-authorized,
  // trust-labelled, and split across instruction / data / quarantine channels,
  // so a retrieved item cannot occupy the instruction channel.
  const contextMode = deps.contextMode ?? (deps.contextPackage ? "context" : "legacy");
  let injectedContext = false;

  if (deps.contextPackage && contextMode !== "legacy") {
    try {
      const { messages: ctxMessages, injection } = buildContextMessages(deps.contextPackage, {
        workspaceRoot: cwd,
      });
      for (const m of ctxMessages) messages.push({ role: m.role, content: m.content });
      injectedContext = ctxMessages.length > 0;
      deps.onContextInjected?.(injection);

      auditStore.audit(
        "context.inject",
        {
          packageId: deps.contextPackage.packageId,
          packageVersion: deps.contextPackage.version,
          contentHash: deps.contextPackage.contentHash,
          items: injection.allItemIds.length,
          chars: injection.totalChars,
          // Channel counts prove the authority separation held.
          channels: injection.blocks.map((b) => ({
            channel: b.channel,
            tier: b.tier,
            role: b.role,
            items: b.itemIds.length,
          })),
          degraded: deps.contextPackage.degraded,
          degradedReasons: deps.contextPackage.degradedReasons,
          revalidated: deps.contextPackage.revalidation?.note,
        },
        sessionId,
      );
    } catch {
      /* best-effort: context injection must never break a run */
    }
  }

  // Legacy path — runs when no package was supplied, or in "both" mode.
  if (deps.memory?.enabled && (!injectedContext || contextMode === "both")) {
    try {
      const scope = projectScopeFromCwd(cwd);
      const limit = deps.memory.recallLimit ?? 5;
      // Stage 6 — prefer the canonical engine; fall back to the legacy store.
      const engine: MemoryStore | undefined =
        deps.memoryStore ??
        (userMemoryStore && "recallSemantic" in userMemoryStore
          ? (userMemoryStore as unknown as MemoryStore)
          : undefined);
      const hits = engine
        ? (deps.memory.semantic === false
          ? engine.recallExplain(task, { scope, k: limit })
          : await engine.recallSemanticExplain(task, { scope, k: limit }))
        : [];
      const recalled = hits.map((h) => h.entry);
      const block = buildMemoryBlock(recalled);
      if (block) {
        messages.push({ role: "system", content: block });
        auditStore.audit(
          "memory.recall",
          {
            count: recalled.length,
            ids: recalled.map((e) => e.id),
            scores: hits.map((h) => ({ id: h.entry.id, sim: Math.round(h.sim * 100) })),
            mode: contextMode,
          },
          sessionId,
        );
      }
    } catch {
      /* best-effort: recall must never break a run */
    }
  }

  if (deps.systemPrompt?.trim()) {
    messages.push({ role: "system", content: deps.systemPrompt.trim() });
  }

  if (!deps.resumeFrom) {
    messages.push({ role: "user", content: task });
  }
  let finalMessage = "";
  let stepIdx = 0;
  /**
   * Phase 6 · M-09 — run-scoped, MONOTONIC tool-call ids. Every call gets
   * `tc_<session>_<n>`; `n` continues across a resume (the checkpoint stores
   * the sequence), so trace identity survives crashes: the same logical call
   * keeps the same id in the step records, the checkpoint, and the stream.
   */
  let toolCallSeq = deps.resumeFrom?.toolCallSeq ?? 0;
  if (deps.resumeFrom) {
    // Rebuild the transcript from the checkpoint (dropped-oldest trimming is
    // the documented bound). No re-push of the user task — it is already in
    // the recovered transcript.
    messages.splice(0, messages.length, ...deps.resumeFrom.messages.map((m) => ({ ...m })));
    stepIdx = deps.resumeFrom.stepIdx + 1;
  }
  // Phase 6 · Step 1 — entering execution is a task transition (started).
  if (deps.taskLedger) fireTask(deps.resumeFrom ? "recover" : "start", { maxSteps, resumed: !!deps.resumeFrom });
  /** Phase 05 — emit provider_ready status once, before the first model turn. */
  let providerReadyEmitted = false;
  /** Phase 2 · F-06 — audit the empty-deny-list fallback exactly once per run. */
  let denyListAbsentAudited = false;

  // Stage 6 — fold the finished conversation into a compact session summary.
  // Best-effort, separate store, never throws, never confuses with long-term
  // memory. Only fires when the caller opted in.
  const maybeSaveSessionSummary = (): void => {
    if (!deps.sessionSummary?.enabled || !deps.memoryStore) return;
    try {
      const scope = projectScopeFromCwd(cwd);
      deps.memoryStore.saveSessionSummary(scope, messages, {
        minTurns: deps.sessionSummary.minTurns,
      });
    } catch {
      /* best-effort */
    }
  };

  /**
   * A-19 — cooperative cancellation. Checkpoints sit where the loop can stop
   * cleanly WITHOUT faking outcomes: before a step starts, after a model turn
   * resolves (before its tool calls run), and between tool calls. The
   * session/audit record says exactly what happened — interrupted by the
   * caller, at this step.
   */
  const isCancelled = (): boolean => deps.signal?.aborted === true;
  const cancelledResult = (steps: number): AgentResult => {
    say(`\x1b[33m⏸ cancelled — interrupted at your request\x1b[0m`);
    sessionStore.endSession(sessionId, "stopped");
    fireTask("cancel", { steps });
    auditStore.audit("session.cancelled", { steps, snapshot: governor.snapshot() }, sessionId);
    return {
      sessionId,
      finalMessage: finalMessage || "Interrupted at your request.",
      steps,
      stopped: "cancelled",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  };

  try {
    for (; stepIdx < maxSteps; stepIdx++) {
      if (isCancelled()) return cancelledResult(stepIdx);

      const decision = governor.checkBeforeStep();
      
      if (decision.allow && decision.warning) {
        say(`\x1b[33m⚠ ${decision.warning}\x1b[0m`);
      }

      if (!decision.allow) {
        auditStore.audit("budget.pause", { reason: decision.reason, snapshot: decision.snapshot }, sessionId);
        
        if (decision.suggestLocal) {
          say(`\x1b[33m⚠ Cloud budget exhausted. If you have a local model, consider using it.\x1b[0m`);
        }

        const extra = deps.onOverBudget
          ? await deps.onOverBudget(governor.meter(), decision.reason)
          : null;
        if (!extra) {
          say(`\x1b[33m⏸ stopped — ${decision.reason}\x1b[0m`);
          // Phase 12 · Phase C — a budget stop is its own honest state, not a
          // generic error: nothing failed, XR stopped to respect the cap.
          deps.onStreamEvent?.({ type: "status", status: "budget_stopped", message: decision.reason });
          sessionStore.endSession(sessionId, "stopped");
          fireTask("budget_block", { reason: decision.reason.slice(0, 300) });
          fireTask("fail", { reason: "budget ceiling reached; no raise granted" });
          auditStore.audit("budget.stop", { snapshot: governor.snapshot() }, sessionId);
          return {
            sessionId,
            finalMessage: finalMessage || `Stopped to respect your budget. ${governor.meter()}`,
            steps: stepIdx,
            stopped: "budget",
            routingDecisionId: deps.routingDecision?.decisionId,
          };
        }
        governor.raise(extra);
        fireTask("budget_block", { reason: "ceiling reached; human raise pending" });
        fireTask("budget_raised", { extra });
        auditStore.audit("budget.raised", { extra }, sessionId);
      }

      say(`\x1b[2m▸ think  (step ${stepIdx + 1}/${maxSteps}) · ${provider.label} · ${governor.meter()}\x1b[0m`);
      if (!providerReadyEmitted) {
        providerReadyEmitted = true;
        deps.onStreamEvent?.({
          type: "status",
          status: "provider_ready",
          provider: provider.id,
          model: (provider as { modelId?: string }).modelId,
        });
      }
      // Phase 12 · Phase C — publish truthful progress instead of leaving the
      // surface to guess. Both of these are real work the loop is doing right
      // here, so naming them is honest; the brief's §7 rule is that a state
      // must correspond to something actually happening.
      deps.onStreamEvent?.({ type: "status", status: "compacting_context" });
      const compacted = compact(messages, { maxChars: 16000, keepRecent: 6 });
      deps.onStreamEvent?.({ type: "status", status: "generating" });
      // GAP-001 — hand the caller's cancellation token to the transport itself.
      // Loop checkpoints alone could not interrupt an in-flight model call, so
      // a stalled provider was unrecoverable (reproduced live: Ctrl+C printed
      // "stopping at the next step" and then hung until the process was
      // killed). The provider now also applies a bounded default timeout.
      // Phase 05 — the turn prefers the provider's streaming variant so real
      // token deltas flow to the surface (see runModelTurn).
      const { turn, streamed } = await runModelTurn(provider, compacted, tools, deps);

      // ── Phase 1 · F-02/M-02/M-06 — strict turn contract ─────────────────────
      // A turn that is `error` (empty/undecodable, no content and no tool
      // calls) ends the run honestly as stopped:"error" with an audited
      // turn.empty / turn.undecodable event. Never a fake completion.
      if (turn.error) {
        const event = turn.status === "undecodable" ? "turn.undecodable" : "turn.empty";
        auditStore.audit(
          event,
          {
            step: stepIdx,
            // Hash of the tail (last-200 chars) — never the content itself.
            tailHash: tailHash(turn.message),
            reason: turn.error,
          },
          sessionId,
        );
        // Keep the run-failure marker for consumers that grep `session.error`.
        auditStore.audit("session.error", { error: turn.error, step: stepIdx }, sessionId);
        sessionStore.endSession(sessionId, "error");
        say(`\x1b[31m✗ error: ${turn.error}\x1b[0m`);
        deps.onStreamEvent?.({ type: "error", code: "turn.empty", message: turn.error });
        return {
          sessionId,
          finalMessage: turn.error,
          steps: stepIdx + 1,
          stopped: "error",
          meter: governor.meter(),
          routingDecisionId: deps.routingDecision?.decisionId,
        };
      }

      // NOTE (Phase 1): a `done:false` turn that carries a real message and no
      // tool calls is treated as an in-progress turn and the loop continues
      // (bounded by maxSteps → honest "max_steps"). We do NOT hard-fail it:
      // the model produced real content. The strict turn contract only fails on
      // a turn with NO content AND NO tool calls, which `finalizeTurn` already
      // converts to `turn.error` (empty/undecodable) above.
      // estimate it and flag it. A buggy/hostile provider cannot meter $0.
      if (turn.usage) {
        governor.record(turn.usage.inTokens, turn.usage.outTokens);
        try {
          const stepUsd =
            (turn.usage.inTokens / 1_000_000) * (deps.pricing?.inPerMTok ?? 0) +
            (turn.usage.outTokens / 1_000_000) * (deps.pricing?.outPerMTok ?? 0);
          costStore.recordCost(sessionId, provider.id, provider.label, turn.usage.inTokens, turn.usage.outTokens, stepUsd, "provider");
        } catch {
          /* best-effort */
        }
      } else {
        const est = estimateTurnUsage(turn, messages);
        governor.record(est.inTokens, est.outTokens);
        try {
          const stepUsd =
            (est.inTokens / 1_000_000) * (deps.pricing?.inPerMTok ?? 0) +
            (est.outTokens / 1_000_000) * (deps.pricing?.outPerMTok ?? 0);
          costStore.recordCost(sessionId, provider.id, provider.label, est.inTokens, est.outTokens, stepUsd, "estimated");
        } catch {
          /* best-effort */
        }
        auditStore.audit(
          "usage.estimated",
          { step: stepIdx, inTokens: est.inTokens, outTokens: est.outTokens },
          sessionId,
        );
      }
      sessionStore.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "think", null, {
        message: turn.message,
        toolCalls: turn.toolCalls.map((c) => c.tool),
      });

      if (turn.message && !streamed) say(`\x1b[36m◆ ${turn.message}\x1b[0m`);
      messages.push({ role: "assistant", content: JSON.stringify({ message: turn.message, tool_calls: turn.toolCalls, done: turn.done }) });

      // A-19 — an abort that landed while the model turn was in flight takes
      // effect HERE, before any of its tool calls run.
      if (isCancelled()) return cancelledResult(stepIdx + 1);

      if (turn.done && turn.toolCalls.length === 0) {
        finalMessage = turn.message;
        // Phase 12 · Phase C — "Finishing" covers the real work that still
        // happens after the last token: session summary + session close.
        // Naming it means the surface never looks frozen at the end of a run.
        deps.onStreamEvent?.({ type: "status", status: "finishing" });
        // Stage 6 — optionally fold the conversation into a session summary.
        maybeSaveSessionSummary();
        sessionStore.endSession(sessionId, "done");
        fireTask("succeed", { steps: stepIdx + 1 });
        auditStore.audit("session.done", { steps: stepIdx + 1, snapshot: governor.snapshot() }, sessionId);
        return {
          sessionId,
          finalMessage,
          steps: stepIdx + 1,
          stopped: "done",
          meter: governor.meter(),
          routingDecisionId: deps.routingDecision?.decisionId,
        };
      }

      for (let toolIdx = 0; toolIdx < turn.toolCalls.length; toolIdx++) {
        const call = turn.toolCalls[toolIdx];
        // Phase 6 · M-09 — run-scoped monotonic id (persisted in the step
        // record below): stable within a run AND across resume (the sequence
        // number continues from the checkpoint), unlike the old per-batch
        // `tc_<n>` that restarted on every step and every resume.
        const toolCallId = `tc_${sessionId}_${++toolCallSeq}`;
        // A-19 — between tool calls: a mid-batch abort skips the rest.
        if (isCancelled()) return cancelledResult(stepIdx + 1);

        // ── Phase 08 — unified policy boundary: every tool call passes through
        // the same authorization boundary (trust → lifecycle → scope → permission → mode)
        if (registry) {
          try {
            const { evaluatePolicy } = await import("../capabilities/policy.ts");
            const req = {
              capabilityId: call.tool,
              requestedBy: "model",
              runId,
              sessionId,
              scope: undefined,
              workspaceId: cwd,
              arguments: call.args as Record<string, unknown>,
              reason: `tool call from model`,
              mode,
              cwd,
            };
            // Phase 2 · F-06 — real deny-lists from workspace config. An absent
            // list (no workspace config on an out-of-tree path) is audited once
            // per run so the fallback is never silent.
            const deniedPermissions = deps.deniedPermissions ?? [];
            if (!deps.deniedPermissions && !denyListAbsentAudited) {
              denyListAbsentAudited = true;
              auditStore.audit(
                "capability.policy.deny_list_absent",
                { tool: call.tool, note: "no workspace config provided; denying by config is disabled for this run" },
                sessionId,
              );
            }
            const decision = evaluatePolicy(req as any, {
              registry,
              deniedPermissions,
              egressAllowlist: deps.egressAllowlist ?? [],
              allowedHosts: deps.allowedHosts ?? [],
              cwd,
              hardened,
            });
            if (!decision.allowed) {
              // For unknown tools, let existing tool.blocked path handle it (preserves T1 EFFECTS contract)
              if (decision.reason?.includes("not found")) {
                // fall through to unknown_tool handling below
              } else {
                const msg = `tool \"${call.tool}\" blocked by capability policy: ${decision.reason}`;
                say(`\x1b[31m✗ ${msg}\x1b[0m`);
                deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: false, error: decision.reason });
                messages.push({ role: "tool", name: call.tool, content: msg });
                auditStore.audit("capability.denied", { tool: call.tool, reason: decision.reason, policyTrace: decision.policyTrace }, sessionId);
                // Phase 2 · F-06 — a policy ENGINE fault (evaluatePolicy converted
                // an internal throw into a deny decision) is audited distinctly:
                // the boundary denied on error, not on a policy rule.
                if (decision.reason === "policy_error") {
                  auditStore.audit(
                    "capability.deny_error",
                    {
                      tool: call.tool,
                      error: decision.policyTrace?.join(" ") ?? "policy evaluation failed",
                      note: "denied (fail closed)",
                    },
                    sessionId,
                  );
                }
                // Also audit tool.blocked for backward compat with envelope tests that expect tool.blocked
                auditStore.audit("tool.blocked", { tool: call.tool, mode, reason: decision.reason }, sessionId);
                continue;
              }
            }
          } catch (e) {
            // ── Phase 2 · F-06 — DENY-ON-THROW (the "fail closed?" question is
            // answered: yes). A policy evaluation failure is a denial, not a
            // pass: the tool is NOT executed, the event is audited as
            // `capability.deny_error`, and the loop continues to the next call.
            const msg = `tool "${call.tool}" blocked by capability policy: policy_error`;
            say(`\x1b[31m✗ ${msg}\x1b[0m`);
            deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: false, error: "policy_error" });
            messages.push({ role: "tool", name: call.tool, content: msg });
            auditStore.audit(
              "capability.deny_error",
              { tool: call.tool, error: (e as Error).message, note: "evaluation threw — denied (fail closed)" },
              sessionId,
            );
            // Backward-compat marker: policy denials of this class still read as denials.
            auditStore.audit("capability.denied", { tool: call.tool, reason: "policy_error" }, sessionId);
            continue;
          }
        }

        const tool = resolveTool(call.tool);
        if (!tool || !tools.some((t) => t.name === call.tool)) {
          /**
           * Phase 06 · Step 30 — a request for a nonexistent tool is a
           * MALFORMED TOOL CALL: deterministic, NON_RETRYABLE. It is surfaced
           * honestly to the model and the audit trail — never executed, never
           * silently retried, never allowed to corrupt the session.
           */
          const msg = `tool "${call.tool}" is not available in ${mode} mode`;
          say(`\x1b[31m✗ ${msg}\x1b[0m`);
          deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: false, error: msg });
          messages.push({ role: "tool", name: call.tool, content: msg });
          // Phase 06 — `tool.blocked` is the established contract; the
          // `reason` records WHY (nonexistent tool = malformed, non-retryable).
          auditStore.audit("tool.blocked", { tool: call.tool, mode, reason: "unknown_tool" }, sessionId);
          continue;
        }
        /**
         * Phase 06 · Step 30 — invalid arguments are rejected BEFORE
         * execution. args must be a plain object; anything else is a
         * malformed call (policy/safety checks receive untrusted input
         * otherwise). Dangerous paths are still caught by the tools' own
         * path-escape guards — this is the first gate, not the only one.
         */
        if (call.args === null || typeof call.args !== "object" || Array.isArray(call.args)) {
          const msg = `tool "${call.tool}" received invalid arguments (expected an object)`;
          say(`\x1b[31m✗ ${msg}\x1b[0m`);
          deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: false, error: msg });
          messages.push({ role: "tool", name: call.tool, content: msg });
          auditStore.audit("tool.malformed_call", { tool: call.tool, reason: "invalid_arguments" }, sessionId);
          continue;
        }
        say(`\x1b[2m▸ tool   ⚙ ${call.tool}(${JSON.stringify(call.args)})\x1b[0m`);
        // Phase 12 · Phase C — the surface learns a tool is running from the
        // canonical vocabulary (not by scraping the say() line above). The
        // matching `tool_result` event carries the outcome.
        deps.onStreamEvent?.({ type: "status", status: "tool_running", message: call.tool });
        try {
          const result = await tool.run(call.args, toolCtx);
          const tag = result.ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
          say(`  ${tag} ${result.output.split("\n")[0].slice(0, 100)}`);
          deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: result.ok, result: result.output });
          sessionStore.addStep(`st_${randomUUID().slice(0, 8)}`, sessionId, stepIdx, "act", call.tool, {
            ok: result.ok,
            // Phase 6 · M-09 — the trace identity for this call, durable.
            toolCallId,
          });
          // GAP-003 — tool output is UNTRUSTED DATA. Before this it was pushed
          // raw, so any file/page/MCP response could inject instructions into
          // the model's stream. Now it is scanned, delimited and audited.
          // Non-blocking by design: the content is still delivered in full.
          const framed = frameToolOutput(call.tool, result.output);
          if (framed.flagged) {
            say(
              `  \x1b[33m! untrusted content flagged in ${call.tool} output: ${framed.signatures.join(", ")}\x1b[0m`,
            );
            auditStore.audit(
              "security.untrusted_content",
              { tool: call.tool, signatures: framed.signatures },
              sessionId,
            );
          }
          messages.push({ role: "tool", name: call.tool, content: framed.content });
          toolCtx.onToolUse?.({ tool: call.tool, ok: result.ok });
        } catch (e) {
          const msg = `tool error: ${(e as Error).message}`;
          say(`  \x1b[31m✗ ${msg}\x1b[0m`);
          deps.onStreamEvent?.({ type: "tool_result", id: toolCallId, tool: call.tool, ok: false, error: (e as Error).message });
          messages.push({ role: "tool", name: call.tool, content: msg });
          auditStore.audit("tool.error", { tool: call.tool, error: (e as Error).message }, sessionId);
          toolCtx.onToolUse?.({ tool: call.tool, ok: false, error: (e as Error).message });
        }
      }

      // ── Phase 6 · Step 6 — per-step durable checkpoint ───────────────────
      // Written at the STEP boundary (transcript + meter + tool-call sequence),
      // under the store's WriteGate via the checkpoint repo. A kill -9 after
      // this row means the NEXT resume continues from stepIdx+1 with exactly
      // the meter the crash left behind — no double-spend, no lost step.
      if (deps.checkpointSink) {
        try {
          const snap = governor.snapshot();
          const { keep, dropped } = trimMessagesForCheckpoint(messages);
          deps.checkpointSink("run.step", {
            stepIdx,
            droppedMessages: dropped,
            consumed: { inTokens: snap.inTokens, outTokens: snap.outTokens, usd: snap.usd },
            toolCallSeq,
            messages: keep,
          });
        } catch {
          /* checkpoint failure never changes the run's outcome; the resume
             that needs it will report the gap honestly */
        }
      }
      // (a step boundary is NOT a task state change — the checkpoint row is
      // the durable fact; ledger edges belong to terminals and gates)
    }

    sessionStore.endSession(sessionId, "stopped");
    // Phase 6 honesty: truncation WITH a substantive answer completes the task
    // visibly; truncation WITHOUT one is a failure (mirrors the S-2 worker rule).
    fireTask(finalMessage ? "succeed" : "fail", { stopped: "max_steps", steps: stepIdx });
    auditStore.audit("session.max_steps", { steps: maxSteps }, sessionId);
    return {
      sessionId,
      finalMessage: finalMessage || "(stopped at step limit)",
      steps: stepIdx,
      stopped: "max_steps",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  } catch (e) {
    // GAP-001 — a run the USER cancelled must end `cancelled`, not `error`.
    // Now that the caller's signal reaches the transport, an in-flight model
    // call can reject with ProviderAbortError; reporting that as a generic
    // error would be exactly the fake/false outcome XR forbids (the loop's own
    // contract is success | failed | cancelled, honestly stamped).
    if (isCancellation(e)) return cancelledResult(stepIdx);
    sessionStore.endSession(sessionId, "error");
    fireTask("fail", { error: (e as Error).message.slice(0, 300) });
    auditStore.audit("session.error", { error: (e as Error).message }, sessionId);
    say(`\x1b[31m✗ error: ${(e as Error).message}\x1b[0m`);
    return {
      sessionId,
      finalMessage: (e as Error).message,
      steps: stepIdx,
      stopped: "error",
      meter: governor.meter(),
      routingDecisionId: deps.routingDecision?.decisionId,
    };
  } finally {
    // Phase 2 · F-12 — settle the open reservation on every exit path so a
    // finished run never leaves phantom headroom beyond the short TTL window.
    governor.close();
  }
}

/**
 * @deprecated Phase 2 · T1 — use `AgentService.execute()` / the execution
 * envelope. Retained ONLY as a compatibility alias for out-of-tree callers and
 * for the pre-existing unit tests that exercise the loop in isolation.
 *
 * In-tree surfaces MUST NOT call this: `test/core/no-bypass.test.ts` asserts
 * that no production module outside `src/core/execution/` imports the loop.
 *
 * Removal: 2.0.0 (ADR-0002).
 */
export const runAgent = runAgentLoop;
