import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PanelState, ToWebview } from "../shared/protocol";
import { Composer } from "./components/Composer";
import { Header } from "./components/Header";
import { Message } from "./components/Message";
import { post } from "./vscode";

type Action = ToWebview;

/**
 * Host messages are applied as small patches so a token stream re-renders one
 * message, not the whole conversation.
 */
function reduce(state: PanelState | null, action: Action): PanelState | null {
  if (action.type === "init") return action.state;
  if (!state) return state;
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "context":
      return { ...state, context: action.context };
    case "busy":
      return { ...state, busy: action.busy };
    case "clear":
      return { ...state, messages: [] };
    case "seed":
      // Handled in the component (it prefills the composer), not in the chat state.
      return state;
    case "message": {
      const exists = state.messages.some((m) => m.id === action.message.id);
      const messages = exists
        ? state.messages.map((m) => (m.id === action.message.id ? action.message : m))
        : [...state.messages, action.message];
      return { ...state, messages };
    }
    case "delta":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? { ...m, text: m.text + action.text } : m)),
      };
    case "activity":
      return {
        ...state,
        messages: state.messages.map((m) => {
          if (m.id !== action.id) return m;
          const idx = m.activity.findIndex((a) => a.id === action.line.id);
          const activity = idx >= 0 ? m.activity.map((a, i) => (i === idx ? action.line : a)) : [...m.activity, action.line];
          return { ...m, activity };
        }),
      };
  }
}

export function App() {
  const [state, dispatch] = useReducer(reduce, null);
  const [seed, setSeed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as ToWebview | undefined;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      if (data.type === "seed") {
        setSeed(data.text);
        return;
      }
      dispatch(data);
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const messages = state?.messages ?? [];
  const lastLength = messages.reduce((n, m) => n + m.text.length + m.activity.length, 0);

  useEffect(() => {
    const el = listRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lastLength, messages.length]);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  if (!state) {
    return <div className="loading" role="status">Loading XR…</div>;
  }

  const status = state.status;
  const offline = status.state === "offline" || status.state === "connecting";
  const unauthorized = status.state === "unauthorized";

  return (
    <div className="app">
      <Header status={status} busy={state.busy} iconUri={state.iconUri} hasMessages={messages.length > 0} />

      {offline && (
        <div className="banner" role="status">
          <p>XR daemon is not running. XR must be running on your computer for chat to respond.</p>
          <div className="banner-actions">
            <button type="button" className="btn primary" onClick={() => post({ type: "startDaemon" })}>
              Start XR
            </button>
            <button type="button" className="btn" onClick={() => post({ type: "setToken" })}>
              Set token
            </button>
          </div>
        </div>
      )}

      {unauthorized && (
        <div className="banner error" role="alert">
          <p>{status.detail ?? "The daemon rejected the token."}</p>
          <div className="banner-actions">
            <button type="button" className="btn primary" onClick={() => post({ type: "setToken" })}>
              Set token
            </button>
          </div>
        </div>
      )}

      <div className="messages" role="log" aria-live="polite" aria-relevant="additions text" ref={listRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <Empty onPick={(t) => setSeed(t)} />
        ) : (
          messages.map((m) => <Message key={m.id} message={m} iconUri={state.iconUri} />)
        )}
      </div>

      <Composer
        busy={state.busy}
        context={state.context}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
      />
    </div>
  );
}

function Empty({ onPick }: { onPick: (text: string) => void }) {
  const picks = ["Explain this file", "What does the selection do?", "Find problems in the selection"];
  return (
    <div className="empty">
      <p className="empty-title">Ask XR about this workspace.</p>
      <p className="empty-sub">Answers come from the XR daemon on this computer. Select code and open the right-click menu, or use the XR link above a function.</p>
      <div className="picks">
        {picks.map((p) => (
          <button key={p} type="button" className="pick" onClick={() => onPick(p)}>
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
