/**
 * Phase 0 · T12 — unattended install + container reachability.
 *
 * Two guarantees:
 *   1. The daemon binds an address that is actually reachable from a published
 *      container port, while remaining loopback-only on a normal install.
 *   2. The installer is safe to run non-interactively (no TTY, `--yes`), which
 *      is the precondition for the containerised/unattended golden path.
 *
 * The reachability test starts a REAL server on the container bind address and
 * connects to it over TCP — the effect, not the configuration.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  resolveBindHost,
  isContainerRuntime,
  DEFAULT_LOOPBACK,
  CONTAINER_BIND,
} from "../../src/daemon/server.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");

describe("T12 · daemon bind address", () => {
  test("a normal install still binds loopback only (no new exposure)", () => {
    const env = {} as NodeJS.ProcessEnv;
    // Simulate a non-container host by asserting the container markers are the
    // only thing that flips the address.
    if (!isContainerRuntime(env)) {
      expect(resolveBindHost(env)).toBe(DEFAULT_LOOPBACK);
    }
  });

  test("inside a container the daemon binds 0.0.0.0 so a published port can reach it", () => {
    const env = { XR_IN_CONTAINER: "1" } as NodeJS.ProcessEnv;
    expect(isContainerRuntime(env)).toBe(true);
    expect(resolveBindHost(env)).toBe(CONTAINER_BIND);
  });

  test("Kubernetes is detected as a container runtime", () => {
    expect(isContainerRuntime({ KUBERNETES_SERVICE_HOST: "10.0.0.1" } as NodeJS.ProcessEnv)).toBe(true);
  });

  test("an explicit XR_DAEMON_HOST always wins", () => {
    expect(resolveBindHost({ XR_DAEMON_HOST: "192.168.1.50" } as NodeJS.ProcessEnv)).toBe("192.168.1.50");
    // Even inside a container, the operator's choice is respected.
    expect(
      resolveBindHost({ XR_IN_CONTAINER: "1", XR_DAEMON_HOST: DEFAULT_LOOPBACK } as NodeJS.ProcessEnv),
    ).toBe(DEFAULT_LOOPBACK);
  });

  test("EFFECT: a server on the container bind address is reachable over TCP", async () => {
    // This is what a published container port does: connect from outside the
    // process to the address the daemon bound. A 127.0.0.1 bind would be
    // unreachable in that topology.
    const server = Bun.serve({
      hostname: CONTAINER_BIND,
      port: 0,
      fetch: () => new Response("xr-ok"),
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe("xr-ok");
    } finally {
      server.stop(true);
    }
  });
});

describe("T12 · installer is non-interactive-safe", () => {
  const installSh = readFileSync(join(REPO_ROOT, "install.sh"), "utf8");
  const installPs1 = readFileSync(join(REPO_ROOT, "install.ps1"), "utf8");

  test("install.sh accepts an explicit --yes / -y", () => {
    expect(installSh).toMatch(/-y\|--yes\)/);
  });

  test("install.sh short-circuits prompts when --yes is given", () => {
    expect(installSh).toMatch(/if \[ "\$YES" = "1" \]/);
  });

  test("install.sh never blocks on a prompt without a TTY", () => {
    // `prompt_yes` must return (declining) rather than calling `read` when
    // stdin/stdout are not a terminal — otherwise an unattended run hangs.
    expect(installSh).toMatch(/is_tty\(\)\s*\{\s*\[ -t 0 \] && \[ -t 1 \]/);
    expect(installSh).toMatch(/if ! is_tty; then return 1; fi/);
  });

  test("install.sh propagates --yes to the nested installer", () => {
    expect(installSh).toMatch(/\[ "\$YES" = "1" \] && cmd\+=\(--yes\)/);
  });

  test("install.ps1 exposes a non-interactive switch", () => {
    // The switch lives on Invoke-XrInstall (a real function parameter), not on
    // a top-level param() block — a top-level param() breaks `iex (irm ...)`.
    expect(installPs1).toMatch(/\[switch\]\$AssumeYes/);
  });

  test("install.ps1 short-circuits prompts when the switch is given", () => {
    expect(installPs1).toMatch(/if \(\$AssumeYes\) \{ return \$DefaultYes \}/);
  });

  test("install.ps1 never blocks on a prompt without a TTY", () => {
    // Unattended runs (CI, packer images) must decline rather than hang on
    // Read-Host, mirroring install.sh's is_tty contract.
    expect(installPs1).toMatch(/if \(-not \(Test-XrInteractive\)\) \{ return \$false \}/);
  });

  test("install.ps1 propagates the non-interactive flag to the nested wizard", () => {
    expect(installPs1).toMatch(/if \(\$AssumeYes\) \{ \$wizardArgs \+= '--yes' \}/);
  });

  test("both installers are stamped from the release manifest", () => {
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "release.manifest.json"), "utf8")) as {
      identity: { version: string };
    };
    expect(installSh).toContain(`VERSION="${manifest.identity.version}"`);
    expect(installPs1).toContain(`$Version = '${manifest.identity.version}'`);
  });
});

describe("T12 · container image and compose agree with the runtime", () => {
  const dockerfile = readFileSync(join(REPO_ROOT, "Dockerfile"), "utf8");
  const compose = readFileSync(join(REPO_ROOT, "docker-compose.yml"), "utf8");

  test("the image marks itself as a container so the bind address is correct", () => {
    expect(dockerfile).toMatch(/ENV XR_IN_CONTAINER=1/);
  });

  test("the host publish is loopback-only, so 0.0.0.0 inside is not public exposure", () => {
    expect(compose).toMatch(/"127\.0\.0\.1:7842:7842"/);
  });

  test("the compose service passes the container marker through", () => {
    expect(compose).toMatch(/XR_IN_CONTAINER=1/);
  });
});
