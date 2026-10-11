/**
 * XR — per-chat reply context for chat surfaces (in-memory only).
 *
 * Keeps the last N turns per chat so follow-ups ("make it shorter") work.
 * Nothing is persisted: restarting XR clears it, by design. Durable chat
 * history is out of scope.
 */
import type { ChatRef } from "./types.ts";

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export class ReplyContext<K extends ChatRef = ChatRef> {
  private rings = new Map<K, ChatTurn[]>();

  constructor(private readonly maxTurns = 20) {}

  push(chatId: K, turn: ChatTurn): void {
    const ring = this.rings.get(chatId) ?? [];
    ring.push({ role: turn.role, text: turn.text.slice(0, 2000) });
    while (ring.length > this.maxTurns) ring.shift();
    this.rings.set(chatId, ring);
  }

  recent(chatId: K): ChatTurn[] {
    return [...(this.rings.get(chatId) ?? [])];
  }

  clear(chatId?: K): void {
    if (chatId === undefined) this.rings.clear();
    else this.rings.delete(chatId);
  }
}
