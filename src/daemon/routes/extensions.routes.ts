/** XR Daemon — skills and plugin API adapters. */

import { handlePluginApi } from "../plugin-api.ts";
import { handleSkillsApi } from "../skills-api.ts";
import { route, type DaemonRoute } from "./router.ts";

/**
 * Skills/plugins adapters are prefix routes on the CANONICAL path space
 * (`/api/skills`, `/api/plugins`). The router hands them `ctx.path`, which
 * the mount layer has already canonicalized, so a `/api/v1/...` request and
 * its legacy `/api/...` twin reach the adapters identically. Passing
 * `url.pathname` here (the pre-Phase-02 behaviour) leaked the transport
 * prefix into the adapters and 404'd every versioned request.
 */
export function extensionRoutes(): DaemonRoute[] {
  return [
    route({
      id: "skills.api",
      prefix: "/api/skills",
      handle: async ({ req, url, path }) => await handleSkillsApi(req, url, path),
    }),
    route({
      id: "plugins.api",
      prefix: "/api/plugins",
      handle: async ({ req, url, path, state }) => await handlePluginApi(req, url, path, state.store),
    }),
  ];
}
