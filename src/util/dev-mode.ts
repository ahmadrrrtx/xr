/**
 * XR Phase 31 · Bucket A (A12) — dev/production mode gate.
 *
 * Dev-only affordances (dashboard dev menu items, `--verbose`, crash
 * simulation in the desktop tray) must never render or activate in a
 * production build. The single source of truth is `globalThis.__XR_DEV__`,
 * which is set ONLY from the `XR_DEV=1` environment opt-in (dev / nightly
 * shells export it); production entry points never set it.
 *
 * `isDevMode()` is intentionally conservative: an unset flag, `"0"`, or any
 * NODE_ENV=production process without the explicit opt-in is NOT dev mode.
 */

declare global {
  // eslint-disable-next-line no-var
  var __XR_DEV__: boolean | undefined;
}

/** True only when the operator explicitly opted into dev mode. */
export function isDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (globalThis.__XR_DEV__ === true) return true;
  return env.XR_DEV === "1";
}

/**
 * Publish the flag for surfaces that read `globalThis.__XR_DEV__` directly
 * (the served dashboard script, the desktop shell). Call once at process
 * start; production starts simply never call it with a truthy source.
 */
export function installDevGlobal(env: NodeJS.ProcessEnv = process.env): boolean {
  const dev = isDevMode(env);
  globalThis.__XR_DEV__ = dev;
  return dev;
}
