/**
 * XR — Discord bot (Phase 26).
 *
 * Wire layer only. Rate limits, the one-task-per-chat guard, spend, reply
 * context and the approval bridge come from src/bots/ (BotRuntime). This file
 * owns the gateway lifecycle, the access rules, and the Discord message and
 * interaction shapes.
 *
 * Access rules (fail-closed, see auth.ts):
 *  - DM from an unpaired user: no reply at all.
 *  - Guild message: answered only in a whitelisted channel, from a paired user,
 *    and only when the bot is mentioned or the message starts with "/xr" or "xr ".
 *  - Interactions must be acknowledged, so the one case that gets a reply is a
 *    slash command or button press, and that reply is ephemeral (only the invoker sees it).
 */
import type { Store } from "../state/workspace-store.ts";
import { BotRuntime } from "../bots/runtime.ts";
import { startTypingPulse } from "../bots/typing.ts";
import type { ApprovalRequest } from "../bots/approvals.ts";
import type { BotSurface, MessageRef } from "../bots/types.ts";
import { DEFAULT_TELEGRAM_RATE_LIMIT } from "../automation/token-bucket.ts";
import { wrapUntrusted } from "../context/injection.ts";
import { executeOnSurface } from "../services/surface-execution.ts";
import { loadConfig } from "../config/config.ts";
import { getApprovalStore } from "../control/approval-store.ts";
import { renderPreviewText } from "../control/preview.ts";
import { buildProvider } from "../providers/factory.ts";
import { PRESETS } from "../providers/presets.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { DiscordRest } from "./rest.ts";
import { DiscordGateway, type GatewayStatus, type WsCtor } from "./gateway.ts";
import { DiscordAccess, DiscordCodes } from "./auth.ts";
import { parseTextCommand, parseSlashCommand, stripBotMention, XR_COMMAND_DEFINITION, HELP_TEXT, type XrCommand, type SlashOption } from "./commands.ts";
import { approvalCard, approvalDetails, approvalResolvedText, plainText, splitForDiscord, truncate } from "./render.ts";
import {
  DISCORD_MAX_CHARS,
  InteractionCallbackType,
  InteractionType,
  MessageFlags,
  XR_INTENTS,
  type DiscordInteraction,
  type DiscordMessageCreate,
  type DiscordOutgoing,
  type DiscordReady,
  type DiscordUser,
} from "./types.ts";

export const BUSY_REPLY = "A task is already running in this chat. /xr stop cancels it.";
export const NOT_HERE_REPLY = "XR is not set up for this channel. Ask the person running XR for a pairing code.";
const CONNECT_COPY = "XR must be running on your computer for the bot to respond.";

/** What a task run produces. The default runner is executeOnSurface; tests inject a fake. */
export interface AgentRun {
  finalMessage?: string;
  stopped: string;
  meter?: string;
}

export interface AgentRunArgs {
  task: string;
  modelId: string;
  signal: AbortSignal;
  budgetUsd: number | undefined;
  approve: (req: ApprovalRequest) => Promise<boolean>;
}

export interface DiscordBotDeps {
  token: string;
  /** Injected agent runner (tests). Production leaves it unset and uses executeOnSurface. */
  runAgent?: (args: AgentRunArgs) => Promise<AgentRun>;
  store: Store;
  access: DiscordAccess;
  codes: DiscordCodes;
  apiBase?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  WebSocketCtor?: WsCtor;
  onStatus?: (s: GatewayStatus, detail?: string) => void;
  log: (line: string) => void;
}

export interface DiscordIdentity {
  botId: string;
  username: string;
  appId: string | null;
}

export class DiscordError extends Error {
  constructor(
    readonly code: "auth_failed" | "unreachable" | "rejected",
    message: string,
  ) {
    super(message);
  }
}

type Reply = (msg: DiscordOutgoing) => Promise<void>;

interface Ctx {
  chatId: string;
  userId: string;
  dm: boolean;
  messageId?: string;
  reply: Reply;
  /** Interaction-driven commands defer and reply in the same interaction. */
  interaction?: boolean;
}

export class DiscordBot {
  readonly runtime: BotRuntime<DiscordOutgoing>;
  readonly rest: DiscordRest;
  private gateway: DiscordGateway | null = null;
  private identity: DiscordIdentity | null = null;
  private guildCount = 0;
  private readonly deps: DiscordBotDeps;

