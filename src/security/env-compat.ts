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
 */
export function envSecretCompatEnabled(): boolean {
  const raw = process.env.XR_SECRETS_ENV_COMPAT;
  if (raw === undefined || raw.trim() === "") return true; // default ON for 1.0
  const v = raw.trim().toLowerCase();
  // Only explicit off-values disable ambient hydration; anything else
  // (including typos) keeps the 1.0 behavior — fail-safe toward working
  // providers, never toward silently missing keys.
  return !(v === "0" || v === "false" || v === "off");
}
