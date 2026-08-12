/**
 * XR — one computation authority for skill counts (audit GAP-008 · P2).
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 *
 * Four different numbers were in circulation, all called "skills":
 *
 *   65  README + release.manifest.json   (directories under skills/)
 *   54  official manifests               (dirs containing xr-skill.json)
 *   79  `xr skills list` / `skills types` (unified runtime records)
 *   64  rows actually printed by `skills list`
 *
 * None was wrong in isolation — they measure different populations — but they
 * were all labelled identically, so a reader could not tell which population a
 * number described. For a project whose distinguishing claim is
 * mechanically-verified honesty, an ambiguous count is a real defect: it is
 * exactly the kind of number a reader assumes has been checked.
 *
 * README principle 1 ("one computation authority per question") requires that
 * whatever answers a question answers it for every surface. This module is
 * that authority for "how many skills?".
 *
 * The fix is NOT to force one number. It is to make each number named,
 * derivable from one place, and separately reportable.
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { bundledSkillsDir } from "./loader-runtime.ts";

export interface SkillCounts {
  /**
   * Directories under `skills/` — what "N bundled skills" means in the README
   * and release manifest. The claim-lint mechanical check uses this.
   */
  bundledDirectories: number;
  /**
   * Bundled directories carrying an `xr-skill.json` manifest ("official").
   * The remainder are legacy-markdown skills, which are still loadable.
   */
  officialManifests: number;
  /** Bundled directories without a manifest (legacy markdown format). */
  legacyMarkdown: number;
}

/**
 * Count the bundled skill tree. Filesystem-only and side-effect free, so
 * claim-lint, the CLI and the release manifest all agree by construction.
 */
export function countBundledSkills(root: string = bundledSkillsDir()): SkillCounts {
  if (!existsSync(root)) {
    return { bundledDirectories: 0, officialManifests: 0, legacyMarkdown: 0 };
  }

  let bundledDirectories = 0;
  let officialManifests = 0;

  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    let isDir = false;
    try {
      isDir = statSync(dir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    bundledDirectories++;
    if (existsSync(join(dir, "xr-skill.json"))) officialManifests++;
  }

  return {
    bundledDirectories,
    officialManifests,
    legacyMarkdown: bundledDirectories - officialManifests,
  };
}

/**
 * Human-readable, unambiguous summary. Used where a single line must describe
 * the skill inventory without inviting the reader to conflate populations.
 */
export function describeSkillCounts(counts: SkillCounts = countBundledSkills()): string {
  return (
    `${counts.bundledDirectories} bundled ` +
    `(${counts.officialManifests} with an xr-skill.json manifest, ` +
    `${counts.legacyMarkdown} legacy markdown)`
  );
}
