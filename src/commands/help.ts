/**
 * XR 3.1C — Command discovery surface (compat re-export)
 *
 * Implementation lives in src/cli/help.ts + src/cli/catalog.ts.
 * This module remains so existing imports of `showHelp` keep working.
 */

export { showHelp, showCommandHelp } from "../cli/help.ts";
