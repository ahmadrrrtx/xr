/**
 * XR Phase 9 — `xr triggers` (governed proactivity).
 *
 * Creating a trigger requires explicit consent + a budget declaration.
 * `pause-all` is the kill switch (config + audit); in-flight fires keep
 * their own cancel path.
 */
import { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { TriggerService } from "../automation/triggers.ts";
import { emit, ok, banner, xrBold, xrDim, xrCyan, xrAmber, xrRed, xrGreen, tip } from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";
import type { TriggerInput, TriggerKind } from "../automation/trigger-spec.ts";

export class TriggersCommand implements Command {
  name = "triggers";
  description = "governed trigger table — list, create, pause-all";
  usage = "xr triggers [list|status|create|pause-all|resume-all|enable|disable|delete] …";

  async execute(ctx: CommandContext): Promise<void> {
    const store = ctx.registry.resolve(Tokens.Store);
    const svc = new TriggerService(store);
    const args = ctx.args.filter((a) => a !== "--json");
    const sub = args.find((a) => !a.startsWith("-")) ?? "status";

    if (sub === "help" || sub === "--help" || sub === "-h") {
      console.log(this.usage);
      return;
    }

    if (sub === "pause-all") {
      svc.pauseAll("cli");
      emit({ ok: true, pauseAll: true }, () => ok("Triggers paused. New fires will not start. In-flight runs continue."));
      return;
    }

    if (sub === "resume-all") {
      svc.resumeAll("cli");
      emit({ ok: true, pauseAll: false }, () => ok("Triggers resumed."));
      return;
    }

    if (sub === "status" || sub === "list" || sub === "show") {
      const paused = svc.isPausedAll();
      const rows = svc.list();
      emit(
        { ok: true, pauseAll: paused, inflight: svc.inflightCount(), triggers: rows },
        () => {
          banner();
          console.log(`  ${xrBold("Triggers")}  ${paused ? xrRed("PAUSED") : xrGreen("armed")}`);
          console.log(`  ${xrDim("─".repeat(40))}`);
          console.log(`  pause-all ........ ${paused ? xrAmber("true") : xrDim("false")}`);
          console.log(`  in-flight ........ ${svc.inflightCount()}`);
          console.log(`  count ............ ${rows.length}`);
          for (const t of rows) {
            const due = t.kind === "cron" && t.spec.kind === "cron" ? (t.spec.expr ?? t.spec.nl) : t.kind;
            const on = t.enabled ? xrGreen("on") : xrDim("off");
            console.log(`  ${on}  ${xrCyan(t.id)}  ${t.kind}  ${xrDim(String(due))}  spent $${t.spentUsd.toFixed(4)}`);
          }
          if (!rows.length) console.log(`  ${xrDim("(none — create with xr triggers create …)")}`);
          console.log();
          tip('Kill switch: xr triggers pause-all');
        },
      );
      return;
    }

    if (sub === "enable" || sub === "disable") {
      const id = args.find((a, i) => i > args.indexOf(sub) && !a.startsWith("-"));
      if (!id) throw usageError("Trigger id required", `xr triggers ${sub} <id>`);
      const okSet = svc.setEnabled(id, sub === "enable");
      if (!okSet) throw usageError(`Unknown trigger: ${id}`, "xr triggers list");
      emit({ ok: true, id, enabled: sub === "enable" }, () => ok(`${id} ${sub}d`));
      return;
    }

    if (sub === "delete" || sub === "rm") {
      const id = args.find((a, i) => i > args.indexOf(sub) && !a.startsWith("-"));
      if (!id) throw usageError("Trigger id required", "xr triggers delete <id>");
      const okDel = svc.delete(id);
      if (!okDel) throw usageError(`Unknown trigger: ${id}`, "xr triggers list");
      emit({ ok: true, id, deleted: true }, () => ok(`deleted ${id}`));
      return;
    }

    if (sub === "create") {
      const kind = (flag(args, "--kind") ?? "cron") as TriggerKind;
      const expr = flag(args, "--expr");
      const nl = flag(args, "--nl");
      const event = flag(args, "--event");
      const path = flag(args, "--path");
      const task = flag(args, "--task") ?? restTask(args);
      const consent = flag(args, "--consent");
      const budgetUsd = num(flag(args, "--budget-usd"));
      const budgetTokens = num(flag(args, "--budget-tokens"));
      const approvalMode = (flag(args, "--approval") ?? "inherit") as "inherit" | "require";
      const quiet = flag(args, "--quiet");
      const id = flag(args, "--id");
      if (!consent) {
        throw usageError(
          "creating a trigger requires explicit consent (--consent <ref>)",
          'xr triggers create --kind cron --expr "0 9 * * *" --task "audit" --budget-usd 0.10 --consent cli:user',
        );
      }
      if (!task) throw usageError("task template required (--task)", this.usage);
      const spec =
        kind === "cron"
          ? { kind: "cron" as const, expr: expr ?? undefined, nl: nl ?? undefined }
          : kind === "event"
            ? { kind: "event" as const, event: event ?? "session.done" }
            : { kind: "watch" as const, path: path ?? "" };
      const input: TriggerInput = {
        id: id ?? undefined,
        kind,
        spec,
        taskTemplate: task,
        budget: { maxUsd: budgetUsd, maxTokens: budgetTokens },
        approvalMode,
        consentRef: consent,
        quietHours: parseQuiet(quiet),
      };
      const created = svc.create(input);
      emit({ ok: true, trigger: created }, () => ok(`created ${created.id} (${created.kind})`));
      return;
    }

    throw usageError(
      `Unknown triggers command: ${sub}`,
      "Use list, create, pause-all, resume-all, enable, disable, or delete.",
      ["xr triggers", "xr triggers pause-all"],
    );
  }
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith("-") ? v : undefined;
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function restTask(args: string[]): string {
  const i = args.indexOf("create");
  const parts: string[] = [];
  for (let k = i + 1; k < args.length; k++) {
    if (args[k]!.startsWith("--")) {
      k++;
      continue;
    }
    parts.push(args[k]!);
  }
  return parts.join(" ").trim();
}

function parseQuiet(s: string | undefined): { start: string; end: string } | undefined {
  if (!s) return undefined;
  const [start, end] = s.split("-");
  if (!start || !end) return undefined;
  return { start: start.trim(), end: end.trim() };
}

