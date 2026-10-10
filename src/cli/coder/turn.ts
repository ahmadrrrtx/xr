/**
 * Phase 23 — run one coding turn through the engine's single execution envelope
 * (AgentService.execute) and render what it does.
 *
 * The coder never calls the agent loop directly and never builds its own tools:
 * it passes the coding toolset (toolsAllow), the approval gate (approve), the
 * stream sink (onStreamEvent) and the abort signal, and reads the outcome back.
 */
import type { ApprovalRequest, ChatStreamEvent } from "../../core/types.ts";
import type { AgentRunOverrides } from "../../services/agent-service.ts";
import type { EnvelopeOutcome } from "../../core/execution/envelope.ts";
import { clip } from "./ansi.ts";
import type { ApprovalGate } from "./approvals.ts";
import type { KeyInput } from "./key-input.ts";
import { MarkdownStream } from "./markdown-stream.ts";
import { Sink, Spinner } from "./sink.ts";

/** The slice of AgentService a turn needs (keeps this module free of engine imports). */
export interface AgentLike {
  execute(req: AgentRunOverrides & { task: string; mode: "agent" }): Promise<EnvelopeOutcome>;
}

export interface CoderContext {
  sink: Sink;
  agent: AgentLike;
  gate: ApprovalGate;
  systemPrompt: string;
  toolsAllow: string[];
  /** `-p`: the answer is the only thing on stdout; status goes to stderr. */
  printOnly: boolean;
  /** Human-readable model label for the summary line. */
  modelLabel: string;
  provider?: string;
  model?: string;
  budget?: number;
  maxSteps: number;
  /** Raw keys (null without a terminal). The caller owns raw mode; a turn only hooks Ctrl+C. */
  keys: KeyInput | null;
  approve: (req: ApprovalRequest) => Promise<boolean>;
}

export interface Msg {
  role: "user" | "assistant";
  content: string;
}

export interface TurnSummary {
  stopped: EnvelopeOutcome["stopped"];
  finalMessage: string;
  steps: number;
  sessionId: string;
  meter?: string;
  inputTokens: number;
  outputTokens: number;
  filesWritten: string[];
  shellRuns: number;
  shellFailures: number;
  toolErrors: number;
  /** Set when the engine reported an error the user should see. */
  error?: string;
  /** Text the model streamed, verbatim (print mode uses it when finalMessage is empty). */
  streamed: string;
}

/** Engine tool-output strings that mean "a human or policy said no". */
const REFUSAL = /^(write denied|delete denied|shell denied|denied|blocked:|shell command cancelled|path escapes|approval)/i;

/** The last `max` lines of a command's output, and how many earlier lines were cut. */
export function tailLines(output: string, max: number): { shown: string[]; hidden: number } {
  const lines = output.replace(/\n+$/, "").split("\n");
  const shown = lines.slice(-max);
  return { shown, hidden: lines.length - shown.length };
}

/** Compact, human phrasing for each tool call. */
export function toolCallLine(tool: string, args: unknown): { marker: string; text: string } {
  const a = (args ?? {}) as Record<string, unknown>;
  const s = (v: unknown, n = 90) => clip(String(v ?? ""), n);
  switch (tool) {
    case "read_file":
      return { marker: "›", text: `read ${s(a.path)}` };
    case "list_dir":
      return { marker: "›", text: `ls ${s(a.path ?? ".")}` };
    case "search_code":
      return { marker: "›", text: `search "${s(a.pattern ?? a.query, 60)}"${a.path ? ` in ${s(a.path, 40)}` : ""}` };
    case "write_file":
    case "patch_file":
      return { marker: "✏", text: `edit ${s(a.path)}` };
    case "delete_file":
      return { marker: "✗", text: `delete ${s(a.path)}` };
    case "shell":
      return { marker: "▶", text: s(a.cmd, 200) };
    case "fetch_url":
      return { marker: "›", text: `fetch ${s(a.url, 120)}` };
    case "web_search":
      return { marker: "›", text: `web search "${s(a.query, 80)}"` };
    default:
      return { marker: "›", text: `${tool} ${s(JSON.stringify(args ?? {}), 80)}` };
  }
}

function statusLabel(status: string): string {
  if (status === "provider_selection" || status === "provider_ready") return "connecting";
  if (status === "tool_running") return "working";
  return "thinking";
}

/** Runs one turn and owns its rendering state. */
class TurnRunner {
  private readonly spinner: Spinner;
  private readonly md: MarkdownStream;
  private lastChar = "\n";
  private lastWasProse = false;
  private readonly calls = new Map<string, { tool: string; args: unknown }>();
  private usageIn = 0;
  private usageOut = 0;
  private streamed = "";
  private readonly summary: TurnSummary = {
    stopped: "done",
    finalMessage: "",
    steps: 0,
    sessionId: "",
    inputTokens: 0,
    outputTokens: 0,
    filesWritten: [],
    shellRuns: 0,
    shellFailures: 0,
    toolErrors: 0,
    streamed: "",
  };

