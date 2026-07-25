/**
 * XR 4.2 — Deterministic Risk Classifier
 *
 * Maps objective, adapter-supplied facts about an action to a risk tier and a
 * set of required controls. This is a PURE, DETERMINISTIC function of its
 * inputs: a model may propose an action, but it cannot choose the tier or
 * downgrade the required placement. Unknown/ambiguous inputs escalate, never
 * relax.
 */
import { homedir } from "node:os";
import { sep } from "node:path";
import {
  TRUST_BOUNDS,
  TRUST_CLASSIFIER_VERSION,
  type CredentialMode,
  type FilesystemPolicy,
  type NetworkPolicy,
  type ProcessPolicy,
  type ResourcePolicy,
  type RiskClassification,
  type RiskTier,
  type TrustRequest,
} from "./types.ts";

/** Sensitive host paths that must never be exposed to a sandboxed action. */
export function sensitiveBlockedPaths(home = homedir()): string[] {
  const h = home.endsWith(sep) ? home.slice(0, -1) : home;
  return [
    `${h}${sep}.ssh`,
    `${h}${sep}.aws`,
    `${h}${sep}.gnupg`,
    `${h}${sep}.netrc`,
    `${h}${sep}.git-credentials`,
    `${h}${sep}.config${sep}gh`,
    `${h}${sep}.npmrc`,
    `${h}${sep}.docker${sep}config.json`,
    `${h}${sep}.kube`,
    `${h}${sep}.bun${sep}install`,
    `/etc/shadow`,
    `/etc/sudoers`,
    `/proc/sys`,
  ];
}

function boundedReasons(reasons: string[]): string[] {
  return reasons.slice(0, TRUST_BOUNDS.MAX_REASONS).map((r) =>
    r.length > TRUST_BOUNDS.MAX_REASON_CHARS
      ? r.slice(0, TRUST_BOUNDS.MAX_REASON_CHARS)
      : r,
  );
}

function deriveFs(req: TrustRequest, tier: RiskTier): FilesystemPolicy {
  const writable = tier === "tier0_in_process" ? [] : [req.workspaceRoot];
  return {
    writableRoots: writable,
    readOnlyRoots: [],
    blockedPaths: sensitiveBlockedPaths(),
    ephemeralScratch: tier !== "tier0_in_process",
  };
}

function deriveNet(req: TrustRequest, tier: RiskTier): NetworkPolicy {
  if (req.networkTargets.length === 0) {
    return { mode: "none", allowlist: [], blockPrivateNetworks: true, blockOffAllowlistRedirects: true };
  }
  const allowlist = req.networkTargets
    .slice(0, TRUST_BOUNDS.MAX_ALLOWLIST)
    .map((t) => normalizeHost(t));
  // Tier 2 / untrusted content is never "open" by default.
  const mode = tier === "tier0_in_process" ? "none" : "allowlist";
  return {
    mode,
    allowlist: mode === "allowlist" ? allowlist : [],
    blockPrivateNetworks: true,
    blockOffAllowlistRedirects: true,
  };
}

function deriveProc(req: TrustRequest, tier: RiskTier): ProcessPolicy {
  if (tier === "tier0_in_process") {
    return { allowedExecutables: [], allowSpawn: false, maxProcesses: 1, stripAmbientEnv: true };
  }
  return {
    allowedExecutables: [],
    allowSpawn: req.spawnsProcess || req.runsArbitraryCode,
    maxProcesses: tier === "tier2_isolated" ? TRUST_BOUNDS.DEFAULT_MAX_PROCESSES : 8,
    stripAmbientEnv: true,
  };
}

