/**
 * Open a file the model mentioned, inside the workspace only.
 *
 * Paths from chat are untrusted. The path must be relative, must not climb out
 * of a workspace folder, and must name an existing file. If the path does not
 * resolve, a unique file with the same base name is used. Anything ambiguous
 * is refused rather than guessed.
 */

import * as vscode from "vscode";
import { isInside, isSafeRelativePath, clampLine } from "./paths";

const BASENAME_RE = /^[\w.@-]{1,120}$/;

/** Resolve a workspace-relative path to an existing file, or undefined. */
export async function resolveWorkspaceFile(path: string): Promise<vscode.Uri | undefined> {
  if (!isSafeRelativePath(path)) return undefined;
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const uri = vscode.Uri.joinPath(folder.uri, path);
    if (!isInside(folder.uri.fsPath, uri.fsPath)) continue;
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type === vscode.FileType.File) return uri;
    } catch {
      // not in this folder; keep looking
    }
  }
  const base = path.split(/[\\/]/).pop() ?? "";
  if (!BASENAME_RE.test(base)) return undefined;
  const matches = await vscode.workspace.findFiles(`**/${base}`, "**/{node_modules,.git,out,dist}/**", 3);
  return matches.length === 1 ? matches[0] : undefined;
}

export async function openWorkspaceFile(ref: { path: string; line?: number }): Promise<boolean> {
  const uri = await resolveWorkspaceFile(ref.path);
  if (!uri) {
    void vscode.window.showInformationMessage(`XR could not find ${ref.path} in this workspace.`);
    return false;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: true });
  if (ref.line !== undefined) {
    const line = clampLine(ref.line, doc.lineCount);
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
  }
  return true;
}
