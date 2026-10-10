/**
 * Phase 23 — exit codes for the `xr` coding agent.
 *
 * These are the coder's own contract (Ahmad's Phase 23 brief). They intentionally
 * differ from the legacy `EXIT` table in ../flags.ts, which serves the older
 * subcommand surface; the coder never reuses that table.
 */
export const CODER_EXIT = {
  /** Turn finished; nothing failed. */
  OK: 0,
  /** Error: bad usage, no usable model, provider failure, or the run hit its step limit. */
  ERROR: 1,
  /** Cancelled by the user (Ctrl+C / SIGINT). */
  CANCELLED: 2,
  /** A required approval was denied and the work did not complete. */
  APPROVAL_DENIED: 3,
  /** The per-task budget ceiling stopped the run. */
  BUDGET_EXCEEDED: 4,
} as const;

export type CoderExitCode = (typeof CODER_EXIT)[keyof typeof CODER_EXIT];
