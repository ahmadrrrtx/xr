/**
 * XR 3.1C — CLI public API
 *
 * Import from here for professional CLI helpers shared by commands.
 */

export * from "./flags.ts";
export * from "./output.ts";
export * from "./errors.ts";
export * from "./catalog.ts";
export { showHelp, showCommandHelp } from "./help.ts";
export { runCli, registerCommands, registryNameFor } from "./router.ts";
