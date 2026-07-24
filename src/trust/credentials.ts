/**
 * XR 4.2 — Credential Broker
 *
 * Provides TASK-SCOPED credential references to isolated environments WITHOUT
 * ever exposing raw secret values in execution records, logs, errors, or
 * command-line arguments.
 *
 * Hard rules enforced here:
 *   - Raw secret values live ONLY in an in-memory map. They are never returned
 *     by any method that feeds records/logs; only `prepareInjection()` yields
 *     them, and that output is meant to be handed straight to a sandboxed
 *     process's environment and then discarded.
 *   - Records see `CredentialScope` (refs + env var NAMES, never values).
 *   - `redact()` scrubs registered values (plus common secret shapes) from
 *     any text before it is logged/persisted.
 */
import { randomUUID } from "node:crypto";
import {
  TRUST_BOUNDS,
  type CredentialMode,
  type CredentialRef,
  type CredentialScope,
} from "./types.ts";

interface StoredSecret {
  ref: CredentialRef;
  value: string;
  envName: string;
}

const GENERIC_SECRET_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/g,                              // AWS access key id
  /\b(?:sk|pk)[_-](?:live|test|prod)[_-]?[0-9A-Za-z]{10,}\b/g,
  /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g,                    // github tokens
  /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,                  // slack tokens
  /\beyJ[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\.[0-9A-Za-z_-]{8,}\b/g, // JWT
  /\b-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----\b/g,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, // emails (PII scrub)
];

function envNameFor(label: string): string {
  const clean = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `XR_CRED_${clean || "SECRET"}`;
}

export class CredentialBroker {
  private readonly store = new Map<string, StoredSecret>();

  /**
   * Register a raw secret; returns a reference that is safe to store in
   * records. The raw value is retained only in memory until revoked.
   */
  register(label: string, value: string, scope: string, mode: CredentialMode = "task_scoped", ttlMs = TRUST_BOUNDS.GRANT_TTL_MS): CredentialRef {
    const refId = `cred_${randomUUID().slice(0, 12)}`;
    const ref: CredentialRef = {
      refId,
      label,
      mode,
      scope,
      expiresAt: Date.now() + ttlMs,
    };
    this.store.set(refId, { ref, value, envName: envNameFor(label) });
    return ref;
  }

  has(refId: string): boolean {
    const s = this.store.get(refId);
    if (!s) return false;
    if (s.ref.expiresAt && Date.now() >= s.ref.expiresAt) return false;
    return true;
  }

  /**
   * Resolve refs to a transient `{ env }` object of NAME→VALUE for injection
   * into a SANDBOXED process only. The caller must not persist the result.
   * Refs that are missing/expired/`unavailable` are skipped (fail-closed is
   * enforced by the policy layer when a REQUIRED ref is absent).
   */
  prepareInjection(refs: readonly CredentialRef[]): { env: Record<string, string>; injected: string[] } {
    const env: Record<string, string> = {};
    const injected: string[] = [];
    for (const ref of refs) {
      const s = this.store.get(ref.refId);
      if (!s) continue;
      if (s.ref.expiresAt && Date.now() >= s.ref.expiresAt) continue;
      if (s.ref.mode === "unavailable" || s.ref.mode === "none") continue;
      env[s.envName] = s.value;
      injected.push(s.envName);
    }
    return { env, injected };
  }

  /** Names-only view (safe to persist in records). */
  scopeFor(refs: readonly CredentialRef[], mode: CredentialMode): CredentialScope {
    const envNames: string[] = [];
    const safeRefs: CredentialRef[] = [];
    for (const ref of refs.slice(0, TRUST_BOUNDS.MAX_CRED_REFS)) {
      const s = this.store.get(ref.refId);
      if (s) envNames.push(s.envName);
      safeRefs.push(ref);
    }
    return { mode, refs: safeRefs, envNames: envNames.slice(0, TRUST_BOUNDS.MAX_ENV_NAMES) };
  }

  /** Revoke specific refs (delete raw values). */
  revoke(refs: readonly CredentialRef[]): number {
    let n = 0;
    for (const ref of refs) {
      if (this.store.delete(ref.refId)) n++;
    }
    return n;
  }

  revokeAll(): number {
    const n = this.store.size;
    this.store.clear();
    return n;
  }

  activeCount(): number {
    return this.store.size;
  }

  /** Scrub registered secret values and common secret shapes from text. */
  redact(text: string): string {
    let out = text;
    for (const s of this.store.values()) {
      if (s.value && s.value.length >= 4) {
        out = out.split(s.value).join("[REDACTED]");
      }
    }
    for (const re of GENERIC_SECRET_PATTERNS) {
      out = out.replace(re, "[REDACTED]");
    }
    return out;
  }

  /**
   * Throw if any registered secret value appears in a serialized structure.
   * Used as a guard before persisting records/logs.
   */
  assertClean(serialized: unknown): void {
    const hay = typeof serialized === "string" ? serialized : JSON.stringify(serialized);
    for (const s of this.store.values()) {
      if (s.value && s.value.length >= 4 && hay.includes(s.value)) {
        throw new Error(`credential broker: raw secret "${s.ref.label}" leaked into serialized output`);
      }
    }
  }
}
