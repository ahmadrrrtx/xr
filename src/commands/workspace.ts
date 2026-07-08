/**
 * XR 3.0 — Workspace Command
 * Implements Phase 7: Workspace management via CLI.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { XRKernel } from "../core/kernel.ts";
import { colors as C, ok, error } from "../interfaces/cli.ts";

export class WorkspaceCommand implements Command {
  name = "workspace";
  description = "manage development and isolated team workspaces";
  usage = "workspace [list|create|use|delete] [arguments]";

  async execute(ctx: CommandContext): Promise<void> {
    const { container, args } = ctx;
    const kernel = container.resolve<XRKernel>("kernel");
    const wm = kernel.workspaces;

    const action = args[0] ?? "list";

    switch (action) {
      case "list": {
        const list = wm.listWorkspaces();
        const activeId = wm.getActiveId();
        console.log(`\n  ${C.bold("Workspaces")}`);
        console.log(`  ${C.dim("─".repeat(40))}`);
        for (const ws of list) {
          const activeMarker = ws.id === activeId ? C.green("● (active)") : C.dim("○");
          console.log(`  ${activeMarker} ${C.bold(ws.id)} - ${C.dim(ws.name)}`);
        }
        console.log();
        break;
      }

      case "create": {
        const id = args[1];
        const name = args[2] ?? id;
        if (!id) {
          error("Usage: xr workspace create <id> [name]");
          return;
        }
        wm.ensureWorkspace(id, name);
        ok(`Workspace "${id}" successfully created.`);
        break;
      }

      case "use": {
        const id = args[1];
        if (!id) {
          error("Usage: xr workspace use <id>");
          return;
        }
        const workspaces = wm.listWorkspaces();
        if (!workspaces.some(w => w.id === id)) {
          error(`Workspace "${id}" does not exist. Use "xr workspace create ${id}" first.`);
          return;
        }
        await kernel.switchWorkspace(id);
        ok(`Switched to workspace "${id}".`);
        break;
      }

      case "delete": {
        const id = args[1];
        if (!id) {
          error("Usage: xr workspace delete <id>");
          return;
        }
        if (id === "default") {
          error("Cannot delete the default workspace.");
          return;
        }
        const success = wm.deleteWorkspace(id);
        if (success) {
          ok(`Workspace "${id}" successfully deleted.`);
        } else {
          error(`Failed to delete workspace "${id}". It might not exist.`);
        }
        break;
      }

      default: {
        error(`Unknown action: ${action}`);
        console.log(`Usage:\n  xr workspace list\n  xr workspace create <id> [name]\n  xr workspace use <id>\n  xr workspace delete <id>`);
      }
    }
  }
}
