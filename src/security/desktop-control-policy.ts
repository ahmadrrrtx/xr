/**
 * Preview 1: direct host desktop automation has no sandbox handoff on Windows
 * or macOS. Availability of Docker/Seatbelt/AppContainer alone cannot prove
 * this particular executor runs inside it. Refuse rather than run on host.
 */
export function desktopControlBlock(platform: NodeJS.Platform = process.platform): string | null {
  if (platform !== "win32" && platform !== "darwin") return null;
  const name = platform === "win32" ? "Windows" : "macOS";
  return `${name}: computer control is unavailable because this action path is not wired to a verified sandbox. No unsandboxed host action was run. See https://github.com/ahmadrrrtx/xr/blob/main/docs/release/1.2.0-preview.1/known-limitations.md#agent-command-execution`;
}
