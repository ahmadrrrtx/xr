import type { ActivityLine, ChatMessage } from "../../shared/protocol";
import { Markdown } from "./Markdown";

/**
 * One message. The user side is a compact right-aligned bubble. The XR side
 * shows a 16px sentinel, tool and status lines, the markdown answer, a streaming
 * cursor while tokens arrive, and a calm error line when a run fails.
 */
export function Message({ message, iconUri }: { message: ChatMessage; iconUri: string }) {
  if (message.role === "system") {
    return (
      <div className="msg system" role="note">
        {message.text}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="msg user">
        {message.contextLabel && <div className="ctx-label">{message.contextLabel}</div>}
        <div className="bubble">{message.text}</div>
      </div>
    );
  }

  return (
    <div className="msg assistant" aria-busy={message.streaming}>
      <div className="msg-head">
        {iconUri ? <img className="sentinel" src={iconUri} alt="" width={16} height={16} /> : null}
        <span className="msg-name">XR</span>
      </div>
      {message.activity.length > 0 && (
        <div className="activity-list">
          {message.activity.map((line) => (
            <ActivityRow key={line.id} line={line} />
          ))}
        </div>
      )}
      <div className="msg-body">
        {message.text ? <Markdown source={message.text} actions={!message.streaming} /> : null}
        {message.streaming && <span className="cursor" aria-hidden="true" />}
      </div>
      {message.error && (
        <div className="msg-error" role="alert">
          {message.error}
        </div>
      )}
    </div>
  );
}

function ActivityRow({ line }: { line: ActivityLine }) {
  return (
    <div className={`activity ${line.kind} ${line.state}`}>
      <span className={`activity-dot ${line.state}`} aria-hidden="true" />
      <span className="activity-text">{line.text}</span>
    </div>
  );
}
