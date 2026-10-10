/**
 * Bridge to the extension host. `acquireVsCodeApi` exists only inside a
 * VS Code webview; it is acquired once per page.
 */
import type { ToHost } from "../shared/protocol";

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

let api: { postMessage(message: unknown): void } | null = null;

export function post(message: ToHost): void {
  if (!api) api = acquireVsCodeApi();
  api.postMessage(message);
}
