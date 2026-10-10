/**
 * XR — Telegram bot runtime (long-polling or webhook, dependency-free via fetch).
 *
 * Secure by design:
 *   • fail-closed pairing: unknown users get NO reply, not even an error
 *     (a pairing window opened from the desktop is the only exception, and
 *     only /start produces a code there)
 *   • risky actions become ✅ / ❌ / 👀 buttons, answered from the phone and
 *     cross-synced with the desktop through the durable approval store
 *   • every message, decision and refusal is audited
 *   • attachments and reply context are quarantined as untrusted input
 *
 * The token comes from TelegramManager (SecretBroker) and is never logged.
 */
import type { Store } from "../state/workspace-store.ts";
import { isAllowed } from "./auth.ts";
import { parseCommand, helpText, extractBudget } from "./commands.ts";
import {
  approvalMessage,
  approvalDetailsMessage,
  approvalResolvedText,
  statusMessage,
  plain,
  parseCallback,
  type OutgoingMessage,
} from "./render.ts";
import { splitForTelegram } from "./markdown.ts";
import { PairingBook } from "./pairing.ts";
import { checkSize, extractAttachment, classifyAttachment } from "./attachments.ts";
import { transcribeVoice } from "./voice.ts";
import type { ChatSettings } from "./state.ts";
import type { SpeechToText } from "../voice/stt.ts";
import { loadConfig } from "../config/config.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import { renderPreviewText } from "../control/preview.ts";
import { runLab } from "../security/lab.ts";
import { wrapUntrusted } from "../context/injection.ts";
import { basename } from "node:path";
import { DEFAULT_TELEGRAM_RATE_LIMIT } from "../automation/token-bucket.ts";
import { pauseAllTriggers, resumeAllTriggers } from "../automation/triggers.ts";
import {
  BotRuntime,
  knownModelsFor,
  type ApprovalPresenter,
  type ApprovalRequest,
  type ApprovalView,
  type MessageRef,
} from "../bots/runtime.ts";
import type { ChatKey } from "../bots/context.ts";

const API = (token: string) => `https://api.telegram.org/bot${token}`;
const FILE_API = (token: string) => `https://api.telegram.org/file/bot${token}`;

export interface BotDeps {
  token: string;
  /** Paired user ids. Used when no live `pairedIds` getter is supplied. */
  allowedIds: number[];
  store: Store;
  /** Injected fetch for testing. */
  fetchFn?: typeof fetch;
  /** Live paired-id lookup (the manager keeps this current). */
  pairedIds?: () => number[];
  /** Pairing book. Created internally when absent. */
  pairing?: PairingBook;
  /** Per-chat settings (model, budget). Mutated in place; `persist` saves. */
  chats?: Record<string, ChatSettings>;
  persist?: () => void;
  /** Speech-to-text used for voice notes. Absent = voice gets the "no model" reply. */
  stt?: Pick<SpeechToText, "describeAsync" | "transcribe">;
  /** Called after each processed update with the next getUpdates offset. */
  onOffset?: (offset: number) => void;
  /** Called on a non-retryable Telegram error (bad token, webhook conflict). */
  onFatal?: (reason: string) => void;
  /** Redacted diagnostics for the manager's log tail. */
  onLog?: (line: string) => void;
  /** Attachment cap in bytes (default 5 MB; photos capped at 2 MB). */
  maxAttachmentBytes?: () => number;
}

export class TelegramBot {
  private offset = 0;
  private running = false;
  private abortPoll: AbortController | null = null;
  private f: typeof fetch;
  /** Shared chat runtime: rate limit, task guard, spend, approvals, reply context. */
  private readonly runtime: BotRuntime;
  readonly pairing: PairingBook;

  constructor(private deps: BotDeps) {
    this.f = deps.fetchFn ?? fetch;
    this.pairing = deps.pairing ?? new PairingBook();
    this.offset = 0;
    this.runtime = new BotRuntime({
      surface: "telegram",
      store: deps.store,
      log: (line) => this.log(line),
    });
  }

  /** Pending approvals: id -> resolver. */
  get pending(): Map<string, (ok: boolean) => void> {
    return this.runtime.pending;
  }

