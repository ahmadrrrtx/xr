/**
 * XR 3.1C — Logs command
 *
 * Surfaces recent audit/runtime activity in a CLI-friendly form.
 * Spec: IA CLI site map — xr logs
 */

import type { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/db.ts";
import {
  banner,
  heading,
  table,
  emit,
  tip,
  xrDim,
  xrCyan,
} from "../cli/output.ts";

function resolveStore(ctx: CommandContext): Store {
  try {
    return ctx.container.resolve<Store>("legacyStore");
  } catch {
    return new Store();
  }
}

export class LogsCommand implements Command {
  name = "logs";
  description = "show recent XR runtime / audit activity";
  usage = "xr logs [--limit n] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const store = resolveStore(ctx);
    let limit = 40;
    for (let i = 0; i < ctx.args.length; i++) {
      if ((ctx.args[i] === "--limit" || ctx.args[i] === "-n") && ctx.args[i + 1]) {
        limit = Number.parseInt(ctx.args[++i]!, 10) || 40;
      }
    }

    const entries = store.recentAudit(limit);

    emit(
      {
        ok: true,
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          event: e.event,
          createdAt: e.created_at,
          sessionId: e.session_id ?? null,
          hash: e.hash,
        })),
      },
      () => {
        banner();
        heading(`Recent activity (${entries.length})`);
        if (!entries.length) {
          console.log(`  ${xrDim("No activity recorded yet.")}\n`);
          return;
        }
        const rows = entries.map((e) => {
          const t = new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19);
          return [t, e.event, (e.session_id ?? "—").toString().slice(0, 10)];
        });
        table(["time (UTC)", "event", "session"], rows, {
          widths: [20, 28, 12],
        });
        console.log();
        tip(`${xrCyan("xr audit verify")} · ${xrCyan("xr audit export")}`);
        console.log();
      },
    );
  }
}
