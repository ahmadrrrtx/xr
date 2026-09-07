/**
 * XR Phase 8 — Secret env-compat flag (single gate, zero deps).
 *
 * `XR_SECRETS_ENV_COMPAT` governs ambient process.env hydration of provider
 * keys:
 *
 *   • unset / empty / "0" / "false" / "off"  — DEFAULT (2.0): keys are
 *     resolved lazily through the SecretBroker only and never land in
 *     process.env.
 *   • "1" / "true" / "on" / "yes"            — 1.0 compat: keys MAY be
 *     hydrated into process.env (opt-in legacy).
 *
 * Imported by both `secrets.ts` (the durable backend) and `secret-broker.ts`
 * (the resolution seam), so the gate has exactly ONE definition.
 *
 * The flag is SNAPSHOT at module load (env flags describe process start-up
 * posture). Snapshotting also keeps the gate immune to mid-process env
 * mutations: `bun test` runs test files in threads that share process.env,
 * so a live read would let one file's flag mutation change every other
 * file's secret behavior.
 */

/** Pure predicate: does a raw env value disable ambient hydration? */
export function isOffValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return true; // default OFF for 2.0
  const v = raw.trim().toLowerCase();
  // Only explicit on-values enable ambient hydration. Typos and anything
  // else fail-safe toward NOT hydrating keys into process.env.
  if (v === "1" || v === "true" || v === "on" || v === "yes") return false;
  return true;
}

const SNAPSHOT_OFF = isOffValue(process.env.XR_SECRETS_ENV_COMPAT);

export function envSecretCompatEnabled(): boolean {
  return !SNAPSHOT_OFF;
}
