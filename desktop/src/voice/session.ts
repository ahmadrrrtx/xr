/*
 * Voice session controller (Phase 15) — one instance per window.
 *
 *   mic ──► gain ──► analyser ──► ScriptProcessor(4096)
 *            │                        │ Float32 @ ctx rate → box-filter → 16 kHz Int16
 *            │                        └─► 150 ms base64 chunks → POST /voice/audio
 *   engine SSE /voice/events ──► state · final · tts(wav) · tts_stop · approval ·
 *                                status · error · download · cost
 *   tts wav ──► decodeAudioData ──► BufferSource(detune = pitch) ──► analyser ──► out
 *
 * Rules that live here, not in React:
 *   • ONE AudioContext, created on a user gesture (start/press) and reused.
 *   • Barge-in is local and immediate: mic energy while speaking stops the
 *     source first, then tells the engine.
 *   • Nothing is sent while the engine is speaking (it would ignore it) or
 *     while muted / un-pressed in hold mode.
 *   • Silence auto-exit (hold/tap) with a soft chime; wake chime on start.
 *   • Every failure becomes a visible error (store + Bell) — never silence.
 */
import { toast } from 'sonner';

import { bridgeEngineApproval } from '@/engine/approvals';
import { readSse } from '@/engine/sse';
import { EngineDown, EngineHttpError } from '@/engine/transport';
import type { AvatarState } from '@/components/brand/types';
import { sendNotification, decideApproval } from '@/lib/approvalEvents';
import { orbSetState } from '@/lib/orb';
import { isTauri } from '@/lib/tauri';
import { emitTheater } from '@/lib/theater';
import { THEATER_IN } from '@/lib/theaterCore';
import { useApprovalStore } from '@/stores/approvalStore';
import { useEngineStore } from '@/stores/engineStore';

import {
  bytesToBase64,
  concatPcm16,
  floatToPcm16,
  resampleTo16k,
  TARGET_RATE,
} from './audio';
import { voiceApi, type VoiceEngineEvent, type VoiceSessionState } from './voiceApi';
import { applyDownloadEvent, useVoiceStore, type MicPermission } from './voiceStore';
import { closeMicrophone, openMicrophone, SessionPlayback, type MicGraph, type PlaybackEvent } from './sessionAudio';

const FLUSH_MS = 150;
const SPEECH_RMS = 0.02;
const BARGE_RMS = 0.06;
const BARGE_MS = 220;
const HOLD_TAIL_MS = 900;
const SEND_FAILURES_BEFORE_ERROR = 4;

export type VoiceOrigin = 'screen' | 'docked' | 'hotkey' | 'orb' | 'chat' | 'theater';

/** Playback observer (Phase 16 karaoke): one utterance started / stopped. */
export type TtsEvent = PlaybackEvent;

export interface VoiceLevels {
  /** Mic RMS after gain (0..1). */
  mic: number;
  /** Playback RMS (0..1). */
  out: number;
  /** Mic peak (0..1) — the meter turns red at ≥ 0.985. */
  peak: number;
  clipped: boolean;
}

export function avatarStateFor(state: VoiceSessionState): AvatarState {
  switch (state) {
    case 'listening':
    case 'interrupted':
      return 'listening';
    case 'thinking':
    case 'planning':
    case 'working':
    case 'tool':
      return 'thinking';
    case 'approval':
      return 'waiting-approval';
    case 'speaking':
      return 'speaking';
    case 'error':
      return 'error';
    case 'offline':
      return 'sleeping';
    default:
      return 'idle';
  }
}

export const STATE_COPY: Record<VoiceSessionState, string> = {
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  planning: 'Planning…',
  working: 'Working…',
  tool: 'Using a tool…',
  approval: 'Needs your approval',
  speaking: 'Speaking',
  success: 'Done',
  interrupted: 'Interrupted',
  error: 'Something went wrong',
  offline: 'Engine offline',
};

interface SessionRun { generation: number; abort: AbortController; engineRequested: boolean }

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    if (signal.aborted) done(); else signal.addEventListener('abort', done, { once: true });
  });
}

export class VoiceController {
  readonly levels: VoiceLevels = { mic: 0, out: 0, peak: 0, clipped: false };

