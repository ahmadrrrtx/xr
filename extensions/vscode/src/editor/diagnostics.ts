/**
 * Problems-panel sink for XR diagnostics.
 *
 * The chat parser (src/chat/diagnostics.ts) already rejects prose and malformed
 * entries. This layer adds the editor's own check: the file must exist inside
 * the workspace and the line must exist in it. An entry that points at nothing
 * is dropped and counted, never shown.
 */

import * as vscode from "vscode";
import type { XrDiagnostic } from "../chat/diagnostics";
import { resolveWorkspaceFile } from "./open";

const MAX_PER_FILE = 100;

export interface PublishResult {
  shown: number;
  dropped: number;
}

export class XrDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("xr");

  async publish(items: XrDiagnostic[]): Promise<PublishResult> {
    const byFile = new Map<string, XrDiagnostic[]>();
    for (const item of items) {
      const list = byFile.get(item.file) ?? [];
      list.push(item);
      byFile.set(item.file, list);
    }

    let shown = 0;
    let dropped = 0;
    for (const [path, entries] of byFile) {
      const uri = await resolveWorkspaceFile(path);
      if (!uri) {
        dropped += entries.length;
        continue;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      const diags: vscode.Diagnostic[] = [];
      for (const e of entries) {
        if (e.line > doc.lineCount) {
          dropped++;
          continue;
        }
        if (diags.length >= MAX_PER_FILE) {
          dropped++;
          continue;
        }
        const range = doc.lineAt(e.line - 1).range;
        const d = new vscode.Diagnostic(range, e.message, severity(e.severity));
        d.source = "XR";
        diags.push(d);
        shown++;
      }
      // Replace this file's XR problems with the latest answer's, so repeats do not pile up.
      if (diags.length) this.collection.set(uri, diags);
    }
    return { shown, dropped };
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function severity(s: XrDiagnostic["severity"]): vscode.DiagnosticSeverity {
  switch (s) {
    case "error":
      return vscode.DiagnosticSeverity.Error;
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
      return vscode.DiagnosticSeverity.Information;
  }
}
