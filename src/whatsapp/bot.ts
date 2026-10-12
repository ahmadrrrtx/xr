/**
 * XR — WhatsApp bot runtime (Phase 26).
 *
 * Transport is `WhatsAppClient` (linked device socket); this file owns the
 * product rules:
 *
 *   • FAIL-CLOSED access. Only allow-listed numbers are answered; groups,
 *     broadcasts and status traffic are dropped; a stranger's message is
 *     ignored in total silence. Linking the device trusts nobody by itself.
 *   • Risky actions become a numbered approval menu (`[1] Approve [2] Deny
 *     [3] View details`) on the same durable approval record as the desktop,
 *     Telegram and Discord — answer from whichever surface is in reach.
 *   • WhatsApp has no message editing, so outcomes and long answers arrive as
 *     follow-ups; replies quote the message they answer.
 *   • At most one outbound message per second per chat, and attachments are
 *     capped before download and quarantined as untrusted input.
 *
 * Nothing in this file knows a phone number in full: logs and audits carry the
 * last four digits (`maskPhone`).
 */
import { basename } from "node:path";
import type { Store } from "../state/workspace-store.ts";
import { BotRuntime } from "../bots/runtime.ts";
import { runTask as runTaskTurn, type Delivery, type TurnContext } from "./tasks.ts";
import type { ApprovalRequest } from "../bots/approvals.ts";
import { NO_MODEL_REPLY } from "../bots/voice-note.ts";
import type { ChatSettings } from "../bots/types.ts";
import type { SpeechToText } from "../voice/stt.ts";
import { WhatsAppGate } from "./auth.ts";
import { maskPhone } from "./auth.ts";
import { parseDecision, parseWhatsAppText, type WhatsAppCommand } from "./commands.ts";
import {
  approvalDetailsText,
  approvalMessage,
  approvalResolvedText,
  blockedText,
  budgetText,
  helpText,
  splitForWhatsApp,
  statusMessage,
} from "./render.ts";
import { collectMediaBlocks, handleVoiceNote, type WhatsAppAttachmentDeps } from "./attachments.ts";
import type { WhatsAppConnectionState, WhatsAppIncoming } from "./types.ts";
import { loadConfig } from "../config/config.ts";
import { getApprovalStore, type ApprovalStoreConfig } from "../control/approval-store.ts";
import { renderPreviewText } from "../control/preview.ts";
import { PRESETS } from "../providers/presets.ts";
import { runLab } from "../security/lab.ts";
import { wrapUntrusted } from "../context/injection.ts";
import { DEFAULT_TELEGRAM_RATE_LIMIT } from "../automation/token-bucket.ts";

/** WhatsApp's own ceiling: one message per second per chat, never more. */
const MAX_OUTBOUND_PER_SEC = 1;

export interface WhatsAppTransport {
  sendText(chatId: string, text: string, opts?: { quoteMessageId?: string | null }): Promise<string | undefined>;
  setTyping(chatId: string): Promise<void>;
  markRead?: (raw: unknown) => Promise<void>;
}

export interface WhatsAppBotDeps {
  store: Store;
  /** Bound transport (the manager passes the live client). */
  transport: WhatsAppTransport;
  /** Live allow-list, read from config on every message. */
  allowedContacts?: () => readonly string[];
  /** Live outbox switch, read from config on every message. */
  respondToOutbox?: () => boolean;
  /** The gate. Created internally when absent (tests inject one). */
  gate?: WhatsAppGate;
  /** Persisted outbox numbers, for the gate. */
  outbox?: readonly string[];
  onOutboxChange?: (list: string[]) => void;
  /** Per-chat settings (model, budget). Mutated in place; `persist` saves. */
  chats?: Record<string, ChatSettings>;
  /** Display-only contact names, keyed by phone. */
  labels?: Record<string, string>;
  persist?: () => void;
  /** The sender asked XR to stop: the manager drops them from the allow-list. */
  onRevoke?: (phone: string) => void;
  /** Speech-to-text for voice notes. Absent = the "no model" reply. */
  stt?: Pick<SpeechToText, "describeAsync" | "transcribe">;
  /** Redacted diagnostics for the manager's log ring. */
  onLog?: (line: string) => void;
  /** Attachment cap in bytes (default: config.whatsapp.maxAttachmentBytes). */
  maxAttachmentBytes?: () => number;
  /** Connection facts for `/xr status`. */
  connection?: () => WhatsAppConnectionState;
  linkedAs?: () => string | null;
  /** Test seam: clock. */
  now?: () => number;
}

