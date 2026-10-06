/*
 * Theater panels (Phase 16): the transcript glass and the approval card.
 * Pure presentation — the stage owns state and IPC.
 */
import { ShieldAlert } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';

import { approvalLine, splitWords, visibleTurns, type TheaterCaption } from '@/lib/theaterCore';

export interface Karaoke {
  id: string;
  text: string;
  /** words before this index have been spoken; `index === total` ⇒ done */
  index: number;
  total: number;
}

const ROLE_LABEL: Record<TheaterCaption['role'], string> = { you: 'You:', xr: 'XR:', system: '' };

interface TranscriptPanelProps {
  captions: readonly TheaterCaption[];
  karaoke: Karaoke | null;
  /** Session idle and nothing said yet → the one-line hint. */
  showHint: boolean;
}

export const TranscriptPanel = memo(function TranscriptPanel({ captions, karaoke, showHint }: TranscriptPanelProps) {
  const turns = visibleTurns(captions);
  const scroller = useRef<HTMLDivElement>(null);

  // Newest line always in view (the panel is capped at 200 px).
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, karaoke?.index]);

  // The karaoke sweep applies to the newest XR line that carries the utterance.
  const karaokeId = karaoke ? [...turns].reverse().find((c) => c.role === 'xr' && c.text.trim() === karaoke.text.trim())?.id : undefined;

  return (
    <div ref={scroller} className="theater-transcript" role="log" aria-live="polite" aria-label="Transcript">
      {turns.length === 0 ? (
        <p className="theater-hint">{showHint ? 'Press Space or say “Hey XR” to start.' : ' '}</p>
      ) : (
        <dl style={{ margin: 0 }}>
          {turns.map((caption) => (
            <div key={caption.id} className="theater-line" data-role={caption.role}>
              <dt aria-label={caption.role === 'you' ? 'You' : caption.role === 'xr' ? 'XR' : undefined}>
                {ROLE_LABEL[caption.role]}
              </dt>
              <dd>
                {karaoke && caption.id === karaokeId ? <KaraokeText text={caption.text} spoken={karaoke.index} /> : caption.text}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
});

function KaraokeText({ text, spoken }: { text: string; spoken: number }) {
  const words = splitWords(text);
  return (
    <>
      {words.map((word, i) => (
        <span key={i} className="theater-word" data-spoken={i < spoken ? 'true' : 'false'}>
          {word}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </>
  );
}

export interface ApprovalView {
  id: string;
  tool?: string;
  reason?: string;
}

interface ApprovalCardProps {
  approval: ApprovalView;
  onDecide: (id: string, approved: boolean) => void;
}

export const ApprovalCard = memo(function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Focus lands on the safe choice — the same rule as the emergency dialogs.
  useEffect(() => {
    cancelRef.current?.focus();
  }, [approval.id]);

  return (
    <section
      className="theater-approval"
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="theater-approval-title"
      aria-describedby="theater-approval-desc"
    >
      <ShieldAlert size={22} color="#F59E0B" aria-hidden="true" />
      <div>
        <h2 id="theater-approval-title">Approval needed</h2>
        <p id="theater-approval-desc">{approvalLine(approval.tool, approval.reason) || 'XR wants to run an action.'}</p>
      </div>
      <div className="theater-approval-actions">
        <button ref={cancelRef} type="button" className="theater-action" data-kind="ghost" onClick={() => onDecide(approval.id, false)}>
          Cancel
        </button>
        <button type="button" className="theater-action" data-kind="primary" onClick={() => onDecide(approval.id, true)}>
          Confirm
        </button>
      </div>
    </section>
  );
});
