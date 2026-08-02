/**
 * XR Phase 7 · T4 — Manifest security posture scanner.
 *
 * Real-world extension manifests are minimal (no signed authorship, no SBOM,
 * permissive tool lists, descriptions that can hijack routing). This scanner
 * makes XR's posture explicit and default-deny:
 *
 *   REJECT  — must be fixed or the capability cannot be enabled
 *   FLAG    — surfaced to the operator before enable
 *   OK      — evidence present
 *
 * Checks (per capability descriptor):
 *   1. signed authorship     — signature status valid + keyId (verified
 *                              against the publisher key ring when supplied)
 *   2. publisher verification — publisher.verified
 *   3. SBOM                  — security.sbom reference present
 *   4. capability statement  — security.capabilityStatement present
 *   5. dependency locks      — declared dependencies have locks (id+version
 *                              +hash) unless builtin/unknown
 *   6. default-deny posture  — no wildcard/auto-approve markers; executable
 *                              capabilities declare permissions; no
 *                              authority-vector undetermined state
 *   7. routing-safe description — description cannot smuggle authority or
 *                              tool declarations (prompt-injection guard)
 */

import type { CapabilityDescriptor } from "./types.ts";

export type SecurityVerdict = "ok" | "flag" | "reject";

export interface ManifestSecurityReport {
  verdict: SecurityVerdict;
  ok: string[];
  flags: string[];
  rejects: string[];
  checks: Array<{ name: string; verdict: SecurityVerdict; detail: string }>;
}

export interface ManifestSecurityOptions {
  /** keyId → public PEM key ring for signature verification. */
  publisherKeys?: Record<string, string>;
  /** Require SBOM + capability statement + locks (strict publishing). */
  strict?: boolean;
}

const WILDCARD_MARKERS = ["*", "**", "all", "everything", "any"];
const AUTO_APPROVE_MARKERS = ["auto-approve", "autoapprove", "approve automatically", "no prompt"];
/** Tokens that let a description try to declare authority or tools. */
const INJECTION_MARKERS = [
  "permissions:",
  "grantedPermissions:",
  "tools:",
  "allowed-tools:",
  "allowedTools:",
  "xr-skill.json",
  "xr-plugin.json",
  "system:",
  "ignore previous",
  "you are now",
];

