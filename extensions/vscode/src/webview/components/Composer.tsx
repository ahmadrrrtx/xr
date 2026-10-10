import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ContextChip } from "../../shared/protocol";
import { post } from "../vscode";

const MIN_HEIGHT = 32;
const MAX_HEIGHT = 140;

/**
 * Multi-line composer. Enter sends, Shift+Enter adds a newline. The paperclip
 * toggles the editor selection as context, and the chip shows what will be sent.
 */
export function Composer({
  busy,
  context,
  seed,
  onSeedConsumed,
}: {
  busy: boolean;
  context: ContextChip;
  seed: string | null;
  onSeedConsumed: () => void;
}) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (seed !== null) {
      setText(seed);
      onSeedConsumed();
      ref.current?.focus();
    }
  }, [seed, onSeedConsumed]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, el.scrollHeight))}px`;
  }, [text]);

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    post({ type: "send", text: value });
    setText("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const hasSelection = context.selectedLines > 0;
  const chipLabel = !context.file
    ? "No file open"
    : hasSelection
      ? `${context.file} · ${context.selectedLines} ${context.selectedLines === 1 ? "line" : "lines"} selected`
      : context.file;

  return (
    <div className="composer">
      <div className="context-row">
        <button
          type="button"
          className={`chip-btn attach ${context.attached ? "on" : ""}`}
          aria-pressed={context.attached}
          aria-label={context.attached ? "Remove selection from the message" : "Add selection to the message"}
          title={hasSelection ? "Add the selected code to the next message" : "Select code in the editor first"}
          disabled={!hasSelection}
          onClick={() => post({ type: "toggleAttach" })}
        >
          <Clip />
          <span>{context.attached ? "Selection attached" : "Add selection"}</span>
        </button>
        <span className="context-file" title={chipLabel}>
          {chipLabel}
        </span>
      </div>
      <div className="input-row">
        <textarea
          ref={ref}
          className="input"
          aria-label="Message XR"
          placeholder="Ask XR about this code"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="send stop" aria-label="Stop" onClick={() => post({ type: "stop" })}>
            <StopIcon />
          </button>
        ) : (
          <button type="button" className="send" aria-label="Send" disabled={!text.trim()} onClick={send}>
            <ArrowUp />
          </button>
        )}
      </div>
    </div>
  );
}

function Clip() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M10.5 4.5 5.8 9.2a1.2 1.2 0 0 0 1.7 1.7l4.6-4.6a2.4 2.4 0 0 0-3.4-3.4L4.1 7.5a3.6 3.6 0 0 0 5.1 5.1l3.8-3.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2" y="2" width="8" height="8" rx="1.2" fill="currentColor" />
    </svg>
  );
}