  private ctx: AudioContext | null = null;
  private mic: MicGraph | null = null;
  private ttsObservers = new Set<(ev: TtsEvent) => void>();
  private pending: Int16Array[] = [];
  private flushTimer: number | null = null;
  private bargeHotMs = 0;
  private sendFailures = 0;
  private lastActivityAt = 0;
  private exitTimer: number | null = null;
  private sseAbort: AbortController | null = null;
  private retains = 0;
  private run: SessionRun | null = null;
  private starting: { run: SessionRun; task: Promise<boolean> } | null = null;
  private stopping: Promise<void> | null = null;
  private sessionCommands: Promise<unknown> = Promise.resolve();
  private micAttempt = 0;
  private readonly playback = new SessionPlayback({
    context: () => this.ensureContext(), pitch: () => useVoiceStore.getState().settings?.desktop.ttsPitch ?? 0,
    levels: this.levels, notify: ev => this.notifyTts(ev), touch: () => this.touch(),
    fail: () => this.fail('tts-decode', 'The reply audio could not be played.'),
    played: () => { const run = this.run; if (run && this.current(run)) void voiceApi.played({ signal: run.abort.signal }).catch(() => {}); },
  });
  private readonly approvalAbort = new Map<string, AbortController>();
  private readonly scratch = new Float32Array(new ArrayBuffer(1024 * 4));

  constructor() {
    // A replaced engine cannot own old mic grants, decodes, requests or streams.
    useEngineStore.subscribe((next, previous) => {
      if (next.generation !== previous.generation || next.status !== 'ready') {
        void this.stop('engine'); this.releaseEvents();
        if (next.generation !== previous.generation) this.sessionCommands = Promise.resolve();
      }
      if (this.retains > 0 && next.status === 'ready') this.ensureEvents();
    });
  }

  private current(run: SessionRun): boolean {
    const engine = useEngineStore.getState();
    return this.run === run && !run.abort.signal.aborted && run.generation === engine.generation && engine.status === 'ready';
  }

  private sessionCommand(action: 'start' | 'stop', run: SessionRun): Promise<void> {
    const command = this.sessionCommands.catch(() => {}).then(async () => {
      if (run.generation !== useEngineStore.getState().generation || (action === 'start' && !this.current(run))) return;
      if (action === 'start') run.engineRequested = true;
      // Do not abort a start acknowledgement: a queued stop must follow it,
      // never race ahead of a start the engine has not committed yet.
      await voiceApi.session(action);
    });
    this.sessionCommands = command;
    return command;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  /** Screens hold the SSE open while mounted (download progress rides on it). */
  retain(): () => void {
    this.retains += 1;
    this.ensureEvents();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.retains -= 1;
      this.maybeReleaseEvents();
    };
  }

  get active(): boolean {
    return useVoiceStore.getState().active;
  }

  /** The user gesture entry point — mic, engine session, SSE, chime. */
  start(origin: VoiceOrigin = 'screen'): Promise<boolean> {
    if (this.run && this.current(this.run)) {
      if (this.active) return Promise.resolve(true);
      if (this.starting?.run === this.run) return this.starting.task;
    }
    const run: SessionRun = { generation: useEngineStore.getState().generation, abort: new AbortController(), engineRequested: false };
    this.run = run;
    const task = this.startRun(run, origin).finally(() => {
      if (this.starting?.run === run) this.starting = null;
      if (this.run === run && !this.active) { this.run = null; run.abort.abort(); this.closeMic(); this.maybeReleaseEvents(); }
    });
    this.starting = { run, task };
    return task;
  }