  constructor(deps: DiscordBotDeps) {
    this.deps = deps;
    this.rest = new DiscordRest({
      token: deps.token,
      apiBase: deps.apiBase,
      fetchFn: deps.fetchFn,
      sleep: deps.sleep,
    });
    const surface: BotSurface<DiscordOutgoing> = {
      id: "discord",
      send: (chatId, msg) => this.send(String(chatId), msg),
      edit: (chatId, messageId, text) => this.edit(String(chatId), String(messageId), text),
      setTyping: (chatId) => this.setTyping(String(chatId)),
    };
    this.runtime = new BotRuntime<DiscordOutgoing>({
      surface,
      store: deps.store,
      storeConfig: () => {
        const { config } = loadConfig();
        return { defaultTtlMs: config.approvals.defaultTtlMs, perSurface: config.approvals.perSurface };
      },
      renderRequest: (p) => approvalCard(p),
      renderResolved: (p) => approvalResolvedText(p),
    });
  }

  get info(): { identity: DiscordIdentity | null; guilds: number; running: boolean } {
    return { identity: this.identity, guilds: this.guildCount, running: this.gateway !== null };
  }

  /** Validate the token, open the gateway, and register /xr. Throws DiscordError on failure. */
  async start(): Promise<DiscordIdentity> {
    if (this.gateway && this.identity) return this.identity;
    const me = await this.rest.request<DiscordUser>("GET", "/users/@me");
    if (!me.ok || !me.data) {
      throw new DiscordError(me.status === 401 ? "auth_failed" : "unreachable", me.status === 401 ? "Discord rejected the bot token." : `Discord did not answer (${me.status}).`);
    }
    const gw = await this.rest.request<{ url?: string }>("GET", "/gateway/bot");
    if (!gw.ok || !gw.data?.url) throw new DiscordError("unreachable", `Discord gateway lookup failed (${gw.status}).`);
    this.identity = { botId: me.data.id, username: me.data.username, appId: null };
    this.gateway = new DiscordGateway({
      token: this.deps.token,
      intents: XR_INTENTS,
      url: gw.data.url,
      WebSocketCtor: this.deps.WebSocketCtor,
      onReady: (ready) => void this.onReady(ready),
      onDispatch: (type, data) => void this.onDispatch(type, data),
      onStatus: (s, detail) => {
        if (s === "fatal") this.gateway = null;
        this.deps.log(`gateway ${s}${detail ? `: ${detail}` : ""}`);
        this.deps.onStatus?.(s, detail);
      },
    });
    this.gateway.start();
    return this.identity;
  }

  stop(): void {
    this.gateway?.stop();
    this.gateway = null;
    this.runtime.abortAll();
  }

  // ── surface: outgoing ────────────────────────────────────────────────────

  async send(chatId: string, msg: DiscordOutgoing): Promise<MessageRef | undefined> {
    const body = toMessageBody(msg);
    const res = await this.rest.request<{ id?: string }>("POST", `/channels/${chatId}/messages`, body);
    if (!res.ok) {
      this.deps.log(`send failed (${res.status}) in ${chatId}`);
      return undefined;
    }
    return res.data?.id;
  }

  async edit(chatId: string, messageId: string, text: string): Promise<void> {
    const res = await this.rest.request("PATCH", `/channels/${chatId}/messages/${messageId}`, {
      content: truncate(text, DISCORD_MAX_CHARS),
      components: [],
      allowed_mentions: { parse: [] },
    });
    if (!res.ok) this.deps.log(`edit failed (${res.status}) in ${chatId}`);
  }

  async setTyping(chatId: string): Promise<void> {
    await this.rest.request("POST", `/channels/${chatId}/typing`);
  }

  // ── gateway events ───────────────────────────────────────────────────────

  private async onReady(ready: DiscordReady): Promise<void> {
    this.guildCount = ready.guilds.length;
    const appId = ready.application.id;
    if (this.identity) this.identity = { ...this.identity, appId };
    this.deps.access.setIdentity({ botId: ready.user.id, botUsername: ready.user.username, appId });
    // Global commands take up to about an hour to appear in clients the first time.
    const reg = await this.rest.request("PUT", `/applications/${appId}/commands`, [XR_COMMAND_DEFINITION]);
    this.deps.log(reg.ok ? "commands registered" : `command registration failed (${reg.status})`);
  }

  private async onDispatch(type: string, data: unknown): Promise<void> {
    try {
      if (type === "MESSAGE_CREATE") await this.onMessage(data as DiscordMessageCreate);
      else if (type === "INTERACTION_CREATE") await this.onInteraction(data as DiscordInteraction);
    } catch (err) {
      this.deps.log(`handler error (${type}): ${(err as Error).message}`);
    }
  }