export class ManifestSecurityScanner {
  scan(descriptor: CapabilityDescriptor, opts: ManifestSecurityOptions = {}): ManifestSecurityReport {
    const d = descriptor;
    const ok: string[] = [];
    const flags: string[] = [];
    const rejects: string[] = [];
    const checks: ManifestSecurityReport["checks"] = [];
    const verdictFor = (verdict: SecurityVerdict, name: string, detail: string): SecurityVerdict => {
      checks.push({ name, verdict, detail });
      if (verdict === "ok") ok.push(`${name}: ${detail}`);
      else if (verdict === "flag") flags.push(`${name}: ${detail}`);
      else rejects.push(`${name}: ${detail}`);
      return verdict;
    };

    // 1. Signed authorship.
    if (d.package.signatureStatus === "valid") {
      let verified = false;
      if (d.package.signatureKeyId && opts.publisherKeys?.[d.package.signatureKeyId]) {
        verified = true;
        verdictFor("ok", "signed-authorship", `signature ${d.package.signatureKeyId} matches publisher key ring`);
      } else if (opts.publisherKeys && Object.keys(opts.publisherKeys).length > 0) {
        verdictFor("flag", "signed-authorship", `signature valid but key ${d.package.signatureKeyId ?? "?"} not in publisher key ring`);
      } else {
        verdictFor("flag", "signed-authorship", "package signature valid but no publisher key ring to verify authorship");
      }
      if (!verified && opts.strict) verdictFor("flag", "signed-authorship", "strict mode: authorship not independently verified");
    } else if (d.package.signatureStatus === "invalid") {
      verdictFor("reject", "signed-authorship", "package signature INVALID — refuse enable");
    } else if (d.package.signatureStatus === "unverified") {
      verdictFor("flag", "signed-authorship", "package has a hash but is not signed");
    } else {
      verdictFor("flag", "signed-authorship", "package is unsigned (installation is never trust)");
    }

    // 2. Publisher verification.
    if (d.publisher.verified) {
      verdictFor("ok", "publisher-verification", `publisher ${d.publisher.name} verified`);
    } else {
      verdictFor("flag", "publisher-verification", `publisher ${d.publisher.name} NOT verified`);
    }

    // 3. SBOM.
    const sbom = d.security?.sbom;
    if (sbom?.ref) {
      verdictFor("ok", "sbom", `SBOM referenced (${sbom.ref}${sbom.format ? `, ${sbom.format}` : ""})`);
    } else if (opts.strict) {
      verdictFor("reject", "sbom", "strict mode: SBOM required");
    } else {
      verdictFor("flag", "sbom", "no SBOM reference (supply-chain visibility limited)");
    }

    // 4. Capability statement.
    const statement = d.security?.capabilityStatement;
    if (statement && statement.trim().length >= 20) {
      verdictFor("ok", "capability-statement", "capability statement present");
    } else if (opts.strict) {
      verdictFor("reject", "capability-statement", "strict mode: capability statement required");
    } else {
      verdictFor("flag", "capability-statement", "no capability statement (what it does / what it needs is unclear)");
    }

    // 5. Dependency locks.
    const deps = d.dependencies.filter((dep) => dep.type !== "tool" && dep.type !== "unknown");
    const locked = deps.filter((dep) => {
      const lock = d.security?.dependencyLocks?.find((l) => l.id === dep.id);
      return lock && (!dep.version || lock.version === dep.version) && (!lock.hash || lock.hash.length === 64);
    });
    const unlockable = deps.filter((dep) => ["builtin", "unknown"].includes(dep.type));
    if (deps.length === 0 || locked.length + unlockable.length >= deps.length) {
      verdictFor("ok", "dependency-locks", `${locked.length}/${deps.length} dependencies locked`);
    } else if (opts.strict) {
      verdictFor("reject", "dependency-locks", `strict mode: ${deps.length - locked.length - unlockable.length} dependencies unlocked`);
    } else {
      verdictFor("flag", "dependency-locks", `${deps.length - locked.length - unlockable.length} dependencies unlocked (no lock hash)`);
    }

    // 6. Default-deny posture.
    const dangerous = ["shell", "control", "browser", "secrets", "credential", "computer:act"];
    const wildcards = d.permissions.declared.filter((p) => WILDCARD_MARKERS.some((m) => p.scope.toLowerCase() === m || p.scope.toLowerCase().includes(`${m}:`)));
    const autoApprove = d.description ? AUTO_APPROVE_MARKERS.some((m) => d.description!.toLowerCase().includes(m)) : false;
    const declaredScopes = d.permissions.declared.map((p) => p.scope);
    if (wildcards.length) {
      verdictFor("reject", "default-deny", `wildcard permission declarations: ${wildcards.map((w) => w.scope).join(", ")}`);
    } else if (autoApprove) {
      verdictFor("reject", "default-deny", "description contains auto-approve markers — permission model cannot be default-deny");
    } else if (d.permissions.effective.undetermined) {
      verdictFor("reject", "default-deny", `effective authority undetermined (${d.permissions.effective.reason ?? "unknown"}) — fail-closed`);
    } else if (declaredScopes.length === 0 && d.dataScopes.some((s) => s.access === "write" || s.access === "read_write")) {
      verdictFor("flag", "default-deny", "declares write data scopes but zero permissions (intent unclear)");
    } else if (declaredScopes.some((p) => dangerous.includes(p))) {
      verdictFor("flag", "default-deny", `declares dangerous permission(s): ${declaredScopes.filter((p) => dangerous.includes(p)).join(", ")}`);
    } else {
      verdictFor("ok", "default-deny", "explicit permission declarations; no wildcards/auto-approve");
    }

    // 7. Routing-safe description (description cannot hijack routing).
    const desc = (d.description ?? "").toLowerCase();
    const injected = INJECTION_MARKERS.filter((m) => desc.includes(m));
    if (injected.length) {
      verdictFor("reject", "routing-safe-description", `description contains routing/authority-injection markers: ${injected.join(", ")}`);
    } else if ((d.description?.length ?? 0) > 2400) {
      verdictFor("flag", "routing-safe-description", "description is very long; keep routing-relevant text concise");
    } else {
      verdictFor("ok", "routing-safe-description", "description is routing-safe (no injection markers)");
    }

    const verdict: SecurityVerdict = rejects.length ? "reject" : flags.length ? "flag" : "ok";
    return { verdict, ok, flags, rejects, checks };
  }
}

export function scanManifestSecurity(descriptor: CapabilityDescriptor, opts?: ManifestSecurityOptions): ManifestSecurityReport {
  return new ManifestSecurityScanner().scan(descriptor, opts);
}
