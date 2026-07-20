/** XR Daemon — skills and plugin API adapters. */

import { handlePluginApi } from "../plugin-api.ts";
import { handleSkillsApi } from "../skills-api.ts";
import { route, type DaemonRoute } from "./router.ts";

export function extensionRoutes(): DaemonRoute[] {
  return [
    route({
      id: "skills.api",
      prefix: "/api/skills",
      handle: async ({ req, url }) => await handleSkillsApi(req, url),
    }),
    route({
      id: "plugins.api",
      prefix: "/api/plugins",
      handle: async ({ req, url, state }) => await handlePluginApi(req, url, state.store),
    }),
  ];
}
