/** Additional inventory boundaries: existing repository/skill content APIs, not replacement readers. */
import { expect, test } from "bun:test";
import { linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepoIntelligence } from "../../src/repo/index.ts";
import { WorkspaceStore } from "../../src/state/workspace-store.ts";
import { loadSkills } from "../../src/skills/loader.ts";

test("FS04/FS05 repository indexing and later snippets cannot use sensitive hardlink aliases", async () => {
  const home = mkdtempSync(join(tmpdir(), "a1-repo-context-")), root = join(home, "workspace"); mkdirSync(root);
  const store = new WorkspaceStore("synthetic-a1", join(home, "workspace.db"));
  try {
    writeFileSync(join(root, ".env"), "export const SYNTHETIC_INDEX_CANARY = 123;\n");
    linkSync(join(root, ".env"), join(root, "innocent.ts")); writeFileSync(join(root, "safe.ts"), "export const safeOrdinary = 1;\n");
    const intel = createRepoIntelligence({ workspaceId: "synthetic-a1", root, store });
    const indexed = await intel.index({ force: true }); expect(indexed.state).toBe("ready");
    expect((await intel.map("exported declarations")).text.includes("SYNTHETIC_INDEX_CANARY")).toBe(false);
    expect(intel.fileContext("innocent.ts")).toBeNull();
    expect(intel.fileContext("safe.ts")?.text).toContain("safeOrdinary");
    // A previously-authorized indexed name becomes a sensitive alias after indexing.
    unlinkSync(join(root, "safe.ts")); linkSync(join(root, ".env"), join(root, "safe.ts"));
    expect(intel.fileContext("safe.ts")).toBeNull();
    expect(intel.search("safeOrdinary").length).toBe(0);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});
test("FS05 skill context does not follow a linked SOP directory or body", () => {
  const home = mkdtempSync(join(tmpdir(), "a1-skill-context-"));
  try {
    const root = join(home, "skills"), outside = join(home, "outside"); mkdirSync(root); mkdirSync(outside);
    writeFileSync(join(outside, "SKILL.md"), "---\nid: forged\n---\nSYNTHETIC_SKILL_CANARY\n");
    symlinkSync(outside, join(root, "linked-directory")); mkdirSync(join(root, "linked-body")); symlinkSync(join(outside, "SKILL.md"), join(root, "linked-body/SKILL.md"));
    mkdirSync(join(root, "ordinary")); writeFileSync(join(root, "ordinary/SKILL.md"), "---\nid: ordinary\n---\nSAFE_SKILL_CONTEXT\n");
    const result = loadSkills(root);
    expect(JSON.stringify(result).includes("SYNTHETIC_SKILL_CANARY")).toBe(false);
    expect(result.length).toBe(1); expect(result[0]?.body).toBe("SAFE_SKILL_CONTEXT");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
