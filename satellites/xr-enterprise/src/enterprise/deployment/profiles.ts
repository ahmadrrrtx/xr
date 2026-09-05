/**
 * XR 6.0 — Deployment Profiles
 *
 * Defines the five canonical deployment profiles and their capabilities,
 * limitations, identity models, data paths, and recovery semantics.
 *
 * Each profile is self-describing: a consumer can query what it supports,
 * what it cannot do, and what its trust model is.
 */

import type {
  DeploymentProfile,
  DeploymentProfileKind,
} from "./types.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Canonical Profile Definitions
// ═══════════════════════════════════════════════════════════════════════════

const PERSONAL_LOCAL: DeploymentProfile = {
  kind: "personal_local",
  name: "Personal Local",
  description: "Single machine, no cloud dependency. Full XR operation offline. Ideal for personal, private, or air-gapped use.",
  version: "xr-6.0.0",
  capabilities: {
    localExecution: true,
    remoteExecution: false,
    hybridPlacement: false,
    multiWorkspace: true,
    organizationTenancy: false,
    dataResidency: true,
    offlineMode: true,
    workerPool: false,
    controlPlane: false,
    managedBackups: false,
  },
  limitations: [
    "No remote execution",
    "No multi-user support",
    "No managed cloud features",
    "No automatic backup to remote",
    "Hardware limited to local machine",
  ],
  identityModel: "single_user_local",
  dataPaths: {
    stateRoot: "~/.xr/state",
    workspaceRoot: "~/.xr/workspaces",
    artifactRoot: "~/.xr/artifacts",
    cacheRoot: "~/.xr/cache",
    logRoot: "~/.xr/logs",
    backupRoot: "~/.xr/backups",
    remoteDataPolicy: "local_only",
  },
  offlineSupported: true,
  remoteWorkersSupported: false,
  multiUserSupported: false,
  recovery: {
    localBackupSupported: true,
    remoteReplicationSupported: false,
    disasterRecoverySupported: false,
  },
};

const PRIVATE_LOCAL_SERVER: DeploymentProfile = {
  kind: "private_local_server",
  name: "Private Local Server",
  description: "One trusted local or private server deployment with local/private models and data. Supports multiple workspaces and optional container isolation.",
  version: "xr-6.0.0",
  capabilities: {
    localExecution: true,
    remoteExecution: false,
    hybridPlacement: false,
    multiWorkspace: true,
    organizationTenancy: false,
    dataResidency: true,
    offlineMode: true,
    workerPool: false,
    controlPlane: false,
    managedBackups: true,
  },
  limitations: [
    "No managed cloud features",
    "Single trusted server only",
    "Admin manages all backups manually",
  ],
  identityModel: "private_token",
  dataPaths: {
    stateRoot: "/var/xr/state",
    workspaceRoot: "/var/xr/workspaces",
    artifactRoot: "/var/xr/artifacts",
    cacheRoot: "/var/xr/cache",
    logRoot: "/var/xr/logs",
    backupRoot: "/var/xr/backups",
    remoteDataPolicy: "local_only",
  },
  offlineSupported: true,
  remoteWorkersSupported: false,
  multiUserSupported: true,
  recovery: {
    localBackupSupported: true,
    remoteReplicationSupported: false,
    disasterRecoverySupported: true,
  },
};

const TEAM_PRIVATE: DeploymentProfile = {
  kind: "team_private",
  name: "Team Private",
  description: "Controlled multi-user/multi-workspace deployment with private workers. Organization-scoped identity and RBAC.",
  version: "xr-6.0.0",
  capabilities: {
    localExecution: true,
    remoteExecution: true,
    hybridPlacement: true,
    multiWorkspace: true,
    organizationTenancy: true,
    dataResidency: true,
    offlineMode: true,
    workerPool: true,
    controlPlane: true,
    managedBackups: true,
  },
  limitations: [
    "Private infrastructure only — no managed cloud",
    "Organization admin must configure workers",
    "Network connectivity required for remote features",
  ],
  identityModel: "organization_rbac",
  dataPaths: {
    stateRoot: "/var/xr/state",
    workspaceRoot: "/var/xr/workspaces",
    artifactRoot: "/var/xr/artifacts",
    cacheRoot: "/var/xr/cache",
    logRoot: "/var/xr/logs",
    backupRoot: "/var/xr/backups",
    remoteDataPolicy: "local_preferred",
  },
  offlineSupported: true,
  remoteWorkersSupported: true,
  multiUserSupported: true,
  recovery: {
    localBackupSupported: true,
    remoteReplicationSupported: true,
    disasterRecoverySupported: true,
    rpoMinutes: 60,
    rtoMinutes: 240,
  },
};

const MANAGED_CLOUD: DeploymentProfile = {
  kind: "managed_cloud",
  name: "Managed Cloud",
  description: "Hosted control and data plane with documented trust and residency. Managed by a trusted provider with SLA guarantees.",
  version: "xr-6.0.0",
  capabilities: {
    localExecution: true,
    remoteExecution: true,
    hybridPlacement: true,
    multiWorkspace: true,
    organizationTenancy: true,
    dataResidency: true,
    offlineMode: false,
    workerPool: true,
    controlPlane: true,
    managedBackups: true,
  },
  limitations: [
    "Requires network connectivity",
    "Control plane is managed by third party — review trust documentation",
    "Offline mode not available",
    "Data residency subject to provider region selection",
  ],
  identityModel: "managed_auth",
  dataPaths: {
    stateRoot: "cloud://state",
    workspaceRoot: "cloud://workspaces",
    artifactRoot: "cloud://artifacts",
    cacheRoot: "cloud://cache",
    logRoot: "cloud://logs",
    backupRoot: "cloud://backups",
    remoteDataPolicy: "cloud_allowed",
  },
  offlineSupported: false,
  remoteWorkersSupported: true,
  multiUserSupported: true,
  recovery: {
    localBackupSupported: false,
    remoteReplicationSupported: true,
    disasterRecoverySupported: true,
    rpoMinutes: 15,
    rtoMinutes: 60,
  },
};

