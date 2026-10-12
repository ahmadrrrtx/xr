/**
 * XR — Discord authorization (Phase 26): paired users, allowed channels, and
 * the code book that creates both.
 *
 * Fail-closed, like Telegram:
 *   · DMs: only a paired user id gets a reply. An unpaired DM is silent.
 *   · Guilds: only an allow-listed channel is answered at all, and even there
 *     only slash commands and explicit @mentions (a whitelisted channel means
 *     "XR may act here", not "XR reads everything").
 *   · A wrong pairing code produces no confirmation outside an open window, so
 *     the bot cannot be used to probe itself.
 *
 * Two kinds of codes exist:
 *   · user codes    — minted in the XR app, redeemed with `/xr pair <code>` in a DM
 *   · channel codes — minted in the XR app, redeemed with `/xr pairchannel <code>`
 *                     in the guild channel, by an already-paired user
 */
import { randomInt } from "node:crypto";

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PAIRING_WINDOW_MS = 10 * 60_000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 5;

export interface PendingPairing {
  kind: "user" | "channel";
  /** Who asked, for the desktop list ("Ahmad#1234", "#general"). */
  label: string;
  guildId?: string;
  channelId?: string;
  expiresAt: number;
}

interface Entry extends PendingPairing {
  code: string;
}

/** Discord ids are snowflakes: decimal digits, 17–20 of them today. */
export function normalizeDiscordId(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{5,25}$/.test(s) ? s : null;
}

/** User allow-list. Empty list = nobody (fail closed). */
export function isAllowedUser(userId: string | undefined, allowed: readonly string[]): boolean {
  if (!userId) return false;
  if (allowed.length === 0) return false;
  return allowed.includes(userId);
}

/** Channel key: `guildId:channelId`. */
export function channelKey(guildId: string, channelId: string): string {
  return `${guildId}:${channelId}`;
}

export function allowedChannelKeys(list: readonly { guildId: string; channelId: string }[]): string[] {
  return list.map((c) => channelKey(c.guildId, c.channelId));
}

export function isAllowedChannel(
  channel: { guildId?: string; channelId: string },
  allowed: readonly { guildId: string; channelId: string }[],
): boolean {
  if (!channel.guildId) return false;
  const key = channelKey(channel.guildId, channel.channelId);
  return allowed.some((c) => channelKey(c.guildId, c.channelId) === key);
}

export class DiscordPairingBook {
  private windowUntil = 0;
  private entries: Entry[] = [];
  private failed = 0;

  /** Open (or extend) the pairing window. Returns its close time. */
  openWindow(now = Date.now(), ttlMs = PAIRING_WINDOW_MS): number {
    this.windowUntil = now + ttlMs;
    this.failed = 0;
    return this.windowUntil;
  }

  closeWindow(): void {
    this.windowUntil = 0;
    this.entries = [];
    this.failed = 0;
  }

  isOpen(now = Date.now()): boolean {
    return this.windowUntil > now && this.failed < PAIRING_MAX_FAILED_ATTEMPTS;
  }

  windowClosesAt(now = Date.now()): number | null {
    return this.windowUntil > now ? this.windowUntil : null;
  }

  /**
   * Mint a code for the desktop to display. Requires an open window: XR never
   * leaves a redeemable code lying around after the operator walked away.
   */
  issue(entry: Omit<PendingPairing, "expiresAt">, now = Date.now()): { code: string; expiresAt: number } | null {
    if (!this.isOpen(now)) return null;
    this.prune(now);
    let code = "";
    do {
      code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    } while (this.entries.some((e) => e.code === code));
    const expiresAt = Math.min(now + PAIRING_CODE_TTL_MS, this.windowUntil);
    this.entries.push({ ...entry, code, expiresAt });
    return { code, expiresAt };
  }

  /** Pending requests for the desktop status view. Codes are omitted. */
  pending(now = Date.now()): PendingPairing[] {
    this.prune(now);
    return this.entries.map(({ kind, label, guildId, channelId, expiresAt }) => ({ kind, label, guildId, channelId, expiresAt }));
  }

  /**
   * Redeem a code. Single-use: a match is removed whether or not the caller
   * succeeds. A wrong code counts toward the failed-attempt lock, which closes
   * the window — the same shape as the Telegram pairing book.
   */
  consume(code: string, kind: PendingPairing["kind"], now = Date.now()): PendingPairing | null {
    this.prune(now);
    const wanted = String(code ?? "").trim();
    // A real code used in the wrong flow is a mistake, not a brute-force
    // attempt: refuse it without spending the window's failed-attempt budget.
    if (this.entries.some((e) => e.code === wanted && e.kind !== kind)) return null;
    const idx = this.entries.findIndex((e) => e.code === wanted && e.kind === kind);
    if (idx < 0) {
      this.failed += 1;
      if (this.failed >= PAIRING_MAX_FAILED_ATTEMPTS) this.closeWindow();
      return null;
    }
    const [hit] = this.entries.splice(idx, 1);
    return { kind: hit.kind, label: hit.label, guildId: hit.guildId, channelId: hit.channelId, expiresAt: hit.expiresAt };
  }

  private prune(now: number): void {
    this.entries = this.entries.filter((e) => e.expiresAt > now);
  }
}