function deriveResources(tier: RiskTier): ResourcePolicy {
  if (tier === "tier0_in_process") {
    return { wallClockMs: TRUST_BOUNDS.DEFAULT_WALL_CLOCK_MS, maxOutputBytes: TRUST_BOUNDS.DEFAULT_MAX_OUTPUT_BYTES };
  }
  if (tier === "tier1_restricted") {
    return {
      wallClockMs: TRUST_BOUNDS.DEFAULT_WALL_CLOCK_MS,
      cpuSeconds: TRUST_BOUNDS.DEFAULT_CPU_SECONDS,
      memoryBytes: TRUST_BOUNDS.DEFAULT_MEMORY_BYTES,
      maxOutputBytes: TRUST_BOUNDS.DEFAULT_MAX_OUTPUT_BYTES,
    };
  }
  // tier2: stricter wall clock + memory + output by default.
  return {
    wallClockMs: Math.min(TRUST_BOUNDS.DEFAULT_WALL_CLOCK_MS, 60_000),
    cpuSeconds: 60,
    memoryBytes: 256 * 1024 * 1024,
    maxOutputBytes: Math.min(TRUST_BOUNDS.DEFAULT_MAX_OUTPUT_BYTES, 512_000),
    maxTempBytes: 64 * 1024 * 1024,
    maxFiles: 4096,
  };
}

function normalizeHost(target: string): string {
  try {
    if (/^https?:\/\//i.test(target)) return new URL(target).hostname;
  } catch {
    /* fall through */
  }
  return target.split("/")[0].split(":")[0].toLowerCase();
}

/**
 * Classify an action. Pure and deterministic. Conservative on ambiguity:
 * anything that looks process/credential/irreversible/untrusted is Tier 2.
 */
export function classifyRisk(req: TrustRequest): RiskClassification {
  const reasons: string[] = [];
  let tier: RiskTier = "tier0_in_process";

  const escalate = (to: RiskTier, why: string) => {
    reasons.push(why);
    if (order(to) > order(tier)) tier = to;
  };

  // Dry-run performs no side effects.
  if (req.dryRun) {
    reasons.push("dry_run: no side effects");
  } else {
    // ── Tier 2 triggers ──
    if (req.runsArbitraryCode) escalate("tier2_isolated", "executes arbitrary/interpreted code");
    if (req.spawnsProcess) escalate("tier2_isolated", "spawns a shell/process with host authority");
    if (req.needsCredentials) escalate("tier2_isolated", "requires credentials/secrets");
    if (req.irreversibleExternalWrite) escalate("tier2_isolated", "irreversible external write");
    if (req.untrustedContent) escalate("tier2_isolated", "handles untrusted/hostile content");
    if (req.controlRisk === "destructive") escalate("tier2_isolated", "control plane classified destructive");

    // ── Tier 1 triggers ──
    if (req.touchesOutsideWorkspace) escalate("tier1_restricted", "touches paths outside workspace root");
    if (req.networkTargets.length > 0) escalate("tier1_restricted", `network access: ${req.networkTargets.length} target(s)`);
    if (req.fsPaths.length > 0) escalate("tier1_restricted", "filesystem write/mutation");
    if (req.controlRisk === "sensitive") escalate("tier1_restricted", "control plane classified sensitive");
    if (!req.reversible) escalate("tier1_restricted", "side effects not trivially reversible");

    if (tier === "tier0_in_process") reasons.push("read-only / pure / no process / no network / no secrets");
  }

  // Credentials availability is a hard requirement when needed.
  const requiredCredentialMode: CredentialMode = req.needsCredentials ? "task_scoped" : "none";

  // Inherently unsafe combination: untrusted content demanding open network
  // with irreversible effect cannot be made safe by placement alone.
  let blocked = false;
  let blockReason: string | undefined;
  if (!req.dryRun && req.untrustedContent && req.irreversibleExternalWrite && req.networkTargets.length === 0 === false) {
    // Allowed only with an allowlist + isolation; policy enforces placement.
    reasons.push("untrusted + irreversible external write: requires isolated placement with network allowlist");
  }

  const requiredApprovalLevel: RiskClassification["requiredApprovalLevel"] =
    req.dryRun
      ? "none"
      : req.irreversibleExternalWrite || req.controlRisk === "destructive"
        ? "elevated"
        : tier === "tier0_in_process"
          ? "none"
          : "standard";

  return {
    tier,
    reasons: boundedReasons(reasons),
    blocked,
    blockReason,
    requiredApprovalLevel,
    requiredCredentialMode,
    fs: deriveFs(req, tier),
    net: deriveNet(req, tier),
    proc: deriveProc(req, tier),
    resources: deriveResources(tier),
    inputs: req,
    classifierVersion: TRUST_CLASSIFIER_VERSION,
  };
}

function order(t: RiskTier): number {
  return t === "tier0_in_process" ? 0 : t === "tier1_restricted" ? 1 : 2;
}
