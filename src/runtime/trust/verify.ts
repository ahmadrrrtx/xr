/**
 * XR 4.2 — Isolation Verification
 *
 * Before a high-risk action runs, prove that the ACTUAL placement matches the
 * policy decision and that the backend's guarantees are strong enough for the
 * required tier. If verification fails, the action must NOT execute.
 */
import { hitsBlockedPath, isWithin, type EnvironmentBackend } from "./environment/backend.ts";
import {
  tierAtLeast,
  type AuthorityGrant,
  type EnvironmentExecutable,
  type PlacementKind,
  type RiskTier,
  type VerificationCheck,
  type VerificationResult,
} from "./types.ts";

export interface VerifyInput {
  backend: EnvironmentBackend;
  expectedPlacement: PlacementKind;
  tier: RiskTier;
  exec: EnvironmentExecutable;
  grant: AuthorityGrant;
  /** True when the broker confirmed all REQUIRED credential refs are present. */
  credentialsSatisfied: boolean;
}

export function verifyEnvironment(input: VerifyInput): VerificationResult {
  const { backend, expectedPlacement, tier, exec, grant } = input;
  const checks: VerificationCheck[] = [];
  const push = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  // 1. Placement matches the policy decision.
  push(
    "placement_matches_decision",
    backend.placement === expectedPlacement,
    `expected=${expectedPlacement} actual=${backend.placement}`,
  );

  // 2. Guarantees strong enough for the tier.
  const g = backend.guarantees;
  if (tierAtLeast(tier, "tier2_isolated")) {
    push("tier2_kernel_boundary", g.kernelBoundary, "backend must provide a kernel-level boundary");
    push("tier2_enforced_fs", g.enforcedFilesystem, "filesystem must be OS-enforced");
    push("tier2_enforced_net", g.enforcedNetwork, "network must be OS-enforced");
    push("tier2_no_ambient_authority", g.noAmbientAuthority, "ambient host authority must not be inherited");
  } else if (tierAtLeast(tier, "tier1_restricted")) {
    push("tier1_no_ambient_authority", g.noAmbientAuthority, "ambient env must be stripped");
  }

  // 3. Network policy is actually enforceable by this backend.
  if (grant.net.mode === "allowlist" && grant.net.allowlist.length > 0) {
    // None of the local Phase-3 backends enforce a per-host allowlist inside
    // the boundary; they enforce net=none. Fail closed rather than pretend.
    push(
      "network_allowlist_enforceable",
      false,
      "local backends enforce network=none; a per-host allowlist is not enforceable inside the boundary",
    );
  } else {
    push("network_policy_enforceable", grant.net.mode === "none" ? g.enforcedNetwork || tier === "tier1_restricted" : true);
  }

  // 4. Filesystem confinement: cwd within granted roots, no blocked paths.
  const writable = grant.fs.writableRoots;
  const cwdOk = writable.length === 0 || writable.some((r) => isWithin(exec.cwd, r));
  push("cwd_within_grant", cwdOk, `cwd=${exec.cwd}`);
  const allRoots = [...writable, ...grant.fs.readOnlyRoots, exec.cwd];
  const blockedHit = allRoots.some((p) => hitsBlockedPath(p, grant.fs.blockedPaths));
  push("no_blocked_paths", !blockedHit, blockedHit ? "a granted path hits a blocked sensitive path" : undefined);

  // 5. Not running as root for unprivileged backends.
  push("not_root", process.getuid?.() !== 0, "unprivileged sandboxes are void under root");

  // 6. Credential scope satisfied (required refs present at the broker).
  if (grant.credentials.mode === "task_scoped" || grant.credentials.mode === "workspace") {
    push("credentials_satisfied", input.credentialsSatisfied, "required credential refs must resolve at the broker");
  } else {
    push("credentials_satisfied", grant.credentials.mode !== "unavailable", "credential mode must not be 'unavailable'");
  }

  const verified = checks.every((c) => c.ok);
  return {
    verified,
    expectedPlacement,
    actualPlacement: backend.placement,
    environmentId: backend.id,
    checks,
    verifiedAt: Date.now(),
  };
}
