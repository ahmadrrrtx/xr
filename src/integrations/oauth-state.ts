/**
 * Phase 22 · Integrations — PKCE and pending OAuth sign-ins.
 *
 * The verifier and the state token never leave the daemon: the renderer only
 * opens the authorize URL and later forwards `code` + `state` back. A state
 * value is single-use and expires after the TTL, which is the CSRF guard for
 * the deep-link callback.
 */

import { createHash, randomBytes } from 'crypto';

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** RFC 7636 S256 pair. The verifier is 43 URL-safe characters from 32 random bytes. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

interface PendingSignIn {
  connectorId: string;
  verifier: string;
  createdAt: number;
}

export class PendingOAuthStore {
  private readonly pending = new Map<string, PendingSignIn>();

  constructor(
    private readonly ttlMs = OAUTH_STATE_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Records a new sign-in and returns its unguessable state token. */
  begin(connectorId: string, verifier: string): string {
    this.sweep();
    const state = base64Url(randomBytes(32));
    this.pending.set(state, { connectorId, verifier, createdAt: this.now() });
    return state;
  }

  /** Single-use lookup. Returns null for unknown, reused, or expired states. */
  take(state: string): { connectorId: string; verifier: string } | null {
    this.sweep();
    const entry = this.pending.get(state);
    if (!entry) return null;
    this.pending.delete(state);
    if (this.now() - entry.createdAt > this.ttlMs) return null;
    return { connectorId: entry.connectorId, verifier: entry.verifier };
  }

  get size(): number {
    return this.pending.size;
  }

  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [state, entry] of this.pending) {
      if (entry.createdAt < cutoff) this.pending.delete(state);
    }
  }
}
