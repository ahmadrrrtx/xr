/** XR Stage 8 — small, dependency-free audio helpers. */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
}

export interface VadFrame {
  index: number;
  startMs: number;
  endMs: number;
  rms: number;
  speech: boolean;
}

export interface TurnDetectionResult {
  hasSpeech: boolean;
  speechMs: number;
  silenceMs: number;
  startMs: number;
  endMs: number;
  rms: number;
  frames: VadFrame[];
}

export function parseWav(buf: Uint8Array): WavInfo | null {
  if (buf.length < 44) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (off: number, len: number) => String.fromCharCode(...buf.slice(off, off + len));
  if (tag(0, 4) !== "RIFF" || tag(8, 4) !== "WAVE") return null;

  let pos = 12;
  let sampleRate = 16000;
  let channels = 1;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataLength = 0;

  while (pos + 8 <= buf.length) {
    const id = tag(pos, 4);
    const size = dv.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === "fmt " && size >= 16) {
      channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      bitsPerSample = dv.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, buf.length - body);
      break;
    }
    pos = body + size + (size % 2);
  }

  if (dataOffset < 0 || bitsPerSample !== 16) return null;
  return { sampleRate, channels, bitsPerSample, dataOffset, dataLength };
}

export function wavDurationMs(buf: Uint8Array): number {
  const info = parseWav(buf);
  if (!info) return 0;
  const bytesPerSampleFrame = (info.bitsPerSample / 8) * info.channels;
  if (!bytesPerSampleFrame || !info.sampleRate) return 0;
  return Math.round((info.dataLength / bytesPerSampleFrame / info.sampleRate) * 1000);
}

export function pcm16Rms(buf: Uint8Array): number {
  const info = parseWav(buf);
  if (!info) return rawPcm16Rms(buf);
  return rawPcm16Rms(buf.slice(info.dataOffset, info.dataOffset + info.dataLength), info.channels);
}

function rawPcm16Rms(data: Uint8Array, channels = 1): number {
  if (data.length < 2) return 0;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let sum = 0;
  let count = 0;
  const step = Math.max(1, channels) * 2;
  for (let i = 0; i + 1 < data.length; i += step) {
    const s = dv.getInt16(i, true) / 32768;
    sum += s * s;
    count++;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

export function analyzeVad(
  wav: Uint8Array,
  opts: { frameMs?: number; threshold?: number } = {},
): TurnDetectionResult {
  const info = parseWav(wav);
  const threshold = opts.threshold ?? 0.012;
  const frameMs = opts.frameMs ?? 30;
  if (!info) {
    const rms = pcm16Rms(wav);
    return {
      hasSpeech: rms >= threshold,
      speechMs: rms >= threshold ? wav.length : 0,
      silenceMs: rms >= threshold ? 0 : wav.length,
      startMs: 0,
      endMs: 0,
      rms,
      frames: [],
    };
  }

  const bytesPerSample = info.bitsPerSample / 8;
  const bytesPerFrame = Math.max(2, Math.floor(info.sampleRate * (frameMs / 1000)) * info.channels * bytesPerSample);
  const frames: VadFrame[] = [];
  let totalRms = 0;
  let speechFrames = 0;
  let firstSpeech = -1;
  let lastSpeech = -1;

  const dataEnd = info.dataOffset + info.dataLength;
  for (let off = info.dataOffset, idx = 0; off < dataEnd; off += bytesPerFrame, idx++) {
    const slice = wav.slice(off, Math.min(dataEnd, off + bytesPerFrame));
    const rms = rawPcm16Rms(slice, info.channels);
    const speech = rms >= threshold;
    if (speech) {
      speechFrames++;
      if (firstSpeech < 0) firstSpeech = idx;
      lastSpeech = idx;
    }
    totalRms += rms;
    frames.push({
      index: idx,
      startMs: idx * frameMs,
      endMs: (idx + 1) * frameMs,
      rms,
      speech,
    });
  }

  const hasSpeech = speechFrames > 0;
  const startMs = hasSpeech ? Math.max(0, firstSpeech * frameMs) : 0;
  const endMs = hasSpeech ? Math.min(wavDurationMs(wav), (lastSpeech + 1) * frameMs) : 0;
  const speechMs = speechFrames * frameMs;
  const duration = wavDurationMs(wav);
  return {
    hasSpeech,
    speechMs,
    silenceMs: Math.max(0, duration - speechMs),
    startMs,
    endMs,
    rms: frames.length ? totalRms / frames.length : 0,
    frames,
  };
}

export function hasEnoughSpeech(
  wav: Uint8Array,
  opts: { threshold?: number; minSpeechMs?: number } = {},
): boolean {
  const r = analyzeVad(wav, { threshold: opts.threshold });
  return r.hasSpeech && r.speechMs >= (opts.minSpeechMs ?? 180);
}
