/**
 * Chat controller (extension host).
 *
 * Owns the in-memory conversation for the panel, runs one stream at a time,
 * relays daemon events to the webview as small deltas, and routes approvals
 * through a host-provided confirm function. It has no VS Code imports: the
 * editor, the modal and the diagnostics sink are injected, so the logic can be
 * tested with a fake daemon.
 */

import { randomUUID } from "node:crypto";
import { DaemonHttpError, type ChatEvent, type ChatRequest } from "../daemon/client";
import type {
  ActivityLine,
  ChatMessage,
  ContextChip,
  DaemonStatus,
  PanelState,
  ToWebview,
} from "../shared/protocol";
import { parseDiagnosticBlocks, type XrDiagnostic } from "./diagnostics";

/** The subset of the daemon client the controller needs. */
export interface ChatTransport {
  chat(body: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  decideApproval(id: string, approved: boolean): Promise<void>;
}

export interface EditorSnapshot {
  workspaceName?: string;
  /** Workspace-relative path of the active file. */
  file?: string;
  languageId?: string;
  /** Selected text, when there is a non-empty selection. */
  selection?: { text: string; startLine: number; endLine: number };
}

export interface ApprovalRequest {
  tool: string;
  reason: string;
  riskTier?: string;
  preview?: string;
}

export interface ControllerDeps {
  /** Returns null when the daemon is not reachable. */
  transport: () => ChatTransport | null;
  mode: () => "ask" | "agent";
  editor: () => EditorSnapshot | null;
  /** Shows a modal and resolves true only for an explicit Approve. */
  confirmApproval: (req: ApprovalRequest) => Promise<boolean>;
  publish: (msg: ToWebview) => void;
  onDiagnostics?: (items: XrDiagnostic[]) => void;
  status: () => DaemonStatus;
}

export const MAX_APPROVALS_PER_SESSION = 25;
const MAX_HISTORY_TURNS = 24;
const MAX_SELECTION_CHARS = 8000;

export class ChatController {
  private messages: ChatMessage[] = [];
  private abort: AbortController | null = null;
  private approvals = 0;

  /** Whether the next send includes the editor selection. Reset after each turn. */
  private attachSelection = false;

  constructor(
    private readonly deps: ControllerDeps,
    private readonly iconUri: () => string = () => "",
  ) {}

  get busy(): boolean {
    return this.abort !== null;
  }

  snapshot(): PanelState {
    return {
      status: this.deps.status(),
      messages: this.messages,
      context: this.contextChip(),
      busy: this.busy,
      mode: this.deps.mode(),
      iconUri: this.iconUri(),
    };
  }

  contextChip(): ContextChip {
    const ed = this.deps.editor();
    return {
      file: ed?.file,
      selectedLines: ed?.selection ? ed.selection.endLine - ed.selection.startLine + 1 : 0,
      attached: this.attachSelection && Boolean(ed?.selection),
    };
  }

  setAttachSelection(on: boolean): void {
    this.attachSelection = on;
    this.deps.publish({ type: "context", context: this.contextChip() });
  }

  toggleAttachSelection(): void {
    this.setAttachSelection(!this.attachSelection);
  }

  stop(): void {
    this.abort?.abort();
  }

  clear(): void {
    this.stop();
    this.messages = [];
    this.deps.publish({ type: "clear" });
  }

  /**
   * Send one user turn. `prompt` is the full instruction; when `attachSelection`
   * is set and there is a selection, the selected code is added as a fenced block.
   */
  async send(prompt: string, opts: { attachSelection?: boolean; label?: string } = {}): Promise<void> {
    const text = prompt.trim();
    if (!text) return;
    if (this.busy) {
      this.systemNote("XR is still answering. Stop it first, or wait for the answer to finish.");
      return;
    }

    const transport = this.deps.transport();
    if (!transport) {
      this.systemNote("XR daemon is not running. XR must be running on your computer for chat to respond.");
      this.deps.publish({ type: "status", status: this.deps.status() });
      return;
    }

    const editor = this.deps.editor();
    const withSelection = Boolean(opts.attachSelection || this.attachSelection) && Boolean(editor?.selection);
    const fullPrompt = withSelection && editor?.selection ? `${text}\n\n${selectionBlock(editor)}` : text;
    const contextLabel = opts.label ?? (editor?.file ? describeRange(editor) : undefined);

    // Capture history before this turn is added, so the new prompt is not sent twice.
    const history = this.history();
    const userMsg: ChatMessage = {
      id: randomUUID(),
      role: "user",
      text: fullPrompt,
      activity: [],
      streaming: false,
      contextLabel,
    };
    const reply: ChatMessage = {
      id: randomUUID(),
      role: "assistant",
      text: "",
      activity: [],
      streaming: true,
    };
    this.messages.push(userMsg, reply);
    this.deps.publish({ type: "message", message: userMsg });
    this.deps.publish({ type: "message", message: reply });
    this.deps.publish({ type: "busy", busy: true });

    const controller = new AbortController();
    this.abort = controller;
    let finalText = "";

    try {
      const stream = transport.chat(
        {
          message: fullPrompt,
          mode: this.deps.mode(),
          history,
          context: contextString(editor),
          sessionId: "vscode",
        },
        controller.signal,
      );
      for await (const event of stream) {
        if (controller.signal.aborted) break;
        switch (event.kind) {
          case "token":
            reply.text += event.text;
            finalText = reply.text;
            this.deps.publish({ type: "delta", id: reply.id, text: event.text });
            break;
          case "narration":
            this.setActivity(reply, { id: randomUUID(), kind: "narration", text: event.text, state: "info" });
            break;
          case "status":
            if (event.status === "provider_ready") {
              this.deps.publish({
                type: "status",
                status: { ...this.deps.status(), provider: event.provider, model: event.model },
              });
            } else if (event.status === "compacting_context") {
              this.setActivity(reply, { id: "compact", kind: "status", text: "Compacting context", state: "running" });
            }
            break;
          case "tool_call":
            this.setActivity(reply, { id: event.id, kind: "tool", text: `Running ${event.tool}`, state: "running" });
            break;
          case "tool_result":
            this.setActivity(reply, {
              id: event.id,
              kind: "tool",
              text: event.ok ? `${event.tool} finished` : `${event.tool} failed${event.error ? `: ${event.error}` : ""}`,
              state: event.ok ? "ok" : "error",
            });
            break;
          case "approval":
            await this.handleApproval(transport, reply, event);
            break;
          case "usage":
          case "error":
            if (event.kind === "error") reply.error = event.message;
            break;
          case "done":
            if (!reply.text && event.fullText) reply.text = event.fullText;
            finalText = reply.text;
            if (event.finishReason === "error" && !reply.error) reply.error = event.fullText || "The run ended with an error.";
            break;
        }
      }
      if (controller.signal.aborted) {
        this.setActivity(reply, { id: "stopped", kind: "status", text: "Stopped", state: "info" });
      }
      this.deps.publish({ type: "status", status: this.deps.status() });
    } catch (err) {
      this.handleError(reply, err);
    } finally {
      reply.streaming = false;
      this.abort = null;
      this.attachSelection = false;
      this.deps.publish({ type: "message", message: reply });
      this.deps.publish({ type: "busy", busy: false });
      this.deps.publish({ type: "context", context: this.contextChip() });
      if (!reply.error && finalText) {
        const items = parseDiagnosticBlocks(finalText);
        if (items.length > 0) this.deps.onDiagnostics?.(items);
      }
    }
  }

