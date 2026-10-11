/**
 * XR — approval bridge for chat surfaces (Phase 26 shared layer).
 *
 * A risky action becomes a durable approval record (control/approval-store).
 * The chat shows it with buttons, and the first decision wins from ANY
 * surface: the desktop, another chat, or this one. When the outcome lands,
 * the message this bridge sent is edited so no stale buttons remain.
 *
 * Surface-specific parts are injected: how the request and the resolved text
 * are rendered, and the audit event prefix. This module knows nothing about
 * a platform's wire format.
 */
import type { Store } from "../state/workspace-store.ts";
import { getApprovalStore, type ApprovalStoreConfig } from "../control/approval-store.ts";
import { renderPreviewText, type StructuredPreview } from "../control/preview.ts";
import type { ApprovalOutcomeLabel, BotSurface, BotSurfaceId, ChatRef, MessageRef } from "./types.ts";

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

export interface RenderedApprovalRequest {
  id: string;
  tool: string;
  reason: string;
  preview?: string;
  riskTier: string;
}

export interface ApprovalBridgeOptions<Msg> {
  surface: BotSurface<Msg>;
  store: Store;
  /** Approval TTLs from config, read per request so edits apply immediately. */
  storeConfig: () => ApprovalStoreConfig;
  renderRequest: (p: RenderedApprovalRequest) => Msg;
  renderResolved: (p: { tool: string; outcome: ApprovalOutcomeLabel; surface?: string }) => string;
}

interface Slot {
  chatId: ChatRef;
  messageId?: MessageRef;
}

export class ApprovalBridge<Msg> {
  /** Pending approvals: id -> resolver. The agent loop awaits these. */
  readonly pending = new Map<string, (ok: boolean) => void>();
  /** Approval id -> the chat that owns it and the message to edit when decided. */
  private slots = new Map<string, Slot>();

  constructor(private readonly opts: ApprovalBridgeOptions<Msg>) {}

  private get channel(): BotSurfaceId {
    return this.opts.surface.id;
  }

  private audit(suffix: string, detail: Record<string, unknown>): void {
    this.opts.store.audit(`${this.channel}.approval.${suffix}`, detail);
  }

  /**
   * Approval callback for the agent loop. Resolves with the decision, from
   * whichever surface made it, or false on timeout.
   */
  request(chatId: ChatRef, req: ApprovalRequest): Promise<boolean> {
    const approvalStore = getApprovalStore(this.opts.store, this.opts.storeConfig());
    const handle = approvalStore.request({
      tool: req.tool,
      reason: req.reason,
      args: req.args,
      preview: req.structuredPreview,
      riskTier: req.riskTier,
      surface: this.channel,
      taskId: req.taskId ?? null,
      runId: req.runId ?? null,
      sessionId: req.sessionId ?? null,
    });
    this.audit("request", { tool: req.tool, approvalId: handle.id });
    const slot: Slot = { chatId };
    this.slots.set(handle.id, slot);

    // The message is edited once the outcome is known, whichever surface decided.
    let resolvedText: string | null = null;
    void handle.outcome.then((o) => {
      this.pending.delete(handle.id);
      this.slots.delete(handle.id);
      const outcome: ApprovalOutcomeLabel = o.timedOut ? "expired" : o.approved ? "approved" : "rejected";
      if (o.timedOut) this.audit("timeout", { tool: req.tool, approvalId: handle.id });
      resolvedText = this.opts.renderResolved({ tool: req.tool, outcome, surface: o.decidedBy?.channel });
      if (slot.messageId !== undefined) void this.opts.surface.edit(chatId, slot.messageId, resolvedText);
    });

    const msg = this.opts.renderRequest({
      id: handle.id,
      tool: req.tool,
      reason: req.reason,
      preview: handle.record.preview ? renderPreviewText(handle.record.preview) : req.preview,
      riskTier: handle.record.riskTier,
    });
    void this.opts.surface.send(chatId, msg).then((messageId) => {
      slot.messageId = messageId;
      // Decided before the message id came back: apply the real outcome now.
      if (resolvedText !== null && messageId !== undefined) void this.opts.surface.edit(chatId, messageId, resolvedText);
    });

    return new Promise<boolean>((resolve) => {
      this.pending.set(handle.id, resolve);
      void handle.outcome.then((o) => resolve(o.approved));
    });
  }

  /** True when the approval exists and was shown in this chat. */
  ownsIn(id: string, chatId: ChatRef): boolean {
    const slot = this.slots.get(id);
    return slot !== undefined && slot.chatId === chatId;
  }

  /**
   * Answer an approval from a chat. The chat must own it, so a callback
   * forwarded from another chat cannot decide it.
   */
  decideFromChat(
    id: string,
    approved: boolean,
    chatId: ChatRef,
    userId: string | number,
  ): "decided" | "not_found" | "already" {
    if (!this.ownsIn(id, chatId)) return "not_found";
    const decided = getApprovalStore(this.opts.store).decide(id, approved, {
      channel: this.channel,
      userId: String(userId),
    });
    if (!decided) return "already";
    const resolve = this.pending.get(id);
    this.pending.delete(id);
    resolve?.(approved);
    this.audit("answered", { decision: approved ? "approve" : "reject", approvalId: id });
    return "decided";
  }
}
