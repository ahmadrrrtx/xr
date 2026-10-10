/**
 * XR — shared chat-bot runtime (platform-neutral).
 *
 * Holds the per-chat state every chat surface needs. It used to live inside
 * TelegramBot, and Discord and WhatsApp need the same guarantees:
 *   • a per-chat token bucket (rate limit)
 *   • one running task per chat, cancellable with /stop
 *   • per-chat spend ceilings (Governor envelope per chat)
 *   • an in-memory reply context for follow-ups
 *   • durable approvals that any surface can answer, and that are edited
 *     once decided, from any surface
 *
 * Adapters keep their wire protocol, rendering, pairing, and settings. They
 * never call the agent loop directly: runTurn() goes through executeOnSurface,
 * so the execution-envelope invariant holds on every surface.
 *
 * Audit events are prefixed with the surface id ("telegram.approval.request"),
 * so existing Telegram audit trails keep their names.
 */
import type { Store } from "../state/workspace-store.ts";
import type { SurfaceId } from "../core/execution/envelope.ts";
import type { StructuredPreview } from "../control/preview.ts";
import { ReplyContext, type ChatKey } from "./context.ts";
import { KeyedTokenBuckets, type RateLimitConfig } from "../automation/token-bucket.ts";
import { executeOnSurface } from "../services/surface-execution.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import { renderPreviewText } from "../control/preview.ts";
import { buildProvider } from "../providers/factory.ts";
import { PRESETS } from "../providers/presets.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { wrapUntrusted } from "../context/injection.ts";
import { loadConfig } from "../config/config.ts";

export type AppConfig = ReturnType<typeof loadConfig>["config"];
export type MessageRef = string | number;

/** What the approval UI needs to show. Adapters render it however they like. */
export interface ApprovalView {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier?: string;
}

export type ApprovalOutcome = "approved" | "rejected" | "expired";

/** Adapter hooks for showing an approval and marking it decided. */
export interface ApprovalPresenter {
  /** Post the approval prompt. Resolves to a ref used to edit it later. */
  show(view: ApprovalView): Promise<MessageRef | undefined>;
  /** Edit the prompt once decided (from this chat, desktop, or timeout). */
  resolved(ref: MessageRef, outcome: { tool: string; outcome: ApprovalOutcome; channel?: string }): Promise<void>;
}

export interface ApprovalRequest {
  tool: string;
  reason: string;
  preview?: string;
  args?: Record<string, unknown>;
  structuredPreview?: StructuredPreview;
  riskTier?: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
}

export interface BotRuntimeOptions {
  surface: SurfaceId;
  store: Store;
  /** Redacted diagnostics. Adapters pass their own redaction. */
  log?: (line: string) => void;
}

/** One inbound task, already parsed and attachment-extracted by the adapter. */
export interface AgentRun {
  chatKey: ChatKey;
  userId?: string | number;
  text: string;
  /** Extracted attachment blocks, already wrapped as untrusted input. */
  blocks: string[];
  /** Quoted reply context, already wrapped as untrusted input. */
  quote: string;
  /** Short notes shown to the model (e.g. an attachment that was skipped). */
  notes: string[];
  /** Per-chat overrides set by the user. */
  chat: { model?: string; budgetUsd?: number };
  /** Inline `$x` ceiling from the message text, if any. */
  inlineBudgetUsd?: number;
  /** Per-chat spend ceiling from the surface config. */
  chatBudgets?: { maxUsd?: number; maxTokens?: number };
  config: AppConfig;
  cwd?: string;
  approvals: ApprovalPresenter;
}

/** Reply hooks, called in order during a run. Failures are the adapter's to render. */
export interface AgentReply {
  typing(): Promise<void>;
  started(): Promise<void>;
  answer(body: string, footer: string): Promise<void>;
  failed(): Promise<void>;
}

export type RefusalReason = "paused" | "empty" | "busy" | "budget";

export type RunOutcome =
  | { kind: "refused"; reason: RefusalReason; spent?: number; cap?: number }
  | { kind: "finished"; stopped: string }
  | { kind: "failed" };

export class BotRuntime {
  readonly replies = new ReplyContext(20);
  /** Running task per chat. */
  readonly active = new Map<ChatKey, AbortController>();
  /** Pending approvals: id → resolver. */
  readonly pending = new Map<string, (ok: boolean) => void>();
  /** Per-chat spend against the surface's chat budget. */
  readonly chatSpendUsd = new Map<ChatKey, number>();
  readonly chatSpendTokens = new Map<ChatKey, number>();
  /** Set by the adapter's /pause. Stops new tasks, not running ones. */
  paused = false;

