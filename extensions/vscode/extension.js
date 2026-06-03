// XR VS Code extension (thin wrapper over the local daemon).
// Shows a live cost meter in the status bar and lets you ask XR about a
// selection via right-click. All it does is talk to http://127.0.0.1:7842.
const vscode = require("vscode");

function cfg() {
  const c = vscode.workspace.getConfiguration("xr");
  return { url: c.get("daemonUrl"), token: c.get("token") };
}

async function api(path) {
  const { url, token } = cfg();
  try {
    const res = await fetch(url + path, { headers: { authorization: "Bearer " + token } });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function activate(context) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = "$(shield) XR";
  status.tooltip = "XR — trustworthy agent";
  status.command = "xr.openDashboard";
  status.show();
  context.subscriptions.push(status);

  async function refresh() {
    const cost = await api("/api/cost");
    const sec = await api("/api/security");
    if (cost) {
      const sc = sec ? "  " + Math.round(sec.rate * 100) + "%🛡️" : "";
      status.text = "$(shield) XR  $" + Number(cost.totalUsd || 0).toFixed(3) + sc;
    } else {
      status.text = "$(shield) XR  (daemon off)";
    }
  }
  refresh();
  const timer = setInterval(refresh, 5000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  context.subscriptions.push(
    vscode.commands.registerCommand("xr.openDashboard", () => {
      const { url, token } = cfg();
      vscode.env.openExternal(vscode.Uri.parse(url + "/?token=" + token));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("xr.ask", async () => {
      const ed = vscode.window.activeTextEditor;
      const sel = ed ? ed.document.getText(ed.selection) : "";
      const q = await vscode.window.showInputBox({
        prompt: "Ask XR",
        value: sel ? "Explain this selection" : "",
      });
      if (!q) return;
      vscode.window.showInformationMessage(
        "XR: run `xr \"" + q + "\"` in your terminal (the daemon is read-only; tasks run via CLI for safety).",
      );
    }),
  );
}

function deactivate() {}
module.exports = { activate, deactivate };