  private async onMessage(m: DiscordMessageCreate): Promise<void> {
    if (!m.author || m.author.bot) return;
    if (!m.content && !(m.attachments && m.attachments.length)) return;
    const userId = m.author.id;
    const dm = m.guild_id === undefined;
    const botId = this.identity?.botId ?? "";
    const stripped = botId ? stripBotMention(m.content ?? "", botId) : { text: m.content ?? "", mentioned: false };
    const cmd = parseTextCommand(stripped.text, { dm, mentioned: stripped.mentioned });
    const chatId = m.channel_id;
    const reply: Reply = async (msg) => {
      await this.send(chatId, msg);
    };

    if (dm) {
      if (cmd.kind === "pair") return this.redeemDm(cmd.code, userId, chatId, reply);
      if (cmd.kind === "none") return;
      if (!this.deps.access.isPaired(userId)) {
        this.deps.store.audit("discord.unauthorized", { userId, scope: "dm" });
        return;
      }
      return this.handle(cmd, { chatId, userId, dm: true, messageId: m.id, reply });
    }

    // Guild message. Channel must be whitelisted and the sender paired.
    const guildId = m.guild_id!;
    if (cmd.kind === "pairchannel") {
      if (!this.deps.access.isPaired(userId)) return;
      return this.redeemChannel(cmd.code, guildId, chatId, userId, reply);
    }
    if (cmd.kind === "none") return;
    if (!this.deps.access.isAllowedChannel(guildId, chatId)) return;
    if (!this.deps.access.isPaired(userId)) {
      this.deps.store.audit("discord.unauthorized", { userId, scope: "channel" });
      return;
    }
    if (cmd.kind === "pair") return reply(plainText("Pairing codes go in a DM with XR. Send `/xr pair <code>` there."));
    return this.handle(cmd, { chatId, userId, dm: false, messageId: m.id, reply });
  }

  private async onInteraction(i: DiscordInteraction): Promise<void> {
    if (i.type === InteractionType.APPLICATION_COMMAND) return this.onSlash(i);
    if (i.type === InteractionType.MESSAGE_COMPONENT) return this.onButton(i);
  }

  // ── slash commands ───────────────────────────────────────────────────────

  private async onSlash(i: DiscordInteraction): Promise<void> {
    const user = i.member?.user ?? i.user;
    if (!user || i.data?.name !== "xr") return;
    const userId = user.id;
    const chatId = i.channel_id ?? i.channel?.id;
    if (!chatId) return;
    const dm = i.guild_id === undefined;
    const cmd = parseSlashCommand(i.data.options as SlashOption[] | undefined);
    const ephemeral = cmd.kind !== "ask";
    const paired = this.deps.access.isPaired(userId);

    // Pairing: /xr pair belongs in a DM; /xr pairchannel belongs in a server channel. Code checks run regardless of pairing state.
    if (cmd.kind === "pair") {
      if (!dm) return this.respondEphemeral(i, "Pair in a DM with XR: send `/xr pair <code>` there.");
      await this.defer(i, true);
      return this.redeemDm(cmd.code, userId, chatId, this.ephemeralFollowUp(i));
    }
    if (cmd.kind === "pairchannel") {
      if (dm || !paired || !i.guild_id) {
        if (!paired) this.deps.store.audit("discord.unauthorized", { userId, scope: "channel", interaction: true });
        return this.respondEphemeral(i, NOT_HERE_REPLY);
      }
      await this.defer(i, true);
      return this.redeemChannel(cmd.code, i.guild_id, chatId, userId, this.ephemeralFollowUp(i));
    }

    // Everything else: a paired user, and in a server, a whitelisted channel. Otherwise the generic reply.
    const allowed = paired && (dm || (i.guild_id !== undefined && this.deps.access.isAllowedChannel(i.guild_id, chatId)));
    if (!allowed) {
      if (!paired) this.deps.store.audit("discord.unauthorized", { userId, scope: dm ? "dm" : "channel", interaction: true });
      return this.respondEphemeral(i, NOT_HERE_REPLY);
    }

    // Acknowledge inside Discord's 3-second window; the work continues after this.
    await this.defer(i, ephemeral);
    return this.handle(cmd, { chatId, userId, dm, reply: this.ephemeralFollowUp(i, ephemeral), interaction: true });
  }

