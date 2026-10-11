/**
 * XR — BotRuntime: the shared chat-surface runtime (Phase 26).
 *
 * Composes the common pieces every chat surface needs, so a surface module
 * owns only its wire protocol:
 *   · rate        per-chat token bucket
 *   · tasks       one running task per chat, with /stop and shutdown abort
 *   · spend       per-chat spend ledger for the budget cap
 *   · replies     20-turn in-memory reply context
 *   · approvals   durable approval bridge, edited on any surface's decision
 */
import { ChatRateLimiter } from "./rate.ts";
import { TaskGuard } from "./tasks.ts";
import { ChatSpend } from "./spend.ts";
import { ReplyContext } from "./context.ts";
import { ApprovalBridge, type ApprovalBridgeOptions } from "./approvals.ts";
import type { BotSurface } from "./types.ts";

export class BotRuntime<Msg> {
  readonly surface: BotSurface<Msg>;
  readonly rate = new ChatRateLimiter();
  readonly tasks = new TaskGuard();
  readonly spend = new ChatSpend();
  readonly replies = new ReplyContext(20);
  readonly approvals: ApprovalBridge<Msg>;

  constructor(opts: ApprovalBridgeOptions<Msg>) {
    this.surface = opts.surface;
    this.approvals = new ApprovalBridge<Msg>(opts);
  }

  /** Cancel every running task (daemon shutdown). */
  abortAll(): void {
    this.tasks.abortAll();
  }
}
