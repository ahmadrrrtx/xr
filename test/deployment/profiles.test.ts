/**
 * XR 6.0 — Phase 11 Tests: Deployment Profiles
 */
import { describe, expect, test } from "bun:test";
import {
  getDeploymentProfile,
  listDeploymentProfiles,
  isValidProfileKind,
  defaultProfileForEnvironment,
  validateProfileCompatibility,
  isCapabilityAvailable,
} from "../../src/deployment/profiles.ts";

describe("Deployment Profiles", () => {
  test("all five profiles are defined", () => {
    const profiles = listDeploymentProfiles();
    expect(profiles.length).toBe(5);
    const kinds = profiles.map(p => p.kind).sort();
    expect(kinds).toEqual([
      "hybrid",
      "managed_cloud",
      "personal_local",
      "private_local_server",
      "team_private",
    ]);
  });

  test("personal_local has correct capabilities", () => {
    const profile = getDeploymentProfile("personal_local");
    expect(profile.capabilities.localExecution).toBe(true);
    expect(profile.capabilities.remoteExecution).toBe(false);
    expect(profile.capabilities.hybridPlacement).toBe(false);
    expect(profile.capabilities.offlineMode).toBe(true);
    expect(profile.capabilities.workerPool).toBe(false);
    expect(profile.capabilities.controlPlane).toBe(false);
    expect(profile.offlineSupported).toBe(true);
    expect(profile.remoteWorkersSupported).toBe(false);
    expect(profile.multiUserSupported).toBe(false);
    expect(profile.identityModel).toBe("single_user_local");
    expect(profile.dataPaths.remoteDataPolicy).toBe("local_only");
  });

  test("managed_cloud has correct capabilities", () => {
    const profile = getDeploymentProfile("managed_cloud");
    expect(profile.capabilities.localExecution).toBe(true);
    expect(profile.capabilities.remoteExecution).toBe(true);
    expect(profile.capabilities.offlineMode).toBe(false);
    expect(profile.capabilities.workerPool).toBe(true);
    expect(profile.capabilities.controlPlane).toBe(true);
    expect(profile.offlineSupported).toBe(false);
    expect(profile.remoteWorkersSupported).toBe(true);
    expect(profile.identityModel).toBe("managed_auth");
    expect(profile.dataPaths.remoteDataPolicy).toBe("cloud_allowed");
  });

  test("hybrid supports offline and remote", () => {
    const profile = getDeploymentProfile("hybrid");
    expect(profile.offlineSupported).toBe(true);
    expect(profile.remoteWorkersSupported).toBe(true);
    expect(profile.capabilities.hybridPlacement).toBe(true);
    expect(profile.capabilities.organizationTenancy).toBe(true);
    expect(profile.dataPaths.remoteDataPolicy).toBe("local_preferred");
  });

  test("team_private supports organization tenancy", () => {
    const profile = getDeploymentProfile("team_private");
    expect(profile.capabilities.organizationTenancy).toBe(true);
    expect(profile.capabilities.workerPool).toBe(true);
    expect(profile.identityModel).toBe("organization_rbac");
    expect(profile.multiUserSupported).toBe(true);
  });

  test("isValidProfileKind validates correctly", () => {
    expect(isValidProfileKind("personal_local")).toBe(true);
    expect(isValidProfileKind("hybrid")).toBe(true);
    expect(isValidProfileKind("invalid")).toBe(false);
    expect(isValidProfileKind("")).toBe(false);
  });

  test("defaultProfileForEnvironment selects correctly", () => {
    expect(defaultProfileForEnvironment({})).toBe("personal_local");
    expect(defaultProfileForEnvironment({ hasNetwork: false })).toBe("personal_local");
    expect(defaultProfileForEnvironment({
      hasOrganization: true,
      hasRemoteWorkers: true,
      hasCloudConfig: true,
    })).toBe("hybrid");
    expect(defaultProfileForEnvironment({
      hasOrganization: true,
      hasCloudConfig: true,
    })).toBe("managed_cloud");
    expect(defaultProfileForEnvironment({
      hasOrganization: true,
      hasRemoteWorkers: true,
    })).toBe("team_private");
  });

  test("validateProfileCompatibility detects issues", () => {
    const env = {
      hasNetwork: false,
      hasContainerRuntime: false,
      hasOrganizationConfig: false,
      hasCloudCredentials: false,
      hasRemoteWorkerConfig: false,
    };

    // Managed cloud requires network and cloud credentials
    const issues = validateProfileCompatibility("managed_cloud", env);
    expect(issues.length).toBeGreaterThan(0);

    // Personal local works without anything
    const localIssues = validateProfileCompatibility("personal_local", env);
    expect(localIssues.length).toBe(0);
  });

  test("isCapabilityAvailable checks correctly", () => {
    expect(isCapabilityAvailable("personal_local", "localExecution")).toBe(true);
    expect(isCapabilityAvailable("personal_local", "remoteExecution")).toBe(false);
    expect(isCapabilityAvailable("hybrid", "remoteExecution")).toBe(true);
    expect(isCapabilityAvailable("hybrid", "offlineMode")).toBe(true);
  });

  test("all profiles have valid version", () => {
    for (const profile of listDeploymentProfiles()) {
      expect(profile.version).toBe("xr-6.0.0");
    }
  });

  test("all profiles have recovery config", () => {
    for (const profile of listDeploymentProfiles()) {
      expect(profile.recovery).toBeDefined();
      expect(typeof profile.recovery.localBackupSupported).toBe("boolean");
    }
  });

  test("all profiles have data paths", () => {
    for (const profile of listDeploymentProfiles()) {
      expect(profile.dataPaths).toBeDefined();
      expect(profile.dataPaths.stateRoot).toBeTruthy();
      expect(profile.dataPaths.workspaceRoot).toBeTruthy();
    }
  });

  test("all profiles have limitations", () => {
    for (const profile of listDeploymentProfiles()) {
      expect(profile.limitations.length).toBeGreaterThan(0);
    }
  });
});
