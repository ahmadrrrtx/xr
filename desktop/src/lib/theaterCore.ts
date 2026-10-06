/*
 * Voice Theater primitives (Phase 16) — dependency-free so the root test tier
 * can import them by path (the orbCore.ts pattern).
 *
 * Everything about the theater that is NOT a DOM/Tauri call lives here: the
 * voice-state → avatar-state reducer, the karaoke time sweep, star-field
 * sizing, transcript trimming, the keyboard map and the shared constants that
 * the main window and the theater window must agree on.
 */

/* ── Event names (one contract for both transports) ──────────────────── */

/** main → theater */
export const THEATER_IN = {
  state: 'voice:state-changed',
  snapshot: 'voice:snapshot',
  transcript: 'voice:transcript',
  level: 'voice:level',
  ttsWord: 'voice:tts-word',
  approval: 'voice:approval',
  error: 'voice:error',
  mute: 'voice:mute-changed',
} as const;

/** theater → main */
export const THEATER_OUT = {
  ready: 'theater:ready',
  close: 'theater:close',
  toggleMute: 'theater:toggle-mute',
  toggleListen: 'theater:toggle-listen',
  approve: 'theater:approve',
  deny: 'theater:deny',
  openSettings: 'theater:open-settings',
} as const;

/** Browser transport (no Tauri): one BroadcastChannel shared by every tab. */
export const THEATER_CHANNEL = 'xr-voice-theater';

/** Tauri Store / localStorage keys (`settings.json`, read by Rust too). */
export const THEATER_KEYS = {
  captions: 'xr.theater.captions',
  secondMonitor: 'xr.theater.secondMonitor',
  closeStopsVoice: 'xr.theater.closeStopsVoice',
  alwaysOnTop: 'xr.theater.alwaysOnTop',
} as const;

/* ── Avatar state ────────────────────────────────────────────────────── */

export const THEATER_STATES = ['idle', 'listening', 'thinking', 'speaking', 'approval', 'error'] as const;
export type TheaterState = (typeof THEATER_STATES)[number];

const VOICE_TO_THEATER: Record<string, TheaterState> = {
  idle: 'idle',
  offline: 'idle',
  success: 'idle',
  listening: 'listening',
  interrupted: 'listening',
  thinking: 'thinking',
  planning: 'thinking',
  working: 'thinking',
  tool: 'thinking',
  speaking: 'speaking',
  approval: 'approval',
  error: 'error',
};

/** The error look is a finite flash — red eyes for 4 s, then settle. */
export const ERROR_VISIBLE_MS = 4_000;

export interface TheaterInputs {
  /** `voice:state-changed.state` (unknown: IPC payloads are plain JSON). */
  state: unknown;
  /** `voice:state-changed.active` — a finished session is idle. */
  active: unknown;
  /** A pending approval wins over whatever the loop state says. */
  approval: boolean;
  /** When the last `voice:error` arrived (ms epoch), or null. */
  errorAt: number | null;
  now: number;
}

/**
 * Voice loop state → the one avatar state the stage renders. Approval and a
 * fresh error are overlays on the loop (the engine keeps streaming states
 * underneath them), so they take precedence for as long as they last.
 */
export function theaterStateFor(input: TheaterInputs): TheaterState {
  if (input.approval) return 'approval';
  if (input.errorAt !== null && input.now - input.errorAt < ERROR_VISIBLE_MS) return 'error';
  if (input.active === false) return 'idle';
  if (typeof input.state !== 'string') return 'idle';
  return VOICE_TO_THEATER[input.state] ?? 'idle';
}

/** Muted dims the sentinel only while it would otherwise be listening/idle. */
export function showsMutedLook(state: TheaterState, muted: boolean): boolean {
  return muted && (state === 'idle' || state === 'listening');
}

/** Screen-reader copy per state (sentence case, no marketing). */
export const THEATER_ANNOUNCE: Record<TheaterState, string> = {
  idle: 'XR is idle.',
  listening: 'XR is listening.',
  thinking: 'XR is thinking.',
  speaking: 'XR is speaking.',
  approval: 'XR needs your approval.',
  error: 'Something went wrong.',
};

/* ── Karaoke sweep ───────────────────────────────────────────────────── */

export interface WordTiming {
  index: number;
  /** ms from playback start */
  start: number;
  end: number;
}

/** Split an utterance into display words (whitespace-delimited, no empties). */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w.length > 0);
}

/** Rough speaking weight: characters + a breath after punctuation. */
function wordWeight(word: string): number {
  let weight = word.length + 1; // the space after the word
  if (/[,;:]$/.test(word)) weight += 2;
  if (/[.!?…]$/.test(word)) weight += 4;
  return weight;
}

/**
 * Character-weighted linear sweep over a known audio duration. Piper has no
 * word alignment, so this is the honest best effort: long words and clause
 * endings take proportionally longer. Returns one timing per word; an empty
 * text yields an empty timeline.
 */
