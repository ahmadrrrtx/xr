import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../src/state/workspace-store.ts";
import { SessionCommand } from "../../src/commands/session.ts";

const key = "sk-faketranscript-ABCD1234567890";
const opaque = "opaque-fixture-secret-987654";
const bearer = "fixture-ABCDEF0123456789+/==";

describe("LLM02 user-requested transcript exports", () => {
  test("CLI export masks synthetic keys in title, structured fields and text", () => {
    const dir = mkdtempSync(join(tmpdir(), "xr-transcript-cli-"));
    const store = new Store(join(dir, "xr.db"));
    try {
      store.createSession("session-123", `demo ${key}`, "agent");
      store.addStep("step-1", "session-123", 1, `phase ${key}`, "test", { nested: { apiKey: opaque }, text: `Bearer ${bearer}`, note: "Keep normal text: 127.0.0.1 and a@example.org" });
      const out = join(dir, "session.md");
      (new SessionCommand() as unknown as { export(s: Store, args: string[]): void }).export(store, ["session-123", out]);
      const text = readFileSync(out, "utf8");
      for (const secret of [key, opaque, bearer, "ABCD1234567890"]) expect(text).not.toContain(secret);
      expect(text).toContain("Keep normal text: 127.0.0.1 and a@example.org");
      expect(text).toContain("review before sharing");
      // Export does not rewrite the local session history.
      expect(store.sessionSteps("session-123")[0]?.detail).toContain(opaque);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
