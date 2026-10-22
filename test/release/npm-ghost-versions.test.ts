/**
 * Launch audit XR-LAUNCH-023 — npm 3.x "ghost" versions outrank the 1.x line.
 *
 * Acceptance: a registry probe in the release gate. `scripts/npm-ghost-versions.ts`
 * classifies every version above the `latest` major and requires a deprecation
 * message pointing to `@latest`; `bun run channel:live` (npm channel) runs the
 * same check. The fixture is the REAL registry state captured 2026-10-22
 * (dist-tags + per-version deprecation text only). Everything here is offline,
 * and the module must never run a registry write itself.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runLiveChecks, type Fetcher } from "../../scripts/channel-live-check.ts";
import { deprecationCommands, findGhostVersions, ghostMessage, type Packument } from "../../scripts/npm-ghost-versions.ts";
import { loadManifest } from "../../scripts/release-manifest.ts";

const ROOT = join(import.meta.dir, "..", "..");
const FIXTURE = join(ROOT, "test", "fixtures", "npm", "rrrtx-xr-packument-2026-10-22.json");
const SCRIPT = join(ROOT, "scripts", "npm-ghost-versions.ts");
const real = (): Packument => JSON.parse(readFileSync(FIXTURE, "utf8")) as Packument;

/** The registry after the owner ran the printed commands. */
function fixed(): Packument {
  const doc = real();
  for (const [v, meta] of Object.entries(doc.versions ?? {})) {
    if (meta?.deprecated) doc.versions![v] = { deprecated: ghostMessage("@rrrtx/xr", "1.0.0") };
  }
  return doc;
}

describe("XR-LAUNCH-023 · ghost classification (pure)", () => {
  test("today's registry: all five 3.x versions outrank 1.0.0 and their message points to @beta", () => {
    const r = findGhostVersions(real());
    expect(r.latest).toBe("1.0.0");
    expect(r.ghosts.map((g) => g.version)).toEqual(["3.0.0", "3.0.1", "3.0.2", "3.0.3", "3.1.5"]);
    for (const g of r.ghosts) {
      expect(g.problems).toContain("deprecation message points to @beta");
      expect(g.problems).toContain("deprecation message does not point to @latest");
    }
    expect(r.problems).toHaveLength(10);
  });

  test("versions at or below the latest major are never ghosts (0.2.0, 1.0.0-beta.1, a future 1.x rc)", () => {
    const doc = fixed();
    doc.versions!["1.2.0-rc.1"] = {};
    const r = findGhostVersions(doc);
    expect(r.ghosts.map((g) => g.version)).not.toContain("0.2.0");
    expect(r.ghosts.map((g) => g.version)).not.toContain("1.0.0-beta.1");
    expect(r.ghosts.map((g) => g.version)).not.toContain("1.2.0-rc.1");
  });

  test("after the owner's fix the probe is clean and prints no commands", () => {
    const r = findGhostVersions(fixed());
    expect(r.problems).toEqual([]);
    expect(deprecationCommands(r)).toEqual([]);
  });

  test("an undeprecated ghost and a missing latest dist-tag are both problems", () => {
    const doc = fixed();
    doc.versions!["4.0.0"] = {};
    expect(findGhostVersions(doc).problems).toEqual(["@rrrtx/xr@4.0.0 outranks latest 1.0.0: not deprecated"]);
    expect(findGhostVersions({ versions: { "3.0.0": {} } }).problems[0]).toContain("dist-tag latest is unset");
  });
});

describe("XR-LAUNCH-023 · the owner's commands are explicit and never run", () => {
  test("one npm deprecate per ghost, exact versions (no ranges), message → @latest (1.x)", () => {
    const cmds = deprecationCommands(findGhostVersions(real()));
    expect(cmds).toHaveLength(5);
    for (const c of cmds) {
      expect(c).toMatch(/^npm deprecate '@rrrtx\/xr@3\.\d+\.\d+' '/);
      expect(c).not.toMatch(/[<>^~*]|\|\|/);
      expect(c).toContain("@rrrtx/xr@latest (1.x)");
      expect(c).not.toContain("@beta");
      expect(c).not.toMatch(/deprecate '[^']+' ''$/); // never an empty message (that would UN-deprecate)
    }
  });

  test("the module has no way to execute a command or write to the registry", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).not.toMatch(/child_process|Bun\.spawn|Bun\.\$|\bexecSync\b|\bspawnSync\b/);
    expect(src).not.toMatch(/method:\s*["'](PUT|POST|DELETE|PATCH)/i);
    expect(src).not.toMatch(/NPM_TOKEN|_authToken/);
  });

  test("CLI: exit 1 with --print-commands on today's registry, exit 0 once fixed, --json carries ok", () => {
    const w = mkdtempSync(join(tmpdir(), "xr-npm-ghosts-"));
    try {
      const bad = spawnSync("bun", [SCRIPT, "--fixture", FIXTURE, "--print-commands"], { encoding: "utf8" });
      expect(bad.status).toBe(1);
      expect(bad.stdout).toContain("Owner-run only");
      expect(bad.stdout.match(/^npm deprecate /gm)?.length).toBe(5);
      const good = join(w, "fixed.json");
      writeFileSync(good, JSON.stringify(fixed()));
      const ok = spawnSync("bun", [SCRIPT, "--fixture", good], { encoding: "utf8" });
      expect(ok.status).toBe(0);
      expect(ok.stdout).toContain("[npm-ghosts] ok");
      const json = spawnSync("bun", [SCRIPT, "--fixture", FIXTURE, "--json"], { encoding: "utf8" });
      expect(JSON.parse(json.stdout).ok).toBe(false);
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("XR-LAUNCH-023 · registry probe in the release gate (channel:live npm)", () => {
  const fakeRegistry = (doc: Packument): Fetcher => async (url) =>
    url === "https://registry.npmjs.org/@rrrtx%2Fxr"
      ? new Response(JSON.stringify(doc), { status: 200 })
      : new Response("not found", { status: 404 });

  test("today's registry fails the npm channel with the owner pointer", async () => {
    const [npm] = await runLiveChecks(loadManifest(), { channels: ["npm"], version: "1.0.0", fetch: fakeRegistry(real()) });
    expect(npm!.ok).toBe(false);
    expect(npm!.problems.filter((p) => p.includes("outranks latest 1.0.0"))).toHaveLength(10);
    expect(npm!.problems.every((p) => !p.includes("outranks") || p.includes("bun run npm:ghosts -- --print-commands"))).toBe(true);
  });

  test("the fixed registry passes the npm channel", async () => {
    const [npm] = await runLiveChecks(loadManifest(), { channels: ["npm"], version: "1.0.0", fetch: fakeRegistry(fixed()) });
    expect(npm!.problems).toEqual([]);
    expect(npm!.ok).toBe(true);
  });
});
