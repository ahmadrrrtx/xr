/**
 * XR 3.1C — Session command
 *
 * xr session list|show|export
 * Spec: IA §1.2 Session, §5 CLI site map
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Store } from "../state/db.ts";
import {
  banner,
  heading,
  ok,
  empty,
  table,
  emit,
  tip,
  xrCyan,
  xrDim,
  xrBold,
  xrGreen,
  xrAmber,
  xrRed,
} from "../cli/output.ts";
import { usageError, notFoundError } from "../cli/errors.ts";

function resolveStore(ctx: CommandContext): Store {
  try {
    return ctx.container.resolve<Store>("legacyStore");
  } catch {
    return new Store();
  }
}

function statusPaint(status: string): string {
  if (status === "done") return xrGreen(status);
  if (status === "running") return xrCyan(status);
  if (status === "error") return xrRed(status);
  if (status === "stopped" || status === "paused") return xrAmber(status);
  return xrDim(status);
}

export class SessionCommand implements Command {
  name = "session";
  description = "list, inspect, or export past sessions";
  usage = "xr session [list|show|export] [id] [--limit n] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const store = resolveStore(ctx);
    const sub = (ctx.args[0] ?? "list").toLowerCase();
    const rest = ctx.args.slice(1);

    switch (sub) {
      case "list":
      case "ls":
        return this.list(store, rest);
      case "show":
      case "get":
      case "inspect":
      case "view":
        return this.show(store, rest);
      case "export":
        return this.export(store, rest);
      case "help":
      case "--help":
      case "-h":
        this.printHelp();
        return;
      default:
        // session <id> → show
        if (!sub.startsWith("-")) {
          return this.show(store, [sub, ...rest]);
        }
        return this.list(store, ctx.args);
    }
  }

  private printHelp(): void {
    banner();
    heading("Sessions");
    console.log(`  ${xrCyan("xr session list [--limit n]")}`);
    console.log(`  ${xrCyan("xr session show <id>")}`);
    console.log(`  ${xrCyan("xr session export <id> [path]")}`);
    console.log();
  }

  private list(store: Store, args: string[]): void {
    let limit = 20;
    for (let i = 0; i < args.length; i++) {
      if ((args[i] === "--limit" || args[i] === "-n") && args[i + 1]) {
        limit = Number.parseInt(args[++i]!, 10) || 20;
      }
    }
    const sessions = store.recentSessions(limit);

    emit(
      {
        ok: true,
        count: sessions.length,
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          mode: s.mode,
          status: s.status,
          createdAt: s.created_at,
        })),
      },
      () => {
        banner();
        heading(`Sessions (${sessions.length})`);
        if (!sessions.length) {
          empty("sessions", 'Ask XR something to start one: xr "hello"');
          return;
        }
        const rows = sessions.map((s) => {
          const t = new Date(s.created_at).toISOString().slice(0, 10);
          return [
            s.id.slice(0, 12),
            (s.title || "untitled").slice(0, 28),
            s.mode,
            statusPaint(s.status),
            t,
          ];
        });
        table(["id", "title", "mode", "status", "date"], rows, {
          widths: [14, 30, 8, 10, 12],
        });
        console.log();
        tip("xr session show <id>   ·   xr session export <id>");
        console.log();
      },
    );
  }

  private show(store: Store, args: string[]): void {
    const id = args.find((a) => !a.startsWith("-"));
    if (!id) {
      throw usageError("Session id required", "xr session show <id>", ["xr session list"]);
    }
    const session = store.getSession(id);
    if (!session) {
      // try prefix match
      const all = store.recentSessions(100);
      const match = all.find((s) => s.id === id || s.id.startsWith(id));
      if (!match) throw notFoundError("Session", id, ["xr session list"]);
      return this.show(store, [match.id]);
    }

    const steps = store.sessionSteps(session.id);

    emit(
      {
        ok: true,
        session: {
          id: session.id,
          title: session.title,
          mode: session.mode,
          status: session.status,
          createdAt: session.created_at,
        },
        steps: steps.map((st) => ({
          idx: st.idx,
          phase: st.phase,
          tool: st.tool,
          createdAt: st.created_at,
          detail: safeParse(st.detail),
        })),
      },
      () => {
        banner();
        console.log(`  ${xrBold(session.title || session.id)}`);
        console.log(
          `  ${xrDim("id")} ${session.id}  ${xrDim("mode")} ${session.mode}  ${xrDim("status")} ${statusPaint(session.status)}`,
        );
        console.log(
          `  ${xrDim("created")} ${new Date(session.created_at).toISOString()}\n`,
        );
        if (!steps.length) {
          console.log(`  ${xrDim("No recorded steps.")}\n`);
          return;
        }
        heading(`Steps (${steps.length})`);
        for (const st of steps.slice(0, 50)) {
          const tool = st.tool ? xrCyan(st.tool) : xrDim(st.phase);
          console.log(`  ${xrDim(String(st.idx).padStart(3))}  ${tool}`);
        }
        if (steps.length > 50) console.log(`  ${xrDim(`… ${steps.length - 50} more`)}`);
        console.log();
      },
    );
  }

  private export(store: Store, args: string[]): void {
    const id = args.find((a) => !a.startsWith("-"));
    if (!id) {
      throw usageError("Session id required", "xr session export <id> [path]", [
        "xr session list",
      ]);
    }
    let session = store.getSession(id);
    if (!session) {
      const match = store.recentSessions(100).find((s) => s.id.startsWith(id));
      if (!match) throw notFoundError("Session", id, ["xr session list"]);
      session = match;
    }
    const steps = store.sessionSteps(session.id);
    const outPath =
      args.filter((a) => !a.startsWith("-") && a !== id)[0] ??
      join(process.cwd(), `xr-session-${session.id.slice(0, 8)}.md`);

    const lines: string[] = [
      `# Session: ${session.title || session.id}`,
      "",
      `- **id:** ${session.id}`,
      `- **mode:** ${session.mode}`,
      `- **status:** ${session.status}`,
      `- **created:** ${new Date(session.created_at).toISOString()}`,
      "",
      "## Steps",
      "",
    ];
    for (const st of steps) {
      lines.push(`### ${st.idx}. ${st.phase}${st.tool ? ` · ${st.tool}` : ""}`);
      lines.push("");
      lines.push("```json");
      lines.push(typeof st.detail === "string" ? st.detail : JSON.stringify(st.detail, null, 2));
      lines.push("```");
      lines.push("");
    }

    writeFileSync(outPath, lines.join("\n"), "utf8");

    emit(
      { ok: true, path: outPath, sessionId: session.id, steps: steps.length },
      () => {
        ok(`Exported session`, outPath);
        console.log();
      },
    );
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
