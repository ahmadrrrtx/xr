/**
 * Command registrations. Every ID here matches a command in package.json.
 */

import * as vscode from "vscode";
import { buildActionPrompt, type ActionKind, type CodeTarget } from "./editor/actions";
import { lensTarget, selectionTarget } from "./editor/context";
import type { XrDiagnostics } from "./editor/diagnostics";
import type { ProposalContent } from "./editor/apply";
import { inlineEnabled } from "./editor/inline";
import type { XrChatView } from "./panel";
import type { DaemonSession } from "./session";
import { money } from "./status-format";
import { DaemonHttpError } from "./daemon/client";

export interface CommandDeps {
  session: DaemonSession;
  panel: XrChatView;
  diagnostics: XrDiagnostics;
  proposals: ProposalContent;
}

const NO_SELECTION = "XR: select some code first.";

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  const { session, panel, diagnostics } = deps;
  const reg = (id: string, fn: (...args: unknown[]) => unknown) => vscode.commands.registerCommand(id, fn);

  const actionCommand = (kind: ActionKind) => async (arg?: unknown) => {
    // Code lenses pass a target object. The palette, keybindings and the editor context menu
    // (which passes a Uri) use the current selection instead.
    const target = isLensArg(arg) ? await lensTarget(arg) : selectionTarget();
    if (!target) return void vscode.window.showInformationMessage(NO_SELECTION);
    await runAction(panel, kind, target);
  };

  return [
    reg("xr.openChat", () => panel.reveal()),

    reg("xr.askSelection", () => {
      if (!selectionTarget()) {
        // Still open the panel, so the shortcut is never a dead key.
        return void panel.reveal();
      }
      panel.attachSelectionAndReveal();
    }),

    reg("xr.ask", async () => {
      const text = await vscode.window.showInputBox({
        title: "Ask XR",
        prompt: "What do you want to know about the selected code?",
        ignoreFocusOut: true,
      });
      if (!text?.trim()) return;
      await panel.sendFromCommand(text, { attachSelection: true });
    }),

    reg("xr.explain", actionCommand("explain")),
    reg("xr.fix", actionCommand("fix")),
    reg("xr.improve", actionCommand("improve")),
    reg("xr.addTests", actionCommand("addTests")),

    reg("xr.refactor", async () => {
      const target = selectionTarget();
      if (!target) return void vscode.window.showInformationMessage(NO_SELECTION);
      const instruction = await vscode.window.showInputBox({
        title: "Refactor selection",
        prompt: "How should the selection change? For example: extract a helper, or use early returns.",
        ignoreFocusOut: true,
      });
      if (instruction === undefined) return;
      await runAction(panel, "refactor", target, instruction);
    }),

    reg("xr.statusMenu", () => statusMenu()),

    reg("xr.switchModel", () => switchModel(session)),

    reg("xr.showBudget", () => showBudget(session)),

    reg("xr.toggleInlineSuggestions", async () => {
      const cfg = vscode.workspace.getConfiguration("xr");
      await cfg.update("inlineSuggestions", !inlineEnabled(), vscode.ConfigurationTarget.Global);
      vscode.window.setStatusBarMessage(`XR inline suggestions ${inlineEnabled() ? "on" : "off"}.`, 3000);
    }),

    reg("xr.startDaemon", async () => {
      const ok = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Starting XR…" },
        () => session.startDaemon(),
      );
      if (ok) {
        vscode.window.setStatusBarMessage("XR is running.", 3000);
        return;
      }
      const choice = await vscode.window.showWarningMessage(
        "XR did not start. Check the XR daemon output, or start `xr serve` in a terminal and set the token.",
        "Show output",
      );
      if (choice === "Show output") session.showOutput();
    }),

    reg("xr.setToken", () => session.setToken()),
    reg("xr.forgetToken", () => session.forgetToken()),

    reg("xr.openDashboard", async () => {
      const url = await session.dashboardUrl();
      if (!url) return void vscode.window.showWarningMessage("XR: set the daemon URL to a loopback address first.");
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    reg("xr.clearDiagnostics", () => diagnostics.clear()),
  ];
}

