/**
 * XR — WhatsApp authorization (Phase 26): who may talk to XR, and who may not.
 *
 * Fail-closed, like Telegram and Discord, with one WhatsApp-shaped twist: the
 * QR links *the device*, it does not trust *anyone*. Linking and authorization
 * are separate steps, and after linking the bot is still silent to every number
 * until the owner adds it.
 *
 * Three rules, in order:
 *   1. Groups, broadcasts and status traffic are dropped. Phase 26 is 1:1 only.
 *   2. A number on the allow-list is answered.
 *   3. When `respondToOutbox` is on, a number the *user* messaged first — from
 *      their phone, seen live by this linked device — is answered too. XR never
 *      scrapes history to build that list; it only notes recipients of messages
 *      that arrive while it is running.
 * Everything else is ignored in silence: no reply, no error, no hint that a bot
 * is on the other end.
 *
 * `/stop` (bare) removes the sender from the allow-list, which is why the help
 * text explains it in one line: the sender stops being answered immediately.
 */
import type { ChatRef } from "../bots/types.ts";

/** Digits only, country code included, no `+`. Matches the config regex. */
export function normalizePhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D+/g, "");
  return /^\d{6,15}$/.test(digits) ? digits : null;
}

/**
 * The phone behind a jid, when the jid is a user jid.
 *
 * `923001234567:12@s.whatsapp.net` → `923001234567` (the `:12` is the device).
 * Baileys also reports `@lid` identifiers, which are *not* phone numbers; those
 * return null and therefore never pass the allow-list check.
 */
export function phoneFromJid(jid: string | null | undefined): string | null {
  const raw = String(jid ?? "");
  const at = raw.indexOf("@");
  if (at < 0) return null;
  const domain = raw.slice(at + 1).toLowerCase();
  if (domain !== "s.whatsapp.net" && domain !== "c.us") return null;
  return normalizePhone(raw.slice(0, at).split(":")[0]);
}

/** The jid XR sends to. */
export function jidForPhone(phone: string): string {
  return `${phone}@s.whatsapp.net`;
}

/** Last four digits only — the form used in logs, audits and the status card. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D+/g, "");
  return digits.length >= 4 ? `…${digits.slice(-4)}` : "…";
}

/** Mask every phone-length digit run in a free-text line (log redaction). */
export function maskPhonesInText(line: string): string {
  return line.replace(/\d{6,15}/g, (match) => maskPhone(match));
}

export function isAllowedContact(phone: string | null, allowed: readonly string[]): boolean {
  if (!phone) return false;
  if (allowed.length === 0) return false;
  return allowed.includes(phone);
}

export type Admission = "allowed-list" | "allowed-outbox" | "denied";

export interface WhatsAppGateOptions {
  /** The allow-list, read live from config. */
  allowed: () => readonly string[];
  /** The outbox switch, read live from config. */
  respondToOutbox: () => boolean;
  /** Numbers already known to be in the outbox (from the state file). */
  outbox?: readonly string[];
  /** Persist the outbox when it changes. */
  onOutboxChange?: (list: string[]) => void;
  /** Ring size. Old enough to be useful, small enough to be honest about. */
  maxOutbox?: number;
}

/**
 * The admission gate. Deliberately tiny and synchronous: authorization must not
 * depend on anything that can be in flight.
 */
export class WhatsAppGate {
  private readonly outboxSet: Set<string>;
  private readonly maxOutbox: number;
  /** chatId → phone, so a reply can be attributed and outboxed. */
  private readonly chatPhones = new Map<ChatRef, string>();

  constructor(private readonly opts: WhatsAppGateOptions) {
    this.maxOutbox = opts.maxOutbox ?? 200;
    this.outboxSet = new Set((opts.outbox ?? []).map((p) => normalizePhone(p)).filter((p): p is string => !!p));
  }

  admit(phone: string | null): Admission {
    if (isAllowedContact(phone, this.opts.allowed())) return "allowed-list";
    if (phone && this.opts.respondToOutbox() && this.outboxSet.has(phone)) return "allowed-outbox";
    return "denied";
  }

  /**
   * Note that a message went *to* this number. Called for messages the user
   * sends from their phone (seen live by the linked device) and for every
   * message XR itself sends. Never called from history sync.
   */
  noteOutbound(phone: string | null): void {
    const normalized = normalizePhone(phone);
    if (!normalized || this.outboxSet.has(normalized)) return;
    this.outboxSet.add(normalized);
    while (this.outboxSet.size > this.maxOutbox) {
      const oldest = this.outboxSet.values().next().value;
      if (oldest === undefined) break;
      this.outboxSet.delete(oldest);
    }
    this.opts.onOutboxChange?.([...this.outboxSet]);
  }

  /** Forget a number (used when the sender asks XR to stop). */
  forget(phone: string): void {
    if (this.outboxSet.delete(phone)) this.opts.onOutboxChange?.([...this.outboxSet]);
  }

  outbox(): string[] {
    return [...this.outboxSet];
  }

  /** Remember which chat belongs to which number, for outbox bookkeeping. */
  rememberChat(chatId: ChatRef, phone: string | null): void {
    if (phone) this.chatPhones.set(chatId, phone);
  }

  phoneForChat(chatId: ChatRef): string | null {
    return this.chatPhones.get(chatId) ?? null;
  }
}
