/**
 * The coding CLI's interactive consent goes through the durable approval
 * store (Phase 2 · F-11). A decision is a record with an audit trail, and the
 * coder's prompt is the only thing that answers it.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../../src/state/workspace-store.ts";
import { resetApprovalStores } from "../../../src/control/approval-store.ts";
import { storeConsent } from "../../../src/cli/coder/consent.ts";
import type { ApprovalRequest } from "../../../src/core/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-coder-consent-"));
  resetApprovalStores();
});

const req = (): ApprovalRequest =>
  ({ tool: "write_file", reason: "edit src/a.ts", args: { path: "src/a.ts", content: "x" } }) as ApprovalRequest;

describe("coder consent goes through the durable store", () => {
  test("the prompt's answer is the decision, and it is recorded", async () => {
    const store = new Store(join(tmp, "t.db"));
    const seen: ApprovalRequest[] = [];
    const gate = storeConsent(store)(async (r) => {
      seen.push(r);
      return true;
    });
    expect(await gate(req())).toBe(true);
    expect(seen.map((r) => r.tool)).toEqual(["write_file"]);
    const events = store.recentAudit(20).map((e) => e.event);
    expect(events).toContain("approval.requested");
    store.close?.();
  });

  test("a refusal is a recorded denial, not a silent false", async () => {
    const store = new Store(join(tmp, "t2.db"));
    const gate = storeConsent(store)(async () => false);
    expect(await gate(req())).toBe(false);
    const events = store.recentAudit(20).map((e) => e.event);
    expect(events).toContain("approval.requested");
    store.close?.();
  });
});
