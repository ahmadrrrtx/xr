/**
 * XR Phase 20 — quarantine policy for third-party skills (Art. XV).
 *
 * Quarantine-first install: a community/unsigned skill runs with a hard
 * capability cap for its first 48 hours. The state lives on the persisted
 * `SkillInstallation` (`schema.InstallationSchema.quarantine`) so it survives
 * restarts and can only be lifted by an explicit promote — never by a client
 * patching grants around it.
 *
 * Enforcement is at the DATA layer the runtime already consults:
 *   · `grantedPermissions` while quarantined contains ONLY non-dangerous
 *     scopes (`SkillPermissionManager.canUse` denies everything else),
 *   · operator-approved dangerous scopes park in `quarantine.pendingGrants`
 *     and are applied on promote,
 *   · unsigned / untrusted publishers are FORCED into quarantine at install.
 */
import type { SkillInstallation, SkillManifest, SkillPermissionScope, SkillQuarantine } from "./schema.ts";

/** First-run quarantine window: 48 hours. */
export const QUARANTINE_WINDOW_MS = 48 * 60 * 60 * 1000;

export type QuarantineForceReason =
  | "unsigned"
  | "untrusted-publisher"
  | "registry-unknown"
  | "local-package";

export interface QuarantineDecision {
  /** Quarantine must run regardless of user preference. */
  forced: boolean;
  /** Why quarantine applies (forced reason, or the soft default). */
  reason: string;
  /** Operator-facing sentence for the install modal. */
  detail: string;
}

const FORCE_DETAIL: Record<QuarantineForceReason, string> = {
  unsigned: "This package is unsigned — XR cannot verify who published it. Quarantine stays on.",
  "untrusted-publisher": "The publisher is not verified. Quarantine stays on until you promote the skill.",
  "registry-unknown": "This source is not an XR registry. Make sure you trust it — quarantine stays on.",
  "local-package": "Local or sideloaded packages run quarantined until you promote them.",
};

/** Levels that arrive pre-trusted from the registry. */
const TRUSTED_LEVELS = new Set(["official", "verified", "reviewed"]);

export interface SignatureState {
  /** Manifest-declared verification level. */
  level: string;
  /** Package carries a signature envelope (checked engine-side on install). */
  signed: boolean;
  /** Publisher identity is known to a registry with a trusted key. */
  publisherKnown: boolean;
  /** Source being installed from. */
  fromRegistry: boolean;
}

/**
 * Decide quarantine policy for an install. Community skills quarantine by
 * default (the safe default the UI recommends); unsigned / untrusted sources
 * are FORCED — the install API rejects `quarantine: false` for them.
 */
export function decideQuarantine(state: SignatureState): QuarantineDecision {
  const level = (state.level ?? "unverified").toLowerCase();
  if (!state.signed || level === "unverified" || level === "unknown") {
    return {
      forced: true,
      reason: "unsigned",
      detail: FORCE_DETAIL.unsigned,
    };
  }
  if (!state.publisherKnown && !TRUSTED_LEVELS.has(level)) {
    return {
      forced: true,
      reason: "untrusted-publisher",
      detail: FORCE_DETAIL["untrusted-publisher"],
    };
  }
  if (!state.fromRegistry) {
    return {
      forced: true,
      reason: "registry-unknown",
      detail: FORCE_DETAIL["registry-unknown"],
    };
  }
  if (level === "official") {
    return {
      forced: false,
      reason: "optional",
      detail: "Official XR skill — quarantine optional (still recommended for first runs).",
    };
  }
  return {
    forced: false,
    reason: "community-default",
    detail: "Community skill — XR recommends a 48-hour quarantine so you can see what it does before it acts freely.",
  };
}

export function isQuarantined(installation: Pick<SkillInstallation, "quarantine"> | undefined, now = Date.now()): boolean {
  return Boolean(installation?.quarantine && installation.quarantine.until > now);
}

export function quarantineRemainingMs(installation: Pick<SkillInstallation, "quarantine"> | undefined, now = Date.now()): number {
  if (!installation?.quarantine) return 0;
  return Math.max(0, installation.quarantine.until - now);
}

/** Build the quarantine record for an install. */
export function quarantineRecord(
  manifest: Pick<SkillManifest, "permissions">,
  requestedGrants: SkillPermissionScope[],
  reason: string,
  now = Date.now(),
): SkillQuarantine {
  const declared = new Map(manifest.permissions.map((p) => [p.scope, p]));
  const safe: SkillPermissionScope[] = [];
  const pending: SkillPermissionScope[] = [];
  for (const scope of new Set(requestedGrants)) {
    const permission = declared.get(scope);
    if (!permission) continue;
    if (permission.dangerous) pending.push(scope);
    else safe.push(scope);
  }
  return {
    until: now + QUARANTINE_WINDOW_MS,
    reason,
    quarantinedAt: now,
    pendingGrants: pending.sort(),
  };
}

/**
 * Apply quarantine to an installation record: cap grants to safe scopes and
 * park dangerous approvals. Returns the patched record (pure).
 */
export function applyQuarantine(
  installation: SkillInstallation,
  manifest: Pick<SkillManifest, "permissions">,
  requestedGrants: SkillPermissionScope[],
  reason: string,
  now = Date.now(),
): SkillInstallation {
  const quarantine = quarantineRecord(manifest, requestedGrants, reason, now);
  const declared = new Map(manifest.permissions.map((p) => [p.scope, p]));
  const capped = new Set<SkillPermissionScope>();
  for (const scope of new Set([...installation.grantedPermissions, ...requestedGrants])) {
    const permission = declared.get(scope);
    if (permission && !permission.dangerous) capped.add(scope);
    else if (permission?.dangerous && !quarantine.pendingGrants.includes(scope)) quarantine.pendingGrants.push(scope);
  }
  quarantine.pendingGrants = [...new Set(quarantine.pendingGrants)].sort();
  return { ...installation, grantedPermissions: [...capped].sort(), quarantine };
}

/**
 * Promote out of quarantine: dangerous scopes approved during the quarantine
 * window become real grants; the quarantine record is removed. (Pure.)
 */
export function promoteQuarantine(installation: SkillInstallation, manifest: Pick<SkillManifest, "permissions">): SkillInstallation {
  const declared = new Set(manifest.permissions.map((p) => p.scope));
  const merged = new Set(installation.grantedPermissions);
  for (const scope of installation.quarantine?.pendingGrants ?? []) {
    if (declared.has(scope)) merged.add(scope);
  }
  const { quarantine: _lifted, ...rest } = installation;
  return { ...rest, grantedPermissions: [...merged].sort() };
}

/** Human copy for the UI — one place, honest and calm. */
export const QUARANTINE_COPY = Object.freeze({
  summary: "Runs in quarantine for the first 48 hours — you decide what it can do.",
  limits: [
    "cannot read or write files outside ~/xr/scratch/",
    "cannot run shell commands",
    "can only reach the web through a logged proxy",
    "cannot access your credentials or secrets",
    "needs your approval for every invocation",
  ],
  promoteHint: "After 48 hours (or any time from the skill's detail panel) you can promote it to normal access.",
});