  constructor(
    private readonly ctx: CoderContext,
    private readonly task: string,
    private readonly history: Msg[],
    private readonly signal: AbortSignal,
  ) {
    const { sink } = ctx;
    this.spinner = new Spinner(sink);
    this.md = new MarkdownStream((s) => this.prose(s), sink.p, sink.mode === "tty" && !ctx.printOnly);
  }

  async run(): Promise<TurnSummary> {
    const { ctx, task } = this;
    if (ctx.sink.json) ctx.sink.event({ type: "prompt", text: task.slice(0, 4000) });
    this.spinner.start("thinking");
    try {
      const out = await ctx.agent.execute({
        task,
        mode: "agent",
        surface: "cli",
        systemPrompt: ctx.systemPrompt,
        history: this.history,
        toolsAllow: ctx.toolsAllow,
        approve: ctx.approve,
        onStreamEvent: (e) => this.onEvent(e),
        // The loop's own progress lines (▸ think …) duplicate the structured events; only
        // warnings reach the user, and only through the status channel.
        say: (line) => this.onSay(line),
        signal: this.signal,
        memoryEnabled: false,
        // The provider the user chose (wizard, --model, config) is primary for this run;
        // the engine's fallback applies only when it fails. Per run: the shared
        // providerEngine.routingStrategy is left alone for the desktop app.
        routingMode: "preferred_with_fallback",
        maxSteps: ctx.maxSteps,
        ...(ctx.budget !== undefined ? { budget: ctx.budget } : {}),
        ...(ctx.provider ? { provider: ctx.provider } : {}),
        ...(ctx.model ? { model: ctx.model } : {}),
      });
      this.finish();
      Object.assign(this.summary, {
        stopped: out.stopped,
        finalMessage: out.finalMessage ?? "",
        steps: out.steps,
        sessionId: out.sessionId,
        meter: out.meter,
        inputTokens: out.inputTokens ?? this.usageIn,
        outputTokens: out.outputTokens ?? this.usageOut,
        streamed: this.streamed,
      });
      if (out.stopped === "error") this.summary.error ??= out.finalMessage || "the model call failed";
    } catch (err) {
      this.finish();
      const msg = err instanceof Error ? err.message : String(err);
      Object.assign(this.summary, { stopped: "error", error: msg, streamed: this.streamed });
    } finally {
      this.spinner.stop();
    }
    if (ctx.sink.json) {
      if (this.summary.error) ctx.sink.event({ type: "error", message: this.summary.error });
      // `denials` is the audit record: every edit or command the run asked for and did not get.
      ctx.sink.event({
        type: "done",
        stopped: this.summary.stopped,
        steps: this.summary.steps,
        denials: ctx.gate.denials,
      });
    }
    return this.summary;
  }

  private finish(): void {
    this.spinner.stop();
    this.md.end();
    this.freshLine();
  }

  /** End the current line on the stream that is currently open (prose or status). */
  private freshLine(): void {
    if (this.lastChar === "\n") return;
    if (this.lastWasProse) process.stdout.write("\n");
    else this.status("\n");
    this.lastChar = "\n";
  }

  /** Answer text. Goes to stdout in every mode except json (json uses token events). */
  private prose(s: string): void {
    if (!s || this.ctx.sink.json) return;
    this.lastChar = s[s.length - 1]!;
    this.lastWasProse = true;
    process.stdout.write(s);
  }

  /** Status chrome. Stdout normally; stderr in print mode so the answer stays clean. */
  private status(s: string): void {
    if (this.ctx.sink.json) return;
    this.lastChar = s[s.length - 1] ?? this.lastChar;
    this.lastWasProse = false;
    (this.ctx.printOnly ? process.stderr : process.stdout).write(s);
  }

