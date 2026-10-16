/** Builder decisions: TS diagnostics are syntax-only via Bun's parser; git badges never disclose secret filenames. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitInfo, syntaxDiagnostics } from "../../src/daemon/routes/builder.routes.ts";

test("TS diagnostics: valid source reports nothing; syntax errors carry offsets; no semantic checks", () => {
  const ok = syntaxDiagnostics("export const n: number = 1;\n", "a.ts");
  expect(ok).toEqual({ available: true, diagnostics: [] });
  const bad = syntaxDiagnostics("export const n: = ;\n", "a.ts");
  expect(bad.available).toBe(true);
  if (bad.available) {
    expect(bad.diagnostics.length).toBe(1);
    expect(bad.diagnostics[0]!.from).toBeGreaterThanOrEqual(0);
    expect(bad.diagnostics[0]!.to).toBeGreaterThan(bad.diagnostics[0]!.from);
  }
  // A type error is not a syntax error: must NOT be reported (no project TypeScript execution).
  expect(syntaxDiagnostics("const x: number = 'str';\n", "a.ts")).toEqual({ available: true, diagnostics: [] });
});

test("git badges: secret-looking untracked files are dropped, ordinary files keep their badge", async () => {
  const root = mkdtempSync(join(tmpdir(), "builder-git-"));
  const git = (...a: string[]) => execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q");
  writeFileSync(join(root, "visible.txt"), "x");
  writeFileSync(join(root, ".env"), "TOKEN=1");
  writeFileSync(join(root, "id_rsa"), "KEY");
  const info = await gitInfo(root);
  expect(info.isRepo).toBe(true);
  expect(info.files["visible.txt"]).toBe("untracked");
  expect(Object.keys(info.files).some((k) => k.includes(".env") || k.includes("id_rsa"))).toBe(false);
});
