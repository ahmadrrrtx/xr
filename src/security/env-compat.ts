/**
 * XR Phase 2 · F-24 — Secret env-compat flag (single gate, zero deps).
 *
 * `XR_SECRETS_ENV_COMPAT` governs ambient process.env hydration of provider
 * keys for the 1.0 release:
 *
 *   • unset / "1" / "true" / "on"  — CURRENT behavior: keys may be hydrated
 *     into process.env (backward compatible).
 *   • "0" / "false" / "off"        — keys are resolved lazily through the
 *     SecretBroker only and never land in process.env (2.0 behavior).
 *
 * Imported by both `secrets.ts` (the durable backend) and `secret-broker.ts`
 * (the resolution seam), so the gate has exactly ONE definition.
 *
 * The flag is SNAPSHOT at module load (env flags describe process start-up
 * posture — same pattern as DEFAULT_RESERVATION_TTL_MS). Snapshotting also
 * keeps the gate immune to mid-process env mutations: `bun test` runs test
 * files in threads that share process.env, so a live read would let one
 * file's flag mutation change every other file's secret behavior.
 */

/** Pure predicate: does a raw env value disable ambient hydration? */
export function isOffValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false; // default ON for 1.0
  const v = raw.trim().toLowerCase();
  // Only explicit off-values disable ambient hydration; anything else
  // (including typos) keeps the 1.0 behavior — fail-safe toward working
  // providers, never toward silently missing keys.
  return v === "0" || v === "false" || v === "off";
}

const SNAPSHOT_OFF = isOffValue(process.env.XR_SECRETS_ENV_COMPAT);

export function envSecretCompatEnabled(): boolean {
  return !SNAPSHOT_OFF;
}