  private onEvent(e: ChatStreamEvent): void {
    const { ctx } = this;
    const p = ctx.sink.p;
    switch (e.type) {
      case "status":
        if (this.spinner.running) this.spinner.update(statusLabel(e.status));
        return;
      case "token":
        this.spinner.stop();
        this.streamed += e.text;
        if (ctx.sink.json) ctx.sink.event({ type: "token", content: e.text });
        else this.md.push(e.text);
        return;
      case "tool_call": {
        this.spinner.stop();
        this.md.end();
        this.freshLine();
        this.calls.set(e.id, { tool: e.tool, args: e.args });
        if (ctx.sink.json) {
          ctx.sink.event({ type: "tool", tool: e.tool, args: e.args, status: "running" });
          return;
        }
        const { marker, text } = toolCallLine(e.tool, e.args);
        const paint = marker === "▶" ? p.bold : marker === "✗" ? p.red : p.dim;
        this.status(`  ${p.cyan(marker)} ${paint(text)}\n`);
        return;
      }
      case "tool_result": {
        this.spinner.stop();
        const call = this.calls.get(e.id);
        const tool = e.tool || call?.tool || "tool";
        const output = e.ok ? (e.result ?? "") : (e.error ?? e.result ?? "");
        const refused = !e.ok && REFUSAL.test(output.trim());
        if ((tool === "write_file" || tool === "patch_file") && e.ok) {
          this.summary.filesWritten.push(String((call?.args as { path?: unknown } | undefined)?.path ?? ""));
        }
        if (tool === "shell" && !refused) {
          this.summary.shellRuns++;
          if (!e.ok) this.summary.shellFailures++;
        }
        if (!e.ok) this.summary.toolErrors++;
        if (ctx.sink.json) {
          ctx.sink.event({ type: "tool", tool, status: e.ok ? "ok" : "error", ...(output ? { output: output.slice(0, 2000) } : {}) });
          return;
        }
        this.renderToolResult(tool, e.ok, refused, output);
        return;
      }
      case "usage":
        this.usageIn = Math.max(this.usageIn, e.usage.inTokens);
        this.usageOut = Math.max(this.usageOut, e.usage.outTokens);
        return;
      case "error":
        // Recorded, not printed: the turn summary states the error once, in one place.
        this.spinner.stop();
        this.summary.error ??= e.message;
        return;
      default:
        return;
    }
  }

  private onSay(line: string): void {
    if (this.ctx.sink.json) return;
    // eslint-disable-next-line no-control-regex
    const plain = line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
    // Progress (▸) and tool refusals (✗) are already shown by the structured events.
    if (!plain || /^[▸◆✗✓]/.test(plain) || !/⚠|fall ?back|failed|unavailable/i.test(plain)) return;
    this.freshLine();
    this.status(`  ${this.ctx.sink.p.yellow("!")} ${this.ctx.sink.p.dim(clip(plain, 240))}\n`);
  }

  private renderToolResult(tool: string, ok: boolean, refused: boolean, output: string): void {
    const p = this.ctx.sink.p;
    if (!ok) {
      const first = clip(output.split("\n")[0] ?? "failed", 160);
      this.status(`  ${refused ? p.yellow("!") : p.red("✗")} ${refused ? p.yellow(first) : p.red(first)}\n`);
      if (tool === "shell" && output.includes("\n")) this.statusTail(output, 200, p.red);
      return;
    }
    if (tool === "write_file" || tool === "patch_file" || tool === "delete_file") {
      this.status(`  ${p.green("✓")} ${p.dim(clip(output, 120))}\n`);
      return;
    }
    if (tool === "shell") this.statusTail(output, 40, p.dim);
    // Reads and searches stay quiet: the model consumes them, the user does not need them.
  }

  /** Shell output: the last `max` lines (40 normally, 200 for failures). */
  private statusTail(output: string, max: number, paint: (s: string) => string): void {
    const { shown, hidden } = tailLines(output, max);
    if (hidden > 0) this.status(paint(`  … ${hidden} earlier line${hidden === 1 ? "" : "s"} hidden`) + "\n");
    for (const l of shown) this.status(paint(`  ${l}`) + "\n");
  }
}

/**
 * Run one turn. Ctrl+C (raw keys, or SIGINT) cancels it through the abort signal.
 * Never throws for engine-side failures: they land in the summary.
 */
export async function runTurn(ctx: CoderContext, task: string, history: Msg[]): Promise<TurnSummary> {
  const ac = new AbortController();
  const onSigint = () => ac.abort();
  process.once("SIGINT", onSigint);
  const keys = ctx.keys;
  if (keys) {
    keys.setInterceptor((k) => {
      if (k.ctrl && k.name === "c") {
        ac.abort();
        return true;
      }
      return false;
    });
    keys.start(); // approval prompts read keys during the turn
  }
  try {
    return await new TurnRunner(ctx, task, history, ac.signal).run();
  } finally {
    process.off("SIGINT", onSigint);
    keys?.setInterceptor(null);
  }
}

/** Map a turn outcome to the coder's exit code (see exit-codes.ts). */
export function exitCodeFor(stopped: TurnSummary["stopped"]): number {
  switch (stopped) {
    case "done":
      return 0;
    case "cancelled":
      return 2;
    case "approval":
      return 3;
    case "budget":
      return 4;
    default:
      return 1;
  }
}
