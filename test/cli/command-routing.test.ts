/**
 * XR-LAUNCH-011 — every lazily-loaded command must route as a command.
 *
 * `uninstall` had a loader but no catalog/registry entry, so
 * `xr uninstall --purge --yes` was sent to the agent as a task prompt. The
 * clean-machine journey (scripts/journey/cli-journey.ts) found it; this pins
 * the whole class.
 */
import { describe, expect, test } from "bun:test";
import { COMMAND_LOADERS } from "../../src/cli/command-loaders.ts";
import { decideRoute, registryNameFor } from "../../src/cli/route-decision.ts";

describe("command routing covers every lazy loader", () => {
  for (const name of Object.keys(COMMAND_LOADERS)) {
    test(`xr ${name} routes to a registered command, never a task`, () => {
      const d = decideRoute({ head: name });
      expect(d.kind).not.toBe("task");
      expect(d.kind).not.toBe("unknown");
      expect(COMMAND_LOADERS[registryNameFor(name) ?? ""]).toBeDefined();
    });
  }

  test("xr uninstall --purge is the uninstall command", () => {
    expect(decideRoute({ head: "uninstall" })).toMatchObject({ kind: "command", command: "uninstall" });
  });
});