export class WhatsAppBot {
  readonly gate: WhatsAppGate;
  private readonly runtime: BotRuntime<string>;
  private readonly now: () => number;
  /** chatId → earliest time the next outbound message may leave. */
  private readonly nextSendAt = new Map<string, number>();

  constructor(private readonly deps: WhatsAppBotDeps) {
    this.now = deps.now ?? Date.now;
    this.gate =
      deps.gate ??
      new WhatsAppGate({
        allowed: () => this.deps.allowedContacts?.() ?? [],
        respondToOutbox: () => this.deps.respondToOutbox?.() ?? false,
        outbox: deps.outbox,
        onOutboxChange: (list) => this.deps.onOutboxChange?.(list),
      });

    this.runtime = new BotRuntime<string>({
      surface: {
        id: "whatsapp",
        send: (chatId, msg) => this.deps.transport.sendText(String(chatId), msg),
        // WhatsApp has no message editing. The bridge edits on any-surface
        // decisions, so an edit becomes a follow-up — which is what a person
        // reading the chat wants anyway.
        edit: (chatId, _messageId, text) => this.deps.transport.sendText(String(chatId), text).then(() => undefined),
        setTyping: (chatId) => this.deps.transport.setTyping(String(chatId)),
      },
      store: deps.store,
      storeConfig: () => {
        const { config } = loadConfig();
        return { defaultTtlMs: config.approvals.defaultTtlMs, perSurface: config.approvals.perSurface };
      },
      renderRequest: (p) =>
        approvalMessage({ id: p.id, tool: p.tool, reason: p.reason, preview: p.preview, riskTier: p.riskTier }),
      renderResolved: (p) => approvalResolvedText(p),
    });
  }

  get pending(): Map<string, (ok: boolean) => void> {
    return this.runtime.approvals.pending;
  }

  get chatSpendUsd(): Map<string | number, number> {
    return this.runtime.spend.usd;
  }

