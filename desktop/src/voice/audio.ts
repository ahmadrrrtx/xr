/*
 * Pure audio math for the voice loop (Phase 15). No DOM, no React — these
 * are unit-tested from the repo root (test/desktop/voice-audio.test.ts).
 *
 *   capture:  Float32 @ ctx.sampleRate → box-filter resample → 16 kHz Int16
 *   metering: RMS + clip detection (so the meter can turn red honestly)
 *   wire:     Int16 → base64 (the engine's `pcm` field)
 */

export const TARGET_RATE = 16_000;

/**
 * Resample mono float audio with a box filter (average of the source
 * samples each output sample covers). Cheap, alias-safe enough for speech,
 * and far better than the naive "pick every Nth sample" decimation.
 */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE || input.length === 0) return input;
  const ratio = fromRate / TARGET_RATE;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = i * ratio;
    const end = Math.min(input.length, start + ratio);
    let acc = 0;
    let n = 0;
    for (let j = Math.floor(start); j < end; j++) {
      acc += input[j] ?? 0;
      n += 1;
    }
    out[i] = n > 0 ? acc / n : 0;
  }
  return out;
}

export interface Pcm16Result {
  pcm: Int16Array;
  /** RMS after gain, 0..1. */
  rms: number;
  /** Peak after gain, 0..1 (≥ 0.985 counts as clipping). */
  peak: number;
  clipped: boolean;
}

/** Apply linear gain (1 = unity) and convert to Int16 with hard clipping. */
export function floatToPcm16(input: Float32Array, gain = 1): Pcm16Result {
  const pcm = new Int16Array(input.length);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < input.length; i++) {
    let v = (input[i] ?? 0) * gain;
    if (v > 1) v = 1;
    else if (v < -1) v = -1;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    sum += v * v;
    pcm[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  const rms = input.length ? Math.sqrt(sum / input.length) : 0;
  return { pcm, rms, peak, clipped: peak >= 0.985 };
}

export function rmsOf(input: Float32Array): number {
  if (!input.length) return 0;
  let sum = 0;
  for (let i = 0; i < input.length; i++) sum += (input[i] ?? 0) ** 2;
  return Math.sqrt(sum / input.length);
}

/** Concatenate Int16 chunks into one little-endian byte buffer. */
export function concatPcm16(chunks: Int16Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total * 2);
  const view = new DataView(out.buffer);
  let o = 0;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      view.setInt16(o, c[i] ?? 0, true);
      o += 2;
    }
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** dBFS for the screen-reader meter text (−∞ → "silent"). */
export function dbfs(rms: number): number {
  if (rms <= 0) return -Infinity;
  return Math.round(20 * Math.log10(rms));
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  const mb = n / (1024 * 1024);
  return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Pitch slider (−5..+5) → Web Audio detune in cents (one semitone per step). */
export function pitchToCents(pitch: number): number {
  const p = Math.max(-5, Math.min(5, Math.round(pitch)));
  return p * 100;
}

/**
 * Resolve `activation` + `wakeEnabled` into the engine's `mode` — the one
 * place the two vocabularies meet. Hold/tap are push-to-talk on the engine
 * (no wake gate); always-on gates on the wake phrase only when asked.
 */
export function engineModeFor(
  activation: 'hold' | 'tap' | 'always',
  wakeEnabled: boolean,
): 'push-to-talk' | 'wake-word' | 'always-on' {
  if (activation !== 'always') return 'push-to-talk';
  return wakeEnabled ? 'wake-word' : 'always-on';
}
