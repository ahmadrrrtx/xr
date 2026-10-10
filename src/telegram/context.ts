/**
 * XR — per-chat reply context for Telegram.
 *
 * The implementation moved to src/bots/context.ts so every chat surface shares
 * it. This module re-exports it so existing Telegram imports keep working.
 */
export { ReplyContext, type ChatTurn } from "../bots/context.ts";
