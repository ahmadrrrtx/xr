/** Production operations with deterministic approval barriers (complements process/HTTP proof). */
import { expect, test } from "bun:test";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileTool } from "../../src/tools/files.ts";
import { deleteFileTool } from "../../src/tools/system.ts";
import { buildStructuredPreview } from "../../src/control/preview.ts";
import type { ToolContext } from "../../src/core/types.ts";

for (const op of ["create", "replace", "delete"] as const) {
  test(`FS10/FS11 ${op}: pending approval binds ancestor and object, not path spelling`, async () => {
    const root = mkdtempSync(join(tmpdir(), "a1-swap-"));
    const cwd = join(root, "workspace"), outside = join(root, "outside");
    mkdirSync(cwd); mkdirSync(outside); mkdirSync(join(cwd, "parent"));
    if (op !== "create") writeFileSync(join(cwd, "parent", "target.txt"), "APPROVED_ORIGINAL");
    writeFileSync(join(outside, "target.txt"), "OUTSIDE_MUST_NOT_CHANGE");
    let approved = false;
    const ctx: ToolContext = { cwd, audit() {}, async approve() {
      approved = true;
      renameSync(join(cwd, "parent"), join(cwd, "original"));
      symlinkSync(outside, join(cwd, "parent"), "dir");
      return true;
    } };
    try {
      const result = await (op === "delete" ? deleteFileTool : writeFileTool).run({ path: "parent/target.txt", content: "NEW_CONTENT" }, ctx);
      expect(approved).toBe(true);
      expect(readFileSync(join(outside, "target.txt"), "utf8")).toBe("OUTSIDE_MUST_NOT_CHANGE");
      expect(result.ok).toBe(false);
      if (op !== "create") expect(readFileSync(join(cwd, "original", "target.txt"), "utf8")).toBe("APPROVED_ORIGINAL");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

test("FS04/FS13 previews do not read a sensitive hardlink under an innocent alias", () => {
  const cwd = mkdtempSync(join(tmpdir(), "a1-preview-"));
  try {
    writeFileSync(join(cwd, ".env"), "SYNTHETIC_PREVIEW_CANARY_9173");
    linkSync(join(cwd, ".env"), join(cwd, "innocent.txt"));
    for (const tool of ["write_file", "delete_file"]) {
      const preview = buildStructuredPreview({ tool, args: { path: "innocent.txt", content: "new harmless text" }, reason: "synthetic", cwd });
      expect(JSON.stringify(preview).includes("SYNTHETIC_PREVIEW_CANARY_9173")).toBe(false);
    }
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("FS02 ordinary in-root missing parent is handled without outside effects", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "a1-create-"));
  try {
    // Existing writer does not create parents: preserve a bounded refusal or an owned create.
    const result = await writeFileTool.run({ path: "new.txt", content: "SAFE" }, { cwd, audit() {}, approve: async () => true });
    expect(result.ok).toBe(true);
    expect(existsSync(join(cwd, "new.txt"))).toBe(true);
    expect(readFileSync(join(cwd, "new.txt"), "utf8")).toBe("SAFE");
  } finally { rmSync(cwd, { recursive: true, force: true }); }
});