  private async startRun(run: SessionRun, origin: VoiceOrigin): Promise<boolean> {
    try {
      const ctx = this.ensureContext(); // Created synchronously on the user gesture.
      if (ctx.state === 'suspended') await ctx.resume();
      if (!this.current(run)) return false;
      const status = await useVoiceStore.getState().refreshStatus();
      if (!this.current(run)) return false;
      if (!status) { this.fail('engine-disconnected', 'The engine is not reachable. Voice needs it running.'); return false; }
      if (!status.stt.loaded) { this.fail('stt-model-missing', 'Speech recognition is not installed yet.', { silent: true }); return false; }
      const settings = status.settings;
      if (!await this.openMic(run, settings.desktop.micDeviceId, settings.noiseSuppression, settings.desktop.inputGain)) return false;
      if (!this.current(run)) return false;
      await this.sessionCommand('start', run);
      if (!this.current(run)) return false;
      useVoiceStore.getState()._session({
        active: true, origin, startedAt: Date.now(),
        muted: settings.desktop.activation === 'hold' && !useVoiceStore.getState().pressed,
        error: null, approval: null, sessionState: 'listening',
      });
      useVoiceStore.getState()._clearCaptions();
      useVoiceStore.setState(s => ({ cost: { ...s.cost, sessionUsd: 0 } }));
      this.sendFailures = 0;
      // Begin with this session's fresh state, not buffered events from a prior run.
      this.releaseEvents(); this.ensureEvents(); this.startFlusher(); this.touch(); this.startExitWatch();
      if (settings.wakeSound) this.chime('start');
      this.broadcastState('listening');
      if (origin === 'hotkey') void this.bringForward();
      return true;
    } catch (e) {
      if (!this.current(run)) return false;
      if (e instanceof EngineHttpError && e.status === 409) {
        this.fail(String(e.body?.error ?? 'stt-model-missing'), String(e.body?.detail ?? e.message), { silent: true });
      } else if (e instanceof EngineDown) {
        this.fail('engine-disconnected', 'The engine is not reachable. Voice needs it running.');
      } else this.fail('session-failed', e instanceof Error ? e.message : 'Could not start the session.');
      void this.stop('error');
      return false;
    }
  }

  stop(reason: 'user' | 'silence' | 'mic-lost' | 'engine' | 'error' = 'user'): Promise<void> {
    const run = this.run;
    if (!run) return this.stopping ?? Promise.resolve();
    this.run = null; run.abort.abort();
    const wasActive = useVoiceStore.getState().active;
    this.stopExitWatch(); this.stopFlusher(); this.stopPlayback(); this.closeMic();
    for (const ac of this.approvalAbort.values()) ac.abort();
    this.approvalAbort.clear();
    useVoiceStore.getState()._session({ active: false, pressed: false, muted: false, origin: null, approval: null, sessionState: 'idle' });
    useVoiceStore.getState().setDocked(false);
    if (wasActive && reason === 'silence') {
      this.chime('bye'); toast('Voice session ended', { description: 'Quiet for a while — tap the mic when you need me.' });
    }
    if (wasActive && reason === 'mic-lost') toast.warning('Microphone disconnected', { description: 'The session stopped cleanly. Plug a mic back in and start again.' });
    this.broadcastState('idle'); this.maybeReleaseEvents();
    const previous = this.stopping;
    const command = run.engineRequested && reason !== 'engine' ? this.sessionCommand('stop', run).catch(() => {}) : Promise.resolve();
    const task = Promise.all([previous, command]).then(() => {}).finally(() => { if (this.stopping === task) this.stopping = null; });
    this.stopping = task;
    return task;
  }

  private lastToggleAt = 0;

  /** Debounced: the native global shortcut and the in-app combo can both fire. */
  async toggle(origin: VoiceOrigin = 'screen'): Promise<void> {
    const now = Date.now();
    if (now - this.lastToggleAt < 400) return;
    this.lastToggleAt = now;
    if (this.run) await this.stop('user');
    else await this.start(origin);
  }

  /* ── hold-to-talk ───────────────────────────────────────────────────── */

  async pressStart(origin: VoiceOrigin = 'screen'): Promise<void> {
    useVoiceStore.getState()._session({ pressed: true });
    const task = this.start(origin), run = this.run;
    const ok = await task;
    if (!ok) {
      if (!this.run || this.run === run) useVoiceStore.getState()._session({ pressed: false });
      return;
    }
    if (!run || !this.current(run)) return;
    // A release while permission/start was pending must remain muted in hold mode.
    const store = useVoiceStore.getState();
    if (store.settings?.desktop.activation !== 'hold' || store.pressed) store._session({ muted: false });
    this.touch();
  }

  pressEnd(): void {
    const s = useVoiceStore.getState();
    if (!s.pressed) return;
    s._session({ pressed: false });
    if (!s.active) return;
    // A short silence tail lets the engine's endpointer close the utterance.
    const frames = Math.round((HOLD_TAIL_MS / 1000) * TARGET_RATE);
    this.pending.push(new Int16Array(frames));
    this.flush();
    if (s.settings?.desktop.activation === 'hold') s._session({ muted: true });
  }

