/**
 * XR — one task per chat (Phase 26 shared guard).
 *
 * A chat that has a task running refuses a second one until it finishes or
 * is stopped with /stop. The guard is keyed by chat so two chats never block
 * each other. Synchronous by design: `begin` and `isBusy` never await, so a
 * caller that checks and then begins in the same tick cannot race.
 */
import type { ChatRef } from "./types.ts";

export class TaskGuard<K extends ChatRef = ChatRef> {
  private running = new Map<K, AbortController>();

  isBusy(chatId: K): boolean {
    return this.running.has(chatId);
  }

  /** Register a running task. Returns null when the chat is already busy. */
  begin(chatId: K): AbortController | null {
    if (this.running.has(chatId)) return null;
    const ac = new AbortController();
    this.running.set(chatId, ac);
    return ac;
  }

  /** Abort the chat's running task. False when nothing was running. */
  abort(chatId: K): boolean {
    const ac = this.running.get(chatId);
    if (!ac) return false;
    ac.abort();
    return true;
  }

  /** Clear the chat's slot. Call from `finally`, after the task settles. */
  finish(chatId: K): void {
    this.running.delete(chatId);
  }

  /** Abort every running task (daemon shutdown). Slots clear as tasks settle. */
  abortAll(): void {
    for (const ac of this.running.values()) ac.abort();
  }
}
