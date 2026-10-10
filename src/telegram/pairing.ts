/**
 * XR — Telegram pairing: a short-lived window, 6-digit single-use codes.
 *
 * Fail-closed by design. `/start` from an unknown Telegram user produces a
 * code ONLY while a pairing window is open (opened from the desktop when the
 * user connects or adds a device). Outside the window an unknown user gets no
 * reply at all, so the bot cannot be used to enumerate itself.
 *
 * The code is shown in the Telegram chat, never in the desktop status payload.
 * The user reads it off their phone and types it into XR. The desktop shows
 * the requester's name and @username, so the person pairing can confirm who
 * is asking. Codes expire after 10 minutes, are single-use, and five wrong
 * attempts close the window.
 */
import { randomInt } from "node:crypto";

export const PAIRING_CODE_TTL_MS = 10 * 60_000;
export const PAIRING_WINDOW_MS = 10 * 60_000;
export const PAIRING_MAX_FAILED_ATTEMPTS = 5;

export interface PendingPairing {
  userId: number;
  name: string;
  username: string | null;
  expiresAt: number;
}

interface Entry extends PendingPairing {
  code: string;
}

export class PairingBook {
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

  windowClosesAt(): number | null {
    return this.windowUntil > Date.now() ? this.windowUntil : null;
  }

  /**
   * Issue a code for an unknown user who sent /start. Returns null when the
   * window is closed (the caller must stay silent). A repeated /start from the
   * same user reuses their pending code instead of minting a new one.
   */
  issue(
    user: { id: number; name: string; username: string | null },
    now = Date.now(),
  ): { code: string; expiresAt: number } | null {
    if (!this.isOpen(now)) return null;
    this.prune(now);
    const existing = this.entries.find((e) => e.userId === user.id);
    if (existing) return { code: existing.code, expiresAt: existing.expiresAt };
    let code = "";
    do {
      code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    } while (this.entries.some((e) => e.code === code));
    const expiresAt = Math.min(now + PAIRING_CODE_TTL_MS, this.windowUntil);
    this.entries.push({ code, userId: user.id, name: user.name, username: user.username, expiresAt });
    return { code, expiresAt };
  }

  /** Pending requests for the desktop. Codes are deliberately omitted. */
  pending(now = Date.now()): PendingPairing[] {
    this.prune(now);
    return this.entries.map(({ userId, name, username, expiresAt }) => ({ userId, name, username, expiresAt }));
  }

  /**
   * Consume a code typed on the desktop. Single-use: a matching entry is
   * removed whether or not the caller later succeeds. A wrong code counts
   * toward the failed-attempt lock.
   */
  consume(code: string, now = Date.now()): PendingPairing | null {
    this.prune(now);
    const idx = this.entries.findIndex((e) => e.code === code.trim());
    if (idx < 0) {
      this.failed += 1;
      if (this.failed >= PAIRING_MAX_FAILED_ATTEMPTS) this.closeWindow();
      return null;
    }
    const [hit] = this.entries.splice(idx, 1);
    return { userId: hit.userId, name: hit.name, username: hit.username, expiresAt: hit.expiresAt };
  }

  private prune(now: number): void {
    this.entries = this.entries.filter((e) => e.expiresAt > now);
  }
}
