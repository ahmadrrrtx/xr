/** XR Daemon — route group composition. */

import { agentsRoutes } from "./agents.routes.ts";
import { budgetRoutes } from "./budget.routes.ts";
import { chatRoutes } from "./chat.routes.ts";
import { controlRoutes } from "./control.routes.ts";
import { extensionRoutes } from "./extensions.routes.ts";
import { memoryRoutes } from "./memory.routes.ts";
import { providersRoutes } from "./providers.routes.ts";
import { shieldRoutes } from "./shield.routes.ts";
import { systemRoutes } from "./system.routes.ts";
import { createDaemonRouter, type DaemonRouteHandler } from "./router.ts";

export function createRouteHandler(): DaemonRouteHandler {
  return createDaemonRouter([
    ...systemRoutes(),
    ...chatRoutes(),
    ...agentsRoutes(),
    ...budgetRoutes(),
    ...shieldRoutes(),
    ...providersRoutes(),
    ...extensionRoutes(),
    ...controlRoutes(),
    ...memoryRoutes(),
  ], ({ json }) => json({ error: "not found" }, 404));
}

export * from "./router.ts";