export function wordTimeline(text: string, durationMs: number): WordTiming[] {
  const words = splitWords(text);
  if (words.length === 0 || !(durationMs > 0)) return [];
  const weights = words.map(wordWeight);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let cursor = 0;
  return words.map((_, index) => {
    const start = (cursor / total) * durationMs;
    cursor += weights[index];
    const end = (cursor / total) * durationMs;
    return { index, start, end };
  });
}

/**
 * Which word is being spoken `elapsedMs` into playback. Before the first word
 * → 0; after the last word → `timings.length` (the "done" index, so callers
 * can render every word as spoken).
 */
export function activeWordIndex(timings: readonly WordTiming[], elapsedMs: number): number {
  if (timings.length === 0) return 0;
  if (elapsedMs >= timings[timings.length - 1].end) return timings.length;
  for (const timing of timings) {
    if (elapsedMs < timing.end) return timing.index;
  }
  return timings.length;
}

/* ── Star field ──────────────────────────────────────────────────────── */

export interface StarLayerSpec {
  /** stars per 630 000 px² (the 900×700 reference window) */
  reference: number;
  size: number;
  color: string;
  /** px per frame at 60 fps */
  drift: number;
}

export const STAR_LAYERS: readonly StarLayerSpec[] = [
  { reference: 150, size: 1, color: 'rgba(180,230,255,0.4)', drift: 0.02 },
  { reference: 60, size: 1.5, color: 'rgba(200,240,255,0.55)', drift: 0.05 },
  { reference: 20, size: 2, color: 'rgba(0,229,255,0.8)', drift: 0.1 },
];

const REFERENCE_AREA = 900 * 700;
/** Low-end devices keep 30 % of the stars. */
export const LOW_END_STAR_FACTOR = 0.3;
/** Sparks rising from the chest while speaking. */
export const SPARKS_PER_SECOND = 5;
/** Frame-time probe window and threshold (2 s, > 24 ms avg ⇒ low end). */
export const PROBE_MS = 2_000;
export const LOW_END_FRAME_MS = 24;

/** Star count per layer for a viewport — proportional to area, never below 4. */
export function starCounts(width: number, height: number, lowEnd: boolean): number[] {
  const area = Math.max(0, width) * Math.max(0, height);
  const scale = (area / REFERENCE_AREA) * (lowEnd ? LOW_END_STAR_FACTOR : 1);
  return STAR_LAYERS.map((layer) => Math.max(4, Math.round(layer.reference * scale)));
}

/** Low-end heuristic: sub-1 DPR screens or a slow average frame. */
export function isLowEnd(devicePixelRatio: number, averageFrameMs: number | null): boolean {
  if (devicePixelRatio < 1) return true;
  return averageFrameMs !== null && averageFrameMs > LOW_END_FRAME_MS;
}

/* ── Transcript ──────────────────────────────────────────────────────── */

export interface TheaterCaption {
  id: number;
  role: 'you' | 'xr' | 'system';
  text: string;
}

export const TRANSCRIPT_MAX_TURNS = 4;

/** Last N non-empty captions, oldest first (the panel reads top → bottom). */
export function visibleTurns(captions: readonly TheaterCaption[], max = TRANSCRIPT_MAX_TURNS): TheaterCaption[] {
  const kept = captions.filter((c) => c.text.trim().length > 0);
  return kept.slice(Math.max(0, kept.length - max));
}

/** "{tool} · {reason}" trimmed for the approval card's second line. */
export function approvalLine(tool: unknown, reason: unknown, max = 96): string {
  const parts = [tool, reason].filter((p): p is string => typeof p === 'string' && p.trim().length > 0);
  const line = parts.join(' · ');
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/* ── Keyboard ────────────────────────────────────────────────────────── */

export type TheaterKeyAction = 'toggle-listen' | 'toggle-mute' | 'fullscreen' | 'escape' | 'transcript';

export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  /** Focus is on a button/input — Space must stay the native activation. */
  inControl?: boolean;
}

/** Stage keys: Space mic · M mute · F fullscreen · Esc · T transcript. */
export function keyAction(event: KeyLike): TheaterKeyAction | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (event.key) {
    case ' ':
    case 'Spacebar':
      return event.inControl ? null : 'toggle-listen';
    case 'm':
    case 'M':
      return event.inControl ? null : 'toggle-mute';
    case 'f':
    case 'F':
      return event.inControl ? null : 'fullscreen';
    case 'Escape':
      return 'escape';
    case 't':
    case 'T':
      return event.inControl ? null : 'transcript';
    default:
      return null;
  }
}

/** Level pump cadence (main → theater), per the brief. */
export const LEVEL_FPS = 30;
/** Error subtitle under the avatar auto-dismisses after this. */
export const ERROR_SUBTITLE_MS = 4_000;
/** State-transition timing (spring 280 ms ≈ this ease with a hint of overshoot). */
export const THEATER_EASE = 'cubic-bezier(0.34, 1.16, 0.64, 1)';
export const THEATER_TRANSITION_MS = 280;
