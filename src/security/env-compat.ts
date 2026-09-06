/**
 * XR Phase 8 · F-24 — Secret env posture (two independent gates).
 *
 * ── Why two flags and not one (the Phase 2 seam had one) ────────────────────
 *
 * Phase 2 shipped a single flag, `XR_SECRETS_ENV_COMPAT`, that governed BOTH
 * directions of the process.env relationship:
 *
 *   (a) HYDRATION  — XR writing a stored key INTO process.env, and
 *   (b) AMBIENT READ — XR reading a key the USER exported in their shell.
 *
 * Phase 8's objective is F-24: "provider keys must not sit in ambient process
 * memory where any in-process extension can enumerate them." That is entirely
 * a statement about (a). Direction (b) is not a vulnerability — it is BYOK,
 * the documented way most users and every CI job supply a key. XR did not put
 * the value there; the user did, and it is in their own process either way.
 *
 * Flipping one flag to cover both would have closed F-24 by breaking
 * `export OPENAI_API_KEY=…`, which is a real regression traded for a
 * cosmetic security win. So the gates are separated:
 *
 *   XR_SECRETS_ENV_HYDRATION   default OFF  (Phase 8 flip — closes F-24)
 *     Does XR ever WRITE a secret into process.env?
 *     OFF: never. Keys resolved from the durable store stay in the broker's
 *     memo and are handed to providers through a per-request callback.
 *
 *   XR_SECRETS_ENV_READ        default ON   (BYOK stays working)
 *     Does XR read an ambient value the user exported?
 *     ON: yes, as ONE source, and only after the durable store is consulted —
 *     see the ordering note in secret-broker.ts.
 *
 *   XR_SECRETS_STRICT=1        sealed posture: forces hydration OFF and
 *     ambient read OFF in one switch, for operators who want XR to touch
 *     process.env in neither direction. This is the "2.0 posture" the Phase 2
 *     seam anticipated, now reachable without breaking anyone by default.
 *
 * ── Backward compatibility ──────────────────────────────────────────────────
 *
 * `XR_SECRETS_ENV_COMPAT` is still honoured for one release:
 *   · `XR_SECRETS_ENV_COMPAT=0` ⇒ identical to `XR_SECRETS_STRICT=1`
 *     (what the flag meant to anyone who had already set it: keep XR out of
 *     process.env entirely).
 *   · `XR_SECRETS_ENV_COMPAT=1` ⇒ explicitly re-enables hydration, restoring
 *     the pre-Phase-8 default for anyone who depended on XR exporting keys to
 *     child processes.
 * Both are audited by `secretEnvPostureNote()` so the transition is visible.
 *
 * The flags are SNAPSHOT at module load: env flags describe process start-up
 * posture, and `bun test` runs files in threads that share process.env, so a
 * live read would let one test file's mutation change another's secret
 * behaviour mid-run.
 */

/** Pure predicate: is a raw env value an explicit OFF? */
export function isOffValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "off";
}

/** Pure predicate: is a raw env value an explicit ON? */
export function isOnValue(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Pure resolver — the whole posture decision as a function of the environment,
 * so it is testable without mutating any real process.
 */
export interface SecretEnvPosture {
  /** May XR WRITE secrets into process.env? Phase 8: false by default. */
  readonly hydration: boolean;
  /** May XR READ an ambient user-exported secret? Default: true (BYOK). */
  readonly ambientRead: boolean;
  /** True when the legacy single flag was used to reach this posture. */
  readonly legacyFlagUsed: boolean;
}

export function resolvePosture(env: Record<string, string | undefined>): SecretEnvPosture {
  const strict = isOnValue(env.XR_SECRETS_STRICT);
  const legacy = env.XR_SECRETS_ENV_COMPAT;
  const legacyOff = isOffValue(legacy);
  const legacyOn = isOnValue(legacy);

  // Sealed posture: XR touches process.env in neither direction.
  if (strict || legacyOff) {
    return { hydration: false, ambientRead: false, legacyFlagUsed: legacyOff && !strict };
  }

  // Hydration: OFF by default in Phase 8 (F-24). Re-enabled only by an
  // explicit opt-in on either the new flag or the legacy one.
  const hydration = isOnValue(env.XR_SECRETS_ENV_HYDRATION) || legacyOn;

  // Ambient read: ON by default (BYOK); explicitly disableable on its own.
  const ambientRead = !isOffValue(env.XR_SECRETS_ENV_READ);

  return { hydration, ambientRead, legacyFlagUsed: legacyOn };
}

const SNAPSHOT: SecretEnvPosture = resolvePosture(process.env as Record<string, string | undefined>);

/** May XR write provider keys into process.env? (F-24: no, by default.) */
export function envHydrationEnabled(): boolean {
  return SNAPSHOT.hydration;
}

/** May XR read an ambient, user-exported key? (BYOK: yes, by default.) */
export function envAmbientReadEnabled(): boolean {
  return SNAPSHOT.ambientRead;
}

/** The resolved posture (status surfaces, doctor, tests). */
export function secretEnvPosture(): SecretEnvPosture {
  return SNAPSHOT;
}

/**
 * Human-readable posture line for `xr doctor` / status output and for the
 * one-release deprecation nudge on the legacy flag.
 */
export function secretEnvPostureNote(posture: SecretEnvPosture = SNAPSHOT): string {
  const parts = [
    `hydration=${posture.hydration ? "on" : "off"}`,
    `ambient-read=${posture.ambientRead ? "on" : "off"}`,
  ];
  const base = `secret env posture: ${parts.join(" · ")}`;
  if (!posture.legacyFlagUsed) return base;
  return (
    `${base} — set via the deprecated XR_SECRETS_ENV_COMPAT flag; ` +
    `use XR_SECRETS_ENV_HYDRATION / XR_SECRETS_ENV_READ / XR_SECRETS_STRICT instead (removed in 2.0)`
  );
}

/**
 * Phase 2 compatibility export.
 *
 * The old name meant "may keys be in process.env at all". Callers that still
 * ask are asking about the WRITE direction (that is what every call site used
 * it for: guarding `process.env[name] = value`), so it maps to hydration.
 *
 * @deprecated Use `envHydrationEnabled()` or `envAmbientReadEnabled()` — the
 * two directions are separate policies and conflating them is what made the
 * F-24 fix look like it had to break BYOK.
 */
export function envSecretCompatEnabled(): boolean {
  return SNAPSHOT.hydration;
}
