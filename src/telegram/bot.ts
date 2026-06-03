/**
 * XR — Telegram bot runtime (long-polling, dependency-free via fetch).
 *
 * Secure by design:
 *   • user-id allow-list (only you)
 *   • risky actions become ✅/❌ buttons answered from your phone
 *   • every message/decision is audited
 *
 * Token + allowed ids come from env (BYO, like everything in XR):
 *   XR_TELEGRAM_TOKEN, XR_TELEGRAM_ALLOWED (comma-separated user ids)
 */
import type { Store } from "../state/db.ts";
import { parseAllowedIds, isAllowed } from "./auth.ts";
import { parseCommand, helpText } from "./commands.ts";
import {
  approvalMessage,
  statusMessage,
  plain,
  parseCallback,
  type OutgoingMessage,
} from "./render.ts";
import { runAgent } from "../core/agent.ts";
import { loadConfig } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { runLab } from "../security/lab.ts";
import { basename } from "node:path";

const API = (token: string) => `https://api.telegram.org/bot${token}`;

export interface BotDeps {
  token: string;
  allowedIds: number[];
  store: Store;
  /** Injected fetch for testing. */
  fetchFn?: typeof fetch;
}

export class TelegramBot {
  private offset = 0;
  private running = false;
  private paused = false;
  /** Pending approvals: id -> resolver. */
  private pending = new Map<string, (ok: boolean) => void>();
  private f: typeof fetch;

  constructor(private deps: BotDeps) {
    this.f = deps.fetchFn ?? fetch;
  }

  private async call(method: string, body: Record<string, unknown>): Promise<any> {
    const res = await this.f(`${API(this.deps.token)}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json().catch(() => ({}));
  }

  async send(chatId: number, msg: OutgoingMessage): Promise<void> {
    await this.call("sendMessage", {
      chat_id: chatId,
      text: msg.text,
      parse_mode: msg.parse_mode,
      reply_markup: msg.reply_markup,
    });
  }

  /** Approval callback used by the agent loop. Sends buttons, awaits the tap. */
  approver(chatId: number) {
    return (req: { tool: string; reason: string; preview?: string }): Promise<boolean> => {
      const id = Math.random().toString(36).slice(2, 8);
      const msg = approvalMessage({ id, ...req });
      this.deps.store.audit("telegram.approval.request", { tool: req.tool });
      return new Promise<boolean>((resolve) => {
        this.pending.set(id, resolve);
        void this.send(chatId, msg);
        // Default-deny after 5 min (fail closed).
        setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            this.deps.store.audit("telegram.approval.timeout", { tool: req.tool });
            resolve(false);
          }
        }, 5 * 60 * 1000);
      });
    };
  }

  /** Handle one incoming update (message or callback). Exposed for tests. */
  async handleUpdate(update: any): Promise<void> {
    // Inline button tap (approval).
    if (update.callback_query) {
      const cq = update.callback_query;
      const userId = cq.from?.id;
      if (!isAllowed(userId, this.deps.allowedIds)) return;
      const parsed = parseCallback(cq.data ?? "");
      if (parsed && this.pending.has(parsed.id)) {
        const resolve = this.pending.get(parsed.id)!;
        this.pending.delete(parsed.id);
        resolve(parsed.decision === "approve");
        this.deps.store.audit("telegram.approval.answered", { decision: parsed.decision });
        await this.call("answerCallbackQuery", {
          callback_query_id: cq.id,
          text: parsed.decision === "approve" ? "✅ approved" : "❌ rejected",
        });
      }
      return;
    }

    const msg = update.message;
    if (!msg) return;
    const userId = msg.from?.id;
    const chatId = msg.chat?.id;

    // AUTH GATE — only allow-listed ids; everyone else ignored + logged.
    if (!isAllowed(userId, this.deps.allowedIds)) {
      this.deps.store.audit("telegram.unauthorized", { userId });
      return;
    }

    const cmd = parseCommand(msg.text ?? "");
    await this.dispatch(chatId, cmd);
  }

  private async dispatch(chatId: number, cmd: ReturnType<typeof parseCommand>): Promise<void> {
    const { config } = loadConfig();
    const project = basename(process.cwd());

    switch (cmd.type) {
      case "help":
      case "empty":
        return this.send(chatId, plain(helpText()));

      case "pause":
        this.paused = true;
        this.deps.store.audit("telegram.pause", {});
        return this.send(chatId, plain("⏸ paused. /resume to continue."));

      case "resume":
        this.paused = false;
        return this.send(chatId, plain("▶️ resumed."));

      case "cost": {
        const c = this.deps.store.costSummary();
        return this.send(chatId, plain(`💰 $${c.totalUsd.toFixed(4)} · ${c.totalTokens} tokens total`));
      }

      case "budget":
        this.deps.store.audit("telegram.budget", { usd: cmd.usd });
        return this.send(chatId, plain(`💰 per-task ceiling set to $${cmd.usd.toFixed(2)}`));

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
            paused: this.paused,
          }),
        );
      }

      case "task": {
        if (this.paused) return this.send(chatId, plain("⏸ paused — /resume first."));
        if (!cmd.text) return this.send(chatId, plain("send a task description."));
        await this.send(chatId, plain(`🟢 working on it…`));
        const providerId = config.defaults.provider;
        const model = config.defaults.model;
        const provider = buildProvider(config, {});
        const result = await runAgent(cmd.text, "agent", {
          provider,
          store: this.deps.store,
          cwd: process.cwd(),
          say: () => {}, // streamed lines suppressed on mobile
          approve: this.approver(chatId),
          budget: {
            maxUsd: isLocal(providerId) ? undefined : (cmd.budgetUsd ?? config.budget.perTaskUsd),
            maxTokens: config.budget.perTaskTokens,
          },
          pricing: priceFor(providerId, model),
          egressAllowlist: config.security.egressAllowlist,
        });
        return this.send(
          chatId,
          plain(`✅ ${result.stopped} · ${result.meter ?? ""}\n\n${result.finalMessage.slice(0, 800)}`),
        );
      }
    }
  }

  /** Long-poll loop. */
  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        const res = await this.call("getUpdates", { offset: this.offset, timeout: 25 });
        for (const u of res.result ?? []) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u);
        }
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  stop(): void {
    this.running = false;
  }
}
