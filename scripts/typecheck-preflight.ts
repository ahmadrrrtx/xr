/**
 * Phase 2.5 · P1-16 — typecheck preflight.
 *
 * A fresh contributor checkout explodes with thousands of misleading desktop
 * TypeScript errors when the independent `desktop/` installation is absent
 * (12,191 `error TS` lines in the audit's reproduction — TS7026/TS7006/TS2307
 * for missing JSX, mono types, and modules never imported). The cause is a
 * deliberately separate installation: desktop is its own package with its own
 * lockfile, so the root `bun install` never provides it.
 *
 * This guard runs BEFORE either `tsc` invocation and fails with an exact,
 * actionable remediation instead of the noise:
 *
 *     cd desktop && bun install
 *
 * Contract (pinned by test/release/onboarding.test.ts):
 *   - portable (Bun/Node ESM, no POSIX-only shell fragments): no `test -d`;
 *   - checks the REAL prerequisite — `desktop/node_modules/typescript/package.json`
 *     — not merely any `node_modules` directory (an incomplete/stale install
 *     without the TypeScript package is still a failure);
 *   - installs/repairs nothing: no package manager invocation, no lockfile
 *     read/write, no directory creation or removal;
 *   - pure, injectable check (`desktopDepsReady(root)`) so the test can stage
 *     absence in a temp root without touching a developer's real install.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const REMEDIATION = `desktop/ uses its own installation (separate lockfile, by design). Install it with:

    cd desktop && bun install

then re-run \`bun run typecheck\`.`;

export function desktopDepsReady(root: string = process.cwd()): boolean {
  return existsSync(join(resolve(root), "desktop", "node_modules", "typescript", "package.json"));
}

export function main(): number {
  if (desktopDepsReady()) return 0;
  console.error(`✗ ${REMEDIATION}`);
  return 3; // setup/usage prerequisite — nonzero, never a silent skip
}

if (import.meta.main) {
  process.exit(main());
}