  private approvalSlots = new Map<string, { chatKey: ChatKey; ref?: MessageRef }>();
  private rate = new KeyedTokenBuckets({ tokens: 1, refillPerSec: 0 });
  private rateCfgKey = "";

  constructor(private readonly opts: BotRuntimeOptions) {}

  private get surface(): string {
    return this.opts.surface;
  }

  private audit(event: string, payload: Record<string, unknown>): void {
    this.opts.store.audit(`${this.surface}.${event}`, payload);
  }

  private log(line: string): void {
    this.opts.log?.(line);
  }

  // ── rate limit ───────────────────────────────────────────────────────────

  /** True when this chat may send another message now. Audits refusals. */
  allowMessage(chatKey: ChatKey, rl: RateLimitConfig, extra: Record<string, unknown> = {}, now = Date.now()): boolean {
    const key = JSON.stringify(rl);
    if (key !== this.rateCfgKey) {
      this.rate = new KeyedTokenBuckets({ tokens: rl.tokens, refillPerSec: rl.refillPerSec });
      this.rateCfgKey = key;
    }
    if (this.rate.allow(String(chatKey), now)) return true;
    this.audit("rate_limited", { ...extra, chatId: chatKey });
    return false;
  }

  // ── running tasks ────────────────────────────────────────────────────────

  isBusy(chatKey: ChatKey): boolean {
    return this.active.has(chatKey);
  }

