/** Resource owners for live-session audio. Browser permission/decode promises
 * need not honor abort: identity is checked before attaching any late result. */
import { base64ToBytes, pitchToCents } from './audio';

export interface MicGraph {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  analyser: AnalyserNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
}

export function closeMicrophone(m: MicGraph): void {
  m.processor.onaudioprocess = null;
  for (const track of m.stream.getTracks()) { track.onended = null; track.stop(); }
  for (const node of [m.source, m.gain, m.analyser, m.processor, m.sink]) {
    try { node.disconnect(); } catch { /* already disconnected */ }
  }
}

export async function openMicrophone(options: {
  deviceId: string | null; noise: boolean; gainPercent: number;
  context: () => AudioContext; current: () => boolean;
  onFrame: (input: Float32Array, rate: number) => void; onLost: () => void;
}): Promise<MicGraph | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: {
    ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
    echoCancellation: true, noiseSuppression: options.noise, autoGainControl: true, channelCount: 1,
  } });
  if (!options.current()) { stream.getTracks().forEach(track => track.stop()); return null; }
  const nodes: AudioNode[] = [];
  try {
    const ctx = options.context();
    const source = ctx.createMediaStreamSource(stream); nodes.push(source);
    const gain = ctx.createGain(); nodes.push(gain); gain.gain.value = Math.max(0, options.gainPercent) / 100;
    const analyser = ctx.createAnalyser(); nodes.push(analyser); analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.5;
    const processor = ctx.createScriptProcessor(4096, 1, 1); nodes.push(processor);
    const sink = ctx.createGain(); nodes.push(sink); sink.gain.value = 0;
    source.connect(gain); gain.connect(analyser); analyser.connect(processor); processor.connect(sink); sink.connect(ctx.destination);
    processor.onaudioprocess = ev => { if (options.current()) options.onFrame(ev.inputBuffer.getChannelData(0), ctx.sampleRate); };
    for (const track of stream.getAudioTracks()) track.onended = () => { if (options.current()) options.onLost(); };
    return { stream, source, gain, analyser, processor, sink };
  } catch (e) {
    stream.getTracks().forEach(track => { track.onended = null; track.stop(); });
    for (const node of nodes) { try { node.disconnect(); } catch { /* partial graph */ } }
    throw e;
  }
}

export type PlaybackEvent = { kind: 'start'; text: string; durationMs: number } | { kind: 'stop' };
interface Playback { src: AudioBufferSourceNode; analyser: AnalyserNode }

export class SessionPlayback {
  playing: Playback | null = null;
  private epoch = 0;
  private scratch = new Float32Array(new ArrayBuffer(1024 * 4));
  constructor(private readonly host: {
    context: () => AudioContext; pitch: () => number; levels: { out: number };
    notify: (ev: PlaybackEvent) => void; played: () => void; touch: () => void; fail: () => void;
  }) {}

  async play(wavB64: string, text: string, valid: () => boolean): Promise<void> {
    this.stop(); // Invalidates pending decodes too, not only a playing source.
    const epoch = this.epoch;
    const current = () => epoch === this.epoch && valid();
    let src: AudioBufferSourceNode | undefined, analyser: AnalyserNode | undefined;
    try {
      const ctx = this.host.context();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!current()) return;
      const bytes = base64ToBytes(wavB64), copy = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(copy).set(bytes);
      const buffer = await ctx.decodeAudioData(copy);
      if (!current()) return;
      src = ctx.createBufferSource(); src.buffer = buffer; src.detune.value = pitchToCents(this.host.pitch());
      analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      src.connect(analyser); analyser.connect(ctx.destination);
      const me = { src, analyser };
      src.onended = () => {
        if (this.playing !== me || !current()) return;
        this.release(me); this.playing = null; this.host.levels.out = 0;
        this.host.notify({ kind: 'stop' }); this.host.played(); this.host.touch();
      };
      src.start();
      this.playing = me;
      this.host.notify({ kind: 'start', text, durationMs: buffer.duration * 1000 });
      const tick = () => {
        if (this.playing !== me || !current()) return;
        me.analyser.getFloatTimeDomainData(this.scratch);
        let sum = 0;
        for (const sample of this.scratch) sum += sample ** 2;
        this.host.levels.out = Math.sqrt(sum / this.scratch.length);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    } catch {
      if (this.playing?.src === src) { this.playing = null; this.host.levels.out = 0; }
      if (src) { src.onended = null; try { src.stop(); } catch { /* never started */ } }
      for (const node of [src, analyser]) { try { node?.disconnect(); } catch { /* partial graph */ } }
      if (current()) { this.host.fail(); this.host.played(); }
    }
  }

  stop(): void {
    this.epoch++;
    const playing = this.playing; this.playing = null; this.host.levels.out = 0;
    if (!playing) return;
    this.release(playing); this.host.notify({ kind: 'stop' });
  }

  private release(playing: Playback): void {
    playing.src.onended = null;
    try { playing.src.stop(); } catch { /* ended or never started */ }
    for (const node of [playing.src, playing.analyser]) { try { node.disconnect(); } catch { /* disconnected */ } }
  }
}
