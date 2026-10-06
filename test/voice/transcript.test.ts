/**
 * Phase 15 · transcript shaping, settings sanitising, session honesty.
 */
import { describe, expect, test } from "bun:test";
import { maskProfanity, normalizeTranscript, shapeTranscript, estimateSttUsd, estimateTtsUsd } from "../../src/voice/transcript.ts";
import { sanitizeVoicePatch } from "../../src/voice/settings.ts";
import { VoiceSession, speechRmsFor } from "../../src/daemon/routes/voice.routes.ts";
import { defaultVoiceSettings } from "../../src/voice/types.ts";

describe("transcript shaping", () => {
  test("all-caps recogniser output becomes sentence case; mixed case is untouched", () => {
    expect(normalizeTranscript("WHAT IS TWO PLUS TWO")).toBe("What is two plus two");
    expect(normalizeTranscript("READY WHEN YOU ARE. I AM HERE")).toBe("Ready when you are. I am here");
    expect(normalizeTranscript("I'M DONE")).toBe("I'm done");
    expect(normalizeTranscript("Hello there, XR")).toBe("Hello there, XR");
    expect(normalizeTranscript("   ")).toBe("");
  });

  test("profanity filter masks listed words only when enabled", () => {
    expect(maskProfanity("what the shit is this")).toBe("what the s*** is this");
    expect(maskProfanity("shitake mushrooms")).toBe("shitake mushrooms");
    expect(shapeTranscript("DAMN IT", { profanityFilter: true })).toBe("D*** it");
    expect(shapeTranscript("DAMN IT")).toBe("Damn it");
  });

  test("cloud estimates follow list prices", () => {
    expect(estimateSttUsd("groq", 3600)).toBe(0.04);
    expect(estimateSttUsd("openai", 60)).toBe(0.003);
    expect(estimateTtsUsd(1_000_000)).toBe(15);
  });
});

describe("settings patch sanitising", () => {
  test("drops unknown keys, clamps numbers, validates enums", () => {
    const out = sanitizeVoicePatch({
      ttsSpeed: 9,
      wakeSensitivity: "ultra",
      wakeWord: "hey xr",
      mode: "wake-word",
      bogus: true,
      desktop: { inputGain: 999, ttsPitch: -40, activation: "hold", autoExitSilenceSec: 1, chatMicTarget: "nowhere" },
    });
    expect(out.ttsSpeed).toBe(1.3);
    expect(out.wakeSensitivity).toBeUndefined();
    expect(out.wakeWord).toBe("hey xr");
    expect(out.mode).toBe("wake-word");
    expect((out as Record<string, unknown>).bogus).toBeUndefined();
    expect(out.desktop?.inputGain).toBe(200);
    expect(out.desktop?.ttsPitch).toBe(-5);
    expect(out.desktop?.activation).toBe("hold");
    expect(out.desktop?.autoExitSilenceSec).toBe(10);
    expect(out.desktop?.chatMicTarget).toBe("screen");
  });
});

describe("voice session honesty (Phase 15)", () => {
  const stub = () => ({ audit: () => undefined, workspaceId: "test", recordCost: () => undefined }) as any;
  const settings = () => ({ ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const });

  test("sensitivity maps to an energy floor (high hears quieter speech)", () => {
    expect(speechRmsFor("high")).toBeLessThan(speechRmsFor("medium"));
    expect(speechRmsFor("medium")).toBeLessThan(speechRmsFor("low"));
  });

  test("status reports missing models instead of pretending", async () => {
    const s = new VoiceSession(stub(), settings());
    const st = await s.status();
    expect(st.available).toBe(false);
    expect((st.stt as { loaded: boolean }).loaded).toBe(false);
    expect(typeof (st.firstRun as { bytes: number }).bytes).toBe("number");
    expect(st.modelDir).toBeTruthy();
  });

  test("a disabled STT backend surfaces as an error event, not silence", async () => {
    const s = new VoiceSession(stub(), settings());
    const errors: unknown[] = [];
    s.subscribe((e) => { if (e.type === "error") errors.push(e); });
    s.start();
    const loud = new Uint8Array(16000 * 2 * 0.3);
    const dv = new DataView(loud.buffer);
    for (let i = 0; i < loud.length / 2; i++) dv.setInt16(i * 2, Math.sin(i / 10) * 0.4 * 0x7fff, true);
    for (let i = 0; i < 3; i++) s.feedAudio(loud);
    for (let i = 0; i < 20; i++) s.feedAudio(new Uint8Array(3200));
    await new Promise((r) => setTimeout(r, 50));
    expect(errors.length).toBeGreaterThan(0);
    expect((errors[0] as { detail: string }).detail).toMatch(/^stt-/);
    s.stop();
  });

  test("reconfigure applies a new voice without touching the live state", () => {
    const s = new VoiceSession(stub(), settings());
    s.start();
    s.reconfigure({ ...settings(), ttsVoice: "piper-amy", ttsSpeed: 1.2 });
    expect(s.state).toBe("listening");
    expect(s.currentSettings().ttsVoice).toBe("piper-amy");
    s.stop();
  });
});
