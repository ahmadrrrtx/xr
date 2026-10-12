/**
 * XR — the Discord task turn (Phase 26).
 *
 * One place decides what happens when a human asks XR to do something from
 * Discord: the per-chat budget, the per-task ceiling, the one-task-per-chat
 * guard, the typing pulse, the spend bookkeeping, the 20-turn reply context,
 * and where the answer is delivered.
 *
 * Extracted from `discord/bot.ts` (module-size gate) and written against a
 * narrow host interface so it can be driven by tests with a fake host — no
 * gateway, no REST, no model.
 */
import type { Store } from "../state/workspace-store.ts";
import type { BotRuntime } from "../bots/runtime.ts";
import { startTypingPulse } from "../bots/typing.ts";
import type { ApprovalRequest } from "../bots/approvals.ts";
import type { ChatSettings } from "../bots/types.ts";
import { splitForDiscord, type DiscordOutgoing } from "./render.ts";
import { executeOnSurface } from "../services/surface-execution.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { wrapUntrusted } from "../context/injection.ts";
import type { loadConfig } from "../config/config.ts";

const BUSY_REPLY = "A task is already running in this chat. `/xr stop` cancels it.";
/** Discord keeps the typing indicator alive for ~10 s; 5 s never lets it fade. */
export const TYPING_PULSE_MS = 5000;

/** Where a reply is delivered. */
export type Delivery =
  | { kind: "messages"; replyToMessageId?: string | null }
  | { kind: "interaction"; token: string; applicationId: string; ephemeral: boolean };

/** Everything else a turn needs beyond the message text. */
export interface TurnContext {
  blocks: string[];
  quote: string;
  notes: string[];
  guildId?: string;
  username?: string;
}

export interface TaskHost {
  store: Store;
  runtime: BotRuntime<DiscordOutgoing>;
  log: (line: string) => void;
  chatSettings: (chatId: string) => ChatSettings;
  triggerTyping: (chatId: string) => Promise<void>;
  /** "🤖 Working on it." — channel messages only; interactions already acked. */
  sendWorking: (chatId: string, delivery: Delivery) => Promise<void>;
  /** Deliver a finished answer: chunks, edits or follow-ups as needed. */
  deliver: (chatId: string, delivery: Delivery, raw: string) => Promise<void>;
  reply: (chatId: string, delivery: Delivery) => (content: string) => Promise<void>;
  approver: (chatId: string) => (req: ApprovalRequest) => Promise<boolean>;
}

/**
 * Run one task and deliver the answer. Every exit path either replies or has
 * already replied, so the user is never left with silence.
 */
export async function runTask(
  host: TaskHost,
  chatId: string,
  userId: string,
  text: string,
  inlineBudget: number | undefined,
  turn: TurnContext,
  delivery: Delivery,
  config: ReturnType<typeof loadConfig>["config"],
): Promise<void> {
  const reply = host.reply(chatId, delivery);
  if (!text && !turn.blocks.length) return reply("Send a task description.");
  if (host.runtime.tasks.isBusy(chatId)) return reply(BUSY_REPLY);

  const chatCap = config.discord?.chatBudgets?.maxUsd;
  const spent = host.runtime.spend.usd.get(chatId) ?? 0;
  if (chatCap != null && spent >= chatCap) {
    host.store.audit("discord.chat_budget", { chatId, spent, cap: chatCap, stopped: "budget" });
    return reply(`Chat budget exhausted ($${spent.toFixed(4)} of $${chatCap.toFixed(2)}). Raise it in XR settings.`);
  }
  const remaining = chatCap != null ? Math.max(0, chatCap - spent) : undefined;

  const providerId = config.defaults.provider;
  const chat = host.chatSettings(chatId);
  const modelId = chat.model ?? config.defaults.model;
  const perTask = Math.min(chat.budgetUsd ?? config.budget.perTaskUsd, inlineBudget ?? Infinity);

  // 20-turn ring, trimmed to the last 6 for the prompt: enough to follow
  // "and now the tests", small enough to keep the envelope honest.
  const history = host.runtime.replies.recent(chatId).slice(-6);
  const historyBlock = history.length
    ? wrapUntrusted(history.map((t) => `${t.role}: ${t.text}`).join("\n"), { kind: "discord_history", label: "earlier in this chat" })
    : "";
  const task = [...turn.blocks, turn.quote, historyBlock, ...turn.notes.map((n) => `(${n})`), text || "Review the attachment(s) above and respond."]
    .filter(Boolean)
    .join("\n\n");

  const ac = host.runtime.tasks.begin(chatId);
  if (!ac) return reply(BUSY_REPLY);
  await host.triggerTyping(chatId).catch(() => {});
  const stopTyping = startTypingPulse(() => host.triggerTyping(chatId).catch(() => {}), TYPING_PULSE_MS);
  const costBefore = host.store.costSummary().totalUsd;
  try {
    if (delivery.kind === "messages") await host.sendWorking(chatId, delivery);
    const provider = buildProvider(config, { model: modelId });
    const result = await executeOnSurface({
      task,
      mode: "agent",
      surface: "discord",
      store: host.store,
      provider,
      modelId,
      cwd: process.cwd(),
      say: () => {},
      approve: host.approver(chatId),
      signal: ac.signal,
      budget: {
        maxUsd: isLocal(providerId) ? remaining : remaining != null ? Math.min(perTask, remaining) : perTask,
        maxTokens: config.discord?.chatBudgets?.maxTokens ?? config.budget.perTaskTokens,
      },
      pricing: priceFor(providerId, modelId),
      egressAllowlist: config.security.egressAllowlist,
    });
    const charged = Math.max(0, host.store.costSummary().totalUsd - costBefore);
    host.runtime.spend.usd.set(chatId, spent + charged);

    const body = result.finalMessage?.trim() || (result.stopped === "cancelled" ? "Stopped." : "(no answer)");
    const footer = `${result.stopped}${result.meter ? ` · ${result.meter}` : ""}`;
    host.runtime.replies.push(chatId, { role: "user", text: text || "(attachment)" });
    host.runtime.replies.push(chatId, { role: "assistant", text: body });
    host.store.audit("discord.task", { userId, chatId, stopped: result.stopped, charged });
    await host.deliver(chatId, delivery, `${body}\n\n${footer}`);
  } catch (err) {
    host.log(`task failed: ${(err as Error).message}`);
    await reply("The task failed. Check the XR logs for details.");
  } finally {
    stopTyping();
    host.runtime.tasks.finish(chatId);
  }
}

/** Split an answer into Discord-sized messages (re-exported for the bot). */
export { splitForDiscord };
