/**
 * Phase 15 · desktop voice audio math (desktop/src/voice/audio.ts).
 *
 * Pure logic only — getUserMedia, AudioContext and the SSE pump are covered
 * by the Playwright pass (fake microphone) and the live-loop proof in the PR.
 * Runs from the repo root with no desktop/node_modules (relative imports).
 */
import { describe, expect, test } from "bun:test";

import {
  TARGET_RATE,
  base64ToBytes,
  bytesToBase64,
  concatPcm16,
  dbfs,
  engineModeFor,
  floatToPcm16,
  formatBytes,
  pitchToCents,
  resampleTo16k,
  rmsOf,
} from "../../desktop/src/voice/audio.ts";

function sine(hz: number, rate: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

describe("Phase 15 · resample", () => {
  test("48 kHz → 16 kHz keeps duration and energy (box filter, not decimation)", () => {
    const src = sine(440, 48_000, 0.5);
    const out = resampleTo16k(src, 48_000);
    expect(out.length).toBe(Math.floor(src.length / 3));
    // A 440 Hz tone is far below Nyquist at 16 kHz; RMS must survive (~0.354).
    expect(Math.abs(rmsOf(out) - rmsOf(src))).toBeLessThan(0.02);
  });

  test("44.1 kHz (non-integer ratio) still lands at the right length", () => {
    const src = sine(300, 44_100, 1);
    const out = resampleTo16k(src, 44_100);
    expect(Math.abs(out.length - TARGET_RATE)).toBeLessThanOrEqual(1);
  });

  test("16 kHz input and empty input pass through untouched", () => {
    const src = sine(200, 16_000, 0.1);
    expect(resampleTo16k(src, 16_000)).toBe(src);
    expect(resampleTo16k(new Float32Array(0), 48_000).length).toBe(0);
  });

  test("a high tone that would alias is attenuated, not folded back at full level", () => {
    // 20 kHz at 48 kHz: three-sample box average of a 2.4-samples-per-cycle tone.
    const src = sine(20_000, 48_000, 0.2, 0.8);
    const out = resampleTo16k(src, 48_000);
    expect(rmsOf(out)).toBeLessThan(rmsOf(src) * 0.5);
  });
});

describe("Phase 15 · pcm16 + metering", () => {
  test("unity gain maps ±1 to the Int16 rails and reports no clip below 0.985", () => {
    const r = floatToPcm16(new Float32Array([0, 0.5, -0.5, 0.98]));
    expect(r.pcm[0]).toBe(0);
    expect(r.pcm[1]).toBe(Math.round(0.5 * 0x7fff));
    expect(r.pcm[2]).toBe(Math.round(-0.5 * 0x8000));
    expect(r.clipped).toBe(false);
    expect(r.peak).toBeCloseTo(0.98, 5);
  });

  test("gain > 1 hard-clips and flags it (the meter turns red honestly)", () => {
    const r = floatToPcm16(new Float32Array([0.6, -0.7]), 2);
    expect(r.pcm[0]).toBe(0x7fff);
    expect(r.pcm[1]).toBe(-0x8000);
    expect(r.clipped).toBe(true);
    expect(r.peak).toBe(1);
  });

  test("gain 0 (muted) is digital silence", () => {
    const r = floatToPcm16(sine(440, 16_000, 0.05), 0);
    expect(r.rms).toBe(0);
    expect(Array.from(r.pcm).every((v) => v === 0)).toBe(true);
  });

  test("dBFS: silence is -∞, full scale is 0, half is about -6", () => {
    expect(dbfs(0)).toBe(-Infinity);
    expect(dbfs(1)).toBe(0);
    expect(dbfs(0.5)).toBe(-6);
  });
});

describe("Phase 15 · wire encoding", () => {
  test("Int16 chunks → little-endian bytes → base64 → bytes round-trips", () => {
    const a = new Int16Array([1, -1, 0x7fff]);
    const b = new Int16Array([-0x8000, 256]);
    const bytes = concatPcm16([a, b]);
    expect(bytes.length).toBe(10);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([1, 0, 0xff, 0xff]); // 1, -1 LE
    expect(Array.from(bytes.subarray(6, 8))).toEqual([0x00, 0x80]); // -32768 LE
    const back = base64ToBytes(bytesToBase64(bytes));
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  test("base64 survives buffers larger than one String.fromCharCode batch", () => {
    const big = new Uint8Array(100_000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const back = base64ToBytes(bytesToBase64(big));
    expect(back.length).toBe(big.length);
    expect(back[99_999]).toBe(99_999 % 251);
  });
});

describe("Phase 15 · settings helpers", () => {
  test("formatBytes is honest at every magnitude", () => {
    expect(formatBytes(0)).toBe("0 MB");
    expect(formatBytes(-5)).toBe("0 MB");
    expect(formatBytes(500)).toBe("1 KB");
    expect(formatBytes(816_251)).toBe("797 KB");
    expect(formatBytes(27_586_985)).toBe("26.3 MB");
    expect(formatBytes(95_930_951)).toBe("91.5 MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
  });

  test("pitch steps are semitones and clamp to ±5", () => {
    expect(pitchToCents(0)).toBe(0);
    expect(pitchToCents(2)).toBe(200);
    expect(pitchToCents(-9)).toBe(-500);
    expect(pitchToCents(7.4)).toBe(500);
  });

  test("activation × wake word → engine mode", () => {
    expect(engineModeFor("hold", true)).toBe("push-to-talk");
    expect(engineModeFor("tap", false)).toBe("push-to-talk");
    expect(engineModeFor("always", false)).toBe("always-on");
    expect(engineModeFor("always", true)).toBe("wake-word");
  });
});