function isLensArg(arg: unknown): boolean {
  return typeof arg === "object" && arg !== null && "startLine" in arg && "uri" in arg;
}

export async function runAction(panel: XrChatView, kind: ActionKind, target: CodeTarget, instruction?: string): Promise<void> {
  const label = `${target.file}:${target.startLine}-${target.endLine}`;
  await panel.sendFromCommand(buildActionPrompt(kind, target, instruction), { label });
}

async function statusMenu(): Promise<void> {
  const inline = inlineEnabled();
  const items: Array<vscode.QuickPickItem & { command: string }> = [
    { label: "$(comment-discussion) Open chat", command: "xr.openChat" },
    { label: "$(symbol-enum) Switch model…", command: "xr.switchModel" },
    { label: "$(graph) Show budget", command: "xr.showBudget" },
    { label: "$(play) Start XR", description: "starts `xr serve` from VS Code", command: "xr.startDaemon" },
    { label: "$(key) Set daemon token…", command: "xr.setToken" },
    { label: "$(trash) Forget stored token", command: "xr.forgetToken" },
    { label: "$(globe) Open dashboard", command: "xr.openDashboard" },
    {
      label: `$(lightbulb) ${inline ? "Turn off" : "Turn on"} inline suggestions`,
      description: inline ? "currently on" : "currently off",
      command: "xr.toggleInlineSuggestions",
    },
    { label: "$(clear-all) Clear XR problems", command: "xr.clearDiagnostics" },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: "XR", placeHolder: "Choose an XR action" });
  if (pick) await vscode.commands.executeCommand(pick.command);
}

async function switchModel(session: DaemonSession): Promise<void> {
  const client = await session.ensureClient();
  if (!client) {
    void vscode.window.showWarningMessage("XR is not running on this computer. Start it first, then switch models.");
    return;
  }
  try {
    const providers = await client.providers();
    const usable = providers.providers.filter((p) => p.healthy || p.hasKey);
    const pick = await vscode.window.showQuickPick(
      usable.map((p) => ({
        label: p.label,
        description: p.id === providers.primary ? "current" : p.defaultModel,
        detail: p.healthy ? undefined : p.detail,
        id: p.id,
        model: p.defaultModel,
      })),
      { title: "XR provider", placeHolder: "Choose the primary provider" },
    );
    if (!pick) return;
    const model =
      pick.model ??
      (await vscode.window.showInputBox({ title: `${pick.label} model`, prompt: "Model id", ignoreFocusOut: true }));
    if (!model?.trim()) return;
    await client.setProvider(pick.id, model.trim());
    await session.refresh();
    vscode.window.setStatusBarMessage(`XR now uses ${pick.label} / ${model.trim()}.`, 4000);
  } catch (err) {
    void vscode.window.showErrorMessage(`XR could not switch the model. ${describe(err)}`);
  }
}

async function showBudget(session: DaemonSession): Promise<void> {
  const client = await session.ensureClient();
  if (!client) {
    void vscode.window.showWarningMessage("XR is not running on this computer.");
    return;
  }
  try {
    const b = await client.budget();
    const dailyCap = b.persisted?.daily_cap ?? null;
    const monthlyCap = b.persisted?.monthly_cap ?? null;
    const caps = `Daily cap: ${dailyCap === null ? "none" : money(dailyCap)}. Monthly cap: ${monthlyCap === null ? "none" : money(monthlyCap)}.`;
    void vscode.window.showInformationMessage(
      `Spent today ${money(b.usage.dayUsd)}. Spent this month ${money(b.usage.monthUsd)}. ${caps}`,
    );
  } catch (err) {
    void vscode.window.showErrorMessage(`XR could not read the budget. ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  if (err instanceof DaemonHttpError) return err.message;
  if (err instanceof Error) return err.message.slice(0, 200);
  return "";
}
