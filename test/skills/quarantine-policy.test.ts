/**
 * Phase 20 — quarantine-first policy (src/skills/quarantine.ts). Pure:
 * forced quarantine for unsigned/untrusted sources, 48h window, dangerous
 * grants park in pendingGrants, promote applies them, safe grants are capped.
 */
import { describe, expect, test } from "bun:test";

import {
  applyQuarantine,
  decideQuarantine,
  isQuarantined,
  promoteQuarantine,
  QUARANTINE_WINDOW_MS,
} from "../../src/skills/quarantine.ts";
import type { SkillInstallation, SkillManifest } from "../../src/skills/schema.ts";

const manifest = {
  permissions: [
    { scope: "fs:read", reason: "read", optional: false, dangerous: false, paths: [], domains: [] },
    { scope: "fs:write", reason: "write", optional: false, dangerous: true, paths: [], domains: [] },
    { scope: "shell", reason: "run", optional: false, dangerous: true, paths: [], domains: [] },
  ],
} as unknown as Pick<SkillManifest, "permissions">;

function install(over: Partial<SkillInstallation> = {}): SkillInstallation {
  return {
    id: "architecture_reviewer",
    version: "1.0.0",
    source: "bundled",
    dir: "/tmp/x",
    enabled: true,
    pinned: false,
    favorite: false,
    grantedPermissions: [],
    installedAt: 1,
    updatedAt: 1,
    rollback: [],
    ...over,
  } as SkillInstallation;
}

describe("decideQuarantine — the engine forces it for unsigned sources", () => {
  test("unsigned or unverified is forced", () => {
    const d = decideQuarantine({ level: "unverified", signed: false, publisherKnown: false, fromRegistry: true });
    expect(d.forced).toBe(true);
    expect(d.reason).toBe("unsigned");
  });

  test("signed but untrusted publisher is forced", () => {
    const d = decideQuarantine({ level: "community", signed: true, publisherKnown: false, fromRegistry: true });
    expect(d.forced).toBe(true);
    expect(d.reason).toBe("untrusted-publisher");
  });

  test("a local folder is forced (not from a registry)", () => {
    const d = decideQuarantine({ level: "verified", signed: true, publisherKnown: true, fromRegistry: false });
    expect(d.forced).toBe(true);
    expect(d.reason).toBe("registry-unknown");
  });

  test("an official registry skill is optional, community default is recommended", () => {
    expect(decideQuarantine({ level: "official", signed: true, publisherKnown: true, fromRegistry: true }).forced).toBe(false);
    const community = decideQuarantine({ level: "community", signed: true, publisherKnown: true, fromRegistry: true });
    expect(community.forced).toBe(false);
    expect(community.reason).toBe("community-default");
  });
});

describe("applyQuarantine — capped grants, parked dangerous approvals", () => {
  test("safe grants apply; dangerous approvals park until promotion", () => {
    const now = 1_000_000;
    const q = applyQuarantine(install(), manifest, ["fs:read", "fs:write", "shell"], "unsigned", now);
    expect(q.grantedPermissions).toEqual(["fs:read"]);
    expect(q.quarantine?.pendingGrants).toEqual(["fs:write", "shell"]);
    expect(q.quarantine?.until).toBe(now + QUARANTINE_WINDOW_MS);
    expect(isQuarantined(q, now + 1)).toBe(true);
  });

  test("the 48h window expires on its own", () => {
    const now = 1_000_000;
    const q = applyQuarantine(install(), manifest, ["fs:read"], "unsigned", now);
    expect(isQuarantined(q, now + QUARANTINE_WINDOW_MS + 1)).toBe(false);
  });

  test("undeclared scopes are never granted", () => {
    const q = applyQuarantine(install(), manifest, ["net" as never], "unsigned", 1);
    expect(q.grantedPermissions).toEqual([]);
    expect(q.quarantine?.pendingGrants).toEqual([]);
  });
});

describe("promoteQuarantine — the only way out", () => {
  test("parked dangerous approvals become real grants and the record is lifted", () => {
    const q = applyQuarantine(install(), manifest, ["fs:read", "fs:write", "shell"], "unsigned", 1);
    const promoted = promoteQuarantine(q, manifest);
    expect(promoted.quarantine).toBeUndefined();
    expect(promoted.grantedPermissions).toEqual(["fs:read", "fs:write", "shell"]);
  });
});