  /** Reply through the interaction. Follow-ups keep the ephemeral flag the defer set. */
  private ephemeralFollowUp(i: DiscordInteraction, ephemeral = true): Reply {
    const followUp = this.interactionReply(i);
    return (msg) => followUp({ ...msg, ephemeral });
  }

  // ── buttons (approvals) ──────────────────────────────────────────────────

  private async onButton(i: DiscordInteraction): Promise<void> {
    const user = i.member?.user ?? i.user;
    const customId = i.data?.custom_id ?? "";
    const chatId = i.channel_id ?? i.channel?.id;
    if (!user || !chatId) return;
    const m = /^xr:(approve|deny|view):(.+)$/.exec(customId);
    if (!m) return this.respondEphemeral(i, NOT_HERE_REPLY);
    const action = m[1]!;
    const approvalId = m[2]!;
    if (!this.deps.access.isPaired(user.id)) {
      this.deps.store.audit("discord.unauthorized", { userId: user.id, scope: "button" });
      return this.respondEphemeral(i, NOT_HERE_REPLY);
    }
    if (action === "view") {
      if (!this.runtime.approvals.ownsIn(approvalId, chatId)) return this.respondEphemeral(i, "That approval is not in this chat.");
      const rec = getApprovalStore(this.deps.store).get(approvalId);
      if (!rec) return this.respondEphemeral(i, "That approval is no longer pending.");
      const preview = rec.preview ? renderPreviewText(rec.preview) : undefined;
      return this.respondEphemeral(i, approvalDetails({ id: approvalId, tool: rec.tool, reason: rec.reason, preview }));
    }
    const result = this.runtime.approvals.decideFromChat(approvalId, action === "approve", chatId, user.id);
    if (result !== "decided") {
      const text = result === "already" ? "That approval was already decided." : "That approval is not in this chat.";
      return this.respondEphemeral(i, text);
    }
    // Update the card in place so the buttons disappear. The bridge also edits it when the outcome lands.
    const tool = getApprovalStore(this.deps.store).get(approvalId)?.tool ?? "action";
    const outcome = action === "approve" ? "approved" : "rejected";
    await this.rest.request(
      "POST",
      `/interactions/${i.id}/${i.token}/callback`,
      {
        type: InteractionCallbackType.UPDATE_MESSAGE,
        data: { content: approvalResolvedText({ tool, outcome, surface: "discord" }), components: [], embeds: [] },
      },
      { auth: false },
    );
  }

  // ── commands (shared by text, slash and buttons) ─────────────────────────

  private async handle(cmd: XrCommand, ctx: Ctx): Promise<void> {
    const { config } = loadConfig();
    switch (cmd.kind) {
      case "none":
        return;
      case "ask":
      case "chat": {
        if (!this.runtime.rate.allow(`discord:${ctx.chatId}`, DEFAULT_TELEGRAM_RATE_LIMIT)) {
          this.deps.store.audit("discord.rate_limited", { userId: ctx.userId, chatId: ctx.chatId });
          return ctx.reply(plainText("Slow down a little. Try again in a moment."));
        }
        return this.runTask(ctx, cmd.text, config);
      }
      case "invalid":
        return ctx.reply(plainText(`Usage: \`${cmd.usage}\``));
      case "help":
        return ctx.reply(plainText(HELP_TEXT));
      case "stop":
        if (!this.runtime.tasks.abort(ctx.chatId)) return ctx.reply(plainText("Nothing is running in this chat."));
        this.deps.store.audit("discord.stop", { chatId: ctx.chatId });
        return ctx.reply(plainText("Stopping."));
      case "budget":
        return ctx.reply(plainText(this.budgetText(config.budget.perTaskUsd)));
      case "model":
        return this.modelCommand(cmd.name, ctx, config);
      case "approve":
      case "deny": {
        const id = cmd.id ?? this.latestPendingIn(ctx.chatId);
        if (!id) return ctx.reply(plainText("Nothing is waiting for approval in this chat."));
        const result = this.runtime.approvals.decideFromChat(id, cmd.kind === "approve", ctx.chatId, ctx.userId);
        if (result === "decided") return ctx.reply(plainText(cmd.kind === "approve" ? "Approved." : "Denied."));
        return ctx.reply(plainText(result === "already" ? "That approval was already decided." : "That approval is not in this chat."));
      }
      case "pair":
        return ctx.reply(plainText("This DM is already paired."));
      case "pairchannel":
        return ctx.reply(plainText("Run `/xr pairchannel` inside the server channel you want XR to answer in."));
    }
  }