const HYBRID: DeploymentProfile = {
  kind: "hybrid",
  name: "Hybrid",
  description: "Local-sensitive work runs locally; remote-approved work runs on private or cloud workers. Full offline capability with safe resynchronization.",
  version: "xr-6.0.0",
  capabilities: {
    localExecution: true,
    remoteExecution: true,
    hybridPlacement: true,
    multiWorkspace: true,
    organizationTenancy: true,
    dataResidency: true,
    offlineMode: true,
    workerPool: true,
    controlPlane: true,
    managedBackups: true,
  },
  limitations: [
    "Remote work requires connectivity and approved placement",
    "Sensitive data never leaves local plane without explicit policy",
    "Conflict resolution may require manual intervention",
  ],
  identityModel: "organization_rbac",
  dataPaths: {
    stateRoot: "~/.xr/state",
    workspaceRoot: "~/.xr/workspaces",
    artifactRoot: "~/.xr/artifacts",
    cacheRoot: "~/.xr/cache",
    logRoot: "~/.xr/logs",
    backupRoot: "~/.xr/backups",
    remoteDataPolicy: "local_preferred",
  },
  offlineSupported: true,
  remoteWorkersSupported: true,
  multiUserSupported: true,
  recovery: {
    localBackupSupported: true,
    remoteReplicationSupported: true,
    disasterRecoverySupported: true,
    rpoMinutes: 30,
    rtoMinutes: 120,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Profile Registry
// ═══════════════════════════════════════════════════════════════════════════

const PROFILES: Record<DeploymentProfileKind, DeploymentProfile> = {
  personal_local: PERSONAL_LOCAL,
  private_local_server: PRIVATE_LOCAL_SERVER,
  team_private: TEAM_PRIVATE,
  managed_cloud: MANAGED_CLOUD,
  hybrid: HYBRID,
};

/** Get a deployment profile by kind. */
export function getDeploymentProfile(kind: DeploymentProfileKind): DeploymentProfile {
  return PROFILES[kind];
}

/** List all available deployment profiles. */
export function listDeploymentProfiles(): readonly DeploymentProfile[] {
  return Object.values(PROFILES);
}

/** Validate that a deployment profile kind is recognized. */
export function isValidProfileKind(kind: string): kind is DeploymentProfileKind {
  return kind in PROFILES;
}

/**
 * Determine the default deployment profile for a given environment.
 * Personal local is the universal fallback — XR always works locally.
 */
export function defaultProfileForEnvironment(env: {
  hasNetwork?: boolean;
  hasOrganization?: boolean;
  hasCloudConfig?: boolean;
  hasRemoteWorkers?: boolean;
}): DeploymentProfileKind {
  if (env.hasCloudConfig && env.hasOrganization && env.hasRemoteWorkers) {
    return "hybrid";
  }
  if (env.hasCloudConfig && env.hasOrganization) {
    return "managed_cloud";
  }
  if (env.hasOrganization && env.hasRemoteWorkers) {
    return "team_private";
  }
  if (!env.hasNetwork) {
    return "personal_local";
  }
  // Default: personal local — always safe, always available
  return "personal_local";
}

/**
 * Validate that a requested profile is compatible with the current environment.
 * Returns an array of issues (empty = compatible).
 */
export function validateProfileCompatibility(
  profile: DeploymentProfileKind,
  env: {
    hasNetwork: boolean;
    hasContainerRuntime: boolean;
    hasOrganizationConfig: boolean;
    hasCloudCredentials: boolean;
    hasRemoteWorkerConfig: boolean;
  }
): readonly string[] {
  const issues: string[] = [];
  const p = getDeploymentProfile(profile);

  if (p.capabilities.remoteExecution && !env.hasNetwork) {
    issues.push(`${p.name} requires network connectivity for remote execution`);
  }
  if (p.capabilities.organizationTenancy && !env.hasOrganizationConfig) {
    issues.push(`${p.name} requires organization configuration`);
  }
  if (p.capabilities.controlPlane && !env.hasNetwork) {
    issues.push(`${p.name} requires network connectivity for control plane`);
  }
  if (profile === "managed_cloud" && !env.hasCloudCredentials) {
    issues.push("Managed cloud profile requires cloud credentials");
  }
  if (p.remoteWorkersSupported && env.hasRemoteWorkerConfig && !env.hasNetwork) {
    issues.push("Remote workers require network connectivity");
  }

  return issues;
}

/**
 * Check if a given capability is available under the specified profile.
 */
export function isCapabilityAvailable(
  profile: DeploymentProfileKind,
  capability: keyof DeploymentProfile["capabilities"]
): boolean {
  return getDeploymentProfile(profile).capabilities[capability];
}
