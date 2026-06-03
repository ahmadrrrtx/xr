/**
 * XR — Telegram auth (deterministic user-id allow-list).
 *
 * SECURITY: only explicitly allow-listed Telegram user-ids may control the
 * agent. Everyone else is ignored (and logged). This is the deterministic
 * alternative to unreliable biometrics — and the opposite of OpenClaw's
 * open-to-anyone chat access.
 */
export function parseAllowedIds(env: string | undefined): number[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

export function isAllowed(userId: number | undefined, allowed: number[]): boolean {
  if (userId === undefined) return false;
  if (allowed.length === 0) return false; // fail closed: no allow-list = nobody
  return allowed.includes(userId);
}
