/** XR 5.1 — Environment lifecycle + registry unit tests. */
import { describe, test, expect } from "bun:test";
import {
  EnvironmentSessionRegistry,
  transitionSession,
} from "../../src/platform/environment/lifecycle.ts";
import { defaultEnvironmentPolicy, type EnvironmentSession } from "../../src/platform/environment/types.ts";

function makeSession(registry: EnvironmentSessionRegistry, type = "browser", workspaceId = "/ws/a"): EnvironmentSession {
  return registry.create({
    type: type as EnvironmentSession["type"],
    workspaceId,
    policy: defaultEnvironmentPolicy("/tmp/xr-home", "seed"),
  });
}

describe("transitionSession", () => {
  test("rejects invalid transitions with a reason", () => {
    const r = new EnvironmentSessionRegistry();
    const s = makeSession(r);
    const res = transitionSession(s, "active", "skip a stage");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("invalid");
    expect(s.state).toBe("discover");
  });

  test("records history for accepted transitions", () => {
    const r = new EnvironmentSessionRegistry();
    const s = makeSession(r);
    transitionSession(s, "provision");
    transitionSession(s, "ready");
    transitionSession(s, "active");
    transitionSession(s, "closing", "done");
    transitionSession(s, "closed", "done");
    expect(s.state).toBe("closed");
    expect(s.closedAt).toBeDefined();
    expect(s.history.map((h) => h.to)).toEqual(["discover", "provision", "ready", "active", "closing", "closed"]);
  });

  test("terminal states absorb all further transitions", () => {
    const r = new EnvironmentSessionRegistry();
    const s = makeSession(r);
    transitionSession(s, "provision");
    transitionSession(s, "quarantined", "cleanup failed");
    expect(s.state).toBe("quarantined");
    const res = transitionSession(s, "active");
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("terminal");
    expect(s.quarantineReason).toContain("cleanup failed");
  });
});

describe("EnvironmentSessionRegistry", () => {
  test("create scopes sessions to a workspace and lists them", () => {
    const r = new EnvironmentSessionRegistry();
    const a = makeSession(r, "browser", "/ws/a");
    makeSession(r, "desktop", "/ws/b");
    expect(r.list("/ws/a").map((s) => s.sessionId)).toEqual([a.sessionId]);
    expect(r.list().length).toBe(2);
  });

  test("maxActive is enforced (no unbounded sessions)", () => {
    const r = new EnvironmentSessionRegistry({ maxActive: 2, idleTimeoutMs: 60_000 });
    makeSession(r);
    makeSession(r);
    expect(() => makeSession(r)).toThrow(/session limit/);
  });

  test("idle sweep closes stale sessions", () => {
    const r = new EnvironmentSessionRegistry({ maxActive: 3, idleTimeoutMs: 1_000 });
    const s = makeSession(r);
    transitionSession(s, "provision");
    transitionSession(s, "ready");
    // Force the session to look idle by aging lastActionAt/updatedAt.
    (s as { updatedAt: number }).updatedAt = Date.now() - 10_000;
    const swept = r.sweepIdle();
    expect(swept).toContain(s.sessionId);
    expect(s.state).toBe("closed");
  });

  test("requireUsable blocks terminal, failed, quarantined, and circuit-open sessions", () => {
    const r = new EnvironmentSessionRegistry({ idleTimeoutMs: 3_600_000 });
    const s = makeSession(r);
    // Non-terminal provisioning states are usable at the gate level; the
    // provider layer owns resource-readiness failures (e.g. browser handle).
    expect(r.requireUsable(s.sessionId).ok).toBe(true);
    transitionSession(s, "provision");
    expect(r.requireUsable(s.sessionId).ok).toBe(true);
    transitionSession(s, "ready");
    expect(r.requireUsable(s.sessionId).ok).toBe(true);

    s.circuitOpenUntil = Date.now() + 60_000;
    const gated = r.requireUsable(s.sessionId);
    expect(gated.ok).toBe(false);
    if (!gated.ok) expect(gated.reason).toContain("circuit");

    s.circuitOpenUntil = 0;
    transitionSession(s, "active");
    transitionSession(s, "failed", "crash");
    expect(r.requireUsable(s.sessionId).ok).toBe(false);

    (r as unknown as { sessions: Map<string, EnvironmentSession> }).sessions.clear();
    const q = makeSession(r);
    transitionSession(q, "provision");
    transitionSession(q, "quarantined", "test quarantine");
    const res = r.requireUsable(q.sessionId);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("quarantined");
  });

  test("closeAll marks every non-terminal session closed (shutdown semantics)", () => {
    const r = new EnvironmentSessionRegistry();
    makeSession(r);
    const b = makeSession(r, "desktop");
    transitionSession(b, "provision");
    transitionSession(b, "ready");
    const closed = r.closeAll("test shutdown");
    expect(closed.length).toBe(2);
    for (const s of r.list()) expect(s.state).toBe("closed");
  });
});
