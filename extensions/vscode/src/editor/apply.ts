/**
 * Apply model output to the editor and show it as a diff.
 *
 * Apply uses a WorkspaceEdit, so it joins the editor undo stack and Ctrl+Z
 * reverts it. Diff shows the proposal in a read-only virtual document; nothing
 * changes on disk until the user applies it.
 */

import * as vscode from "vscode";

const SCHEME = "xr-proposal";
const MAX_PROPOSALS = 20;

export class ProposalContent implements vscode.TextDocumentContentProvider {
  private readonly docs = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;
  private seq = 0;

  static readonly scheme = SCHEME;

  /** Store text and return a URI whose extension gives the diff its syntax highlighting. */
  add(text: string, languageId: string): vscode.Uri {
    const id = `proposal-${++this.seq}`;
    if (this.docs.size >= MAX_PROPOSALS) {
      const oldest = this.docs.keys().next().value;
      if (oldest !== undefined) this.docs.delete(oldest);
    }
    this.docs.set(id, text);
    return vscode.Uri.from({ scheme: SCHEME, path: `/${id}.${extensionFor(languageId)}` });
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    const id = uri.path.replace(/^\//, "").replace(/\.[a-z0-9]+$/i, "");
    return this.docs.get(id) ?? "";
  }

  dispose(): void {
    this.emitter.dispose();
    this.docs.clear();
  }
}

/** Apply `code` over the selection, or at the cursor when nothing is selected. */
export async function applyToEditor(code: string): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("XR: open a file to apply this code.");
    return false;
  }
  if (editor.document.isClosed || editor.document.uri.scheme !== "file") {
    void vscode.window.showInformationMessage("XR: this editor cannot take an edit.");
    return false;
  }
  const sel = editor.selection;
  const range = sel.isEmpty ? new vscode.Range(sel.active, sel.active) : new vscode.Range(sel.start, sel.end);
  const edit = new vscode.WorkspaceEdit();
  edit.replace(editor.document.uri, range, code);
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    void vscode.window.showWarningMessage("XR: the edit was not applied.");
    return false;
  }
  // Select what was inserted so the user can review it in place.
  const lines = code.split("\n");
  const endLine = range.start.line + lines.length - 1;
  const endChar = lines.length === 1 ? range.start.character + code.length : lines[lines.length - 1].length;
  editor.selection = new vscode.Selection(range.start, new vscode.Position(endLine, endChar));
  vscode.window.setStatusBarMessage("XR: applied. Ctrl+Z undoes it.", 5000);
  return true;
}

/** Diff the proposal against the selection, or against the whole file when nothing is selected. */
export async function diffWithEditor(code: string, languageId: string, proposals: ProposalContent): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    void vscode.window.showInformationMessage("XR: open a file to compare this code.");
    return;
  }
  const right = proposals.add(code, languageId || editor.document.languageId);
  const sel = editor.selection;
  let left: vscode.Uri = editor.document.uri;
  if (!sel.isEmpty) {
    left = proposals.add(editor.document.getText(sel), editor.document.languageId);
  }
  await vscode.commands.executeCommand(
    "vscode.diff",
    left,
    right,
    sel.isEmpty ? "XR proposal ↔ file" : "XR proposal ↔ selection",
  );
}

export function extensionFor(languageId: string): string {
  const map: Record<string, string> = {
    typescript: "ts",
    typescriptreact: "tsx",
    javascript: "js",
    javascriptreact: "jsx",
    python: "py",
    rust: "rs",
    go: "go",
    json: "json",
    markdown: "md",
    html: "html",
    css: "css",
    shellscript: "sh",
    yaml: "yaml",
    java: "java",
    c: "c",
    cpp: "cpp",
    csharp: "cs",
  };
  return map[languageId] ?? "txt";
}
