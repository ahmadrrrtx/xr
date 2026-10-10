/**
 * XR — per-chat reply context for Telegram (in-memory only).
 *
 * Keeps the last 20 turns per chat so follow-ups ("make it shorter") work.
 * Nothing is persisted: restarting XR clears it, by design. Durable chat
 * history is out of scope for this phase.
 */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export class ReplyContext {
  private rings = new Map<number, ChatTurn[]>();

  constructor(private readonly maxTurns = 20) {}

  push(chatId: number, turn: ChatTurn): void {
    const ring = this.rings.get(chatId) ?? [];
    ring.push({ role: turn.role, text: turn.text.slice(0, 2000) });
    while (ring.length > this.maxTurns) ring.shift();
    this.rings.set(chatId, ring);
  }

  recent(chatId: number): ChatTurn[] {
    return [...(this.rings.get(chatId) ?? [])];
  }

  clear(chatId?: number): void {
    if (chatId === undefined) this.rings.clear();
    else this.rings.delete(chatId);
  }
}
