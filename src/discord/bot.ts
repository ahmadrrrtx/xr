/**
 * XR — Discord bot runtime (Phase 26).
 *
 * Transport is DiscordClient (REST + gateway WebSocket); this file owns the
 * product rules:
 *
 *   • FAIL-CLOSED access. DMs are answered only for paired users; guild
 *     messages only in allow-listed channels and only when XR is mentioned.
 *     Everything else is ignored in silence — an unknown user learns nothing,
 *     not even that a bot is listening.
 *   • Risky actions become ✅ / ❌ / 👀 buttons on a durable approval record,
 *     cross-synced with the desktop and Telegram through the approval store.
 *   • Slash commands answer privately (ephemeral) by default; the answer to
 *     `/xr ask` is private too, because a channel is a shared room.
 *   • Attachments are capped before download, quarantined as untrusted input,
 *     and audio is transcribed through the shared voice pipeline.
 *
 * The bot token comes from DiscordManager (SecretBroker) and never appears in
 * a log line, an error message, or an API response.
 */
import { basename } from "node:path";
import type { Store } from "../state/workspace-store.ts";
import { BotRuntime } from "../bots/runtime.ts";
import { runTask as runTaskTurn, type Delivery, type TurnContext } from "./tasks.ts";
import type { ApprovalRequest } from "../bots/approvals.ts";
import { NO_MODEL_REPLY } from "../bots/voice-note.ts";
import { collectAttachmentBlocks, handleVoiceNote, isVoiceNote, type AttachmentDeps } from "./attachments.ts";
import type { ChatRef, ChatSettings } from "../bots/types.ts";
import type { SpeechToText } from "../voice/stt.ts";
import { DiscordClient, DiscordRestError, type GatewayState, type WsFactory } from "./client.ts";
import { DiscordPairingBook, isAllowedChannel, isAllowedUser } from "./auth.ts";
import { SLASH_COMMANDS, inviteUrl, parseDiscordText, parseInteraction, type DiscordCommand } from "./commands.ts";
import {
  approvalDetailsMessage,
  approvalMessage,
  approvalResolvedText,
  budgetText,
  escapeMarkdown,
  helpText,
  parseComponentId,
  splitForDiscord,
  statusMessage,
  voiceNoteText,
  type DiscordOutgoing,
} from "./render.ts";
import { INTERACTION_TYPE, REQUIRED_INTENTS, type DiscordAttachment, type DiscordInteraction, type DiscordMessage } from "./types.ts";

import { loadConfig } from "../config/config.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import { renderPreviewText } from "../control/preview.ts";
import { PRESETS } from "../providers/presets.ts";
import { runLab } from "../security/lab.ts";
import { wrapUntrusted } from "../context/injection.ts";
import { DEFAULT_TELEGRAM_RATE_LIMIT } from "../automation/token-bucket.ts";

const MAX_ATTACHMENTS_PER_MESSAGE = 4;

export interface DiscordBotDeps {
  token: string;
  store: Store;
  /** Injected transport (tests use a fake fetch + fake socket). */
  fetchFn?: typeof fetch;
  wsFactory?: WsFactory;
  /** Pairing book. Created internally when absent. */
  pairing?: DiscordPairingBook;
  /** Live paired user ids (the manager owns the source of truth). */
  pairedUserIds?: () => string[];
  /** Live channel allow-list. */
  allowedChannels?: () => { guildId: string; channelId: string }[];
  /** A code was redeemed: the manager persists the new pairing. */
  onPairedUser?: (userId: string, label: string) => void;
  onPairedChannel?: (guildId: string, channelId: string, label: string) => void;
  /** Per-channel settings (model, budget). Mutated in place; `persist` saves. */
  chats?: Record<string, ChatSettings>;
  persist?: () => void;
  /** Speech-to-text for voice notes. Absent = the "no model" reply. */
  stt?: Pick<SpeechToText, "describeAsync" | "transcribe">;
  /** Redacted diagnostics for the manager's log ring. */
  onLog?: (line: string) => void;
  /** Non-retryable failure (a token Discord rejects). */
  onFatal?: (reason: string) => void;
  onGatewayState?: (state: GatewayState) => void;
  /** Persisted gateway session so a restart resumes instead of re-identifying. */
  session?: { id: string | null; url: string | null; seq: number | null } | null;
  onSession?: (patch: { id?: string | null; url?: string | null; seq?: number | null }) => void;
  /** Attachment cap in bytes (default: config.discord.maxAttachmentBytes). */
  maxAttachmentBytes?: () => number;
  /** Local dashboard URL for the 🖥 Open XR button (127.0.0.1 by default). */
  dashboardUrl?: () => string | undefined;
  /** Dev guild: slash commands register here for instant propagation. */
  devGuildId?: () => string | undefined;
  onCommandsRegistered?: (at: number) => void;
  /** Test seam: clock. */
  now?: () => number;
}

