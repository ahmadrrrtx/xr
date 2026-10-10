/**
 * XR for VS Code: extension entry point.
 *
 * Wires the daemon session, the status bar, the chat panel, editor providers
 * and commands. Nothing here talks to the daemon directly; that stays in
 * session.ts and the chat controller.
 */

import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { ProposalContent } from "./editor/apply";
import { XrCodeLensProvider, LENS_LANGUAGES } from "./editor/codeLens";
import { XrDiagnostics } from "./editor/diagnostics";
import { inlineEnabled, XrInlineProvider } from "./editor/inline";
import { CHAT_VIEW_ID, XrChatView } from "./panel";
import { DaemonSession } from "./session";
import { XrStatusBar } from "./status";

export function activate(context: vscode.ExtensionContext): void {
  const session = new DaemonSession(context.secrets);
  const status = new XrStatusBar();
  const diagnostics = new XrDiagnostics();
  const proposals = new ProposalContent();
  const panel = new XrChatView(context.extensionUri, session, diagnostics, proposals);
  const lens = new XrCodeLensProvider();

  let inline: vscode.Disposable | undefined;
  const syncInline = () => {
    // Inline completions are registered only when the setting is on, so the default install adds no provider.
    if (inlineEnabled() && !inline) {
      inline = vscode.languages.registerInlineCompletionItemProvider(
        { scheme: "file" },
        new XrInlineProvider(() => session.ensureClient()),
      );
    } else if (!inlineEnabled() && inline) {
      inline.dispose();
      inline = undefined;
    }
  };
  const refreshStatus = () => status.update(session.status, inlineEnabled());

  context.subscriptions.push(
    session,
    status,
    diagnostics,
    proposals,
    panel,
    lens,
    session.onStatus(refreshStatus),
    vscode.window.registerWebviewViewProvider(CHAT_VIEW_ID, panel, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.languages.registerCodeLensProvider(
      LENS_LANGUAGES.map((language) => ({ language, scheme: "file" })),
      lens,
    ),
    vscode.workspace.registerTextDocumentContentProvider(ProposalContent.scheme, proposals),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration("xr")) return;
      lens.refresh();
      syncInline();
      refreshStatus();
      panel.resyncState();
      void session.refresh();
    }),
    new vscode.Disposable(() => inline?.dispose()),
    ...registerCommands({ session, panel, diagnostics, proposals }),
  );

  syncInline();
  refreshStatus();
  session.start();
}

export function deactivate(): void {
  // Disposables registered in activate() are cleaned up by VS Code.
}
