/**
 * Phase 4 voice surface — session unit tests (offline, no mic, no network).
 *
 * Covers the transport-level contract the desktop relies on: wav framing,
 * endpointing (speech then silence tail triggers a transcription attempt),
 * state emission over the subscriber channel, and barge-in semantics when
 * nothing is playing (no-op, never throws).
 */
import { describe, expect, test } from "bun:test";
import { pcm16ToWav, VoiceSession } from "../../src/daemon/routes/voice.routes.ts";
import { parseWav } from "../../src/voice/audio.ts";
import { defaultVoiceSettings } from "../../src/voice/types.ts";

function sineChunk(freq: number, ms: number, rate = 16000): Uint8Array {
  const n = Math.floor((rate * ms) / 1000);
  const out = new Uint8Array(n * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const s = Math.sin((2 * Math.PI * freq * i) / rate) * 0.4;
    dv.setInt16(i * 2, s * 0x7fff, true);
  }
  return out;
}

const silence = (ms: number) => new Uint8Array(Math.floor((16000 * ms) / 1000) * 2);

function stubStore(): any {
  return { audit: () => undefined, workspaceId: "test" };
}

describe("voice session transport", () => {
  test("pcm16 → wav framing round-trips through parseWav", () => {
    const pcm = sineChunk(440, 100);
    const wav = pcm16ToWav(pcm, 16000);
    const info = parseWav(wav);
    expect(info).not.toBeNull();
    expect(info?.sampleRate).toBe(16000);
    expect(info?.channels).toBe(1);
  });

  test("endpointing: speech + silence tail drives listening → thinking → listening", async () => {
    const settings = { ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const };
    const session = new VoiceSession(stubStore(), settings);
    const states: string[] = [];
    session.subscribe((e) => { if (e.type === "state" && e.state) states.push(e.state); });
    session.start();
    expect(session.state).toBe("listening");
    for (let i = 0; i < 6; i++) session.feedAudio(sineChunk(300, 100)); // 600 ms speech
    for (let i = 0; i < 15; i++) session.feedAudio(silence(100)); // 1.5 s tail (covers the semantic probe grace)
    await new Promise((r) => setTimeout(r, 400));
    expect(states).toContain("thinking");
    expect(session.state).toBe("listening");
    session.stop();
    expect(session.state).toBe("idle");
  });

  test("speech below the minimum length never triggers a transcription", async () => {
    const settings = { ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const };
    const session = new VoiceSession(stubStore(), settings);
    const states: string[] = [];
    session.subscribe((e) => { if (e.type === "state" && e.state) states.push(e.state); });
    session.start();
    session.feedAudio(sineChunk(300, 100)); // 100 ms < 250 ms floor
    session.feedAudio(silence(900));
    await new Promise((r) => setTimeout(r, 300));
    expect(states).not.toContain("thinking");
    session.stop();
  });

  test("barge-in while nothing is playing is a safe no-op", () => {
    const settings = { ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const };
    const session = new VoiceSession(stubStore(), settings);
    session.start();
    session.bargeIn();
    expect(session.state).toBe("listening");
    session.stop();
  });

  test("audio before start is ignored (fail-closed transport)", () => {
    const settings = { ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const };
    const session = new VoiceSession(stubStore(), settings);
    session.feedAudio(sineChunk(300, 500));
    session.feedAudio(silence(900));
    expect(session.state).toBe("idle");
  });
});
