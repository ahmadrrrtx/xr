/**
 * XR — the WhatsApp task turn (Phase 26).
 *
 * One place decides what happens when a contact asks XR to do something from
 * WhatsApp: the per-chat budget, the per-task ceiling, the one-task-per-chat
 * guard, the typing presence, the spend bookkeeping, the 20-turn reply context,
 * and how a long answer is delivered.
 *
 * Two WhatsApp facts shape it: there is no message editing (so progress and
 * outcomes are follow-up messages) and there are no buttons (so approvals are
 * the numbered menu in `render.ts`). Written against a narrow host interface so
 * tests drive it with a fake host — no socket, no model.
 */
import type { Store } from "../state/workspace-store.ts";
import type { BotRuntime } from "../bots/runtime.ts";
import { startTypingPulse } from "../bots/typing.ts";
import type { ApprovalRequest } from "../bots/approvals.ts";
import type { ChatSettings } from "../bots/types.ts";
import type { loadConfig } from "../config/config.ts";
import { splitForWhatsApp } from "./render.ts";
import { TYPING_PULSE_MS } from "./types.ts";
import { executeOnSurface } from "../services/surface-execution.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { wrapUntrusted } from "../context/injection.ts";

const BUSY_REPLY = "A task is already running in this chat. `/xr stop` cancels it.";

/** Where a reply goes: WhatsApp has exactly one kind of destination. */
export interface Delivery {
  kind: "chat";
  /** The message being answered, quoted in the reply. */
  quoteMessageId?: string | null;
}

export interface TurnContext {
  blocks: string[];
  quote: string;
  notes: string[];
  username?: string;
}

export interface TaskHost {
  store: Store;
  runtime: BotRuntime<string>;
  log: (line: string) => void;
  chatSettings: (chatId: string) => ChatSettings;
  triggerTyping: (chatId: string) => Promise<void>;
  /** Deliver a finished answer as one or more chat messages. */
  deliver: (chatId: string, delivery: Delivery, raw: string) => Promise<void>;
  reply: (chatId: string, delivery: Delivery) => (content: string) => Promise<void>;
  approver: (chatId: string) => (req: ApprovalRequest) => Promise<boolean>;
}

/**
 * Run one task and deliver the answer. Every exit path replies, so a contact is
 * never left with silence after asking something.
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

  const chatCap = config.whatsapp?.chatBudgets?.maxUsd;
  const spent = host.runtime.spend.usd.get(chatId) ?? 0;
  if (chatCap != null && spent >= chatCap) {
    host.store.audit("whatsapp.chat_budget", { chatId, spent, cap: chatCap, stopped: "budget" });
    return reply(`Chat budget exhausted ($${spent.toFixed(4)} of $${chatCap.toFixed(2)}). Raise it in XR settings.`);
  }
  const remaining = chatCap != null ? Math.max(0, chatCap - spent) : undefined;

  const providerId = config.defaults.provider;
  const chat = host.chatSettings(chatId);
  const modelId = chat.model ?? config.defaults.model;
  const perTask = Math.min(chat.budgetUsd ?? config.budget.perTaskUsd, inlineBudget ?? Infinity);

  // 20-turn ring trimmed to the last 6 for the prompt, as on the other surfaces.
  const history = host.runtime.replies.recent(chatId).slice(-6);
  const historyBlock = history.length
    ? wrapUntrusted(history.map((t) => `${t.role}: ${t.text}`).join("\n"), { kind: "whatsapp_history", label: "earlier in this chat" })
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
    const provider = buildProvider(config, { model: modelId });
    const result = await executeOnSurface({
      task,
      mode: "agent",
      surface: "whatsapp",
      store: host.store,
      provider,
      modelId,
      cwd: process.cwd(),
      say: () => {},
      approve: host.approver(chatId),
      signal: ac.signal,
      budget: {
        maxUsd: isLocal(providerId) ? remaining : remaining != null ? Math.min(perTask, remaining) : perTask,
        maxTokens: config.whatsapp?.chatBudgets?.maxTokens ?? config.budget.perTaskTokens,
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
    host.store.audit("whatsapp.task", { userId, chatId, stopped: result.stopped, charged });
    await host.deliver(chatId, delivery, `${body}\n\n${footer}`);
  } catch (err) {
    host.log(`task failed: ${(err as Error).message}`);
    await reply("The task failed. Check the XR logs for details.");
  } finally {
    stopTyping();
    host.runtime.tasks.finish(chatId);
  }
}

export { splitForWhatsApp };