  private async runTask(ctx: Ctx, text: string, config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
    if (!text) return ctx.reply(plainText("Send a task description."));
    if (this.runtime.tasks.isBusy(ctx.chatId)) return ctx.reply(plainText(BUSY_REPLY));

    const providerId = config.defaults.provider;
    const chat = this.deps.access.chat(ctx.chatId);
    const modelId = chat.model ?? config.defaults.model;
    const perTask = chat.budgetUsd ?? config.budget.perTaskUsd;

    const history = this.runtime.replies.recent(ctx.chatId).slice(-6);
    const historyBlock = history.length
      ? wrapUntrusted(history.map((t) => `${t.role}: ${t.text}`).join("\n"), { kind: "discord_history", label: "earlier in this chat" })
      : "";
    const task = [historyBlock, text].filter(Boolean).join("\n\n");

    // Synchronous with the busy check above (no await in between), so no race.
    const ac = this.runtime.tasks.begin(ctx.chatId);
    if (!ac) return ctx.reply(plainText(BUSY_REPLY));
    const stopTyping = ctx.interaction ? () => {} : startTypingPulse(() => this.setTyping(ctx.chatId), 8000);
    if (!ctx.interaction) {
      await this.setTyping(ctx.chatId);
      await ctx.reply(plainText("Working on it."));
    }
    const costBefore = this.deps.store.costSummary().totalUsd;
    this.deps.store.audit("discord.task.start", { chatId: ctx.chatId, userId: ctx.userId });
    try {
      const approve = (req: ApprovalRequest) => this.runtime.approvals.request(ctx.chatId, req);
      const result: AgentRun = this.deps.runAgent
        ? await this.deps.runAgent({ task, modelId, signal: ac.signal, budgetUsd: perTask, approve })
        : await executeOnSurface({
            task,
            mode: "agent",
            surface: "discord",
            store: this.deps.store,
            provider: buildProvider(config, { model: modelId }),
            modelId,
            cwd: process.cwd(),
            say: () => {},
            approve,
            signal: ac.signal,
            budget: {
              maxUsd: isLocal(providerId) ? undefined : perTask,
              maxTokens: config.budget.perTaskTokens,
            },
            pricing: priceFor(providerId, modelId),
            egressAllowlist: config.security.egressAllowlist,
          });
      const charged = Math.max(0, this.deps.store.costSummary().totalUsd - costBefore);
      this.runtime.spend.usd.set(ctx.chatId, (this.runtime.spend.usd.get(ctx.chatId) ?? 0) + charged);
      const body = result.finalMessage?.trim() || (result.stopped === "cancelled" ? "Stopped." : "(no answer)");
      const footer = `-# ${result.stopped}${result.meter ? ` · ${result.meter}` : ""}`;
      this.runtime.replies.push(ctx.chatId, { role: "user", text });
      this.runtime.replies.push(ctx.chatId, { role: "assistant", text: body });
      for (const chunk of splitForDiscord(`${body}\n\n${footer}`)) await ctx.reply({ content: chunk });
      this.deps.store.audit("discord.task.finish", { chatId: ctx.chatId, stopped: result.stopped });
    } catch (err) {
      this.deps.log(`task failed: ${(err as Error).message}`);
      this.deps.store.audit("discord.task.error", { chatId: ctx.chatId });
      await ctx.reply(plainText("The task failed. Check the XR logs for details."));
    } finally {
      stopTyping();
      this.runtime.tasks.finish(ctx.chatId);
    }
  }

