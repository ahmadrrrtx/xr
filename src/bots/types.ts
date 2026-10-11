/**
 * XR — shared chat-surface types (Phase 26).
 *
 * Telegram, Discord and WhatsApp each own a wire protocol. Everything else a
 * chat bot needs (rate limits, one task per chat, spend caps, the approval
 * bridge, reply context, typing) lives in src/bots/ and talks to the surface
 * only through `BotSurface`.
 */

/** Chat identifiers differ per platform: Telegram uses numbers, Discord and WhatsApp use strings. */
export type ChatRef = string | number;

/** Platform message identifier, used to edit a message after it was sent. */
export type MessageRef = string | number;

/** Every chat surface that can sit on the shared runtime. */
export type BotSurfaceId = "telegram" | "discord" | "whatsapp";

/**
 * The narrow contract a surface implements. `Msg` is the platform-native
 * message shape (Telegram: text + MarkdownV2 + inline keyboard).
 */
export interface BotSurface<Msg> {
  readonly id: BotSurfaceId;
  send(chatId: ChatRef, msg: Msg): Promise<MessageRef | undefined>;
  edit(chatId: ChatRef, messageId: MessageRef, text: string): Promise<void>;
  setTyping(chatId: ChatRef): Promise<void>;
}

/** Outcome label used when an approval message is edited after a decision. */
export type ApprovalOutcomeLabel = "approved" | "rejected" | "expired";
