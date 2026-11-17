import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("mobile policy does not suppress the withdrawn deepmerge advisory", () => {
  // OSV withdrew GHSA-gcqx-w48m-w2h4 at 2026-11-16T18:55:38Z.
  // Keeping its old exception makes the checksum-pinned scanner fail on an
  // unused ignore; retire the exception, never disable that fail-closed check.
  const policy = Bun.TOML.parse(readFileSync(resolve(import.meta.dir, "../../mobile/osv-scanner.toml"), "utf8")) as {
    IgnoredVulns?: Array<{ id: string }>;
  };
  expect((policy.IgnoredVulns ?? []).map(entry => entry.id)).not.toContain("GHSA-gcqx-w48m-w2h4");
});