  /** Abort the running task in a chat. False when nothing was running. */
  abortChat(chatKey: ChatKey): boolean {
    const ac = this.active.get(chatKey);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /** Cancel every running task (used on shutdown). */
  cancelAll(): void {
    for (const ac of this.active.values()) ac.abort();
  }

  // ── approvals ────────────────────────────────────────────────────────────

  /** True when `id` is an approval this surface is waiting on in `chatKey`. */
  ownsApproval(id: string, chatKey: ChatKey): boolean {
    const slot = this.approvalSlots.get(id);
    return Boolean(slot && slot.chatKey === chatKey);
  }

  /**
   * Approval callback used by the agent loop.
   *
   * Every approval is a DURABLE record (the store id is the button id). The
   * prompt is edited when the decision lands, from any surface, so a chat
   * never shows live buttons for an approval the desktop already answered.
   */
  approver(chatKey: ChatKey, presenter: ApprovalPresenter) {
    return (req: ApprovalRequest): Promise<boolean> => {
      const { config } = loadConfig();
      const approvalStore = getApprovalStore(this.opts.store, {
        defaultTtlMs: config.approvals.defaultTtlMs,
        perSurface: config.approvals.perSurface,
      });
      const handle = approvalStore.request({
        tool: req.tool,
        reason: req.reason,
        args: req.args,
        preview: req.structuredPreview,
        riskTier: req.riskTier,
        surface: this.opts.surface,
        taskId: req.taskId ?? null,
        runId: req.runId ?? null,
        sessionId: req.sessionId ?? null,
      });
      this.audit("approval.request", { tool: req.tool, approvalId: handle.id });
      const slot: { chatKey: ChatKey; ref?: MessageRef } = { chatKey };
      this.approvalSlots.set(handle.id, slot);

      // The prompt is edited once the outcome is known, whichever surface decided.
      let resolution: { tool: string; outcome: ApprovalOutcome; channel?: string } | null = null;
      void handle.outcome.then((o) => {
        this.pending.delete(handle.id);
        this.approvalSlots.delete(handle.id);
        const outcome: ApprovalOutcome = o.timedOut ? "expired" : o.approved ? "approved" : "rejected";
        if (o.timedOut) this.audit("approval.timeout", { tool: req.tool, approvalId: handle.id });
        resolution = { tool: req.tool, outcome, channel: o.decidedBy?.channel };
        if (slot.ref !== undefined) void presenter.resolved(slot.ref, resolution);
      });

      void presenter
        .show({
          id: handle.id,
          tool: req.tool,
          reason: req.reason,
          preview: handle.record.preview ? renderPreviewText(handle.record.preview) : req.preview,
          riskTier: handle.record.riskTier,
        })
        .then((ref) => {
          slot.ref = ref;
          // Decided before the prompt came back: apply the real outcome now.
          if (resolution !== null && ref !== undefined) void presenter.resolved(ref, resolution);
        });

      return new Promise<boolean>((resolve) => {
        this.pending.set(handle.id, resolve);
        void handle.outcome.then((o) => resolve(o.approved));
      });
    };
  }

  /** Decide an approval from a chat. Returns what happened, for the reply text. */
  decideFromChat(id: string, approved: boolean, chatKey: ChatKey, actor: string): "decided" | "not_found" | "already" {
    if (!this.ownsApproval(id, chatKey)) return "not_found";
    const decided = getApprovalStore(this.opts.store).decide(id, approved, {
      channel: this.surface,
      userId: actor,
    });
    if (!decided) return "already";
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(approved);
    this.audit("approval.answered", { decision: approved ? "approve" : "reject", approvalId: id });
    return "decided";
  }

  // ── agent runs ───────────────────────────────────────────────────────────

  /**
   * Run one task for a chat. Refusals return before any state changes. Once
   * a run starts, the reply hooks are called in order and the outcome records
   * whether the answer was delivered.
   */
  async runTurn(run: AgentRun, reply: AgentReply): Promise<RunOutcome> {
    if (this.paused) return { kind: "refused", reason: "paused" };
    if (!run.text && !run.blocks.length) return { kind: "refused", reason: "empty" };
    if (this.active.has(run.chatKey)) return { kind: "refused", reason: "busy" };

    const config = run.config;
    const chatCap = run.chatBudgets?.maxUsd;
    const spent = this.chatSpendUsd.get(run.chatKey) ?? 0;
    if (chatCap != null && spent >= chatCap) {
      this.audit("chat_budget", { chatId: run.chatKey, spent, cap: chatCap, stopped: "budget" });
      return { kind: "refused", reason: "budget", spent, cap: chatCap };
    }
    const remaining = chatCap != null ? Math.max(0, chatCap - spent) : undefined;

    const providerId = config.defaults.provider;
    const modelId = run.chat.model ?? config.defaults.model;
    const perTask = Math.min(run.chat.budgetUsd ?? config.budget.perTaskUsd, run.inlineBudgetUsd ?? Infinity);

    const history = this.replies.recent(run.chatKey).slice(-6);
    const historyBlock = history.length
      ? wrapUntrusted(history.map((t) => `${t.role}: ${t.text}`).join("\n"), { kind: `${this.surface}_history`, label: "earlier in this chat" })
      : "";
    const task = [...run.blocks, run.quote, historyBlock, ...run.notes.map((n) => `(${n})`), run.text || "Review the attachment(s) above and respond."]
      .filter(Boolean)
      .join("\n\n");

    const ac = new AbortController();
    this.active.set(run.chatKey, ac);
    await reply.typing();
    const typingTimer = setInterval(() => void reply.typing(), 4000);
    const costBefore = this.opts.store.costSummary().totalUsd;
    try {
      await reply.started();
      const provider = buildProvider(config, { model: modelId });
      const result = await executeOnSurface({
        task,
        mode: "agent",
        surface: this.opts.surface,
        store: this.opts.store,
        provider,
        modelId,
        cwd: run.cwd ?? process.cwd(),
        say: () => {},
        approve: this.approver(run.chatKey, run.approvals),
        signal: ac.signal,
        budget: {
          maxUsd: isLocal(providerId)
            ? remaining
            : remaining != null
              ? Math.min(perTask, remaining)
              : perTask,
          maxTokens: run.chatBudgets?.maxTokens ?? config.budget.perTaskTokens,
        },
        pricing: priceFor(providerId, modelId),
        egressAllowlist: config.security.egressAllowlist,
      });
      const charged = Math.max(0, this.opts.store.costSummary().totalUsd - costBefore);
      this.chatSpendUsd.set(run.chatKey, spent + charged);

      const body = result.finalMessage?.trim() || (result.stopped === "cancelled" ? "Stopped." : "(no answer)");
      const footer = `${result.stopped}${result.meter ? ` · ${result.meter}` : ""}`;
      this.replies.push(run.chatKey, { role: "user", text: run.text || "(attachment)" });
      this.replies.push(run.chatKey, { role: "assistant", text: body });
      await reply.answer(body, footer);
      return { kind: "finished", stopped: result.stopped };
    } catch (err) {
      this.log(`task failed: ${(err as Error).message}`);
      await reply.failed();
      return { kind: "failed" };
    } finally {
      clearInterval(typingTimer);
      this.active.delete(run.chatKey);
    }
  }
}

/** Model ids the chat may pick, with the configured default first. */
export function knownModelsFor(provider: string, fallback: string): string[] {
  const list = PRESETS[provider]?.knownModels ?? [];
  return [...new Set([fallback, ...list])];
}