  setMuted(muted: boolean): void {
    useVoiceStore.getState()._session({ muted });
    if (!muted) this.touch();
  }

  toggleMuted(): void {
    this.setMuted(!useVoiceStore.getState().muted);
  }

  bargeIn(): void {
    if (!this.playback.playing) return;
    this.stopPlayback();
    const run = this.run;
    if (run && this.current(run)) void voiceApi.bargeIn({ signal: run.abort.signal }).catch(() => undefined);
    this.touch();
  }

  /** Mic is open → push the live mic waveform; speaking → playback waveform. */
  waveform(target: Float32Array<ArrayBuffer>): boolean {
    const a = this.playback.playing?.analyser ?? this.mic?.analyser;
    if (!a) {
      target.fill(0);
      return false;
    }
    if (target.length === a.fftSize) {
      a.getFloatTimeDomainData(target);
    } else {
      a.getFloatTimeDomainData(this.scratch);
      const step = this.scratch.length / target.length;
      for (let i = 0; i < target.length; i++) target[i] = this.scratch[Math.floor(i * step)] ?? 0;
    }
    return true;
  }

  /* ── settings that touch the live graph ─────────────────────────────── */

  applyInputGain(percent: number): void {
    if (this.mic) this.mic.gain.gain.value = Math.max(0, percent) / 100;
  }

  async switchDevice(deviceId: string | null): Promise<void> {
    const run = this.run;
    if (!run || !this.current(run) || !this.active) return;
    const s = useVoiceStore.getState().settings;
    this.closeMic();
    const attempt = this.micAttempt + 1;
    const ok = await this.openMic(run, deviceId, s?.noiseSuppression ?? true, s?.desktop.inputGain ?? 100);
    if (!ok && this.current(run) && attempt === this.micAttempt) await this.stop('mic-lost');
  }

  /* ── audio context / mic graph ───────────────────────────────────────── */

  ensureContext(): AudioContext {
    if (!this.ctx || this.ctx.state === 'closed') this.ctx = new AudioContext();
    return this.ctx;
  }

  private async openMic(run: SessionRun, deviceId: string | null, noise: boolean, gainPercent: number): Promise<boolean> {
    const attempt = ++this.micAttempt;
    const current = () => this.current(run) && attempt === this.micAttempt;
    if (!navigator.mediaDevices?.getUserMedia) {
      useVoiceStore.getState().setMicPermission('unsupported'); this.fail('no-mic', 'This environment has no microphone access.'); return false;
    }
    try {
      const graph = await openMicrophone({ deviceId, noise, gainPercent, current,
        context: () => this.ensureContext(), onFrame: (input, rate) => this.onFrame(input, rate), onLost: () => { void this.stop('mic-lost'); } });
      if (!graph) return false;
      if (!current()) { closeMicrophone(graph); return false; }
      this.mic = graph; useVoiceStore.getState().setMicPermission('granted'); return true;
    } catch (e) {
      if (!current()) return false;
      const name = e instanceof DOMException ? e.name : '';
      const denied = name === 'NotAllowedError' || name === 'SecurityError';
      const missing = name === 'NotFoundError' || name === 'OverconstrainedError';
      useVoiceStore.getState().setMicPermission(denied ? 'denied' : missing ? 'no-device' : 'prompt');
      this.fail(denied ? 'mic-denied' : 'no-mic', denied ? 'Microphone access was denied.' : missing ? 'The selected microphone is unavailable. Choose another input.' : 'The microphone could not be opened.', { silent: true });
      return false;
    }
  }

  private closeMic(): void {
    this.micAttempt++;
    const mic = this.mic; this.mic = null; this.pending = [];
    if (mic) closeMicrophone(mic);
    this.levels.mic = 0; this.levels.peak = 0; this.levels.clipped = false;
  }

  private onFrame(input: Float32Array, rate: number): void {
    const frameMs = (input.length / rate) * 1000;
    const { pcm, rms, peak, clipped } = floatToPcm16(resampleTo16k(input, rate));
    this.levels.mic = rms;
    this.levels.peak = peak;
    this.levels.clipped = clipped;
    const s = useVoiceStore.getState();
    if (rms > SPEECH_RMS) this.touch();
    if (this.playback.playing && s.sessionState === 'speaking') {
      this.bargeHotMs = rms > BARGE_RMS ? this.bargeHotMs + frameMs : 0;
      if (this.bargeHotMs >= BARGE_MS) {
        this.bargeHotMs = 0;
        this.bargeIn();
      }
      return;
    }
    this.bargeHotMs = 0;
    if (!s.active || s.muted) return;
    if (s.sessionState !== 'listening' && s.sessionState !== 'idle') return;
    this.pending.push(pcm);
  }

