/**
 * NEW-8 — isolation-backend detection never holds kernel boot; every placement decision still waits for it.
 *
 * Detection runs subprocess probes (`docker info` with an 8 s budget, then `podman info`, and the
 * bwrap/unshare self-checks). Kernel init used to await them one after another, so the first request
 * that boots the app container (the desktop catalog fixture's first custom-provider add) waited for
 * all of them and hit its 3 s client timeout on hosted runners. Now the probes run together, kernel
 * init only starts them, and `evaluate()` / `ensureReady()` await the same run (fail-closed).
 */
import { expect, test } from "bun:test";
import type { EnvironmentBackend } from "../../src/runtime/trust/environment/backend.ts";
import { InProcessBackend } from "../../src/runtime/trust/environment/in-process.ts";
import { shellTrustSpec } from "../../src/runtime/trust/tool-support.ts";
import { makeTrust } from "./_helpers.ts";

const later = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

/** A backend whose probe is held until the test releases it. */
function heldBackend(id: string, placement: EnvironmentBackend["placement"], found: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let probes = 0;
  const backend = {
    id, placement,
    guarantees: {} as EnvironmentBackend["guarantees"],
    enforcement: {} as EnvironmentBackend["enforcement"],
    async detect() { probes++; await gate; return found; },
    async run() { throw new Error("never executed by this test"); },
    describe: () => `${id} (held probe)`,
  } as unknown as EnvironmentBackend;
  return { backend, release: () => release(), probes: () => probes };
}

test("kernel init does not wait for slow isolation probes, and the probes run together, once", async () => {
  const namespace = heldBackend("namespace-sandbox", "namespace_sandbox", false);
  const container = heldBackend("container-docker", "container", false);
  const h = makeTrust([new InProcessBackend(), namespace.backend, container.backend]);
  try {
    expect(await Promise.race([h.trust.onInit().then(() => "returned"), later("held", 1_000)])).toBe("returned");
    expect(h.trust.health().ready).toBe(false);
    void h.manager.init(); void h.trust.ensureReady(); // concurrent callers share the one detection run
    await later(null, 20);
    expect([namespace.probes(), container.probes()]).toEqual([1, 1]); // both started before either finished
    namespace.release(); container.release();
    await h.trust.ensureReady();
    expect(h.trust.health().ready).toBe(true);
    expect([namespace.probes(), container.probes()]).toEqual([1, 1]);
  } finally { namespace.release(); container.release(); }
});

test("a placement decision waits for detection to finish and then fails closed on what it found", async () => {
  const namespace = heldBackend("namespace-sandbox", "namespace_sandbox", false);
  const h = makeTrust([new InProcessBackend(), namespace.backend]);
  try {
    await h.trust.onInit();
    const decided = h.trust.evaluate({
      request: shellTrustSpec("rm -rf /tmp/xr-new8-ws/build", "/tmp/xr-new8-ws").request,
      runId: "ex_new8", correlationId: "ex_new8", workspaceId: "ws", actor: "user:u", capability: "core_tool:shell",
    });
    expect(await Promise.race([decided.then(() => "decided"), later("waiting", 200)])).toBe("waiting");
    namespace.release();
    const ev = await decided;
    expect(ev.trust.classification.tier).toBe("tier2_isolated");
    expect(ev.outcome.kind).toBe("blocked"); // no isolation found: fail closed, never a silent downgrade
  } finally { namespace.release(); }
});
