/**
 * XR Phase 1 · T10 — `xr uninstall`.
 *
 *   xr uninstall [--keep-data] [--yes]   remove launcher + installation, keep data
 *   xr uninstall --purge [--yes]          additionally remove all local data
 */
import { Command } from "../core/command-registry.ts";
import { uninstallXR } from "../install/uninstall.ts";

export class UninstallCommand implements Command {
  name = "uninstall";
  description = "remove XR: launcher + installation (--purge also removes all local data)";
  usage = "xr uninstall [--keep-data|--purge] [--yes]";
  async execute(_ctx: unknown): Promise<void> {
    await uninstallXR((_ctx as { args: string[] }).args ?? []);
  }
}