export class DiscordBot {
  private readonly f: typeof fetch;
  private readonly now: () => number;
  private clientRef: DiscordClient;
  private runtime: BotRuntime<DiscordOutgoing>;
  private gatewayState: GatewayState = { status: "idle", latencyMs: null, lastCloseCode: null, sessionActive: false };
  private applicationId: string | null = null;
  private botUserId: string | null = null;
  private stopped = true;
  readonly pairing: DiscordPairingBook;

  get pending(): Map<string, (ok: boolean) => void> {
    return this.runtime.approvals.pending;
  }

  get chatSpendUsd(): Map<ChatRef, number> {
    return this.runtime.spend.usd;
  }

  get chatSpendTokens(): Map<ChatRef, number> {
    return this.runtime.spend.tokens;
  }

  get state(): GatewayState {
    return this.gatewayState;
  }

  /** Application id, known after `start()`; needed for invite links. */
  get appId(): string | null {
    return this.applicationId;
  }

  /** The transport, for read-only lookups the manager exposes (guild/channel pickers). */
  get client(): DiscordClient {
    return this.clientRef;
  }

  constructor(private readonly deps: DiscordBotDeps) {
    this.f = deps.fetchFn ?? fetch;
    this.now = deps.now ?? Date.now;
    this.pairing = deps.pairing ?? new DiscordPairingBook();
    this.clientRef = new DiscordClient({
      token: deps.token,
      fetchFn: deps.fetchFn,
      wsFactory: deps.wsFactory,
      session: deps.session ?? undefined,
      intents: REQUIRED_INTENTS,
      presence: "XR · running on your machine",
      onLog: (line) => this.log(line),
      onFatal: (reason) => {
        this.stopped = true;
        this.deps.onFatal?.(reason);
      },
      onState: (state) => {
        this.gatewayState = state;
        this.deps.onGatewayState?.(state);
      },
      onSession: (patch) => this.deps.onSession?.(patch),
      onDispatch: (event, data) => this.handleDispatch(event, data),
    });

    this.runtime = new BotRuntime<DiscordOutgoing>({
      surface: {
        id: "discord",
        send: (chatId, msg) => this.sendToChannel(String(chatId), msg),
        edit: (chatId, messageId, text) => this.clientRef.editMessage(String(chatId), String(messageId), text),
        setTyping: (chatId) => this.clientRef.triggerTyping(String(chatId)),
      },
      store: deps.store,
      storeConfig: () => {
        const { config } = loadConfig();
        return { defaultTtlMs: config.approvals.defaultTtlMs, perSurface: config.approvals.perSurface };
      },
      renderRequest: (p) =>
        approvalMessage({
          id: p.id,
          tool: p.tool,
          reason: p.reason,
          preview: p.preview,
          riskTier: p.riskTier,
          dashboardUrl: this.deps.dashboardUrl?.(),
        }),
      renderResolved: (p) => approvalResolvedText(p),
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private log(line: string): void {
    // Belt and braces: the client redacts already, and so does the manager.
    this.deps.onLog?.(line.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{20,}/g, "<redacted>"));
  }

  private pairedUsers(): string[] {
    return this.deps.pairedUserIds?.() ?? [];
  }

  private allowedChannels(): { guildId: string; channelId: string }[] {
    return this.deps.allowedChannels?.() ?? [];
  }

  private isPaired(userId: string | undefined): boolean {
    return isAllowedUser(userId, this.pairedUsers());
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

  /** Everything the attachment helpers need, bound to this bot. */
  private attachmentDeps(): AttachmentDeps {
    const { config } = loadConfig();
    return {
      fetchFn: this.f,
      cap: () => this.deps.maxAttachmentBytes?.() ?? config.discord?.maxAttachmentBytes ?? 5 * 1024 * 1024,
      log: (line) => this.log(line),
      audit: (event, detail) => this.deps.store.audit(event, detail),
      stt: this.deps.stt,
    };
  }

  /** Spend inside a window, from the store's recent cost events. */
  private spendSince(sinceMs: number): number {
    return this.deps.store
      .costSummary()
      .recent.filter((r) => r.at >= sinceMs)
      .reduce((sum, r) => sum + r.usd, 0);
  }

  // ── transport ────────────────────────────────────────────────────────────

  private async sendToChannel(channelId: string, msg: DiscordOutgoing): Promise<string | undefined> {
    const sent = await this.clientRef.sendMessage(channelId, msg);
    return sent?.id;
  }

  /** Send a model answer as up to N messages, buttons on the last chunk. */
  private async sendAnswer(
    chatId: string,
    raw: string,
    opts: { replyToMessageId?: string | null; components?: DiscordOutgoing["components"] } = {},
  ): Promise<void> {
    const chunks = splitForDiscord(raw);
    for (let i = 0; i < chunks.length; i += 1) {
      const last = i === chunks.length - 1;
      await this.sendToChannel(chatId, {
        content: chunks[i],
        ...(i === 0 && opts.replyToMessageId ? { replyToMessageId: opts.replyToMessageId } : {}),
        ...(last && opts.components ? { components: opts.components } : {}),
      });
    }
  }

  /** Reply path for a turn: channel messages, or the interaction's private reply. */
  private reply(chatId: string, delivery: Delivery): (content: string) => Promise<void> {
    if (delivery.kind === "messages") {
      return (content) => this.sendAnswer(chatId, content, { replyToMessageId: delivery.replyToMessageId });
    }
    return (content) =>
      this.clientRef.editInteractionOriginal(delivery.applicationId, delivery.token, { content }).then(() => undefined);
  }

  /** Deliver a finished task: first chunk in space, the rest as follow-ups. */
  private async deliver(chatId: string, delivery: Delivery, raw: string): Promise<void> {
    if (delivery.kind === "messages") {
      await this.sendAnswer(chatId, raw, { replyToMessageId: delivery.replyToMessageId });
      return;
    }
    const chunks = splitForDiscord(raw);
    await this.clientRef.editInteractionOriginal(delivery.applicationId, delivery.token, { content: chunks[0] });
    for (const chunk of chunks.slice(1)) {
      await this.clientRef.interactionFollowUp(delivery.applicationId, delivery.token, { content: chunk, ephemeral: delivery.ephemeral });
    }
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  /**
   * Resolve the application, register slash commands, then open the gateway.
   * A rejected token is fatal and reported once; anything else is a log line
   * and a retry (the client owns the backoff).
   */
  async start(): Promise<void> {
    this.stopped = false;
    const app = await this.clientRef.getApplication().catch((err) => {
      if (err instanceof DiscordRestError && (err.status === 401 || err.status === 403)) {
        this.deps.onFatal?.("Discord rejected the bot token. Paste a new token in Integrations.");
        return null;
      }
      this.log(`could not read the application: ${(err as Error).message}`);
      return null;
    });
    if (!app) return;
    this.applicationId = app.id;
    this.botUserId = app.bot?.id ?? null;

    const guild = this.deps.devGuildId?.();
    try {
      await this.clientRef.registerCommands(app.id, SLASH_COMMANDS, guild);
      this.deps.onCommandsRegistered?.(this.now());
      this.deps.store.audit("discord.commands_registered", { scope: guild ? "guild" : "global", guildId: guild ?? null });
    } catch (err) {
      this.log(`slash command registration failed: ${(err as Error).message}`);
    }
    if (this.stopped) return;
    await this.clientRef.connect();
  }

  /** Stop the gateway and cancel running tasks. */
  stop(): void {
    this.stopped = true;
    this.clientRef.disconnect();
  }

  /** Cancel every running task (daemon shutdown). */
  cancelAll(): void {
    this.runtime.abortAll();
  }

  /** Invite URL for this application, with XR's minimum permissions. */
  inviteUrl(): string | null {
    return this.applicationId ? inviteUrl(this.applicationId) : null;
  }

  // ── gateway events ───────────────────────────────────────────────────────

  /** One gateway dispatch. Errors are logged, never thrown at the socket. */
  async handleDispatch(event: string, data: any): Promise<void> {
    try {
      if (event === "READY") {
        this.botUserId = String(data?.user?.id ?? this.botUserId ?? "") || null;
        this.applicationId = String(data?.application?.id ?? this.applicationId ?? "") || null;
        this.deps.store.audit("discord.ready", { guilds: Array.isArray(data?.guilds) ? data.guilds.length : 0 });
        return;
      }
      if (event === "MESSAGE_CREATE") return await this.handleMessage(data as DiscordMessage);
      if (event === "INTERACTION_CREATE") return await this.handleInteraction(data as DiscordInteraction);
    } catch (err) {
      this.log(`${event} failed: ${(err as Error).message}`);
    }
  }

  // ── messages ─────────────────────────────────────────────────────────────

  /** Handle one message. Public for tests. */
  async handleMessage(msg: DiscordMessage): Promise<void> {
    if (!msg?.author || msg.author.bot || msg.webhook_id) return;
    if (msg.author.id === this.botUserId) return;
    if (msg.type !== undefined && msg.type !== 0 && msg.type !== 19) return; // plain + reply only

    const channelId = String(msg.channel_id ?? "");
    const userId = String(msg.author.id ?? "");
    if (!channelId || !userId) return;

    const inGuild = Boolean(msg.guild_id);
    let text = String(msg.content ?? "").trim();
    const early = parseDiscordText(text);

    // A DM from a stranger is ignored in silence — no reply, not even a hint.
    // The one exception is a pairing command: the code was minted by the owner
    // in the XR app, is single-use, and expires in ten minutes, so redeeming it
    // is the only way a new user can become known.
    if (!inGuild && !this.isPaired(userId) && early.type !== "pair" && early.type !== "pairchannel") {
      this.deps.store.audit("discord.unauthorized", { userId, kind: "dm" });
      return;
    }

    // Guild traffic needs an allow-listed channel AND an explicit mention (or a
    // control command). A whitelisted channel means "XR may act here", not
    // "XR reads everything said here".
    if (inGuild) {
      const allowed = isAllowedChannel({ guildId: String(msg.guild_id), channelId }, this.allowedChannels());
      const probe = parseDiscordText(text);
      const isControl = probe.type !== "task" && probe.type !== "empty";
      if (!allowed) {
        this.deps.store.audit("discord.ignored_channel", { channelId, guildId: String(msg.guild_id) });
        return;
      }
      const mentioned = this.mentionsBot(text);
      if (!mentioned && !isControl) {
        this.deps.store.audit("discord.ignored_no_mention", { channelId });
        return;
      }
      if (mentioned) text = this.stripMentions(text);
      if (!this.isPaired(userId) && probe.type !== "pair" && probe.type !== "pairchannel") {
        this.deps.store.audit("discord.unauthorized", { userId, kind: "guild" });
        return;
      }
    }

    const { config } = loadConfig();
    const rl = config.discord?.rateLimit ?? DEFAULT_TELEGRAM_RATE_LIMIT;
    if (!this.runtime.rate.allow(channelId, rl)) {
      this.deps.store.audit("discord.rate_limited", { userId, channelId });
      await this.sendToChannel(channelId, {
        content: `⌛ Rate limit reached (${Math.round(rl.refillPerSec * 60)} messages a minute per chat). Try again shortly.`,
      });
      return;
    }

    const attachments = Array.isArray(msg.attachments) ? msg.attachments.slice(0, MAX_ATTACHMENTS_PER_MESSAGE) : [];
    const cmd = parseDiscordText(text);
    const turn: TurnContext = {
      blocks: [],
      quote: this.replyQuote(msg),
      notes: [],
      guildId: msg.guild_id ? String(msg.guild_id) : undefined,
      username: msg.author.global_name || msg.author.username,
    };
    const delivery: Delivery = { kind: "messages", replyToMessageId: msg.id };

    // Voice note: transcribe, then the transcript is the task.
    const voice = attachments.find((a) => isVoiceNote(a));
    if (voice) {
      const heard = await handleVoiceNote(this.attachmentDeps(), {
        userId,
        attachment: voice,
        send: (content) => this.sendToChannel(channelId, { content }),
        noModelReply: NO_MODEL_REPLY,
      });
      if (!heard) return;
      if (cmd.type === "task" || cmd.type === "empty") {
        return this.runTask(channelId, userId, heard, undefined, turn, delivery, config);
      }
    }

    const files = attachments.filter((a) => !isVoiceNote(a));
    if (files.length && (cmd.type === "task" || cmd.type === "empty")) {
      void config;
      const att = await collectAttachmentBlocks(this.attachmentDeps(), userId, files);
      turn.blocks = att.blocks;
      turn.notes = att.notes;
      if (!att.blocks.length) {
        await this.sendToChannel(channelId, { content: att.notes.join("\n") || helpText() });
        return;
      }
      return this.runTask(channelId, userId, cmd.type === "task" ? cmd.text : "", cmd.type === "task" ? cmd.budgetUsd : undefined, turn, delivery, config);
    }

    return this.dispatch(channelId, userId, cmd, turn, delivery, config);
  }

  // ── interactions ─────────────────────────────────────────────────────────

  /** Handle a slash command or a button press. Public for tests and webhooks. */
  async handleInteraction(i: DiscordInteraction): Promise<void> {
    const applicationId = String(i.application_id ?? this.applicationId ?? "");
    const inGuild = Boolean(i.guild_id);
    const userId = String(i.member?.user?.id ?? i.user?.id ?? "");
    const channelId = String(i.channel_id ?? "");

    if (i.type === INTERACTION_TYPE.MESSAGE_COMPONENT) return this.handleComponent(i, channelId, userId);
    if (i.type !== INTERACTION_TYPE.APPLICATION_COMMAND) return;

    const cmd = parseInteraction(i.data);
    if (!cmd) return;

    // Guild: allowed channel, or one of the two pairing commands.
    if (inGuild) {
      const allowed = isAllowedChannel({ guildId: String(i.guild_id), channelId }, this.allowedChannels());
      if (!allowed && cmd.type !== "pair" && cmd.type !== "pairchannel") {
        this.deps.store.audit("discord.ignored_channel", { channelId, guildId: String(i.guild_id), interaction: true });
        await this.client
          .respondInteraction(i.id, i.token, { content: "XR is not enabled in this channel. Allow it from the XR app first.", ephemeral: true }, "message")
          .catch(() => {});
        return;
      }
    }
    if (!this.isPaired(userId) && cmd.type !== "pair" && cmd.type !== "pairchannel") {
      this.deps.store.audit("discord.unauthorized", { userId, kind: "interaction" });
      await this.client
        .respondInteraction(i.id, i.token, { content: "That account is not paired with XR yet.", ephemeral: true }, "message")
        .catch(() => {});
      return;
    }

    const { config } = loadConfig();
    const rl = config.discord?.rateLimit ?? DEFAULT_TELEGRAM_RATE_LIMIT;
    if (!this.runtime.rate.allow(channelId, rl)) {
      await this.clientRef.respondInteraction(i.id, i.token, { content: "⌛ Rate limit reached. Try again shortly.", ephemeral: true }, "message").catch(() => {});
      return;
    }

    // Ephemeral replies matter in guilds; in a DM everything is already private.
    const ephemeral = inGuild;
    const delivery: Delivery = { kind: "interaction", token: i.token, applicationId, ephemeral };
    // Defer immediately: Discord gives 3 seconds and a task may take minutes.
    await this.clientRef.deferInteraction(i.id, i.token, ephemeral).catch(() => {});

    const turn: TurnContext = {
      blocks: [],
      quote: "",
      notes: [],
      guildId: i.guild_id ? String(i.guild_id) : undefined,
      username: i.member?.user?.global_name || i.member?.user?.username || i.user?.username,
    };
    return this.dispatch(channelId, userId, cmd, turn, delivery, config);
  }

  private async handleComponent(i: DiscordInteraction, channelId: string, userId: string): Promise<void> {
    const parsed = parseComponentId(String(i.data?.custom_id ?? ""));
    if (!parsed) return;
    if (!this.isPaired(userId)) {
      this.deps.store.audit("discord.unauthorized", { userId, kind: "button" });
      return; // silence: an unpaired tap teaches nothing
    }
    const owns = this.runtime.approvals.ownsIn(parsed.id, channelId);
    const rec = owns ? getApprovalStore(this.deps.store).get(parsed.id) : null;
    const deny = (content: string) =>
      this.clientRef.respondInteraction(i.id, i.token, { content, ephemeral: true }, "message").catch(() => {});

    if (!owns || !rec) return deny("That approval is not from this chat.");
    if (rec.decision !== null) return deny("That approval was already decided.");

    if (parsed.decision === "details") {
      await this.client
        .respondInteraction(
          i.id,
          i.token,
          {
            ...approvalDetailsMessage({
              id: parsed.id,
              tool: rec.tool,
              reason: rec.reason,
              preview: rec.preview ? renderPreviewText(rec.preview) : undefined,
              riskTier: rec.riskTier,
              dashboardUrl: this.deps.dashboardUrl?.(),
            }),
            ephemeral: true,
          },
          "message",
        )
        .catch(() => {});
      this.deps.store.audit("discord.details", { userId, approvalId: parsed.id });
      return;
    }

    const approved = parsed.decision === "approve";
    // Answer the component with the resolved message, so the buttons vanish the
    // moment the tap lands (the bridge writes the same text again).
    await this.client
      .respondInteraction(
        i.id,
        i.token,
        { content: approvalResolvedText({ tool: rec.tool, outcome: approved ? "approved" : "rejected", surface: "discord" }), components: [] },
        "update",
      )
      .catch(() => {});
    const result = this.runtime.approvals.decideFromChat(parsed.id, approved, channelId, userId);
    this.deps.store.audit("discord.button", { userId, approvalId: parsed.id, decision: approved ? "approve" : "deny", result });
  }

  // ── commands ─────────────────────────────────────────────────────────────

  private async dispatch(
    chatId: string,
    userId: string,
    cmd: DiscordCommand,
    turn: TurnContext,
    delivery: Delivery,
    config: ReturnType<typeof loadConfig>["config"],
  ): Promise<void> {
    const reply = this.reply(chatId, delivery);
    const project = basename(process.cwd());

    switch (cmd.type) {
      case "help":
      case "empty":
        return reply(helpText({ mentioned: Boolean(turn.guildId) }));

      case "status": {
        const sec = runLab({ egressAllowlist: config.security.egressAllowlist });
        const c = this.deps.store.costSummary();
        return reply(
          statusMessage({
            project,
            costUsd: c.totalUsd,
            tokens: c.totalTokens,
            blockRate: sec.rate,
            auditOk: this.deps.store.verifyChain().valid,
            paused: false,
            model: this.chatSettings(chatId).model ?? config.defaults.model,
            busy: this.runtime.tasks.isBusy(chatId),
            pairedUsers: this.pairedUsers().length,
            channels: this.allowedChannels().length,
            gateway: this.gatewayState.status,
          }),
        );
      }

      case "budget": {
        if (cmd.usd != null) {
          if (!(cmd.usd > 0 && cmd.usd <= 100)) return reply("Usage: `/xr budget 1.00` (between $0.01 and $100).");
          this.setChatSettings(chatId, { budgetUsd: cmd.usd });
          this.deps.store.audit("discord.budget", { chatId, usd: cmd.usd });
          return reply(`Per-task ceiling for this chat set to $${cmd.usd.toFixed(2)}.`);
        }
        const dayStart = new Date(this.now()).setHours(0, 0, 0, 0);
        const monthStart = new Date(this.now()).setDate(1);
        const chatCap = config.discord?.chatBudgets?.maxUsd;
        const spentHere = this.runtime.spend.usd.get(chatId) ?? 0;
        return reply(
          budgetText({
            todayUsd: this.spendSince(dayStart),
            monthUsd: this.spendSince(monthStart),
            perTask: this.chatSettings(chatId).budgetUsd ?? config.budget.perTaskUsd,
            defaultPerTask: config.budget.perTaskUsd,
            chatCap,
            spentHere,
          }),
        );
      }

      case "model": {
        const current = this.chatSettings(chatId).model ?? config.defaults.model;
        if (!cmd.model) return reply(`Model for this chat: \`${current}\`\nUsage: \`/xr model <id>\``);
        const known = this.knownModels(config.defaults.provider, config.defaults.model);
        if (!known.includes(cmd.model)) {
          return reply(
            `Unknown model \`${escapeMarkdown(cmd.model)}\` for ${config.defaults.provider}. Known: ${known.slice(0, 12).map((m) => `\`${m}\``).join(", ")}`,
          );
        }
        this.setChatSettings(chatId, { model: cmd.model });
        this.deps.store.audit("discord.model", { chatId, model: cmd.model });
        return reply(`Model for this chat set to \`${cmd.model}\`.`);
      }

      case "stop": {
        if (!this.runtime.tasks.abort(chatId)) return reply("Nothing is running in this chat.");
        this.deps.store.audit("discord.stop", { chatId, userId });
        return reply("🤖 Stopping the running task.");
      }

      case "approve":
      case "deny": {
        const approved = cmd.type === "approve";
        const id = cmd.id || this.latestPending(chatId) || "";
        if (!id) return reply(`Usage: \`/xr ${approved ? "approve" : "deny"} <approval id>\``);
        const res = this.runtime.approvals.decideFromChat(id, approved, chatId, userId);
        const text =
          res === "decided"
            ? approved
              ? "✅ Approved."
              : "❌ Denied."
            : res === "already"
              ? "That approval was already decided."
              : "No pending approval with that id in this chat.";
        return reply(text);
      }

      case "pair":
      case "pairchannel":
        return this.redeem(chatId, userId, turn, cmd, reply);

      case "ask":
      case "task": {
        if (!cmd.text && !turn.blocks.length) return reply("Send a task description.");
        return this.runTask(chatId, userId, cmd.text, cmd.budgetUsd, turn, delivery, config);
      }
    }
  }

  /** The most recent undecided approval in this chat (nicer than typing an id). */
  private latestPending(chatId: string): string | null {
    for (const id of this.runtime.approvals.pending.keys()) {
      if (this.runtime.approvals.ownsIn(id, chatId)) return id;
    }
    return null;
  }

  private async redeem(
    chatId: string,
    userId: string,
    turn: TurnContext,
    cmd: Extract<DiscordCommand, { type: "pair" | "pairchannel" }>,
    reply: (content: string) => Promise<void>,
  ): Promise<void> {
    const code = String(cmd.code ?? "").trim();
    const kind = cmd.type === "pair" ? "user" : "channel";
    const known = this.isPaired(userId);
    if (!/^\d{6}$/.test(code)) {
      // A paired operator gets a usage hint; a stranger is ignored entirely.
      if (known) await reply(`Usage: \`/xr ${cmd.type} 123456\` — the code is shown in the XR app.`);
      return;
    }
    const hit = this.pairing.consume(code, kind, this.now());
    if (!hit) {
      if (known) await reply("That pairing code is not valid, or it expired. Mint a new one in the XR app.");
      this.deps.store.audit("discord.pair.failed", { userId, kind });
      return;
    }
    if (kind === "user") {
      this.deps.onPairedUser?.(userId, turn.username ?? userId);
      this.deps.store.audit("discord.paired_user", { userId });
      await reply(`✅ Paired. This account can now DM XR, and slash commands work in allowed channels.\nSend a message to get started.`);
      return;
    }
    const guildId = turn.guildId;
    if (!guildId) {
      await reply("Channel codes only work inside a server channel. Run this command in the channel you want to allow.");
      return;
    }
    this.deps.onPairedChannel?.(guildId, chatId, `<#${chatId}>`);
    this.deps.store.audit("discord.paired_channel", { guildId, channelId: chatId });
    await reply(`✅ This channel is now allowed. Mention me, or use a slash command here.\nPaired by <@${userId}>.`);
  }

  // ── tasks ────────────────────────────────────────────────────────────────

  /** One task turn, delegated to src/discord/tasks.ts. */
  private async runTask(
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
        chatSettings: (id) => this.chatSettings(id),
        triggerTyping: (id) => this.clientRef.triggerTyping(id).then(() => undefined),
        sendWorking: async (id, d) => {
          await this.sendToChannel(id, { content: "🤖 Working on it.", replyToMessageId: d.kind === "messages" ? d.replyToMessageId ?? null : null });
        },
        deliver: (id, d, raw) => this.deliver(id, d, raw),
        reply: (id, d) => this.reply(id, d),
        approver: (id) => this.approver(id),
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

  /** Approval callback for the agent loop. */
  approver(chatId: string | number) {
    return (req: ApprovalRequest): Promise<boolean> => this.runtime.approvals.request(String(chatId), req);
  }

  // ── attachments ──────────────────────────────────────────────────────────

  private mentionsBot(content: string): boolean {
    if (!this.botUserId) return /<@!?\d{5,25}>/.test(content);
    return content.includes(`<@${this.botUserId}>`) || content.includes(`<@!${this.botUserId}>`);
  }

  private stripMentions(content: string): string {
    return content.replace(/<@!?\d{5,25}>/g, " ").replace(/\s+/g, " ").trim();
  }

  /** Quote a reply to one of XR's own messages as untrusted context. */
  private replyQuote(msg: DiscordMessage): string {
    const referenced = msg.referenced_message;
    if (!referenced?.author?.bot) return "";
    const quoted = String(referenced.content ?? "").slice(0, 1000);
    return quoted ? wrapUntrusted(quoted, { kind: "discord_reply_context", label: "message you replied to" }) : "";
  }
}

/** Human-readable gateway state for the status card. */
export function gatewaySummary(state: GatewayState): string {
  if (state.status === "connected") return state.latencyMs != null ? `connected (${state.latencyMs} ms)` : "connected";
  if (state.lastCloseCode && state.status !== "stopped") return `${state.status} (close ${state.lastCloseCode})`;
  return state.status;
}
