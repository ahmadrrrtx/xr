/**
 * XR 3.1C — Workspace Command
 * list | create | use/switch | delete
 * Spec: IA §1.2 Workspace, Navigation workspace switching
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { XRKernel } from "../core/kernel.ts";
import {
  banner,
  heading,
  ok,
  error,
  emit,
  tip,
  xrCyan,
  xrDim,
  xrBold,
  xrGreen,
  icon,
} from "../cli/output.ts";
import { usageError, notFoundError } from "../cli/errors.ts";

export class WorkspaceCommand implements Command {
  name = "workspace";
  description = "manage development and isolated team workspaces";
  usage = "xr workspace [list|create|use|switch|delete] [arguments]";

  async execute(ctx: CommandContext): Promise<void> {
    const { container, args } = ctx;
    const kernel = container.resolve<XRKernel>("kernel");
    const wm = kernel.workspaces;

    const action = (args[0] ?? "list").toLowerCase();

    switch (action) {
      case "list":
      case "ls": {
        const list = wm.listWorkspaces();
        const activeId = wm.getActiveId();
        emit(
          {
            ok: true,
            active: activeId,
            workspaces: list.map((ws) => ({
              id: ws.id,
              name: ws.name,
              active: ws.id === activeId,
            })),
          },
          () => {
            banner();
            console.log(`  ${icon("workspaces", "cyan")}  ${xrBold("Workspaces")}`);
            console.log(`  ${xrDim("─".repeat(40))}`);
            for (const ws of list) {
              const activeMarker =
                ws.id === activeId ? xrGreen("● active") : xrDim("○");
              console.log(`  ${activeMarker}  ${xrBold(ws.id)}  ${xrDim(ws.name)}`);
            }
            console.log();
            tip("xr workspace create <id> [name]  ·  xr workspace use <id>");
            console.log();
          },
        );
        break;
      }

      case "create": {
        const id = args[1];
        const name = args[2] ?? id;
        if (!id) {
          throw usageError(
            "Workspace id required",
            "xr workspace create <id> [name]",
            ["xr workspace list"],
          );
        }
        wm.ensureWorkspace(id, name);
        emit({ ok: true, id, name }, () => {
          ok(`Workspace "${id}" created.`);
        });
        break;
      }

      case "use":
      case "switch":
      case "select": {
        const id = args[1];
        if (!id) {
          throw usageError(
            "Workspace id required",
            "xr workspace use <id>",
            ["xr workspace list"],
          );
        }
        const workspaces = wm.listWorkspaces();
        if (!workspaces.some((w) => w.id === id)) {
          throw notFoundError("Workspace", id, [
            `xr workspace create ${id}`,
            "xr workspace list",
          ]);
        }
        await kernel.switchWorkspace(id);
        emit({ ok: true, active: id }, () => {
          ok(`Switched to workspace "${id}".`);
        });
        break;
      }

      case "delete":
      case "rm":
      case "remove": {
        const id = args[1];
        if (!id) {
          throw usageError(
            "Workspace id required",
            "xr workspace delete <id>",
            ["xr workspace list"],
          );
        }
        if (id === "default") {
          error('Cannot delete the default workspace.');
          process.exitCode = 4;
          return;
        }
        const success = wm.deleteWorkspace(id);
        if (success) {
          emit({ ok: true, deleted: id }, () => {
            ok(`Workspace "${id}" deleted.`);
          });
        } else {
          throw notFoundError("Workspace", id, ["xr workspace list"]);
        }
        break;
      }

      case "help":
      case "--help":
      case "-h": {
        banner();
        heading("Workspaces");
        console.log(`  ${xrCyan("xr workspace list")}`);
        console.log(`  ${xrCyan("xr workspace create <id> [name]")}`);
        console.log(`  ${xrCyan("xr workspace use <id>")}      ${xrDim("(alias: switch)")}`);
        console.log(`  ${xrCyan("xr workspace delete <id>")}`);
        console.log();
        break;
      }

      default: {
        throw usageError(
          `Unknown action: ${action}`,
          "xr workspace list|create|use|delete",
          ["xr workspace --help"],
        );
      }
    }
  }
}