  private startFlusher(): void {
    this.stopFlusher();
    this.flushTimer = window.setInterval(() => this.flush(), FLUSH_MS);
  }

  private stopFlusher(): void {
    if (this.flushTimer !== null) window.clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.pending = [];
  }

  private flush(): void {
    const run = this.run;
    if (!run || !this.current(run) || !this.active || this.pending.length === 0) return;
    const bytes = concatPcm16(this.pending); this.pending = [];
    voiceApi.audio(bytesToBase64(bytes), { signal: run.abort.signal }).then(() => {
      if (this.current(run)) this.sendFailures = 0;
    }).catch((e: unknown) => {
      if (!this.current(run)) return;
      this.sendFailures++;
      if (e instanceof EngineDown || this.sendFailures >= SEND_FAILURES_BEFORE_ERROR) {
        this.sendFailures = 0; this.fail('network-down', 'Audio is not reaching the engine.'); void this.stop('engine');
      }
    });
  }

  /* ── playback ───────────────────────────────────────────────────────── */

  /** Subscribe to utterance start/stop (the theater's word sweep). */
  onTts(cb: (ev: TtsEvent) => void): () => void {
    this.ttsObservers.add(cb);
    return () => {
      this.ttsObservers.delete(cb);
    };
  }

  private notifyTts(ev: TtsEvent): void {
    this.ttsObservers.forEach((cb) => cb(ev));
  }

  private play(wavB64: string, text = ''): Promise<void> {
    const run = this.run;
    if (!run || !this.current(run)) return Promise.resolve();
    this.bargeHotMs = 0;
    return this.playback.play(wavB64, text, () => this.current(run) && this.active);
  }

  private stopPlayback(): void { this.playback.stop(); }

