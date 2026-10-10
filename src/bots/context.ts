/**
 * XR — per-chat reply context for chat surfaces (in-memory only).
 *
 * Keeps the last N turns per chat so follow-ups ("make it shorter") work.
 * Nothing is persisted: restarting XR clears it, by design. Durable chat
 * history is out of scope for this phase.
 *
 * Chat keys are whatever the adapter uses for its chat identity (a Telegram
 * numeric chat id, a Discord snowflake string, a WhatsApp jid). They are
 * compared as given, never coerced.
 */
export type ChatKey = string | number;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export class ReplyContext {
  private rings = new Map<ChatKey, ChatTurn[]>();

  constructor(private readonly maxTurns = 20) {}

  push(chatKey: ChatKey, turn: ChatTurn): void {
    const ring = this.rings.get(chatKey) ?? [];
    ring.push({ role: turn.role, text: turn.text.slice(0, 2000) });
    while (ring.length > this.maxTurns) ring.shift();
    this.rings.set(chatKey, ring);
  }

  recent(chatKey: ChatKey): ChatTurn[] {
    return [...(this.rings.get(chatKey) ?? [])];
  }

  clear(chatKey?: ChatKey): void {
    if (chatKey === undefined) this.rings.clear();
    else this.rings.delete(chatKey);
  }
}
