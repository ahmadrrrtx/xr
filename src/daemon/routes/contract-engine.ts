/**
 * XR-P01 — engine↔desktop contract constants.
 *
 * They live in their own module (re-exported by contract.ts) because
 * docs/perf/SIZE-WAIVERS.json holds the contract.ts barrel to two lines
 * per phase: "every later phase adds its entries to its own
 * contract-<phase>.ts and registers them from this barrel".
 */

/**
 * The engine↔desktop contract version. This is NOT the package version:
 * desktops must never infer compatibility from `PKG.version` (a display
 * string on a rapid-cadence train). Bump ONLY when the handshake surface
 * (`GET /api/v1/meta/version`) or a desktop-consumed operation changes in
 * a way an older/newer desktop cannot tolerate; additive operations do
 * not bump it (they appear in `capabilities`). Single authority: the
 * daemon payload and every test read this constant.
 */
export const ENGINE_CONTRACT_VERSION = 1;

/**
 * The oldest desktop app version this engine will serve a handshake to.
 * The desktop version train is the Tauri app version
 * (`desktop/src/lib/appMeta.ts` mirrors `src-tauri/tauri.conf.json`);
 * `0.2.0` is the first desktop that speaks contract 1. Older desktops
 * (which never call this endpoint) are unaffected — the floor only
 * gates desktops new enough to ask.
 */
export const MIN_DESKTOP_VERSION = "0.2.0";
