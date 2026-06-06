/**
 * XR 1.0 reference plugin — "hello".
 *
 * Shows the full plugin contract:
 *   • a default `activate(host)` that returns contributions
 *   • a contributed COMMAND  → `xr plugin hello greet [name]`
 *   • a contributed TOOL     → `plugin.hello.echo` (offered to the agent)
 *
 * It requests NO permissions, so its host has no fs/net/memory/provider/secrets
 * capabilities at all — the safest possible plugin.
 *
 * NOTE: plugins receive ONLY the host. They never import the Store, config,
 * process.env, fetch, or node:fs directly. (Doing so is the marketplace review
 * red flag we will lint for later.)
 */
import type { PluginHost, PluginContributions } from "../../src/plugins/types.ts";

export function activate(host: PluginHost): PluginContributions {
  host.log(`activated (api v${host.apiVersion}, core ${host.coreVersion})`);

  return {
    commands: [
      {
        name: "greet",
        description: "Print a friendly greeting.",
        run(argv) {
          const who = argv[0] ?? "world";
          host.log(`👋 hello, ${who}! (from the XR hello plugin)`);
        },
      },
    ],
    tools: [
      {
        name: "echo",
        description: "Echo a message back. Safe, read-only, no permissions.",
        parameters: { message: "string" },
        // Pure + harmless → no approval needed.
        requiresApproval: false,
        run(args) {
          const message = String(args.message ?? "");
          return { ok: true, output: `echo: ${message}` };
        },
      },
    ],
    dispose() {
      host.log("disposed");
    },
  };
}

export default activate;
