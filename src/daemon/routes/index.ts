/** XR Daemon — route group composition. */

import { agentsRoutes } from "./agents.routes.ts";
import { budgetRoutes } from "./budget.routes.ts";
import { chatRoutes } from "./chat.routes.ts";
import { capabilityRoutes } from "./capabilities.routes.ts";
import { controlRoutes } from "./control.routes.ts";
import { environmentRoutes } from "./environment.routes.ts";
import { extensionRoutes } from "./extensions.routes.ts";
import { memoryRoutes } from "./memory.routes.ts";
import { contextRoutes } from "./context.routes.ts";
import { providersRoutes } from "./providers.routes.ts";
import { shieldRoutes } from "./shield.routes.ts";
import { systemRoutes } from "./system.routes.ts";
import { trustRoutes } from "./trust.routes.ts";
import { createDaemonRouter, type DaemonRouteHandler } from "./router.ts";

export function createRouteHandler(): DaemonRouteHandler {
  return createDaemonRouter([
    ...systemRoutes(),
    ...chatRoutes(),
    ...agentsRoutes(),
    ...budgetRoutes(),
    ...shieldRoutes(),
    ...trustRoutes(),
    ...capabilityRoutes(),
    ...providersRoutes(),
    ...extensionRoutes(),
    ...controlRoutes(),
    ...environmentRoutes(),
    ...memoryRoutes(),
    ...contextRoutes(),
  ], ({ json }) => json({ error: "not found" }, 404));
}

export * from "./router.ts";
