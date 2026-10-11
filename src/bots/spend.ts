/**
 * XR — per-chat spend ledger (Phase 26 shared layer).
 *
 * Tracks what each chat has spent so the per-chat budget (Governor envelope)
 * can stop a chat before a surface's daily allowance is gone. The maps are
 * exposed directly: the cap check and the message text stay on the surface.
 */
import type { ChatRef } from "./types.ts";

export class ChatSpend<K extends ChatRef = ChatRef> {
  readonly usd = new Map<K, number>();
  readonly tokens = new Map<K, number>();
}
