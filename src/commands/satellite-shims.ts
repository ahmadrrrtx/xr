/**
 * XR Phase 5 · Step 2/3 — satellite relocation shims.
 *
 * `src/enterprise` (21,697 LOC) and `extensions/business-os` (11,749 LOC) were
 * extracted from core in Phase 5 (ADR-0028). Their CLI verbs did NOT simply
 * vanish: a user who types `xr enterprise policy show` on an upgraded install
 * must be told where the feature went, not shown `Unknown command` with a
 * did-you-mean list — that is the difference between a migration and a
 * regression (Art. XXVII: announce → warn → migrate → remove).
 *
 * These shims are retained for ONE release. They:
 *   · print the satellite package + install line,
 *   · exit non-zero (EXIT.USAGE) so scripts fail loudly rather than silently
 *     appearing to succeed with no effect (Cmdt 2 — no success without effect),
 *   · are pure: zero imports from the extracted packages, so the CI invariant
 *     "core must not import satellites" holds.
 *
 * Removal: 2.0.0 (see docs/migration/PHASE-5-SATELLITES.md).
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { colors as C } from "../interfaces/cli.ts";
import { EXIT } from "../cli/flags.ts";

export interface Relocation {
  readonly verb: string;
  readonly pkg: string;
  readonly repo: string;
  readonly binary: string;
  readonly summary: string;
  readonly docs: string;
}

export const RELOCATIONS: Record<string, Relocation> = {
  enterprise: {
    verb: "enterprise",
    pkg: "@rrrtx/xr-enterprise",
    repo: "https://github.com/ahmadrrrtx/xr-enterprise",
    binary: "xr-enterprise",
    summary:
      "organization policy, delegated authority, audit export, SLOs, incidents, supply-chain response, DR, releases, certification evidence",
    docs: "docs/migration/PHASE-5-SATELLITES.md",
  },
  evaluate: {
    verb: "evaluate",
    pkg: "@rrrtx/xr-enterprise",
    repo: "https://github.com/ahmadrrrtx/xr-enterprise",
    binary: "xr-enterprise",
    summary: "the evaluation harness (suites, provenance, scoring, regression gates)",
    docs: "docs/migration/PHASE-5-SATELLITES.md",
  },
  business: {
    verb: "business",
    pkg: "@rrrtx/business-os",
    repo: "https://github.com/ahmadrrrtx/business-os",
    binary: "xr-business",
    summary:
      "the default-off Business OS extension (records, journeys, workers, approvals, artifacts)",
    docs: "docs/migration/PHASE-5-SATELLITES.md",
  },
};

/**
 * Emit the relocation notice and return the exit code the caller must honour.
 * Exported so the migration test can assert the text without spawning a shell.
 */
export function relocationNotice(r: Relocation): string {
  return [
    "",
    `  ${C.bold(C.amber(`xr ${r.verb} has moved out of core`))}`,
    "",
    `  ${C.dim("What: ")} ${r.summary}`,
    `  ${C.dim("Where:")} ${C.cyan(r.pkg)} ${C.dim(`(${r.repo})`)}`,
    "",
    `  ${C.dim("Install:")} ${C.bold(`bun add -g ${r.pkg}`)}`,
    `  ${C.dim("Then:   ")} ${C.bold(`${r.binary} ${r.verb} …`)}`,
    "",
    `  ${C.dim("Why:  ")} Phase 5 shrank core to the runtime it actually is. Nothing was`,
    `          deleted — this surface is maintained, released and tested in its own`,
    `          package. See ${r.docs} and ADR-0028.`,
    "",
  ].join("\n");
}

abstract class RelocatedCommand implements Command {
  abstract readonly name: string;
  abstract readonly relocation: Relocation;
  readonly description = "moved to a satellite package (Phase 5 · ADR-0028)";

  execute(_ctx: CommandContext): void {
    console.log(relocationNotice(this.relocation));
    process.exitCode = EXIT.USAGE;
  }
}

export class EnterpriseCommand extends RelocatedCommand {
  readonly name: string = "enterprise";
  readonly relocation = RELOCATIONS.enterprise!;
}
export class EnterpriseAliasCommand extends EnterpriseCommand {
  override readonly name = "ent";
}
export class EvaluateCommand extends RelocatedCommand {
  readonly name: string = "evaluate";
  readonly relocation = RELOCATIONS.evaluate!;
}
export class EvalAliasCommand extends EvaluateCommand {
  override readonly name = "eval";
}
export class BusinessCommand extends RelocatedCommand {
  readonly name: string = "business";
  readonly relocation = RELOCATIONS.business!;
}
export class BizAliasCommand extends BusinessCommand {
  override readonly name = "biz";
}
