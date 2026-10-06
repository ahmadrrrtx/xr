/*
 * TheaterStage (Phase 16) — the whole theater window.
 *
 *   z 0  star field (canvas)
 *   z 2  avatar bust, centred at 40 % height, subtitle under it
 *   z 3  transcript glass (captions toggle, karaoke sweep)
 *   z 4  approval card
 *   z 5  drag strip + near-invisible controls
 *
 * The stage renders the Phase 15 voice state it receives over the bus and
 * sends intents back; it never talks to the engine. Levels arrive at ≤30 fps
 * and go straight into a ref the bust reads inside its own rAF.
 */
import { Maximize2, Mic, MicOff, Minimize2, Minus, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { AvatarBust, bustCorePx, type Levels } from '@/components/brand/AvatarBust';
import { readSettingJSON, writeSettingJSON } from '@/lib/persistent-store';
import { isTauri } from '@/lib/tauri';
import {
  emitTheater,
  listenTheater,
  theaterIsFullscreen,
  theaterSetFullscreen,
  theaterShowContextMenu,
  theaterWindowOp,
} from '@/lib/theater';
import {
  ERROR_SUBTITLE_MS,
  THEATER_ANNOUNCE,
  THEATER_IN,
  THEATER_KEYS,
  THEATER_OUT,
  keyAction,
  theaterStateFor,
  type TheaterCaption,
} from '@/lib/theaterCore';
import { ApprovalCard, TranscriptPanel, type ApprovalView, type Karaoke } from '@/theater/panels';
import { StarField } from '@/theater/StarField';

/** 280 px in the 900×700 window; shrinks with short windows (min 600×400). */
function avatarSizeFor(innerHeight: number): number {
  return Math.round(Math.min(280, Math.max(170, innerHeight * 0.4)));
}

interface Stage {
  voiceState: string;
  active: boolean;
  muted: boolean;
  captions: TheaterCaption[];
  approval: ApprovalView | null;
  errorAt: number | null;
  /** false once the 4 s error window has closed */
  errorActive: boolean;
  errorMessage: string | null;
  karaoke: Karaoke | null;
}

type Action =
  | { type: 'state'; state: string; active: boolean }
  | { type: 'snapshot'; snap: Partial<Stage> }
  | { type: 'transcript'; captions: TheaterCaption[] }
  | { type: 'approval'; approval: ApprovalView | null }
  | { type: 'error'; message: string; at: number }
  | { type: 'mute'; muted: boolean }
  | { type: 'word'; karaoke: Karaoke }
  | { type: 'error-expired' };

const INITIAL: Stage = {
  voiceState: 'idle',
  active: false,
  muted: false,
  captions: [],
  approval: null,
  errorAt: null,
  errorActive: false,
  errorMessage: null,
  karaoke: null,
};

function reduce(stage: Stage, action: Action): Stage {
  switch (action.type) {
    case 'state':
      return { ...stage, voiceState: action.state, active: action.active, karaoke: action.state === 'speaking' ? stage.karaoke : null };
    case 'snapshot':
      return { ...stage, ...action.snap };
    case 'transcript':
      return { ...stage, captions: action.captions };
    case 'approval':
      return { ...stage, approval: action.approval };
    case 'error':
      return { ...stage, errorAt: action.at, errorActive: true, errorMessage: action.message };
    case 'mute':
      return { ...stage, muted: action.muted };
    case 'word':
      return { ...stage, karaoke: action.karaoke.index >= action.karaoke.total ? null : action.karaoke };
    case 'error-expired':
      return { ...stage, errorActive: false };
  }
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toCaptions(v: unknown): TheaterCaption[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((c: unknown, i) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const role = o.role === 'you' || o.role === 'xr' || o.role === 'system' ? o.role : null;
      return role ? { id: typeof o.id === 'number' ? o.id : i, role, text: str(o.text) } : null;
    })
    .filter((c): c is TheaterCaption => c !== null);
}

function toApproval(v: unknown): ApprovalView | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' ? { id: o.id, tool: str(o.tool) || undefined, reason: str(o.reason) || undefined } : null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

export function TheaterStage() {
  const [stage, dispatch] = useReducer(reduce, INITIAL);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [avatarSize, setAvatarSize] = useState(() => avatarSizeFor(window.innerHeight));
  const reduced = usePrefersReducedMotion();
  const levels = useRef<Levels>({ mic: 0, out: 0 });
  const sparkOrigin = useRef({ x: 0, y: 0 });
  const avatarBox = useRef<HTMLDivElement>(null);

  // Pure derivation: the error window is tracked by the reducer (no clock
  // reads during render), so `now` is simply the error's own timestamp.
  const state = theaterStateFor({
    state: stage.voiceState,
    active: stage.active,
    approval: stage.approval !== null,
    errorAt: stage.errorActive ? stage.errorAt : null,
    now: stage.errorAt ?? 0,
  });

  /* ── bus ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const offs = [
      listenTheater(THEATER_IN.state, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({ type: 'state', state: str(o.state, 'idle'), active: o.active !== false });
      }),
      listenTheater(THEATER_IN.snapshot, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({
          type: 'snapshot',
          snap: {
            voiceState: str(o.state, 'idle'),
            active: o.active === true,
            muted: o.muted === true,
            captions: toCaptions(o.captions),
            approval: toApproval(o.approval),
          },
        });
      }),
      listenTheater(THEATER_IN.transcript, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({ type: 'transcript', captions: toCaptions(o.captions) });
      }),
      listenTheater(THEATER_IN.level, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        levels.current = { mic: num(o.mic), out: num(o.out) };
      }),
      listenTheater(THEATER_IN.ttsWord, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({ type: 'word', karaoke: { id: str(o.id), text: str(o.text), index: num(o.index), total: num(o.total) } });
      }),
      listenTheater(THEATER_IN.approval, (p) => dispatch({ type: 'approval', approval: toApproval(p) })),
      listenTheater(THEATER_IN.error, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({ type: 'error', message: str(o.message, 'Something went wrong.'), at: Date.now() });
      }),
      listenTheater(THEATER_IN.mute, (p) => {
        const o = (p ?? {}) as Record<string, unknown>;
        dispatch({ type: 'mute', muted: o.muted === true });
      }),
      listenTheater('theater:toggle-subtitles', () => setCaptionsOn((on) => !on)),
    ];
    emitTheater(THEATER_OUT.ready);
    // Browser tab only: the shell's CloseRequested announces the close.
    const onPageHide = (): void => {
      if (!isTauri()) emitTheater(THEATER_OUT.close);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      offs.forEach((off) => off());
    };
  }, []);

  // Persisted captions preference + the live fullscreen flag.
  useEffect(() => {
    void readSettingJSON<boolean>(THEATER_KEYS.captions).then((v) => {
      if (v === false) setCaptionsOn(false);
    });
    void theaterIsFullscreen().then(setFullscreen);
    const onFs = (): void => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // The error look is finite: 4 s, then the loop state shows again.
  useEffect(() => {
    if (stage.errorAt === null) return;
    const t = window.setTimeout(() => dispatch({ type: 'error-expired' }), ERROR_SUBTITLE_MS);
    return () => window.clearTimeout(t);
  }, [stage.errorAt]);

  // Spark origin = chest core in CSS px; avatar size follows the window.
  useEffect(() => {
    const measure = (): void => {
      setAvatarSize(avatarSizeFor(window.innerHeight));
      const box = avatarBox.current;
      if (!box) return;
      const rect = box.getBoundingClientRect();
      const core = bustCorePx(avatarSize);
      sparkOrigin.current = { x: rect.left + core.x, y: rect.top + core.y };
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [avatarSize]);

  /* ── intents ─────────────────────────────────────────────────────── */
  const toggleCaptions = useCallback(() => {
    setCaptionsOn((on) => {
      writeSettingJSON(THEATER_KEYS.captions, !on);
      return !on;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const next = !fullscreen;
    setFullscreen(next);
    void theaterSetFullscreen(next);
  }, [fullscreen]);

  const close = useCallback(() => {
    void theaterWindowOp('close');
  }, []);

  const decide = useCallback((id: string, approved: boolean) => {
    emitTheater(approved ? THEATER_OUT.approve : THEATER_OUT.deny, { id });
    dispatch({ type: 'approval', approval: null });
  }, []);

  // Keys: Space mic · M mute · F fullscreen · Esc · T transcript.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const inControl = !!target && /^(button|input|textarea|select)$/i.test(target.tagName);
      const action = keyAction({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, inControl });
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case 'toggle-listen':
          emitTheater(THEATER_OUT.toggleListen);
          break;
        case 'toggle-mute':
          emitTheater(THEATER_OUT.toggleMute);
          break;
        case 'fullscreen':
          toggleFullscreen();
          break;
        case 'transcript':
          toggleCaptions();
          break;
        case 'escape':
          if (fullscreen) toggleFullscreen();
          else close();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, toggleFullscreen, toggleCaptions, close]);

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    void theaterShowContextMenu();
  }, []);

  /* ── derived copy ────────────────────────────────────────────────── */
  const subtitle =
    state === 'approval' ? 'Needs your approval' : state === 'error' ? 'Hmm, something went wrong.' : '';
  const showHint = !stage.active && stage.captions.length === 0;

  return (
    <div className="theater-stage" data-state={state} data-reduced={reduced || undefined} onContextMenu={onContextMenu}>
      <StarField speaking={state === 'speaking'} reduced={reduced} origin={sparkOrigin} />

      <div className="theater-drag" data-tauri-drag-region aria-hidden="true" />

      <div className="theater-controls" role="toolbar" aria-label="Theater controls">
        <Control label="Minimize" onClick={() => void theaterWindowOp('minimize')}>
          <Minus size={16} />
        </Control>
        <Control
          label={stage.muted ? 'Unmute microphone' : 'Mute microphone'}
          pressed={stage.muted}
          onClick={() => emitTheater(THEATER_OUT.toggleMute)}
        >
          {stage.muted ? <MicOff size={16} /> : <Mic size={16} />}
        </Control>
        <Control label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={toggleFullscreen}>
          {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Control>
        <Control label="Voice settings" onClick={() => emitTheater(THEATER_OUT.openSettings)}>
          <Settings size={16} />
        </Control>
        <Control label="Close theater" onClick={close}>
          <X size={16} />
        </Control>
      </div>

      <div ref={avatarBox} className="theater-avatar">
        <AvatarBust size={avatarSize} state={state} muted={stage.muted} reduced={reduced} levels={levels} />
        <p className="theater-subtitle" data-show={subtitle ? 'true' : 'false'} data-tone={state === 'error' ? 'error' : 'warning'} aria-hidden="true">
          {subtitle || '\u00a0'}
        </p>
      </div>

      <div className="theater-bottom">
        {stage.approval && <ApprovalCard approval={stage.approval} onDecide={decide} />}
        {captionsOn && <TranscriptPanel captions={stage.captions} karaoke={stage.karaoke} showHint={showHint} />}
      </div>

      {/* screen-reader state line (visual state is the avatar) */}
      <p className="sr-only" aria-live="polite" role="status">
        {THEATER_ANNOUNCE[state]}
        {state === 'error' && stage.errorMessage ? ` ${stage.errorMessage}` : ''}
      </p>
    </div>
  );
}

function Control({ label, pressed, onClick, children }: { label: string; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="theater-btn" aria-label={label} title={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}