  /** Per-chat spend against telegram.chatBudgets (Governor envelope per chat). */
  get chatSpendUsd(): Map<ChatKey, number> {
    return this.runtime.chatSpendUsd;
  }

  get chatSpendTokens(): Map<ChatKey, number> {
    return this.runtime.chatSpendTokens;
  }

  // ── transport ────────────────────────────────────────────────────────────

  private paired(): number[] {
    return this.deps.pairedIds ? this.deps.pairedIds() : this.deps.allowedIds;
  }

  private isPaired(userId: number | undefined): boolean {
    return isAllowed(userId, this.paired());
  }

  private log(line: string): void {
    this.deps.onLog?.(line.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "<redacted>"));
  }

  /** Call a Bot API method. Never throws on Telegram-level errors. */
  private async call(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<any> {
    const res = await this.f(`${API(this.deps.token)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    return res.json().catch(() => ({}));
  }

  /** Send one message. Returns the Telegram message id when available. */
  async send(chatId: number, msg: OutgoingMessage): Promise<number | undefined> {
    const res = await this.call("sendMessage", {
      chat_id: chatId,
      text: msg.text,
      parse_mode: msg.parse_mode,
      reply_markup: msg.reply_markup,
      disable_web_page_preview: true,
    });
    if (!res?.ok && /can't parse entities/i.test(String(res?.description ?? ""))) {
      // Escaping slipped somewhere: fall back to plain text rather than drop the reply.
      const retry = await this.call("sendMessage", {
        chat_id: chatId,
        text: msg.text.replace(/\\(.)/g, "$1"),
        reply_markup: msg.reply_markup,
      });
      return retry?.result?.message_id;
    }
    return res?.result?.message_id;
  }

  /** Send a model answer: MarkdownV2 chunks, buttons on the last chunk only. */
  private async sendAnswer(chatId: number, raw: string, markup?: OutgoingMessage["reply_markup"]): Promise<void> {
    const chunks = splitForTelegram(raw);
    for (let i = 0; i < chunks.length; i += 1) {
      const last = i === chunks.length - 1;
      await this.send(chatId, {
        text: chunks[i],
        parse_mode: "MarkdownV2",
        ...(last && markup ? { reply_markup: markup } : {}),
      });
    }
  }

  private async edit(chatId: number, messageId: number, text: string): Promise<void> {
    await this.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    }).catch(() => {});
  }

  private async typing(chatId: number): Promise<void> {
    await this.call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  }

  private async answerCb(id: string, text: string): Promise<void> {
    await this.call("answerCallbackQuery", { callback_query_id: id, text }).catch(() => {});
  }

  /** Download a Telegram file by id, after checking size from metadata. */
  private async download(fileId: string): Promise<Uint8Array | null> {
    const meta = await this.call("getFile", { file_id: fileId });
    const path = meta?.result?.file_path as string | undefined;
    if (!path) return null;
    const res = await this.f(`${FILE_API(this.deps.token)}/${path}`);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  }

  // ── approvals ────────────────────────────────────────────────────────────

  /** Telegram's way to show an approval and mark it decided (buttons + edit). */
  private approvalPresenter(chatId: number): ApprovalPresenter {
    return {
      show: (view: ApprovalView) => this.send(chatId, approvalMessage(view)),
      resolved: (ref: MessageRef, o) =>
        this.edit(chatId, ref as number, approvalResolvedText({ tool: o.tool, outcome: o.outcome, surface: o.channel })),
    };
  }

  /**
   * Approval callback used by the agent loop. The shared runtime keeps the
   * durable record and the decision; this adapter only renders it in Telegram.
   */
  approver(chatId: number) {
    const presenter = this.approvalPresenter(chatId);
    const inner = this.runtime.approver(chatId, presenter);
    return (req: ApprovalRequest): Promise<boolean> => inner(req);
  }

  /** Answer an approval from the phone. Returns the user-facing outcome. */
  private decideFromChat(
    id: string,
    approved: boolean,
    chatId: number,
    userId: number,
  ): "decided" | "not_found" | "already" {
    return this.runtime.decideFromChat(id, approved, chatId, String(userId));
  }

  // ── updates ──────────────────────────────────────────────────────────────

  /** Handle one incoming update (message or callback). Exposed for tests and the webhook. */
  async handleUpdate(update: any): Promise<void> {
    if (update.callback_query) return this.handleCallback(update.callback_query);

    const msg = update.message;
    if (!msg) return;
    const userId: number | undefined = msg.from?.id;
    const chatId: number | undefined = msg.chat?.id;
    if (typeof chatId !== "number") return;

    // Groups and channels are out of scope: stay silent there.
    if (msg.chat?.type && msg.chat.type !== "private") {
      this.deps.store.audit("telegram.ignored_chat", { chatType: msg.chat.type });
      return;
    }

    const text = String(msg.text ?? msg.caption ?? "");

    // FAIL-CLOSED: an unpaired user gets no reply at all. The only exception is
    // /start while a pairing window is open, which issues a single-use code.
    if (!this.isPaired(userId)) {
      if (parseCommand(text).type === "start" && typeof userId === "number") {
        const who = {
          id: userId,
          name: String(msg.from?.first_name ?? "Telegram user"),
          username: msg.from?.username ? String(msg.from.username) : null,
        };
        const issued = this.pairing.issue(who);
        if (issued) {
          this.deps.store.audit("telegram.pair.code_issued", { userId });
          await this.send(chatId, plain(`Your XR pairing code is ${issued.code}. Enter it in XR on your computer within 10 minutes.\n\nXR must be running on your computer for the bot to respond.`));
          return;
        }
      }
      this.deps.store.audit("telegram.unauthorized", { userId });
      return;
    }

    const { config } = loadConfig();
    const rl = config.telegram?.rateLimit ?? DEFAULT_TELEGRAM_RATE_LIMIT;
    if (!this.runtime.allowMessage(chatId, rl, { userId })) {
      await this.send(chatId, plain(`Rate limit reached (${Math.round(rl.refillPerSec * 60)} messages a minute per chat). Try again shortly.`));
      return;
    }

    if (msg.voice || msg.audio) return this.handleVoice(chatId, userId, msg, config);

    const cmd = parseCommand(text);
    const hasFiles = Boolean(msg.document || msg.photo);
    if (hasFiles && (cmd.type === "task" || cmd.type === "empty")) {
      const att = await this.attachmentBlocks(chatId, msg, config);
      if (!att.blocks.length) {
        // Nothing usable arrived: say why, instead of running an empty task.
        await this.send(chatId, plain(att.notes.join("\n") || helpText()));
        return;
      }
      const taskText = cmd.type === "task" ? cmd.text : "";
      return this.dispatch(chatId, userId, { type: "task", text: taskText, budgetUsd: cmd.type === "task" ? cmd.budgetUsd : undefined }, {
        blocks: att.blocks,
        quote: this.replyQuote(msg),
        notes: att.notes,
      });
    }
    return this.dispatch(chatId, userId, cmd, { blocks: [], quote: this.replyQuote(msg), notes: [] });
  }

  private async handleCallback(cq: any): Promise<void> {
    const userId: number | undefined = cq.from?.id;
    // Unpaired taps are ignored completely, as messages are.
    if (!this.isPaired(userId)) {
      this.deps.store.audit("telegram.unauthorized", { userId, callback: true });
      return;
    }
    const parsed = parseCallback(cq.data ?? "");
    if (!parsed) return;
    // Bind the decision to the chat it was shown in. A private chat's id equals the user id.
    const chatId: number = cq.message?.chat?.id ?? (userId as number);

    if (parsed.decision === "details") {
      if (!this.runtime.ownsApproval(parsed.id, chatId)) return this.answerCb(cq.id, "Not for this chat");
      const rec = getApprovalStore(this.deps.store).get(parsed.id);
      if (!rec || rec.decision !== null) return this.answerCb(cq.id, "Already decided");
      await this.send(
        chatId,
        approvalDetailsMessage({
          id: parsed.id,
          tool: rec.tool,
          reason: rec.reason,
          preview: rec.preview ? renderPreviewText(rec.preview) : undefined,
        }),
      );
      return this.answerCb(cq.id, "Details sent");
    }

    const approved = parsed.decision === "approve";
    const result = this.decideFromChat(parsed.id, approved, chatId, userId as number);
    if (result === "decided") return this.answerCb(cq.id, approved ? "Approved" : "Rejected");
    if (result === "already") return this.answerCb(cq.id, "Already decided");
    return this.answerCb(cq.id, "Not for this chat");
  }

  private replyQuote(msg: any): string {
    const r = msg.reply_to_message;
    if (!r?.from?.is_bot) return "";
    const quoted = String(r.text ?? r.caption ?? "").slice(0, 1000);
    return quoted ? wrapUntrusted(quoted, { kind: "telegram_reply_context", label: "message you replied to" }) : "";
  }

  private async handleVoice(chatId: number, userId: number | undefined, msg: any, config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
    const media = msg.voice ?? msg.audio;
    const cap = this.deps.maxAttachmentBytes?.() ?? config.telegram?.maxAttachmentBytes ?? 5 * 1024 * 1024;
    const size = checkSize("voice", media.file_size, cap);
    if (!size.ok) return this.send(chatId, plain(size.reason)).then(() => undefined);
    if (!this.deps.stt) {
      return this.send(chatId, plain("Voice messages require a speech model. Set one up in XR (Settings → Voice), then send the voice note again.")).then(() => undefined);
    }
    const bytes = await this.download(media.file_id);
    if (!bytes) return this.send(chatId, plain("I couldn't download that voice note.")).then(() => undefined);
    const heard = await transcribeVoice(bytes, { stt: this.deps.stt });
    if (!heard.ok) return this.send(chatId, plain(heard.reply)).then(() => undefined);
    this.deps.store.audit("telegram.voice", { userId, chars: heard.text.length });
    await this.send(chatId, plain(`Heard: ${heard.text}`));
    // Spoken text is always a task. A transcript never runs a slash command.
    return this.dispatch(chatId, userId, { type: "task", text: heard.text, budgetUsd: extractBudget(heard.text) }, { blocks: [], quote: "", notes: [] });
  }

  private async attachmentBlocks(chatId: number, msg: any, config: ReturnType<typeof loadConfig>["config"]): Promise<{ blocks: string[]; notes: string[] }> {
    const cap = this.deps.maxAttachmentBytes?.() ?? config.telegram?.maxAttachmentBytes ?? 5 * 1024 * 1024;
    const items: Array<{ kind: "document" | "photo"; fileId: string; name: string; mime?: string; size?: number }> = [];
    if (msg.document) {
      items.push({ kind: "document", fileId: msg.document.file_id, name: String(msg.document.file_name ?? "file"), mime: msg.document.mime_type, size: msg.document.file_size });
    }
    if (Array.isArray(msg.photo) && msg.photo.length) {
      const largest = msg.photo[msg.photo.length - 1];
      items.push({ kind: "photo", fileId: largest.file_id, name: "photo.jpg", mime: "image/jpeg", size: largest.file_size });
    }
    const blocks: string[] = [];
    const notes: string[] = [];
    for (const it of items) {
      const size = checkSize(it.kind, it.size, cap);
      if (!size.ok) {
        notes.push(size.reason);
        continue;
      }
      if (classifyAttachment(it.name, it.mime) === "unsupported") {
        notes.push(`I can't use ${it.name}. Send text, code, PDF, or an image.`);
        continue;
      }
      const bytes = await this.download(it.fileId);
      if (!bytes) {
        notes.push(`I couldn't download ${it.name}.`);
        continue;
      }
      const res = await extractAttachment({ name: it.name, mime: it.mime, bytes });
      if (res.ok && res.block) blocks.push(res.block);
      else if (res.note) notes.push(res.note);
      this.deps.store.audit("telegram.attachment", { userId: msg.from?.id, kind: it.kind, bytes: bytes.byteLength, ok: res.ok });
    }
    void chatId;
    return { blocks, notes };
  }

  // ── commands ─────────────────────────────────────────────────────────────

  private chatSettings(chatId: number): ChatSettings {
    const chats = this.deps.chats ?? (this.deps.chats = {});
    return chats[String(chatId)] ?? {};
  }

  private setChatSettings(chatId: number, patch: ChatSettings): void {
    const chats = this.deps.chats ?? (this.deps.chats = {});
    chats[String(chatId)] = { ...(chats[String(chatId)] ?? {}), ...patch };
    this.deps.persist?.();
  }

  private async dispatch(
    chatId: number,
    userId: number | undefined,
    cmd: ReturnType<typeof parseCommand>,
    ctx: { blocks: string[]; quote: string; notes: string[] },
  ): Promise<void> {
    const { config } = loadConfig();
    const project = basename(process.cwd());

    switch (cmd.type) {
      case "start":
        return this.send(chatId, plain(helpText())).then(() => undefined);

      case "help":
      case "empty":
        return this.send(chatId, plain(helpText())).then(() => undefined);

      case "pause":
        this.runtime.paused = true;
        this.deps.store.audit("telegram.pause", { userId });
        return this.send(chatId, plain("Paused. /resume to continue.")).then(() => undefined);

      case "resume":
        this.runtime.paused = false;
        this.deps.store.audit("telegram.resume", { userId });
        return this.send(chatId, plain("Resumed.")).then(() => undefined);

      case "pause-all":
        pauseAllTriggers(this.deps.store, `telegram:${chatId}`);
        return this.send(chatId, plain("All scheduled triggers paused. /resume-all to re-arm.")).then(() => undefined);

      case "resume-all":
        resumeAllTriggers(this.deps.store, `telegram:${chatId}`);
        return this.send(chatId, plain("Scheduled triggers resumed.")).then(() => undefined);

      case "cost": {
        const c = this.deps.store.costSummary();
        return this.send(chatId, plain(`Spend: $${c.totalUsd.toFixed(4)} · ${c.totalTokens} tokens (total)`)).then(() => undefined);
      }

      case "budget": {
        if (!(cmd.usd > 0 && cmd.usd <= 100)) {
          return this.send(chatId, plain("Usage: /budget $1.00 (between $0.01 and $100).")).then(() => undefined);
        }
        this.setChatSettings(chatId, { budgetUsd: cmd.usd });
        this.deps.store.audit("telegram.budget", { chatId, usd: cmd.usd });
        return this.send(chatId, plain(`Per-task ceiling for this chat set to $${cmd.usd.toFixed(2)}.`)).then(() => undefined);
      }

      case "model": {
        const current = this.chatSettings(chatId).model ?? config.defaults.model;
        if (!cmd.model) {
          return this.send(chatId, plain(`Model for this chat: ${current}\nUsage: /model <id>`)).then(() => undefined);
        }
        const known = knownModelsFor(config.defaults.provider, config.defaults.model);
        if (!known.includes(cmd.model)) {
          return this.send(chatId, plain(`Unknown model "${cmd.model}" for ${config.defaults.provider}. Known: ${known.slice(0, 12).join(", ")}`)).then(() => undefined);
        }
        this.setChatSettings(chatId, { model: cmd.model });
        this.deps.store.audit("telegram.model", { chatId, model: cmd.model });
        return this.send(chatId, plain(`Model for this chat set to ${cmd.model}.`)).then(() => undefined);
      }

      case "approve":
      case "deny": {
        if (!cmd.id) return this.send(chatId, plain(`Usage: /${cmd.type === "approve" ? "approve" : "deny"} <approval id>`)).then(() => undefined);
        const res = this.decideFromChat(cmd.id, cmd.type === "approve", chatId, userId ?? chatId);
        const text =
          res === "decided"
            ? cmd.type === "approve" ? "Approved." : "Rejected."
            : res === "already" ? "That approval was already decided." : "No pending approval with that id in this chat.";
        return this.send(chatId, plain(text)).then(() => undefined);
      }

      case "stop": {
        if (!this.runtime.abortChat(chatId)) return this.send(chatId, plain("Nothing is running in this chat.")).then(() => undefined);
        this.deps.store.audit("telegram.stop", { chatId, userId });
        return this.send(chatId, plain("Stopping the running task.")).then(() => undefined);
      }

      case "status": {
        const sec = runLab({ egressAllowlist: config.security.egressAllowlist });
        const c = this.deps.store.costSummary();
        return this.send(
          chatId,
          statusMessage({
            project,
            costUsd: c.totalUsd,
            tokens: c.totalTokens,
            blockRate: sec.rate,
            auditOk: this.deps.store.verifyChain().valid,
            paused: this.runtime.paused,
            model: this.chatSettings(chatId).model ?? config.defaults.model,
            busy: this.runtime.isBusy(chatId),
          }),
        ).then(() => undefined);
      }

      case "task":
        return this.runTask(chatId, userId, cmd.text, cmd.budgetUsd, ctx, config);
    }
  }

  private async runTask(
    chatId: number,
    userId: number | undefined,
    text: string,
    inlineBudget: number | undefined,
    ctx: { blocks: string[]; quote: string; notes: string[] },
    config: ReturnType<typeof loadConfig>["config"],
  ): Promise<void> {
    const outcome = await this.runtime.runTurn(
      {
        chatKey: chatId,
        userId,
        text,
        blocks: ctx.blocks,
        quote: ctx.quote,
        notes: ctx.notes,
        chat: this.chatSettings(chatId),
        inlineBudgetUsd: inlineBudget,
        chatBudgets: config.telegram?.chatBudgets,
        config,
        cwd: process.cwd(),
        approvals: this.approvalPresenter(chatId),
      },
      {
        typing: () => this.typing(chatId),
        started: () => this.send(chatId, plain("Working on it.")).then(() => undefined),
        answer: (body, footer) => this.sendAnswer(chatId, `${body}\n\n${footer}`),
        failed: () => this.send(chatId, plain("The task failed. Check the XR logs for details.")).then(() => undefined),
      },
    );

    if (outcome.kind === "refused") {
      switch (outcome.reason) {
        case "paused":
          return this.send(chatId, plain("Paused. /resume first.")).then(() => undefined);
        case "empty":
          return this.send(chatId, plain("Send a task description.")).then(() => undefined);
        case "busy":
          return this.send(chatId, plain("A task is already running in this chat. /stop cancels it.")).then(() => undefined);
        case "budget":
          return this.send(
            chatId,
            plain(`Chat budget exhausted ($${(outcome.spent ?? 0).toFixed(4)} of $${(outcome.cap ?? 0).toFixed(2)}). Raise it in XR settings.`),
          ).then(() => undefined);
      }
    }
  }

  // ── long-poll loop ───────────────────────────────────────────────────────

  /** Long-poll loop with persisted offset, backoff, and a clean stop. */
  async start(startOffset = this.offset): Promise<void> {
    this.running = true;
    this.offset = startOffset;
    let backoff = 1000;
    while (this.running) {
      this.abortPoll = new AbortController();
      try {
        const res = await this.call("getUpdates", { offset: this.offset, timeout: 25 }, this.abortPoll.signal);
        if (res && res.ok === false) {
          const code = Number(res.error_code ?? 0);
          const desc = String(res.description ?? "unknown error");
          if (code === 401 || code === 404) {
            this.log(`stopping: Telegram rejected the token (${code})`);
            this.running = false;
            this.deps.onFatal?.("Telegram rejected the bot token. Paste a new token in Integrations.");
            break;
          }
          this.log(`getUpdates error ${code}: ${desc}`);
          await this.sleep(Math.min(backoff, 60_000));
          backoff = Math.min(backoff * 2, 60_000);
          continue;
        }
        backoff = 1000;
        for (const u of res.result ?? []) {
          await this.handleUpdate(u).catch((e) => this.log(`update failed: ${(e as Error).message}`));
          this.offset = u.update_id + 1;
          this.deps.onOffset?.(this.offset);
        }
      } catch (err) {
        if (!this.running) break;
        this.log(`poll error: ${(err as Error).message}`);
        await this.sleep(backoff);
        backoff = Math.min(backoff * 2, 60_000);
      } finally {
        this.abortPoll = null;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  get currentOffset(): number {
    return this.offset;
  }

  /** Stop the loop and abort any in-flight long poll. */
  stop(): void {
    this.running = false;
    this.abortPoll?.abort();
  }

  /** Cancel every running task (used on daemon shutdown). */
  cancelAll(): void {
    this.runtime.cancelAll();
  }
}

