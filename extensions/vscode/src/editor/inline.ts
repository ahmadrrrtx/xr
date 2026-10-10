/**
 * Inline (ghost-text) suggestions. Registered only when xr.inlineSuggestions is
 * on, so the default install adds no inline provider at all.
 *
 * Each suggestion is a real daemon call, so the provider is conservative:
 * it waits for a pause in typing, only completes at the end of a line, sends a
 * bounded window of code, and caches the last answer for the same document
 * version and cursor position.
 */

import * as vscode from "vscode";
import type { ChatTransport } from "../chat/controller";
import { buildPrompt, cleanCompletion, MAX_COMPLETION_CHARS } from "./completion";

const DEBOUNCE_MS = 700;
const MAX_BEFORE_LINES = 120;
const MAX_AFTER_LINES = 40;

export function inlineEnabled(): boolean {
  return vscode.workspace.getConfiguration("xr").get<boolean>("inlineSuggestions", false);
}

export class XrInlineProvider implements vscode.InlineCompletionItemProvider {
  private lastKey = "";
  private lastText: string | null = null;

  constructor(private readonly transport: () => Promise<ChatTransport | null>) {}

  async provideInlineCompletionItems(
    doc: vscode.TextDocument,
    pos: vscode.Position,
    _ctx: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    if (!inlineEnabled() || doc.uri.scheme !== "file") return [];
    const lineText = doc.lineAt(pos.line).text;
    // Complete only at the end of a line, and only once there is some code above.
    if (lineText.slice(pos.character).trim().length > 0) return [];

    const startLineIdx = Math.max(0, pos.line - MAX_BEFORE_LINES);
    const before = doc.getText(new vscode.Range(startLineIdx, 0, pos.line, pos.character));
    if (before.trim().length < 3) return [];
    const endLineIdx = Math.min(doc.lineCount - 1, pos.line + MAX_AFTER_LINES);
    const after = doc.getText(new vscode.Range(pos.line, pos.character, endLineIdx, doc.lineAt(endLineIdx).text.length));

    const key = `${doc.uri.toString()}|${doc.version}|${pos.line}:${pos.character}`;
    if (key !== this.lastKey) {
      const version = doc.version;
      const ready = await wait(DEBOUNCE_MS, token);
      if (!ready || token.isCancellationRequested || doc.version !== version) return [];
      const transport = await this.transport();
      if (!transport) return [];
      this.lastText = await this.complete(transport, doc.languageId, vscode.workspace.asRelativePath(doc.uri, false), before, after, token);
      this.lastKey = key;
    }
    if (!this.lastText || token.isCancellationRequested) return [];
    return [new vscode.InlineCompletionItem(this.lastText, new vscode.Range(pos, pos))];
  }

  private async complete(
    transport: ChatTransport,
    languageId: string,
    file: string,
    before: string,
    after: string,
    token: vscode.CancellationToken,
  ): Promise<string | null> {
    const ac = new AbortController();
    const sub = token.onCancellationRequested(() => ac.abort());
    let text = "";
    try {
      for await (const ev of transport.chat(
        {
          message: buildPrompt(languageId, file, before, after),
          mode: "ask",
          context: "Client: VS Code inline completion. Reply with code only.",
          sessionId: "vscode-inline",
        },
        ac.signal,
      )) {
        if (ev.kind === "token") text += ev.text;
        if (ev.kind === "done") break;
        if (text.length > MAX_COMPLETION_CHARS) ac.abort();
      }
    } catch {
      // Aborted or offline: show nothing rather than a partial guess.
      return null;
    } finally {
      sub.dispose();
    }
    return cleanCompletion(text);
  }
}

function wait(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve(true);
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve(false);
    });
  });
}
