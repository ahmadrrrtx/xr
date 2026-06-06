/**
 * XR — single source of truth for runtime versions.
 *
 * CORE_VERSION is the XR runtime version (kept in sync with package.json).
 * PLUGIN_API_VERSION is the plugin host ABI version. It is bumped only when the
 * host surface (PluginHost / capabilities) changes in a breaking way, so a
 * plugin can declare which host it was built against and XR can refuse to load
 * an incompatible one deterministically.
 */
export const CORE_VERSION = "1.0.0";

/** Host ABI version exposed to plugins (see src/plugins/host.ts). */
export const PLUGIN_API_VERSION = 1;
