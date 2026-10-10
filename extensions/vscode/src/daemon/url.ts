/**
 * Loopback guard for the daemon URL.
 *
 * The extension sends the daemon bearer token on every request, so it must
 * never be pointed at a host that is not this machine. The check is fail
 * closed: anything that is not http(s) on a loopback address is rejected
 * before a request is made.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const DEFAULT_DAEMON_URL = "http://127.0.0.1:3141";

export class UnsafeDaemonUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeDaemonUrlError";
  }
}

/**
 * Returns the normalized origin (no path, no trailing slash) for a loopback
 * daemon URL. Throws UnsafeDaemonUrlError for anything else.
 */
export function assertLoopbackDaemonUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeDaemonUrlError("XR daemon URL is not a valid URL. Check xr.daemonUrl.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeDaemonUrlError("XR daemon URL must use http or https.");
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new UnsafeDaemonUrlError(
      "XR daemon URL must point at this computer (127.0.0.1, localhost or ::1). The token is never sent elsewhere.",
    );
  }
  if (url.username || url.password) {
    throw new UnsafeDaemonUrlError("XR daemon URL must not contain credentials.");
  }
  return `${url.protocol}//${url.host}`;
}
