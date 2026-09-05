/**
 * Phase 5 · ADR-0027 — "XR Shield" names the enforcement boundary.
 *
 * F-07: the name was attached to a host scanner that enforces nothing, while
 * the ensemble that actually decides whether an action runs had no name. This
 * test is what keeps the correction from decaying back into prose:
 *
 *   · every component the docs claim is part of the boundary must exist in the
 *     tree at the path the facade names (so the README table cannot drift);
 *   · every component must be re-exported by the facade (so the name resolves
 *     to something in code, not just in a document);
 *   · the hygiene scanner must NOT be part of it (the whole point);
 *   · the facade must remain a facade — re-exports only, no enforcement logic
 *     of its own, because Phase 5 is subtraction and renaming, and new
 *     security code smuggled in under a rename is the failure mode.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { XR_SHIELD_COMPONENTS } from "../../src/xr-shield/index.ts";
import * as shield from "../../src/xr-shield/index.ts";

const ROOT = resolve(import.meta.dir, "../..");
const FACADE = join(ROOT, "src/xr-shield/index.ts");

describe("XR Shield facade (ADR-0027)", () => {
  test("the boundary enumerates the seven components the docs name", () => {
    expect(XR_SHIELD_COMPONENTS.map((c) => c.id)).toEqual([
      "policy",
      "guard",
      "trust",
      "consent",
      "egress",
      "integrity",
      "evidence",
    ]);
  });

  test("every named module actually exists", () => {
    const missing: string[] = [];
    for (const component of XR_SHIELD_COMPONENTS) {
      for (const modulePath of component.modules) {
        if (!existsSync(join(ROOT, modulePath))) {
          missing.push(`${component.id}: ${modulePath}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("the enforcement entry points are reachable through the facade", () => {
    // One representative export per blocking component: if the boundary can be
    // described, it can be imported.
    expect(typeof shield.evaluatePolicy).toBe("function"); // policy
    expect(typeof shield.checkAction).toBe("function"); // guard
    expect(typeof shield.classifyRisk).toBe("function"); // trust
    expect(typeof shield.decidePlacement).toBe("function"); // trust placement
    expect(typeof shield.getApprovalStore).toBe("function"); // consent
    expect(typeof shield.checkEgressTarget).toBe("function"); // egress
    expect(typeof shield.frameToolOutput).toBe("function"); // integrity
    expect(typeof shield.signCheckpoint).toBe("function"); // evidence
    expect(typeof shield.verifySignedChain).toBe("function"); // evidence
  });

  test("consent is exposed as the durable store, never the legacy queue", () => {
    // Phase 2 (F-11) made approvals durable and restricted the legacy
    // control/approvals.ts queue to two bound callers. The boundary facade must
    // not reopen that seam: a bypass shipped from the module called "the
    // security boundary" would be trusted precisely because of where it lives.
    const src = readFileSync(join(ROOT, "src/xr-shield/index.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
    expect(code.join("\n")).not.toMatch(/from\s+"\.\.\/control\/approvals\.ts"/);
    expect(typeof shield.makeApprover).toBe("function");
  });

  test("six of the seven components can refuse an action; evidence records", () => {
    const blocking = XR_SHIELD_COMPONENTS.filter((c) => c.blocking).map((c) => c.id);
    expect(blocking).toEqual(["policy", "guard", "trust", "consent", "egress", "integrity"]);
    expect(XR_SHIELD_COMPONENTS.find((c) => c.id === "evidence")!.blocking).toBe(false);
  });

  test("the hygiene scanner is NOT part of the boundary", () => {
    const named = XR_SHIELD_COMPONENTS.flatMap((c) => c.modules).join(" ");
    expect(named).not.toContain("hygiene/scanner.ts");
    expect(named).not.toContain("security/shield.ts");
    expect(shield.HYGIENE_IS_NOT_THE_BOUNDARY).toBe(true);
  });

  test("the facade adds no enforcement of its own", () => {
    // A facade that starts making decisions is a new, unreviewed security
    // layer wearing a documentation change. Allow re-exports, the component
    // table, and types — nothing that branches on a decision.
    const src = readFileSync(FACADE, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(src).not.toMatch(/\bif\s*\(/);
    expect(src).not.toMatch(/\bthrow\b/);
    expect(src).not.toMatch(/\bfunction\s+\w+\s*\(/);
    expect(src).not.toMatch(/\bclass\s+\w+/);
  });

  test("the renamed scanner keeps its old import path working for one release", async () => {
    const shim = await import("../../src/security/shield.ts");
    const canonical = await import("../../src/hygiene/scanner.ts");
    // Same class object, not a copy: the shim re-exports, it does not fork.
    expect(shim.XRShieldService).toBe(canonical.XRShieldService);
    expect(canonical.SystemHygieneScanner).toBe(canonical.XRShieldService);
  });
});
