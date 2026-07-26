/**
 * XR 5.2.0 — Capability Lifecycle: Install / Update / Disable / Quarantine / Rollback / Remove
 *
 * All transitions durable, auditable, and reversible where possible.
 * Updates requesting new permissions require explicit review/re-approval.
 */
import { CapabilityDescriptor, LifecycleEvent, LifecycleState } from "./types.ts";

export interface LifecycleTransitionResult {
  ok: boolean;
  newState: LifecycleState;
  descriptor: CapabilityDescriptor;
  auditEvent?: LifecycleEvent;
  errors: string[];
  warnings: string[];
  permissionReviewRequired: boolean;
}

export function transitionLifecycle(
  descriptor: CapabilityDescriptor,
  action: LifecycleEvent["action"],
  detail?: string,
  newVersion?: string,
  newPermissions?: string[],
): LifecycleTransitionResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const history = descriptor.lifecycleHistory ?? [];
  const event: LifecycleEvent = {
    at: Date.now(),
    action,
    detail,
    versionBefore: descriptor.version,
    versionAfter: newVersion,
    permissionsBefore: [...(descriptor.effectiveAuthority?.grantedPermissions ?? [])],
    permissionsAfter: newPermissions ? [...newPermissions] : descriptor.effectiveAuthority?.grantedPermissions,
  };

  const updatedHistory = [...history, event];

  let newState: LifecycleState = descriptor.lifecycleState;
  let permissionReviewRequired = false;

  switch (action) {
    case "discover":
      newState = "discovered";
      break;
    case "inspect":
      newState = descriptor.lifecycleState === "discovered" ? "inspected" : descriptor.lifecycleState;
      break;
    case "verify":
      newState = descriptor.lifecycleState === "installed" ? "verified" : descriptor.lifecycleState;
      break;
    case "install":
      if (descriptor.lifecycleState === "installed" || descriptor.lifecycleState === "enabled" || descriptor.lifecycleState === "loaded" || descriptor.lifecycleState === "executed") {
        warnings.push("capability already installed; use update for new version");
        newState = descriptor.lifecycleState;
      } else {
        newState = "installed";
      }
      break;
    case "approve":
      if (!descriptor.effectiveAuthority) {
        errors.push("cannot approve without effective authority computed");
        newState = descriptor.lifecycleState;
      } else if (descriptor.effectiveAuthority.reviewStatus === "pending_review" || descriptor.effectiveAuthority.reviewStatus === "revoked") {
        newState = descriptor.lifecycleState === "installed" ? "approved" : descriptor.lifecycleState;
      } else {
        warnings.push("approval requested but authority already approved");
        newState = descriptor.lifecycleState;
      }
      break;
    case "enable":
      if (descriptor.lifecycleState !== "approved" && descriptor.lifecycleState !== "installed") {
        errors.push("capability must be installed and approved before enabling");
      } else {
        newState = "enabled";
      }
      break;
    case "load":
      if (descriptor.lifecycleState !== "enabled" && descriptor.lifecycleState !== "loaded") {
        errors.push("capability must be enabled before loading");
      } else {
        newState = "loaded";
      }
      break;
    case "execute":
      if (descriptor.lifecycleState !== "loaded" && descriptor.lifecycleState !== "executed") {
        errors.push("capability must be loaded before execution");
      } else {
        newState = "executed";
      }
      break;
    case "disable":
      if (descriptor.lifecycleState === "enabled" || descriptor.lifecycleState === "loaded" || descriptor.lifecycleState === "executed") {
        newState = "disabled";
      } else {
        warnings.push("disable called on non-active capability");
        newState = descriptor.lifecycleState;
      }
      break;
    case "update":
      permissionReviewRequired = true;
      if (!newVersion) {
        errors.push("update action requires newVersion");
        newState = descriptor.lifecycleState;
      } else {
        if (newPermissions && descriptor.effectiveAuthority?.grantedPermissions) {
          const prevPerms = new Set(descriptor.effectiveAuthority.grantedPermissions);
          const newPermSet = new Set(newPermissions);
          for (const p of newPermissions) {
            if (!prevPerms.has(p)) {
              permissionReviewRequired = true;
            }
          }
        }
        newState = descriptor.lifecycleState === "installed" || descriptor.lifecycleState === "approved" || descriptor.lifecycleState === "enabled" || descriptor.lifecycleState === "loaded" ? "updated" : descriptor.lifecycleState;
      }
      break;
    case "quarantine":
      newState = "quarantined";
      break;
    case "rollback":
      newState = "roll_back";
      break;
    case "remove":
      newState = "removed";
      break;
    default:
      errors.push(`unknown lifecycle action: ${(action as string)}`);
  }

  const updatedDescriptor: CapabilityDescriptor = {
    ...descriptor,
    version: newVersion ?? descriptor.version,
    lifecycleState: newState,
    lifecycleHistory: updatedHistory,
    effectiveAuthority: descriptor.effectiveAuthority ? {
      ...descriptor.effectiveAuthority,
      grantedPermissions: newPermissions ?? descriptor.effectiveAuthority.grantedPermissions,
      reviewStatus: permissionReviewRequired ? "pending_review" : descriptor.effectiveAuthority.reviewStatus,
    } : descriptor.effectiveAuthority,
  };

  return {
    ok: errors.length === 0,
    newState,
    descriptor: updatedDescriptor,
    auditEvent: event,
    errors,
    warnings,
    permissionReviewRequired,
  };
}

export function quarantineCapability(
  descriptor: CapabilityDescriptor,
  reason?: string,
): LifecycleTransitionResult {
  return transitionLifecycle(descriptor, "quarantine", reason ?? "security or verification failure");
}

export function rollbackCapability(
  descriptor: CapabilityDescriptor,
  previousVersion?: string,
): LifecycleTransitionResult {
  return transitionLifecycle(descriptor, "rollback", `rollback to ${previousVersion ?? "previous version"}`, previousVersion);
}
