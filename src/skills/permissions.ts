/** XR 2.1A — Skill Permission Manager. */
import type { SkillManifest, SkillPermission, SkillPermissionScope } from "./schema.ts";
import type { SkillInstallation } from "./schema.ts";

export interface SkillPermissionDecision {
  scope: SkillPermissionScope;
  declared: boolean;
  granted: boolean;
  dangerous: boolean;
  reason: string;
  needsApproval: boolean;
}

export interface SkillPermissionReport {
  skillId: string;
  safe: SkillPermissionDecision[];
  dangerous: SkillPermissionDecision[];
  missingApproval: SkillPermissionDecision[];
}

export class SkillPermissionManager {
  report(manifest: SkillManifest, installation?: SkillInstallation): SkillPermissionReport {
    const granted = new Set<SkillPermissionScope>(installation?.grantedPermissions ?? manifest.permissions.filter((p) => !p.dangerous).map((p) => p.scope));
    const decisions = manifest.permissions.map((permission) => this.decision(permission, granted));
    return {
      skillId: manifest.id,
      safe: decisions.filter((d) => !d.dangerous),
      dangerous: decisions.filter((d) => d.dangerous),
      missingApproval: decisions.filter((d) => d.needsApproval),
    };
  }

  private decision(permission: SkillPermission, granted: Set<SkillPermissionScope>): SkillPermissionDecision {
    const isGranted = granted.has(permission.scope);
    return {
      scope: permission.scope,
      declared: true,
      granted: isGranted,
      dangerous: permission.dangerous,
      reason: permission.reason,
      needsApproval: permission.dangerous && !isGranted,
    };
  }

  canUse(manifest: SkillManifest, scope: SkillPermissionScope, installation?: SkillInstallation): boolean {
    const report = this.report(manifest, installation);
    return [...report.safe, ...report.dangerous].some((d) => d.scope === scope && d.granted);
  }
}
