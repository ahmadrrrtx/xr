/** Dev/native use the same independent desktop engine state. XR_HOME is
 * deliberately ignored; opt in to a different home with XR_DESKTOP_HOME. */
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
export function desktopEngineHome(
  env: Record<string, string | undefined> = process.env,
  userHome = homedir()
): string {
  if (env.XR_DESKTOP_HOME !== undefined) {
    if (!isAbsolute(env.XR_DESKTOP_HOME))
      throw new Error('XR_DESKTOP_HOME must be an absolute path');
    return env.XR_DESKTOP_HOME;
  }
  if (!isAbsolute(userHome))
    throw new Error(
      'Cannot resolve desktop home; set an absolute XR_DESKTOP_HOME'
    );
  return join(userHome, '.xr-desktop');
}
