/**
 * XR 4.0 — Kernel Error Taxonomy Tests
 *
 * Tests the structured kernel error classes and their serialization.
 */

import { describe, test, expect } from "bun:test";
import {
  KernelError,
  KernelErrorCode,
  LifecycleTransitionError,
  DuplicateBootstrapError,
  StartBeforeBootstrapError,
  ServiceNotFoundError,
  DuplicateRegistrationError,
  DependencyCycleError,
  MissingDependencyError,
  StaleServiceError,
  WorkspaceSwitchFailedError,
  WorkspaceNotFoundError,
  BackgroundJobNotFoundError,
  BackgroundJobDuplicateError,
  RuntimeNotReadyError,
  RuntimeFailedError,
  ProviderRegistrationFailedError,
  ProviderInitFailedError,
  LifecycleHookFailedError,
} from "../../src/core/errors.ts";

describe("Kernel Error Taxonomy", () => {
  test("KernelError carries code, message, and context", () => {
    const err = new KernelError(
      KernelErrorCode.SERVICE_NOT_FOUND,
      "Service not found",
      { service: "test.svc", state: "RUNNING" },
    );
    expect(err.code).toBe("SERVICE_NOT_FOUND");
    expect(err.message).toBe("Service not found");
    expect(err.context.service).toBe("test.svc");
    expect(err.context.state).toBe("RUNNING");
    expect(err.context.timestamp).toBeGreaterThan(0);
    expect(err.name).toBe("KernelError");
  });

  test("KernelError.toJSON() produces a safe serializable object", () => {
    const err = new KernelError(
      KernelErrorCode.SERVICE_NOT_FOUND,
      "test message",
      { service: "svc", detail: "extra" },
    );
    const json = err.toJSON();
    expect(json.code).toBe("SERVICE_NOT_FOUND");
    expect(json.message).toBe("test message");
    expect((json.context as any).service).toBe("svc");
    // No secrets leaked
    expect(JSON.stringify(json)).not.toContain("password");
    expect(JSON.stringify(json)).not.toContain("key");
  });

  test("LifecycleTransitionError describes the transition", () => {
    const err = new LifecycleTransitionError("RUNNING", "UNINITIALIZED");
    expect(err.code).toBe(KernelErrorCode.INVALID_LIFECYCLE_TRANSITION);
    expect(err.message).toContain("RUNNING");
    expect(err.message).toContain("UNINITIALIZED");
    expect(err.name).toBe("LifecycleTransitionError");
  });

  test("DuplicateBootstrapError has descriptive message", () => {
    const err = new DuplicateBootstrapError();
    expect(err.code).toBe(KernelErrorCode.DUPLICATE_BOOTSTRAP);
    expect(err.message).toContain("already been bootstrapped");
  });

  test("StartBeforeBootstrapError has descriptive message", () => {
    const err = new StartBeforeBootstrapError();
    expect(err.code).toBe(KernelErrorCode.START_BEFORE_BOOTSTRAP);
    expect(err.message).toContain("before bootstrap");
  });

  test("ServiceNotFoundError includes the service ID", () => {
    const err = new ServiceNotFoundError("xr.agent");
    expect(err.code).toBe(KernelErrorCode.SERVICE_NOT_FOUND);
    expect(err.message).toContain("xr.agent");
    expect(err.context.service).toBe("xr.agent");
  });

  test("DuplicateRegistrationError includes the service ID", () => {
    const err = new DuplicateRegistrationError("xr.config");
    expect(err.code).toBe(KernelErrorCode.DUPLICATE_REGISTRATION);
    expect(err.message).toContain("xr.config");
  });

  test("DependencyCycleError includes the cycle path", () => {
    const err = new DependencyCycleError(["a", "b", "c", "a"]);
    expect(err.code).toBe(KernelErrorCode.DEPENDENCY_CYCLE);
    expect(err.message).toContain("a → b → c → a");
    expect(err.context.dependencies).toEqual(["a", "b", "c", "a"]);
  });

  test("MissingDependencyError includes both service and dependency", () => {
    const err = new MissingDependencyError("agent", "store");
    expect(err.code).toBe(KernelErrorCode.MISSING_DEPENDENCY);
    expect(err.message).toContain("agent");
    expect(err.message).toContain("store");
  });

  test("StaleServiceError includes the service ID", () => {
    const err = new StaleServiceError("xr.store", "workspace closed");
    expect(err.code).toBe(KernelErrorCode.STALE_SERVICE);
    expect(err.message).toContain("xr.store");
    expect(err.context.detail).toBe("workspace closed");
  });

  test("WorkspaceSwitchFailedError includes from/to/step", () => {
    const err = new WorkspaceSwitchFailedError("default", "qa", "rebind_providers");
    expect(err.code).toBe(KernelErrorCode.WORKSPACE_SWITCH_FAILED);
    expect(err.message).toContain("default");
    expect(err.message).toContain("qa");
    expect(err.message).toContain("rebind_providers");
    expect(err.context.workspaceId).toBe("qa");
  });

  test("WorkspaceNotFoundError includes workspace ID and help", () => {
    const err = new WorkspaceNotFoundError("my-workspace");
    expect(err.code).toBe(KernelErrorCode.WORKSPACE_NOT_FOUND);
    expect(err.message).toContain("my-workspace");
    expect(err.message).toContain("xr workspace create");
  });

  test("BackgroundJobNotFoundError includes job ID", () => {
    const err = new BackgroundJobNotFoundError("my_job");
    expect(err.code).toBe(KernelErrorCode.BACKGROUND_JOB_NOT_FOUND);
    expect(err.message).toContain("my_job");
    expect(err.context.jobId).toBe("my_job");
  });

  test("BackgroundJobDuplicateError includes job ID", () => {
    const err = new BackgroundJobDuplicateError("my_job");
    expect(err.code).toBe(KernelErrorCode.BACKGROUND_JOB_DUPLICATE);
    expect(err.message).toContain("my_job");
  });

  test("RuntimeNotReadyError has descriptive message", () => {
    const err = new RuntimeNotReadyError("still bootstrapping");
    expect(err.code).toBe(KernelErrorCode.RUNTIME_NOT_READY);
    expect(err.message).toContain("still bootstrapping");
  });

  test("RuntimeFailedError preserves cause", () => {
    const cause = new Error("disk full");
    const err = new RuntimeFailedError("database init failed", cause);
    expect(err.code).toBe(KernelErrorCode.RUNTIME_FAILED);
    expect(err.message).toContain("database init failed");
    expect(err.cause).toBe(cause);
  });

  test("ProviderRegistrationFailedError preserves cause", () => {
    const cause = new Error("import failed");
    const err = new ProviderRegistrationFailedError("state", cause);
    expect(err.code).toBe(KernelErrorCode.PROVIDER_REGISTRATION_FAILED);
    expect(err.message).toContain("state");
    expect(err.cause).toBe(cause);
  });

  test("ProviderInitFailedError preserves cause", () => {
    const cause = new Error("schema migration failed");
    const err = new ProviderInitFailedError("business", cause);
    expect(err.code).toBe(KernelErrorCode.PROVIDER_INIT_FAILED);
    expect(err.cause).toBe(cause);
  });

  test("LifecycleHookFailedError includes service and phase", () => {
    const cause = new Error("timeout");
    const err = new LifecycleHookFailedError("xr.config", "init", cause);
    expect(err.code).toBe(KernelErrorCode.LIFECYCLE_HOOK_FAILED);
    expect(err.message).toContain("xr.config");
    expect(err.message).toContain("init");
    expect(err.context.service).toBe("xr.config");
    expect(err.context.phase).toBe("init");
    expect(err.cause).toBe(cause);
  });

  test("all error codes are defined", () => {
    const codes = Object.values(KernelErrorCode);
    expect(codes.length).toBeGreaterThan(15);
    expect(codes).toContain("INVALID_LIFECYCLE_TRANSITION");
    expect(codes).toContain("SERVICE_NOT_FOUND");
    expect(codes).toContain("WORKSPACE_SWITCH_FAILED");
    expect(codes).toContain("BACKGROUND_JOB_NOT_FOUND");
    expect(codes).toContain("RUNTIME_NOT_READY");
    expect(codes).toContain("RUNTIME_FAILED");
  });

  test("toDisplayString formats error for human output", () => {
    const err = new WorkspaceSwitchFailedError("default", "qa", "rebind");
    const display = err.toDisplayString();
    expect(display).toContain("WORKSPACE_SWITCH_FAILED");
    expect(display).toContain("workspace: qa");
    expect(display).toContain("detail:");
  });
});
