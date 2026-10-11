/**
 * XR — per-chat reply context for Telegram.
 *
 * The implementation moved to the shared chat runtime (src/bots/context.ts) in
 * Phase 26. This module re-exports it so existing imports keep working.
 */
export { ReplyContext, type ChatTurn } from "../bots/context.ts";
