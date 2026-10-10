/**
 * Phase 23 — the interactive REPL: a prompt, one turn per line, a summary after each.
 *
 * Raw keys are owned here (start before the first prompt, stop on exit), so the
 * terminal is restored whatever happens inside a turn.
 */
import { appendHistory, loadHistory, looksSecret, trimHistory } from "./history.ts";
import { LineEditor } from "./line-editor.ts";
import { REPL_HELP, summaryLine } from "./renderer.ts";
import { expandReferences } from "./context.ts";
import type { KeyInput } from "./key-input.ts";
import type { Sink } from "./sink.ts";
import { runTurn, type CoderContext, type Msg } from "./turn.ts";

/** Keep the model's context bounded: the last N messages of the conversation. */
export const MAX_HISTORY_MESSAGES = 40;

export interface ReplDeps {
  sink: Sink;
  keys: KeyInput;
  base: Omit<CoderContext, "toolsAllow" | "printOnly">;
  toolsAllow: string[];
  cwd: string;
  /** null with --no-history. */
  historyFile: string | null;
  /** `/setup`: re-run the wizard. Returns false when the user quit. */
  onSetup: () => Promise<void>;
}

/** Runs until /exit, Ctrl+D or Ctrl+C at an empty prompt. The REPL itself never fails the process. */
export async function runRepl(deps: ReplDeps): Promise<number> {
  const { sink, keys, base, cwd } = deps;
  const p = sink.p;
  const editor = new LineEditor(keys, (s) => process.stdout.write(s));
  const history: Msg[] = [];
  if (deps.historyFile) trimHistory(deps.historyFile);
  const recall = deps.historyFile ? loadHistory(deps.historyFile) : [];

  keys.start();
  try {
    for (;;) {
      const line = await editor.read(`${p.cyan("›")} `, recall);
      if (line === null) break; // Ctrl+D or Ctrl+C at an empty prompt
      const text = line.trim();
      if (!text) continue;

      if (text.startsWith("/")) {
        const handled = await slash(text, deps, history);
        if (handled === "exit") break;
        continue;
      }

      if (deps.historyFile && !looksSecret(text)) {
        appendHistory(deps.historyFile, text);
        recall.push(text);
      }

      const expanded = await expandReferences(text, cwd);
      for (const miss of expanded.missing) sink.warn(`no such file or folder: @${miss} (sent as plain text)`);
      if (expanded.attached.length) sink.line(p.dim(`  attached: ${expanded.attached.join(", ")}`));

      const summary = await runTurn({ ...base, printOnly: false, toolsAllow: deps.toolsAllow, keys }, expanded.prompt, history);
      if (!sink.json) sink.line(`  ${summaryLine(summary, p)}`);
      if (summary.stopped === "done") {
        history.push({ role: "user", content: expanded.prompt }, { role: "assistant", content: summary.finalMessage || summary.streamed });
        if (history.length > MAX_HISTORY_MESSAGES) history.splice(0, history.length - MAX_HISTORY_MESSAGES);
      }
      sink.line();
    }
  } finally {
    keys.stop();
  }
  return 0;
}

/** Slash commands. Returns "exit" to leave the loop. */
async function slash(text: string, deps: ReplDeps, history: Msg[]): Promise<"exit" | "continue"> {
  const { sink } = deps;
  const [cmd] = text.split(/\s+/);
  switch (cmd) {
    case "/exit":
    case "/quit":
      return "exit";
    case "/help":
      for (const l of REPL_HELP) sink.line(`  ${l}`);
      sink.line();
      return "continue";
    case "/clear":
      history.length = 0;
      sink.line(`  ${sink.p.dim("conversation cleared")}`);
      return "continue";
    case "/setup":
      await deps.onSetup();
      return "continue";
    default:
      sink.warn(`unknown command ${cmd} — try /help`);
      return "continue";
  }
}
