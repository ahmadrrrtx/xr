/** Desktop sidecar mobile data must never share the CLI's ~/.xr registry. */
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
export function mobileHome(): string {
  if (process.env.XR_SECRET_NAMESPACE === "desktop") {
    const home = process.env.XR_HOME;
    if (!home || !isAbsolute(home)) throw new Error("Desktop mobile state requires an absolute XR_HOME");
    return home;
  }
  return join(process.env.HOME ?? homedir(), ".xr");
}
