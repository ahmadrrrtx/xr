/**
 * Phase 4 · Semantic end-of-turn (voice backlog #6).
 *
 * Pins the classifier heuristics AND the two-stage behaviour of ServerVad:
 * a mid-thought partial extends the silence tail once; a complete partial
 * (or none) keeps the acoustic 650ms tail. Fail-open on garbage.
 */
import { describe, expect, test } from "bun:test";
import {
  looksIncomplete,
  SILENCE_TAIL_BASE_MS,
  SILENCE_TAIL_EXTENDED_MS,
} from "../../src/voice/endpointing.ts";
import { ServerVad } from "../../src/voice/v2.ts";

describe("looksIncomplete classifier", () => {
  test("trailing conjunctions / prepositions / fillers are mid-thought", () => {
    for (const t of [
      "open the browser and",
      "I want to search for",
      "can you check the",
      "um",
      "well",
      "the file is in",
      "run the tests but",
    ]) {
      expect(looksIncomplete(t).incomplete).toBe(true);
    }
  });

  test("trailing comma / dash is mid-thought", () => {
    expect(looksIncomplete("first open the repo,").incomplete).toBe(true);
    expect(looksIncomplete("wait —").incomplete).toBe(true);
  });

  test("terminal punctuation and closed sentences are complete", () => {
    for (const t of [
      "open the browser.",
      "what is the weather?",
      "run the tests!",
      'he said "stop."',
      "list my files",
      "play some music",
    ]) {
      expect(looksIncomplete(t).incomplete).toBe(false);
    }
  });

  test("fail-open: empty / garbage never hangs the turn", () => {
    expect(looksIncomplete("").incomplete).toBe(false);
    expect(looksIncomplete("   ").incomplete).toBe(false);
    expect(looksIncomplete("42").incomplete).toBe(false);
  });

  test("extended tail is strictly longer than the base tail", () => {
    expect(SILENCE_TAIL_EXTENDED_MS).toBeGreaterThan(SILENCE_TAIL_BASE_MS);
  });
});

/** A frame of pcm16 silence or tone at 16 kHz (30ms = 960 bytes). */
function frame(loud: boolean): Uint8Array {
  const f = new Uint8Array(960);
  if (loud) {
    for (let i = 0; i < f.length; i += 2) {
      const v = i % 4 === 0 ? 12000 : -12000;
      f[i] = v & 0xff;
      f[i + 1] = (v >> 8) & 0xff;
    }
  }
  return f;
}

describe("ServerVad two-stage endpointing", () => {
  test("acoustic-only: turn completes at ~650ms of silence", () => {
    const vad = new ServerVad();
    for (let i = 0; i < 10; i++) vad.push(frame(true)); // 300ms speech
    let done = false;
    let silent = 0;
    for (let i = 0; i < 40 && !done; i++) {
      const r = vad.push(frame(false));
      silent += 30;
      if (r.turnComplete) done = true;
    }
    expect(done).toBe(true);
    expect(silent).toBeLessThanOrEqual(690); // ~650 + one frame
  });

  test("mid-thought partial extends the tail (does NOT complete at 650ms)", () => {
    const vad = new ServerVad();
    for (let i = 0; i < 10; i++) vad.push(frame(true));
    vad.setPartial("open the browser and");
    let completedAt = -1;
    let silent = 0;
    for (let i = 0; i < 80; i++) {
      const r = vad.push(frame(false));
      silent += 30;
      if (r.turnComplete) {
        completedAt = silent;
        break;
      }
    }
    expect(completedAt).toBeGreaterThan(650); // acoustic tail was NOT enough
    expect(completedAt).toBeLessThanOrEqual(SILENCE_TAIL_EXTENDED_MS + 60);
  });

  test("complete partial keeps the acoustic tail", () => {
    const vad = new ServerVad();
    for (let i = 0; i < 10; i++) vad.push(frame(true));
    vad.setPartial("open the browser.");
    let completedAt = -1;
    let silent = 0;
    for (let i = 0; i < 40; i++) {
      const r = vad.push(frame(false));
      silent += 30;
      if (r.turnComplete) {
        completedAt = silent;
        break;
      }
    }
    expect(completedAt).toBeGreaterThan(0);
    expect(completedAt).toBeLessThanOrEqual(690);
  });

  test("reset clears the partial", () => {
    const vad = new ServerVad();
    vad.setPartial("um");
    vad.reset();
    for (let i = 0; i < 10; i++) vad.push(frame(true));
    let silent = 0;
    for (let i = 0; i < 40; i++) {
      silent += 30;
      if (vad.push(frame(false)).turnComplete) break;
    }
    expect(silent).toBeLessThanOrEqual(690);
  });
});