  /** Cancel every running task (daemon shutdown). */
  cancelAll(): void {
    this.runtime.abortAll();
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private log(line: string): void {
    // The client masks phones already; this is the belt to that braces.
    this.deps.onLog?.(line);
  }

  private chatSettings(chatId: string): ChatSettings {
    const chats = this.deps.chats ?? (this.deps.chats = {});
    return chats[chatId] ?? {};
  }

  private setChatSettings(chatId: string, patch: ChatSettings): void {
    const chats = this.deps.chats ?? (this.deps.chats = {});
    chats[chatId] = { ...(chats[chatId] ?? {}), ...patch };
    this.deps.persist?.();
  }

  private knownModels(provider: string, fallback: string): string[] {
    const list = PRESETS[provider]?.knownModels ?? [];
    return [...new Set([fallback, ...list])];
  }

  private spendSince(sinceMs: number): number {
    return this.deps.store
      .costSummary()
      .recent.filter((r) => r.at >= sinceMs)
      .reduce((sum, r) => sum + r.usd, 0);
  }

  private attachmentDeps(): WhatsAppAttachmentDeps {
    const { config } = loadConfig();
    return {
      cap: () => this.deps.maxAttachmentBytes?.() ?? config.whatsapp?.maxAttachmentBytes ?? 5 * 1024 * 1024,
      log: (line) => this.log(line),
      audit: (event, detail) => this.deps.store.audit(event, detail),
      stt: this.deps.stt,
    };
  }

  // ── outbound ─────────────────────────────────────────────────────────────

  /**
   * Send one message, respecting WhatsApp's sensible ceiling of a message a
   * second per chat. A long answer therefore arrives as a calm sequence
   * instead of a burst that reads like a bot.
   */
  async pacedSend(chatId: string, text: string, opts: { quoteMessageId?: string | null } = {}): Promise<string | undefined> {
    const due = this.nextSendAt.get(chatId) ?? 0;
    const now = this.now();
    if (now < due) await new Promise((resolve) => setTimeout(resolve, due - now));
    this.nextSendAt.set(chatId, this.now() + Math.ceil(1000 / MAX_OUTBOUND_PER_SEC));
    const phone = this.gate.phoneForChat(chatId);
    if (phone) this.gate.noteOutbound(phone);
    return this.deps.transport.sendText(chatId, text, opts);
  }

  private sendChunks(chatId: string, raw: string, quoteMessageId?: string | null): Promise<void> {
    const chunks = splitForWhatsApp(raw);
    return (async () => {
      for (let i = 0; i < chunks.length; i += 1) {
        await this.pacedSend(chatId, chunks[i], i === 0 && quoteMessageId ? { quoteMessageId } : {});
      }
    })();
  }

  private reply(chatId: string, delivery: Delivery): (content: string) => Promise<void> {
    return (content) => this.sendChunks(chatId, content, delivery.quoteMessageId);
  }

  /** Send a message XR starts (not a reply): used by the outbox feature. */
  async sendToNumber(phone: string, text: string): Promise<string | undefined> {
    const chatId = `${phone}@s.whatsapp.net`;
    this.gate.noteOutbound(phone);
    this.gate.rememberChat(chatId, phone);
    return this.sendChunks(chatId, text).then(() => chatId);
  }

  // ── inbound ──────────────────────────────────────────────────────────────

  /** Handle one normalized incoming message. Public for the client and tests. */
  async handleMessage(msg: WhatsAppIncoming): Promise<void> {
    // Messages the *user* sends from their phone. They are never tasks, but
    // they are how the outbox whitelist learns who the user talks to.
    if (msg.fromMe) {
      if (!msg.group && !msg.broadcast && this.deps.respondToOutbox?.()) this.gate.noteOutbound(msg.phone);
      return;
    }
    if (msg.group || msg.broadcast) {
      this.deps.store.audit("whatsapp.ignored_group", { chat: maskPhone(msg.phone), kind: msg.group ? "group" : "broadcast" });
      return;
    }

    const chatId = msg.chatId;
    const phone = msg.phone;
    const admission = this.gate.admit(phone);
    if (admission === "denied") {
      // Silence, deliberately: a stranger learns nothing, not even that XR exists.
      this.deps.store.audit("whatsapp.unauthorized", { from: maskPhone(phone), admission: "denied" });
      return;
    }
    this.gate.rememberChat(chatId, phone);
    if (phone && msg.pushName) {
      const labels = this.deps.labels ?? (this.deps.labels = {});
      if (labels[phone] !== msg.pushName) {
        labels[phone] = msg.pushName;
        this.deps.persist?.();
      }
    }
    if (msg.raw !== undefined) void this.deps.transport.markRead?.(msg.raw);

    const { config } = loadConfig();
    const rl = config.whatsapp?.rateLimit ?? DEFAULT_TELEGRAM_RATE_LIMIT;
    const effective = { tokens: Math.min(rl.tokens, 20), refillPerSec: Math.min(rl.refillPerSec, MAX_OUTBOUND_PER_SEC) };
    if (!this.runtime.rate.allow(chatId, effective)) {
      this.deps.store.audit("whatsapp.rate_limited", { chat: maskPhone(phone) });
      await this.pacedSend(chatId, "⌛ Too many messages. Give me a moment and send that again.");
      return;
    }

    const cmd = parseWhatsAppText(msg.text);
    const turn: TurnContext = {
      blocks: [],
      quote: this.quoteContext(msg),
      notes: [],
      username: msg.pushName,
    };
    const delivery: Delivery = { kind: "chat", quoteMessageId: msg.messageId || null };

    // Numbered menu answers only mean something while an approval is pending.
    const pendingId = this.latestPending(chatId);
    if (pendingId) {
      const decision = msg.media.length ? null : parseDecision(msg.text);
      if (decision) return this.answerPending(chatId, String(phone ?? chatId), pendingId, decision);
    }

    const voice = msg.media.find((m) => m.kind === "audio");
    if (voice) {
      const heard = await handleVoiceNote(this.attachmentDeps(), {
        userId: String(phone ?? chatId),
        media: voice,
        send: (content) => this.pacedSend(chatId, content),
        noModelReply: NO_MODEL_REPLY,
      });
      if (!heard) return;
      if (cmd.type === "task" || cmd.type === "empty") {
        return this.runTask(chatId, String(phone ?? chatId), `[🎤 Voice note] ${heard}`, undefined, turn, delivery, config);
      }
    }

    const files = msg.media.filter((m) => m.kind !== "audio");
    if (files.length && (cmd.type === "task" || cmd.type === "empty")) {
      const att = await collectMediaBlocks(this.attachmentDeps(), String(phone ?? chatId), files);
      turn.blocks = att.blocks;
      turn.notes = att.notes;
      if (!att.blocks.length) {
        await this.pacedSend(chatId, att.notes.join("\n") || helpText(), {});
        return;
      }
      return this.runTask(
        chatId,
        String(phone ?? chatId),
        cmd.type === "task" ? cmd.text : "",
        cmd.type === "task" ? cmd.budgetUsd : undefined,
        turn,
        delivery,
        config,
      );
    }
    if (msg.unsupported?.length && (cmd.type === "task" || cmd.type === "empty") && !msg.text.trim()) {
      await this.pacedSend(chatId, `I can't use ${msg.unsupported.join(" or ")} yet. Send text, a voice note, a photo, a file or a PDF.`);
      return;
    }

    return this.dispatch(chatId, String(phone ?? chatId), cmd, turn, delivery, config);
  }

  private async answerPending(chatId: string, userId: string, id: string, decision: "approve" | "deny" | "details"): Promise<void> {
    if (decision === "details") {
      const record = getApprovalStore(this.deps.store, this.storeConfig()).get(id);
      if (!record) {
        await this.pacedSend(chatId, "That approval is gone.");
        return;
      }
      this.deps.store.audit("whatsapp.details", { approvalId: id, userId });
      await this.pacedSend(
        chatId,
        approvalDetailsText({
          id,
          tool: record.tool,
          reason: record.reason,
          preview: record.preview ? renderPreviewText(record.preview) : undefined,
          riskTier: record.riskTier,
        }),
      );
      return;
    }
    const res = this.runtime.approvals.decideFromChat(id, decision === "approve", chatId, userId);
    const text =
      res === "decided"
        ? decision === "approve"
          ? "✅ Approved."
          : "❌ Denied."
        : res === "already"
          ? "That approval was already decided."
          : "No pending approval in this chat.";
    await this.pacedSend(chatId, text);
  }

  /** The most recent undecided approval shown in this chat. */
  private latestPending(chatId: string): string | null {
    for (const id of this.runtime.approvals.pending.keys()) {
      if (this.runtime.approvals.ownsIn(id, chatId)) return id;
    }
    return null;
  }

  private storeConfig(): ApprovalStoreConfig {
    const { config } = loadConfig();
    return { defaultTtlMs: config.approvals.defaultTtlMs, perSurface: config.approvals.perSurface };
  }

  /** A reply to one of XR's own messages becomes untrusted context. */
  private quoteContext(msg: WhatsAppIncoming): string {
    if (!msg.quotedText) return "";
    return wrapUntrusted(String(msg.quotedText).slice(0, 1000), { kind: "whatsapp_reply_context", label: "message you replied to" });
  }

  // ── commands ─────────────────────────────────────────────────────────────

  private async dispatch(
    chatId: string,
    userId: string,
    cmd: WhatsAppCommand,
    turn: TurnContext,
    delivery: Delivery,
    config: ReturnType<typeof loadConfig>["config"],
  ): Promise<void> {
    const reply = this.reply(chatId, delivery);
    const phone = this.gate.phoneForChat(chatId);

    switch (cmd.type) {
      case "help":
      case "empty":
        return reply(helpText());

      case "status": {
        const sec = runLab({ egressAllowlist: config.security.egressAllowlist });
        const c = this.deps.store.costSummary();
        const conn = this.deps.connection?.() ?? { status: "idle", reason: null, lastCloseCode: null, linkedAs: null };
        return reply(
          statusMessage({
            project: basename(process.cwd()),
            costUsd: c.totalUsd,
            tokens: c.totalTokens,
            blockRate: sec.rate,
            auditOk: this.deps.store.verifyChain().valid,
            paused: false,
            model: this.chatSettings(chatId).model ?? config.defaults.model,
            busy: this.runtime.tasks.isBusy(chatId),
            linkedAs: this.deps.linkedAs?.() ?? conn.linkedAs,
            contacts: (this.deps.allowedContacts?.() ?? []).length,
            connection: conn.status,
          }),
        );
      }

      case "budget": {
        if (cmd.usd != null) {
          if (!(cmd.usd > 0 && cmd.usd <= 100)) return reply("Usage: `/xr budget 1.00` (between $0.01 and $100).");
          this.setChatSettings(chatId, { budgetUsd: cmd.usd });
          this.deps.store.audit("whatsapp.budget", { chat: maskPhone(phone), usd: cmd.usd });
          return reply(`Per-task ceiling for this chat set to $${cmd.usd.toFixed(2)}.`);
        }
        const dayStart = new Date(this.now()).setHours(0, 0, 0, 0);
        const monthStart = new Date(this.now()).setDate(1);
        return reply(
          budgetText({
            todayUsd: this.spendSince(dayStart),
            monthUsd: this.spendSince(monthStart),
            perTask: this.chatSettings(chatId).budgetUsd ?? config.budget.perTaskUsd,
            defaultPerTask: config.budget.perTaskUsd,
            chatCap: config.whatsapp?.chatBudgets?.maxUsd,
            spentHere: this.runtime.spend.usd.get(chatId) ?? 0,
          }),
        );
      }

      case "model": {
        const current = this.chatSettings(chatId).model ?? config.defaults.model;
        if (!cmd.model) return reply(`Model for this chat: \`${current}\`\nUsage: \`/xr model <id>\``);
        const known = this.knownModels(config.defaults.provider, config.defaults.model);
        if (!known.includes(cmd.model)) {
          return reply(`Unknown model \`${cmd.model}\` for ${config.defaults.provider}. Known: ${known.slice(0, 12).join(", ")}`);
        }
        this.setChatSettings(chatId, { model: cmd.model });
        this.deps.store.audit("whatsapp.model", { chat: maskPhone(phone), model: cmd.model });
        return reply(`Model for this chat set to \`${cmd.model}\`.`);
      }

      case "stop": {
        if (!this.runtime.tasks.abort(chatId)) return reply("Nothing is running in this chat.");
        this.deps.store.audit("whatsapp.stop", { chat: maskPhone(phone) });
        return reply("🤖 Stopping the running task.");
      }

      case "approve":
      case "deny": {
        const approved = cmd.type === "approve";
        const id = cmd.id || this.latestPending(chatId) || "";
        if (!id) return reply(`Usage: \`/xr ${approved ? "approve" : "deny"} <approval id>\``);
        return this.answerPending(chatId, userId, id, approved ? "approve" : "deny");
      }

      case "revoke": {
        // The sender asked to be forgotten. Confirm first, then the manager
        // removes the number from the allow-list — this chat goes quiet at once.
        this.deps.store.audit("whatsapp.revoke", { chat: maskPhone(phone) });
        await reply(blockedText());
        if (phone) {
          this.gate.forget(phone);
          this.runtime.replies.clear(chatId);
          this.deps.onRevoke?.(phone);
        }
        return;
      }

      case "ask":
      case "task": {
        if (!cmd.text && !turn.blocks.length) return reply("Send a task description.");
        return this.runTask(chatId, userId, cmd.text, cmd.budgetUsd, turn, delivery, config);
      }
    }
  }

  /** Approval callback for the agent loop. */
  approver(chatId: string | number) {
    return (req: ApprovalRequest): Promise<boolean> => this.runtime.approvals.request(String(chatId), req);
  }

  // ── task turn ────────────────────────────────────────────────────────────

  private runTask(
    chatId: string,
    userId: string,
    text: string,
    inlineBudget: number | undefined,
    turn: TurnContext,
    delivery: Delivery,
    config: ReturnType<typeof loadConfig>["config"],
  ): Promise<void> {
    return runTaskTurn(
      {
        store: this.deps.store,
        runtime: this.runtime,
        log: (line) => this.log(line),
        chatSettings: (c) => this.chatSettings(c),
        triggerTyping: (c) => this.deps.transport.setTyping(c),
        deliver: (c, d, raw) => this.sendChunks(c, raw, d.quoteMessageId),
        reply: (c, d) => this.reply(c, d),
        approver: (c) => this.approver(c),
      },
      chatId,
      userId,
      text,
      inlineBudget,
      turn,
      delivery,
      config,
    );
  }
}
