/**
 * XR Stage 12 — Multi-agent CLI commands.
 */

import { Command, CommandContext } from "../core/command-registry.ts";
import { MultiAgentService } from "../services/multi-agent-service.ts";
import { banner, colors as C, info, ok, warn } from "../interfaces/cli.ts";
import type { WorkflowKind } from "../agents/types.ts";
import { renderWorkflowPlan } from "../agents/planner.ts";

function fmtTs(ts?: number): string {
  return ts ? new Date(ts).toISOString() : "—";
}

function parseFlags(args: string[]): {
  positionals: string[];
  provider?: string;
  model?: string;
  kind?: WorkflowKind;
  dryRun?: boolean;
  json?: boolean;
  budget?: number;
  maxSteps?: number;
  maxTokens?: number;
} {
  const out: any = { positionals: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--provider") out.provider = args[++i];
    else if (a === "--model") out.model = args[++i];
    else if (a === "--kind") out.kind = args[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--json") out.json = true;
    else if (a === "--budget") out.budget = Number(args[++i]);
    else if (a === "--max-steps") out.maxSteps = Number(args[++i]);
    else if (a === "--max-tokens") out.maxTokens = Number(args[++i]);
    else out.positionals.push(a);
  }
  return out;
}

function printHelp(): void {
  banner("Multi-Agent System");
  console.log(C.bold("Usage"));
  console.log("  xr agents list");
  console.log("  xr agents status [workflowId]");
  console.log("  xr agents inspect <agentId|workflowId>");
  console.log('  xr agents plan "your task" [--kind research|build|refactor|security|automation|business]');
  console.log('  xr agents run "your task" [--provider id] [--model name] [--dry-run]');
  console.log("  xr agents delegate <workflowId> <agentId> <instruction>");
  console.log("  xr agents review <workflowId>");
  console.log("  xr agents synthesize <workflowId>");
  console.log("  xr agents stop <workflowId>");
  console.log("  xr agents resume <workflowId>");
}

function printWorkflowSummaryLine(row: any): void {
  const parts = [
    row.workflowId,
    row.kind,
    row.status,
    `${row.tasksCompleted}/${row.tasksTotal}`,
    row.currentAgentId ?? "—",
    row.goal.slice(0, 64),
  ];
  console.log(`  ${parts[0].padEnd(14)} ${parts[1].padEnd(11)} ${parts[2].padEnd(16)} ${parts[3].padEnd(7)} ${parts[4].padEnd(18)} ${parts[5]}`);
}

export class AgentsCommand implements Command {
  name = "agents";
  description = "inspect and run XR's multi-agent supervisor runtime";
  usage = "xr agents [list|status|plan|run|delegate|review|synthesize|stop|resume|inspect]";

  async execute(ctx: CommandContext): Promise<void> {
    const svc = ctx.container.resolve<MultiAgentService>("multiAgents");
    const sub = ctx.args[0] ?? "help";
    const rest = ctx.args.slice(1);
    const flags = parseFlags(rest);

    if (["help", "-h", "--help"].includes(sub)) {
      printHelp();
      return;
    }

    if (sub === "list") {
      const agents = svc.listAgents(true);
      banner("Built-in Agents");
      for (const agent of agents) {
        console.log(`\n${C.bold(agent.id)} ${agent.enabledByDefault ? C.green("[enabled]") : C.dim("[optional]")}`);
        console.log(`  role ......... ${agent.role}`);
        console.log(`  tools ........ ${agent.toolScope.tools.join(", ") || "(none)"}`);
        console.log(`  memory ....... ${agent.memoryScope.kind} (${agent.memoryScope.maxEntries})`);
        console.log(`  caps ......... ${agent.capabilities.join(", ")}`);
      }
      return;
    }

    if (sub === "status") {
      if (!flags.positionals.length) {
        banner("Workflow Status");
        const rows = svc.listWorkflows(20);
        if (!rows.length) {
          info("No multi-agent workflows yet.");
          return;
        }
        console.log(`  ${"workflow".padEnd(14)} ${"kind".padEnd(11)} ${"status".padEnd(16)} ${"done".padEnd(7)} ${"current-agent".padEnd(18)} goal`);
        for (const row of rows) printWorkflowSummaryLine(row);
        return;
      }
      const workflowId = flags.positionals[0];
      const record = svc.getWorkflow(workflowId);
      if (!record) throw new Error(`Unknown workflow: ${workflowId}`);
      banner(`Workflow ${workflowId}`);
      console.log(`status ......... ${record.status}`);
      console.log(`kind ........... ${record.kind}`);
      console.log(`goal ........... ${record.goal}`);
      console.log(`current agent .. ${record.currentAgentId ?? "—"}`);
      console.log(`created ........ ${fmtTs(record.createdAt)}`);
      console.log(`updated ........ ${fmtTs(record.updatedAt)}`);
      console.log(`plan ........... ${record.planSummary}`);
      console.log(`\n${C.bold("Tasks")}`);
      for (const task of record.tasks) {
        console.log(`  ${task.taskId}  ${task.status.padEnd(16)} ${task.agentId.padEnd(18)} ${task.name}`);
        if (task.blockedReason) console.log(`    blocked: ${task.blockedReason}`);
      }
      if (record.finalOutput?.summary) {
        console.log(`\n${C.bold("Final output")}`);
        console.log(record.finalOutput.summary);
      }
      return;
    }

    if (sub === "inspect") {
      const id = flags.positionals[0];
      if (!id) throw new Error("Usage: xr agents inspect <agentId|workflowId>");
      const agent = svc.inspectAgent(id);
      if (agent) {
        console.log(JSON.stringify(agent, null, 2));
        return;
      }
      const workflow = svc.getWorkflow(id);
      if (!workflow) throw new Error(`Unknown agent or workflow: ${id}`);
      console.log(JSON.stringify(workflow, null, 2));
      return;
    }

    if (sub === "plan") {
      const goal = flags.positionals.join(" ").trim();
      if (!goal) throw new Error('Usage: xr agents plan "your task"');
      const record = svc.planWorkflow({
        goal,
        cwd: ctx.cwd,
        kind: flags.kind,
        provider: flags.provider,
        model: flags.model,
        dryRun: flags.dryRun,
      });
      if (flags.json) console.log(JSON.stringify(record, null, 2));
      else {
        banner(`Workflow Plan ${record.workflowId}`);
        console.log(renderWorkflowPlan(record));
      }
      return;
    }

    if (sub === "run") {
      const goal = flags.positionals.join(" ").trim();
      if (!goal) throw new Error('Usage: xr agents run "your task"');
      banner("Running Multi-Agent Workflow");
      const record = await svc.runWorkflow({
        goal,
        cwd: ctx.cwd,
        kind: flags.kind,
        provider: flags.provider,
        model: flags.model,
        dryRun: flags.dryRun,
        budget: flags.budget,
        maxSteps: flags.maxSteps,
        maxTokens: flags.maxTokens,
      });
      console.log(`workflow ...... ${record.workflowId}`);
      console.log(`status ........ ${record.status}`);
      console.log(`kind .......... ${record.kind}`);
      if (record.finalOutput?.summary) {
        console.log(`\n${C.bold("Final output")}`);
        console.log(record.finalOutput.summary);
      } else {
        warn(`Workflow ended without a final synthesis. Inspect with: xr agents status ${record.workflowId}`);
      }
      return;
    }

    if (sub === "delegate") {
      const [workflowId, agentId, ...restWords] = flags.positionals;
      const instruction = restWords.join(" ").trim();
      if (!workflowId || !agentId || !instruction) {
        throw new Error("Usage: xr agents delegate <workflowId> <agentId> <instruction>");
      }
      const record = await svc.delegateTask(workflowId, agentId, instruction);
      ok(`Delegated to ${agentId} in ${record.workflowId}`);
      return;
    }

    if (sub === "review") {
      const workflowId = flags.positionals[0];
      if (!workflowId) throw new Error("Usage: xr agents review <workflowId>");
      banner(`Review Status ${workflowId}`);
      const rows = svc.reviewStatus(workflowId);
      if (!rows.length) {
        info("No reviewer/security-checker tasks in this workflow.");
        return;
      }
      for (const row of rows) {
        console.log(`\n${C.bold(row.taskId)} ${row.agentId} ${row.status} ${C.dim(`review=${row.reviewState}`)}`);
        console.log(`  ${row.name}`);
        if (row.blockedReason) console.log(`  blocked: ${row.blockedReason}`);
        if (row.outputs?.summary) console.log(`  ${row.outputs.summary}`);
      }
      return;
    }

    if (sub === "synthesize") {
      const workflowId = flags.positionals[0];
      if (!workflowId) throw new Error("Usage: xr agents synthesize <workflowId>");
      const record = await svc.synthesizeWorkflow(workflowId);
      if (record.finalOutput?.summary) console.log(record.finalOutput.summary);
      else warn("No synthesis available yet.");
      return;
    }

    if (sub === "stop") {
      const workflowId = flags.positionals[0];
      if (!workflowId) throw new Error("Usage: xr agents stop <workflowId>");
      const record = svc.stopWorkflow(workflowId);
      ok(`Cancellation requested for ${record.workflowId}`);
      return;
    }

    if (sub === "resume") {
      const workflowId = flags.positionals[0];
      if (!workflowId) throw new Error("Usage: xr agents resume <workflowId>");
      const record = await svc.resumeWorkflow(workflowId, {
        provider: flags.provider,
        model: flags.model,
        dryRun: flags.dryRun,
        budget: flags.budget,
        maxSteps: flags.maxSteps,
        maxTokens: flags.maxTokens,
      });
      ok(`Workflow ${record.workflowId} is now ${record.status}`);
      if (record.finalOutput?.summary) console.log(`\n${record.finalOutput.summary}`);
      return;
    }

    printHelp();
  }
}