  /** 200 ms sine chimes — A4 for start/wake, C5 falling for goodbye. */
  chime(kind: 'start' | 'bye' | 'approval'): void {
    try {
      const ctx = this.ensureContext();
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(kind === 'bye' ? 523.25 : 440, t);
      if (kind === 'bye') osc.frequency.exponentialRampToValueAtTime(440, t + 0.2);
      if (kind === 'approval') osc.frequency.setValueAtTime(523.25, t + 0.1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    } catch {
      /* no audio output here — the chime is decoration */
    }
  }

  /* ── silence auto-exit ──────────────────────────────────────────────── */

  private touch(): void {
    this.lastActivityAt = Date.now();
  }

  private startExitWatch(): void {
    this.stopExitWatch();
    this.exitTimer = window.setInterval(() => {
      const s = useVoiceStore.getState();
      if (!s.active || !s.settings) return;
      if (s.settings.desktop.activation === 'always') return;
      if (s.sessionState !== 'listening' && s.sessionState !== 'idle') {
        this.touch();
        return;
      }
      const limit = Math.max(10, s.settings.desktop.autoExitSilenceSec) * 1000;
      if (Date.now() - this.lastActivityAt >= limit) void this.stop('silence');
    }, 1000);
  }

  private stopExitWatch(): void {
    if (this.exitTimer !== null) window.clearInterval(this.exitTimer);
    this.exitTimer = null;
  }

  /* ── SSE downlink ───────────────────────────────────────────────────── */

  private ensureEvents(): void {
    if (this.sseAbort || useEngineStore.getState().status !== 'ready') return;
    const owner = new AbortController(), generation = useEngineStore.getState().generation;
    this.sseAbort = owner;
    void this.pumpEvents(owner, generation);
  }

  private releaseEvents(): void {
    const owner = this.sseAbort; this.sseAbort = null; owner?.abort();
    useVoiceStore.getState()._session({ connected: false });
  }

  private maybeReleaseEvents(): void {
    const s = useVoiceStore.getState();
    if (this.retains > 0 || this.run || s.active || s.downloadBusy) return;
    this.releaseEvents();
  }

  private async pumpEvents(owner: AbortController, generation: number): Promise<void> {
    const current = () => this.sseAbort === owner && !owner.signal.aborted && useEngineStore.getState().generation === generation;
    let backoff = 1000;
    while (current()) {
      try {
        const res = await voiceApi.events(owner.signal);
        if (!current()) { await res.body?.cancel().catch(() => {}); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        useVoiceStore.getState()._session({ connected: true }); backoff = 1000;
        await readSse(res, payload => { if (current()) this.onPayload(payload); }, owner.signal);
      } catch { /* reconnect only while this stream still owns the connection */ }
      if (!current()) return;
      useVoiceStore.getState()._session({ connected: false });
      if (this.active) { this.fail('engine-disconnected', 'Lost the engine mid-session.'); void this.stop('engine'); }
      await sleep(backoff, owner.signal); backoff = Math.min(10_000, backoff * 2);
    }
  }

  private onPayload(payload: string): void {
    if (payload === '[DONE]') return;
    let e: VoiceEngineEvent;
    try {
      e = JSON.parse(payload) as VoiceEngineEvent;
    } catch {
      return;
    }
    this.onEvent(e);
  }

  private onEvent(e: VoiceEngineEvent): void {
    const store = useVoiceStore.getState();
    if (e.type !== 'download' && !(e.type === 'approval' && e.resolved) && (!this.run || !this.current(this.run) || !store.active)) return;
    switch (e.type) {
      case 'state': {
        const st = e.state ?? 'idle';
        if (st === 'idle' || st === 'offline') { void this.stop('engine'); return; }
        // Only a session this window runs drives the UI; a stale engine
        // session (a client that vanished) is not "listening" for the user.
        store._session({ sessionState: st });
        if (st !== 'listening') this.touch();
        if (st === 'listening') store._session({ approval: null });
        this.broadcastState(st);
        return;
      }
      case 'final':
        if (e.text) {
          store._caption('you', e.text);
          this.followResearch(e.text);
          this.followAgents(e.text);
        }
        return;
      case 'tts':
        if (e.text) store._caption('xr', e.text);
        if (e.wav && store.active) void this.play(e.wav, e.text ?? '');
        return;
      case 'tts_stop':
        this.stopPlayback();
        return;
      case 'status':
        if (e.text) store._caption('system', e.text);
        if (e.detail === 'tts-no-audio' && store.active) {
          this.fail('tts-no-audio', 'The engine is speaking through its own speakers (system voice). Pick an offline voice for audio here.', { silent: true });
        }
        return;
      case 'approval':
        this.onApproval(e);
        return;
      case 'error':
        this.fail(e.detail ?? 'voice-error', e.message ?? 'Voice hit an error.');
        if (e.detail === 'stt-model-missing' || e.detail === 'tts-model-missing') void this.stop('error');
        return;
      case 'download':
        if (e.component && e.id && e.status) {
          applyDownloadEvent({
            component: e.component,
            id: e.id,
            status: e.status,
            received: e.received ?? 0,
            total: e.total ?? 0,
            percent: e.percent ?? 0,
            file: e.file,
            detail: e.detail,
            bundleReceived: e.bundleReceived,
            bundleTotal: e.bundleTotal,
          });
          this.maybeReleaseEvents();
        }
        return;
      case 'cost':
        if (typeof e.usd === 'number') store._cost(e.usd);
        return;
      default:
        return;
    }
  }

  private onApproval(e: VoiceEngineEvent): void {
    const store = useVoiceStore.getState();
    if (!e.id) return;
    if (e.resolved) {
      this.approvalAbort.get(e.id)?.abort();
      this.approvalAbort.delete(e.id);
      if (store.approval?.id === e.id) store._session({ approval: null });
      // The engine already decided (voice or another surface): close our copy
      // with the same verdict so the Bell / Shield history stays truthful.
      if (useApprovalStore.getState().pending.some((r) => r.id === e.id)) {
        decideApproval(e.id, e.resolved, { reason: 'Decided by voice', silent: true });
      }
      return;
    }
    const tool = e.tool ?? 'tool';
    const reason = e.reason ?? `${tool} needs your approval`;
    store._session({ approval: { id: e.id, tool, reason, riskTier: e.riskTier, unclear: false } });
    this.chime('approval');
    if (!this.approvalAbort.has(e.id)) {
      const ac = new AbortController();
      this.approvalAbort.set(e.id, ac);
      void bridgeEngineApproval({ id: e.id, tool, reason, args: e.args, riskTier: e.riskTier }, ac.signal).finally(() => {
        if (this.approvalAbort.get(e.id!) !== ac) return;
        this.approvalAbort.delete(e.id!);
        const s = useVoiceStore.getState();
        if (s.approval?.id === e.id) s._session({ approval: null });
      });
    }
  }

  /** Approve/Deny from the voice bar — the same desktop path the modal uses. */
  decideApproval(id: string, approved: boolean): void {
    decideApproval(id, approved ? 'approved' : 'denied', { reason: 'Decided in the voice bar' });
  }

  /* ── cross-surface broadcast ────────────────────────────────────────── */

  private lastBroadcast: VoiceSessionState | null = null;

  private broadcastState(state: VoiceSessionState): void {
    if (this.lastBroadcast === state) return;
    this.lastBroadcast = state;
    void orbSetState(avatarStateFor(state)).catch(() => undefined);
    // Orb (Rust VoiceActiveState) + Voice Theater (Phase 16) share this one.
    emitTheater(THEATER_IN.state, { state, active: useVoiceStore.getState().active });
  }

  /**
   * Phase 18: the ENGINE's voice pipeline runs "research <topic>" itself
   * (src/voice/intents.ts → runVoiceResearch); the desktop must not start a
   * second run. Instead the main window opens Research in follow mode, which
   * picks the finished session up from the engine when it lands.
   */
  /**
   * Phase 19: "open agents" / "open my agents" / "open workflows" /
   * "new workflow" navigate the main window; the screen shows a toast
   * naming the voice intent. Nothing runs without the user on the screen.
   */
  private followAgents(text: string): void {
    const m = /^(?:open|show|go to|new)\s+(?:my\s+)?(agents?|workflows?|workflow)\b/i.exec(text.trim());
    if (!m) return;
    const word = m[1].toLowerCase();
    const isNew = /^new\s/i.test(text.trim());
    const tab = word.startsWith('workflow') ? 'workflows' : /\bmy\b/i.test(text) ? 'mine' : 'prebuilt';
    const extra = isNew ? (tab === 'workflows' ? '&new=workflow' : '&new=agent') : '';
    window.location.hash = `#/agents?tab=${tab}${extra}&via=voice`;
  }

  private followResearch(text: string): void {
    const m = /^(?:research|investigate|look up deeply|make a report on|give me a brief on)\s+(.+)$/i.exec(text.trim());
    if (!m?.[1] || !useVoiceStore.getState().active) return;
    if (/\/(hud|orb|theater)\.html$/.test(window.location.pathname)) return; // only the main window routes
    window.location.hash = `#/research?q=${encodeURIComponent(m[1].trim())}&via=voice`;
  }

  private async bringForward(): Promise<void> {
    if (!isTauri()) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const w = getCurrentWindow();
      await w.show();
      await w.unminimize();
      await w.setFocus();
    } catch {
      /* best effort */
    }
  }

  private fail(code: string, message: string, opts: { silent?: boolean } = {}): void {
    useVoiceStore.getState()._session({ error: { code, message, at: Date.now() } });
    if (opts.silent) return;
    sendNotification({ type: 'error', title: 'Voice', body: message, data: { code, surface: 'voice' } });
    toast.error(message);
  }
}

export const voice = new VoiceController();

/** Shared permission probe (device list + permission state without prompting). */
export async function probeMicrophones(prompt = false): Promise<void> {
  const store = useVoiceStore.getState();
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    store.setMicPermission('unsupported');
    return;
  }
  let permission: MicPermission = store.micPermission === 'unknown' ? 'prompt' : store.micPermission;
  if (prompt) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
      permission = 'granted';
    } catch (e) {
      const name = e instanceof DOMException ? e.name : '';
      permission = name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotFoundError' ? 'no-device' : 'prompt';
    }
  } else {
    try {
      const st = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      permission = st.state === 'granted' ? 'granted' : st.state === 'denied' ? 'denied' : 'prompt';
    } catch {
      /* permissions API unsupported — keep what we knew */
    }
  }
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    const inputs = list.filter((d) => d.kind === 'audioinput');
    store.setDevices(inputs.map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` })));
    if (inputs.length === 0 && permission !== 'denied') permission = 'no-device';
  } catch {
    store.setDevices([]);
  }
  store.setMicPermission(permission);
}
