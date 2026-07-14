/**
 * XR 3.1C — Config Command
 *
 * xr config [get|set|path|reset]
 * Spec: IA settings architecture
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { ConfigService } from "../services/config-service.ts";
import {
  banner,
  heading,
  ok,
  emit,
  tip,
  xrCyan,
  xrDim,
  xrBold,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".").filter(Boolean);
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function parseValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export class ConfigCommand implements Command {
  name = "config";
  description = "view or update configuration";
  usage = "xr config [get|set|path|reset] [key] [value]";

  async execute(ctx: CommandContext): Promise<void> {
    const configService = ctx.container.resolve<ConfigService>("config");
    const sub = ctx.args[0];

    if (!sub || sub === "show" || sub === "list" || sub === "dump") {
      const cfg = configService.get();
      const path = configService.getPath();
      emit(
        { ok: true, path, config: cfg },
        () => {
          banner();
          console.log(`${xrBold("Config path:")} ${xrDim(path)}\n`);
          console.log(JSON.stringify(cfg, null, 2));
          console.log();
          tip("xr config get defaults.provider  ·  xr config path");
        },
      );
      return;
    }

    if (sub === "path") {
      const path = configService.getPath();
      emit({ ok: true, path }, () => {
        console.log(path);
      });
      return;
    }

    if (sub === "get") {
      const key = ctx.args[1];
      if (!key) throw usageError("Key required", "xr config get <dotted.key>", ["xr config"]);
      const cfg = configService.get();
      const value = getByPath(cfg, key);
      emit(
        { ok: true, key, value: value ?? null },
        () => {
          if (value === undefined) {
            console.log(xrDim(`(unset) ${key}`));
          } else if (typeof value === "object") {
            console.log(JSON.stringify(value, null, 2));
          } else {
            console.log(String(value));
          }
        },
      );
      return;
    }

    if (sub === "set") {
      const key = ctx.args[1];
      const raw = ctx.args.slice(2).join(" ");
      if (!key || !raw) {
        throw usageError(
          "Key and value required",
          "xr config set <dotted.key> <value>",
          ["xr config get defaults.provider"],
        );
      }
      const value = parseValue(raw);
      const current = structuredClone(configService.get()) as Record<string, unknown>;
      setByPath(current, key, value);
      const { saveConfig } = await import("../config/config.ts");
      saveConfig(current as never);
      // Refresh service in-memory view when possible
      if (typeof (configService as unknown as { update?: (p: unknown) => Promise<void> }).update === "function") {
        try {
          await (configService as unknown as { update: (p: unknown) => Promise<void> }).update(current);
        } catch {
          /* saveConfig already persisted */
        }
      }
      emit({ ok: true, key, value }, () => {
        ok(`Set ${key}`);
      });
      return;
    }

    if (sub === "reset") {
      tip("For a full reset with backups use: xr reset");
      tip("Or delete the config file shown by: xr config path");
      return;
    }

    if (sub === "help" || sub === "--help" || sub === "-h") {
      banner();
      heading("Config");
      console.log(`  ${xrCyan("xr config")}                    print full config`);
      console.log(`  ${xrCyan("xr config path")}               config file path`);
      console.log(`  ${xrCyan("xr config get <key>")}          read dotted key`);
      console.log(`  ${xrCyan("xr config set <key> <value>")}  write dotted key`);
      console.log();
      return;
    }

    // Unknown sub — if it looks like a key, treat as get
    if (!sub.startsWith("-") && sub.includes(".")) {
      ctx.args = ["get", sub];
      return this.execute(ctx);
    }

    throw usageError(
      `Unknown config subcommand: ${sub}`,
      "xr config [get|set|path]",
      ["xr config --help"],
    );
  }
}
