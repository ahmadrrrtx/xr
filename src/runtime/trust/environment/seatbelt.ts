/**
 * macOS Seatbelt mechanism for the Tier-2 OS sandbox (XR-LAUNCH-003, decision D3).
 *
 * EXPERIMENTAL and opt-in (`XR_OS_SANDBOX=experimental`): with the flag unset,
 * detection reports "unavailable" and the trust gate keeps refusing Tier-2 work
 * (fail closed, the pre-existing behaviour). Not verified on Apple hardware by
 * this change; `os-sandbox.yml` runs the smoke on the macOS CI runner.
 *
 * Boundary (sandbox-exec + an SBPL profile, deny-by-default):
 *   - file contents readable only under the system/toolchain roots listed
 *     below, the granted roots and a per-run scratch dir; everything else —
 *     the user's home, ~/.ssh, ~/Library, other projects — is unreadable
 *     (stat metadata stays visible so path resolution works);
 *   - writes only to the granted writable roots, the scratch dir and a few
 *     device nodes;
 *   - no network (no `network*` allow rule);
 *   - signals only to processes inside the same sandbox.
 * Seatbelt matches resolved paths, so every root is realpath'd (/tmp →
 * /private/tmp).
 */
import { realpathSync } from "node:fs";

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";

/** Read-only system and toolchain roots (contents). */
const SYSTEM_READ_ROOTS = [
  "/usr", "/bin", "/sbin", "/System", "/Library", "/private/etc", "/private/var/db/timezone",
  "/opt/homebrew", "/usr/local", "/Applications/Xcode.app", "/dev",
];

export const SEATBELT_PATH = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin";

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** SBPL string literal. */
function lit(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The SBPL profile. Paths are passed as -D parameters, never spliced in. */
export function seatbeltProfile(writableCount: number, readOnlyCount: number): string {
  const w = Array.from({ length: writableCount }, (_, i) => `(subpath (param "W${i}"))`).join(" ");
  const r = Array.from({ length: readOnlyCount }, (_, i) => `(subpath (param "R${i}"))`).join(" ");
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target same-sandbox))",
    "(allow process-info* (target same-sandbox))",
    "(allow sysctl-read)",
    "(allow user-preference-read)",
    "(allow ipc-posix-sem)",
    "(allow ipc-posix-shm)",
    "(allow pseudo-tty)",
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center") (global-name "com.apple.system.logger") (global-name "com.apple.sysmond"))',
    "(allow file-read-metadata)",
    `(allow file-read* (literal "/") ${SYSTEM_READ_ROOTS.map((p) => `(subpath ${lit(p)})`).join(" ")} (subpath (param "SCRATCH")) ${w} ${r})`,
    `(allow file-write* (subpath (param "SCRATCH")) ${w} (literal "/dev/null") (literal "/dev/zero") (literal "/dev/dtracehelper") (regex #"^/dev/tty") (literal "/dev/ptmx"))`,
    '(allow file-ioctl (literal "/dev/null") (regex #"^/dev/tty") (literal "/dev/ptmx"))',
  ].join("\n");
}

/** argv that runs `command` under the profile. */
export function seatbeltArgv(
  writableRoots: readonly string[],
  readOnlyRoots: readonly string[],
  scratch: string,
  command: readonly string[],
): string[] {
  const params: string[] = ["-D", `SCRATCH=${real(scratch)}`];
  writableRoots.forEach((p, i) => params.push("-D", `W${i}=${real(p)}`));
  readOnlyRoots.forEach((p, i) => params.push("-D", `R${i}=${real(p)}`));
  return [SANDBOX_EXEC, "-p", seatbeltProfile(writableRoots.length, readOnlyRoots.length), ...params, ...command];
}
