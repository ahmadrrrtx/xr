/**
 * CodeLens above functions, methods, classes and other named units.
 *
 * Each lens is its own setting (xr.codeLens.explain, fix, improve, addTests).
 * Lenses carry a plain target object, so the command can re-read the code when
 * it runs. Markdown and JSON are not included: their symbols are headings and
 * keys, not code units, so a "fix" lens there would be misleading.
 */

import * as vscode from "vscode";
import { displayPath } from "./context";

export type LensAction = "explain" | "fix" | "improve" | "addTests";

export const LENS_ACTIONS: LensAction[] = ["explain", "fix", "improve", "addTests"];

const TITLES: Record<LensAction, string> = {
  explain: "XR: explain",
  fix: "XR: fix",
  improve: "XR: improve",
  addTests: "XR: add tests",
};

const COMMANDS: Record<LensAction, string> = {
  explain: "xr.explain",
  fix: "xr.fix",
  improve: "xr.improve",
  addTests: "xr.addTests",
};

export const LENS_LANGUAGES = [
  "typescript",
  "typescriptreact",
  "javascript",
  "javascriptreact",
  "python",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "kotlin",
  "swift",
];

const CODE_KINDS = new Set<vscode.SymbolKind>([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.Enum,
]);

const MAX_SYMBOLS = 200;
const MAX_DOC_LINES = 20000;

export function enabledLensActions(): LensAction[] {
  const cfg = vscode.workspace.getConfiguration("xr");
  return LENS_ACTIONS.filter((a) => cfg.get<boolean>(`codeLens.${a}`, true));
}

export class XrCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  refresh(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  async provideCodeLenses(doc: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const actions = enabledLensActions();
    if (actions.length === 0 || doc.uri.scheme !== "file" || doc.lineCount > MAX_DOC_LINES) return [];
    if (!LENS_LANGUAGES.includes(doc.languageId)) return [];

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
      "vscode.executeDocumentSymbolProvider",
      doc.uri,
    );
    if (!symbols || token.isCancellationRequested) return [];

    const lenses: vscode.CodeLens[] = [];
    const file = displayPath(doc.uri);
    let units = 0;
    for (const sym of flatten(symbols)) {
      if (!CODE_KINDS.has(sym.kind)) continue;
      if (++units > MAX_SYMBOLS) break;
      const line = sym.range.start.line;
      const range = new vscode.Range(line, 0, line, 0);
      const target = {
        uri: doc.uri.toString(),
        startLine: sym.range.start.line + 1,
        endLine: sym.range.end.line + 1,
        name: sym.name.slice(0, 120),
        file,
      };
      for (const action of actions) {
        lenses.push(new vscode.CodeLens(range, { title: TITLES[action], command: COMMANDS[action], arguments: [target] }));
      }
    }
    return lenses;
  }
}

function* flatten(symbols: vscode.DocumentSymbol[]): Generator<vscode.DocumentSymbol> {
  for (const s of symbols) {
    yield s;
    if (s.children?.length) yield* flatten(s.children);
  }
}