  private modelCommand(name: string | undefined, ctx: Ctx, config: ReturnType<typeof loadConfig>["config"]): Promise<void> {
    const known = [...new Set([config.defaults.model, ...(PRESETS[config.defaults.provider]?.knownModels ?? [])])];
    if (!name) {
      const current = this.deps.access.chat(ctx.chatId).model ?? config.defaults.model;
      return ctx.reply(plainText(`Model for this chat: \`${current}\`.\nKnown: ${known.map((m) => `\`${m}\``).join(", ")}`));
    }
    if (!known.includes(name)) return ctx.reply(plainText(`Unknown model. Known: ${known.map((m) => `\`${m}\``).join(", ")}`));
    this.deps.access.setChat(ctx.chatId, { model: name });
    this.deps.store.audit("discord.model", { chatId: ctx.chatId, model: name });
    return ctx.reply(plainText(`Model for this chat set to \`${name}\`.`));
  }

  private budgetText(perTaskUsd: number): string {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const day = this.deps.store.getSpendForPeriod(startOfDay);
    const month = this.deps.store.getSpendForPeriod(startOfMonth);
    return [`Spend today: $${day.toFixed(4)}`, `Spend this month: $${month.toFixed(4)}`, `Per-task limit: $${perTaskUsd.toFixed(2)}`, CONNECT_COPY].join("\n");
  }

  private latestPendingIn(chatId: string): string | undefined {
    const ids = [...this.runtime.approvals.pending.keys()].filter((id) => this.runtime.approvals.ownsIn(id, chatId));
    return ids[ids.length - 1];
  }

  // ── pairing ──────────────────────────────────────────────────────────────

  private async redeemDm(code: string, userId: string, chatId: string, reply: Reply): Promise<void> {
    const outcome = this.deps.codes.redeem("dm", code);
    if (outcome === "ok") {
      this.deps.access.pairUser(userId);
      this.deps.store.audit("discord.pair.ok", { userId });
      return reply(plainText(`Paired. ${CONNECT_COPY}`));
    }
    this.deps.store.audit("discord.pair.failed", { userId, reason: outcome });
    return reply(plainText(outcome === "locked" ? "Too many wrong codes. Get a new code from XR on your computer." : "That code is not valid or has expired. Get a new one from XR on your computer."));
  }

  private async redeemChannel(code: string, guildId: string, channelId: string, userId: string, reply: Reply): Promise<void> {
    const outcome = this.deps.codes.redeem("channel", code);
    if (outcome !== "ok") {
      this.deps.store.audit("discord.pair.failed", { userId, reason: outcome, scope: "channel" });
      return reply(plainText(outcome === "locked" ? "Too many wrong codes. Get a new code from XR on your computer." : "That code is not valid or has expired."));
    }
    this.deps.access.allowChannel(guildId, channelId, userId);
    this.deps.store.audit("discord.channel.allowed", { guildId, channelId, userId });
    return reply(plainText(`This channel is allowed. ${CONNECT_COPY}`));
  }

  // ── interaction plumbing ─────────────────────────────────────────────────

  private async defer(i: DiscordInteraction, ephemeral: boolean): Promise<void> {
    await this.rest.request(
      "POST",
      `/interactions/${i.id}/${i.token}/callback`,
      { type: InteractionCallbackType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, data: { flags: ephemeral ? MessageFlags.EPHEMERAL : 0 } },
      { auth: false },
    );
  }

  /** First reply edits the deferred response; later replies are follow-up messages. */
  private interactionReply(i: DiscordInteraction): (msg: DiscordOutgoing) => Promise<void> {
    const appId = i.application_id;
    let first = true;
    return async (msg) => {
      const base = `/webhooks/${appId}/${i.token}`;
      // The deferred original cannot change its flags, so only follow-ups carry them.
      const res = first
        ? await this.rest.request("PATCH", `${base}/messages/@original`, toMessageBody(msg, { keepFlags: false }), { auth: false })
        : await this.rest.request("POST", `${base}?wait=true`, toMessageBody(msg), { auth: false });
      first = false;
      if (!res.ok) this.deps.log(`interaction reply failed (${res.status})`);
    };
  }

  private async respondEphemeral(i: DiscordInteraction, content: string): Promise<void> {
    await this.rest.request(
      "POST",
      `/interactions/${i.id}/${i.token}/callback`,
      { type: InteractionCallbackType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: truncate(content, DISCORD_MAX_CHARS), flags: MessageFlags.EPHEMERAL, allowed_mentions: { parse: [] } } },
      { auth: false },
    );
  }
}

/** Build a REST body. Mentions are always suppressed: model output must not ping @everyone. */
function toMessageBody(msg: DiscordOutgoing, opts: { keepFlags?: boolean } = {}): Record<string, unknown> {
  const body: Record<string, unknown> = { allowed_mentions: { parse: [] } };
  if (msg.content !== undefined) body.content = truncate(msg.content, DISCORD_MAX_CHARS);
  if (msg.embeds) body.embeds = msg.embeds;
  if (msg.components) body.components = msg.components;
  if (msg.replyTo) body.message_reference = { message_id: msg.replyTo, fail_if_not_exists: false };
  if (msg.ephemeral && opts.keepFlags !== false) body.flags = MessageFlags.EPHEMERAL;
  return body;
}
