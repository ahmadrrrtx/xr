/**
 * Reads the active editor into plain data. The chat controller and the action
 * commands use these snapshots and never touch editor objects directly.
 */

import * as vscode from "vscode";
import type { EditorSnapshot } from "../chat/controller";
import type { CodeTarget } from "./actions";
import { MAX_CODE_CHARS } from "./actions";

/** Workspace-relative path. Files outside every workspace folder yield their base name only. */
export function displayPath(uri: vscode.Uri): string {
  const rel = vscode.workspace.asRelativePath(uri, false);
  if (rel === uri.fsPath || rel.startsWith("/") || /^[a-zA-Z]:/.test(rel)) {
    return uri.path.split("/").pop() ?? "file";
  }
  return rel;
}

export function workspaceName(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.name;
}

/** Lines of a non-empty selection, 1-based and inclusive. */
export function selectionLines(sel: vscode.Selection): { startLine: number; endLine: number } {
  const startLine = sel.start.line + 1;
  // A selection ending at column 0 does not include that line.
  const endLine = sel.end.character === 0 && sel.end.line > sel.start.line ? sel.end.line : sel.end.line + 1;
  return { startLine, endLine };
}

export function editorSnapshot(): EditorSnapshot {
  const editor = vscode.window.activeTextEditor;
  const snapshot: EditorSnapshot = { workspaceName: workspaceName() };
  if (!editor || editor.document.uri.scheme !== "file") return snapshot;
  snapshot.file = displayPath(editor.document.uri);
  snapshot.languageId = editor.document.languageId;
  if (!editor.selection.isEmpty) {
    const { startLine, endLine } = selectionLines(editor.selection);
    snapshot.selection = {
      text: editor.document.getText(editor.selection).slice(0, MAX_CODE_CHARS),
      startLine,
      endLine,
    };
  }
  return snapshot;
}

/** The current non-empty selection as a code target, or null. */
export function selectionTarget(): CodeTarget | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty || editor.document.uri.scheme !== "file") return null;
  const { startLine, endLine } = selectionLines(editor.selection);
  return {
    file: displayPath(editor.document.uri),
    languageId: editor.document.languageId,
    startLine,
    endLine,
    code: editor.document.getText(editor.selection),
  };
}

/** A code target from a CodeLens argument. Lines are re-read so a stale lens fails safely. */
export async function lensTarget(raw: unknown): Promise<CodeTarget | null> {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.uri !== "string" || typeof o.startLine !== "number" || typeof o.endLine !== "number") return null;
  let uri: vscode.Uri;
  try {
    uri = vscode.Uri.parse(o.uri);
  } catch {
    return null;
  }
  if (uri.scheme !== "file") return null;
  const doc = await vscode.workspace.openTextDocument(uri);
  const startIdx = Math.min(Math.max(o.startLine - 1, 0), doc.lineCount - 1);
  const endIdx = Math.min(Math.max(o.endLine - 1, startIdx), doc.lineCount - 1);
  const range = new vscode.Range(startIdx, 0, endIdx, doc.lineAt(endIdx).text.length);
  return {
    file: displayPath(uri),
    languageId: doc.languageId,
    startLine: startIdx + 1,
    endLine: endIdx + 1,
    code: doc.getText(range),
    symbolName: typeof o.name === "string" ? o.name.slice(0, 120) : undefined,
  };
}
