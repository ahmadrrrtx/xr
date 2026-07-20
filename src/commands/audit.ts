/**
 * XR 3.1.5 (Helios) — Audit command
 *
 * Canonical: xr audit [tail|verify|export]
 * Legacy alias: xr verify-log → audit verify
 *
 * Spec: IA §1.2 Audit Entry, §5 CLI site map
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Command, CommandContext } from "../core/command-registry.ts";
import { Tokens } from "../core/tokens.ts";
import { Store } from "../state/workspace-store.ts";
import { buildAuditReport } from "../export/report.ts";
import {
  banner,
  heading,
  ok,
  warn,
  error,
  tip,
  table,
  emit,
  isJsonMode,
  xrCyan,
  xrDim,
  xrGreen,
  xrRed,
  xrBold,
  statusMark,
} from "../cli/output.ts";
import { usageError } from "../cli/errors.ts";

/** 0.2 Storage Unification: Always resolve from container, never create new Store(). */
function resolveStore(ctx: CommandContext): Store {
  return ctx.registry.resolve(Tokens.Store);
}

function parseLimit(args: string[], fallback = 30): number {
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--limit" || args[i] === "-n") && args[i + 1]) {
      const n = Number.parseInt(args[i + 1]!, 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
    if (args[i]?.startsWith("--limit=")) {
      const n = Number.parseInt(args[i]!.slice("--limit=".length), 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return fallback;
}

export class AuditCommand implements Command {
  name = "audit";
  description = "tamper-evident audit log: tail, verify, export";
  usage = "xr audit [tail|verify|export] [--limit n] [--json]";

  async execute(ctx: CommandContext): Promise<void> {
    const store = resolveStore(ctx);
    const sub = (ctx.args[0] ?? "tail").toLowerCase();
    const rest = ctx.args.slice(1);

    switch (sub) {
      case "tail":
      case "list":
      case "ls":
        return this.tail(store, rest);
      case "verify":
      case "check":
      case "status":
        return this.verify(store);
      case "export":
        return this.export(store, rest);
      case "help":
      case "--help":
      case "-h":
        this.printHelp();
        return;
      default:
        // If first arg is a flag, treat as tail
        if (sub.startsWith("-")) {
          return this.tail(store, ctx.args);
        }
        throw usageError(
          `Unknown audit subcommand: ${sub}`,
          "Use: xr audit tail | verify | export",
          ["xr audit --help", "xr shield status"],
        );
    }
  }

  private printHelp(): void {
    banner();
    heading("Audit");
    console.log(`  ${xrCyan("xr audit tail [--limit n]")}   recent entries`);
    console.log(`  ${xrCyan("xr audit verify")}              verify SHA-256 chain`);
    console.log(`  ${xrCyan("xr audit export [path]")}       signed markdown report`);
    console.log();
    tip("Legacy: xr verify-log → xr audit verify");
    console.log();
  }

  private tail(store: Store, args: string[]): void {
    const limit = parseLimit(args, 30);
    const entries = store.recentAudit(limit);
    const chain = store.verifyChain();

    emit(
      {
        ok: true,
        chainValid: chain.valid,
        brokenAt: chain.brokenAt,
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          event: e.event,
          hash: e.hash,
          sessionId: e.session_id ?? null,
          createdAt: e.created_at,
          detail: safeParse(e.detail),
        })),
      },
      () => {
        banner();
        console.log(
          `  ${xrBold("Audit log")}  ${chain.valid ? xrGreen("chain intact ✓") : xrRed("chain BROKEN ✗")}`,
        );
        console.log(`  ${xrDim(`Showing ${entries.length} newest · total ${store.auditCount()}`)}\n`);

        if (!entries.length) {
          console.log(`  ${xrDim("No audit entries yet. Run a task to produce the first record.")}\n`);
          return;
        }

        const rows = entries.map((e) => {
          const t = new Date(e.created_at).toISOString().replace("T", " ").slice(0, 19);
          return [String(e.id), t, e.event, e.hash.slice(0, 12) + "…"];
        });
        table(["id", "time (UTC)", "event", "hash"], rows, {
          widths: [6, 20, 22, 16],
        });
        console.log();
        tip("xr audit verify   ·   xr audit export");
        console.log();
      },
    );
  }

  private verify(store: Store): void {
    const result = store.verifyChain();
    const count = store.auditCount();

    emit(
      {
        ok: result.valid,
        valid: result.valid,
        brokenAt: result.brokenAt ?? null,
        entries: count,
      },
      () => {
        banner();
        if (result.valid) {
          console.log(`  ${statusMark("ok")} ${xrBold(xrGreen("Audit chain intact"))}`);
          console.log(`  ${xrDim(`${count} entries verified · SHA-256 hash chain`)}`);
        } else {
          console.log(`  ${statusMark("error")} ${xrBold(xrRed("Audit chain BROKEN"))}`);
          console.log(
            `  ${xrDim(`Integrity failure at entry id ${result.brokenAt ?? "?"}`)}`,
          );
          console.log(`  ${xrDim("Why")}  A hash link does not match the recomputed value.`);
          console.log(
            `  ${xrDim("Fix")}  Do not trust this log for compliance until investigated.`,
          );
          tip("Export a copy for forensics: xr audit export");
        }
        console.log();
      },
    );

    if (!result.valid) {
      process.exitCode = 1;
    }
  }

  private export(store: Store, args: string[]): void {
    const limit = parseLimit(args, 500);
    const outPath =
      args.find((a) => !a.startsWith("-") && a !== "export") ??
      join(process.cwd(), `xr-audit-${Date.now()}.md`);

    const chain = store.verifyChain();
    const entries = store.recentAudit(limit).map((e) => ({
      event: e.event,
      detail: e.detail,
      hash: e.hash,
      created_at: e.created_at,
    }));

    const report = buildAuditReport({
      project: process.cwd(),
      chainValid: chain.valid,
      entries,
    });

    writeFileSync(outPath, report.markdown, "utf8");

    emit(
      {
        ok: true,
        path: outPath,
        sha256: report.sha256,
        chainValid: chain.valid,
        entries: entries.length,
      },
      () => {
        ok(`Exported signed audit report`, outPath);
        console.log(`  ${xrDim("sha256")}  ${report.sha256}`);
        console.log(
          `  ${xrDim("chain")}   ${chain.valid ? xrGreen("intact") : xrRed("broken")}`,
        );
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