  private async handleApproval(
    transport: ChatTransport,
    reply: ChatMessage,
    event: Extract<ChatEvent, { kind: "approval" }>,
  ): Promise<void> {
    const lineId = `approval-${event.id}`;
    if (this.approvals >= MAX_APPROVALS_PER_SESSION) {
      await transport.decideApproval(event.id, false).catch(() => undefined);
      this.setActivity(reply, {
        id: lineId,
        kind: "tool",
        text: `${event.tool} denied: too many approval requests this session`,
        state: "error",
      });
      return;
    }
    this.approvals++;
    this.setActivity(reply, { id: lineId, kind: "tool", text: `Waiting for approval: ${event.tool}`, state: "running" });
    const approved = await this.deps.confirmApproval({
      tool: event.tool,
      reason: event.reason,
      riskTier: event.riskTier,
      preview: event.preview,
    });
    await transport.decideApproval(event.id, approved).catch(() => undefined);
    this.setActivity(reply, {
      id: lineId,
      kind: "tool",
      text: `${event.tool} ${approved ? "approved" : "denied"}`,
      state: approved ? "ok" : "error",
    });
  }

  private handleError(reply: ChatMessage, err: unknown): void {
    if (err instanceof DaemonHttpError) {
      if (err.status === 401 || err.status === 403) {
        reply.error = "The daemon rejected the token. Run XR: Set daemon token.";
      } else if (err.status === 429) {
        reply.error = "XR is busy with another run for this workspace. Try again in a moment.";
      } else {
        reply.error = err.message;
      }
      const unauthorized = err.status === 401 || err.status === 403;
      this.deps.publish({
        type: "status",
        status: { ...this.deps.status(), state: unauthorized ? "unauthorized" : this.deps.status().state, detail: err.message },
      });
      return;
    }
    if (err instanceof Error && err.name === "AbortError") return;
    reply.error = "XR daemon is not reachable. XR must be running on your computer for chat to respond.";
    this.deps.publish({ type: "status", status: { state: "offline", detail: "Connection failed" } });
  }

  private systemNote(text: string): void {
    const msg: ChatMessage = { id: randomUUID(), role: "system", text, activity: [], streaming: false };
    this.messages.push(msg);
    this.deps.publish({ type: "message", message: msg });
  }

  private setActivity(reply: ChatMessage, line: ActivityLine): void {
    const existing = reply.activity.findIndex((a) => a.id === line.id);
    if (existing >= 0) reply.activity[existing] = line;
    else reply.activity.push(line);
    this.deps.publish({ type: "activity", id: reply.id, line });
  }

  private history(): Array<{ role: "user" | "assistant"; content: string }> {
    return this.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.streaming && !m.error && m.text)
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.text.slice(0, 6000) }));
  }
}

function describeRange(ed: EditorSnapshot): string {
  if (!ed.file) return "";
  if (ed.selection) return `${ed.file}:${ed.selection.startLine}-${ed.selection.endLine}`;
  return ed.file;
}

function selectionBlock(ed: EditorSnapshot): string {
  const sel = ed.selection!;
  const text = sel.text.length > MAX_SELECTION_CHARS ? sel.text.slice(0, MAX_SELECTION_CHARS) + "\n…" : sel.text;
  return `Selected code from ${ed.file ?? "the active editor"} (lines ${sel.startLine}-${sel.endLine}):\n\`\`\`${ed.languageId ?? ""}\n${text}\n\`\`\``;
}

/** Context string for the daemon. Instructions about the task, never the task itself. */
function contextString(ed: EditorSnapshot | null): string | undefined {
  if (!ed) return undefined;
  const parts = ["Client: VS Code extension."];
  if (ed.workspaceName) parts.push(`Workspace: ${ed.workspaceName}.`);
  if (ed.file) parts.push(`Active file: ${ed.file}${ed.languageId ? ` (${ed.languageId})` : ""}.`);
  parts.push("Reference files as path:line so the user can open them.");
  return parts.join(" ");
}
