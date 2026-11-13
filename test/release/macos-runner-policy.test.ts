import { test, expect } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

test("journeys keep supported macOS arm64 and Intel legs without retired runners", () => {
  const cli = readFileSync(".github/workflows/journey.yml", "utf8");
  const desktop = readFileSync(".github/workflows/desktop-app.yml", "utf8");
  for (const runner of ["macos-26", "macos-15", "macos-15-intel"]) expect(cli).toContain(runner);
  expect(desktop).toContain("slug: darwin-arm64, runsOn: macos-26");
  expect(desktop).toContain("slug: darwin-arm64, runsOn: macos-15");
  expect(desktop).toContain("slug: darwin-x64, runsOn: macos-15-intel");
  for (const file of readdirSync(".github/workflows").filter(f => /\.ya?ml$/.test(f))) {
    const content = readFileSync(join(".github/workflows", file), "utf8");
    expect(content).not.toMatch(/runsOn:\s*macos-14\b|runs-on:\s*macos-14\b|\bmacos-14\s*[,\]]/);
  }
});
