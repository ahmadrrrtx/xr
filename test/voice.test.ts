/**
 * XR — Block 7 tests: voice pipeline (STT/TTS adapters mocked; no real audio).
 */
import { test, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/state/workspace-store.ts";
import { detectWake, parseConfirmation } from "../src/voice/wake.ts";
import { shapeForPersona, TextToSpeech } from "../src/voice/tts.ts";
import { SpeechToText } from "../src/voice/stt.ts";
import { VoicePipeline } from "../src/voice/pipeline.ts";

let tmp: string;
let store: Store;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "xr-voice-"));
  process.env.XR_HOME = join(tmp, "home");
  store = new Store(join(tmp, "v.db"));
});

// ---- wake word ----
test("detectWake matches 'Hey XR' variants and strips the phrase", () => {
  expect(detectWake("Hey XR open the report").triggered).toBe(true);
  expect(detectWake("Hey XR open the report").command).toBe("open the report");
  expect(detectWake("okay XR, run tests").command).toBe("run tests");
  expect(detectWake("xr, summarize this").command).toBe("summarize this");
  expect(detectWake("just some random speech").triggered).toBe(false);
});

// ---- confirmation ----
test("parseConfirmation interprets yes/no", () => {
  expect(parseConfirmation("yes do it")).toBe("confirm");
  expect(parseConfirmation("confirm")).toBe("confirm");
  expect(parseConfirmation("no cancel that")).toBe("cancel");
  expect(parseConfirmation("abort")).toBe("cancel");
  expect(parseConfirmation("hmm maybe later")).toBe("unclear");
});

// ---- persona ----
test("shapeForPersona: fast clips to first sentence, detailed keeps all", () => {
  const long = "First sentence here. Second one. Third one with more detail.";
  expect(shapeForPersona(long, "fast")).toBe("First sentence here.");
  expect(shapeForPersona(long, "detailed")).toBe(long);
  expect(shapeForPersona("x".repeat(800), "calm").length).toBeLessThanOrEqual(601);
});

// ---- STT/TTS adapters (mock fetch) ----
test("STT transcribes via mock server", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ text: " hello world " }), {
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  const stt = new SpeechToText({ fetchFn });
  const r = await stt.transcribe(new Uint8Array([1, 2, 3]));
  expect(r.ok).toBe(true);
  expect(r.text).toBe("hello world");
});

test("STT fails soft on network error", async () => {
  const fetchFn = (async () => {
    throw new Error("down");
  }) as unknown as typeof fetch;
  const stt = new SpeechToText({ fetchFn });
  const r = await stt.transcribe(new Uint8Array([1]));
  expect(r.ok).toBe(false);
  expect(r.text).toBe("");
});

test("TTS returns audio bytes, falls back silently on error", async () => {
  const okFetch = (async () =>
    new Response(new Uint8Array([1, 2, 3, 4]).buffer, { status: 200 })) as unknown as typeof fetch;
  const tts = new TextToSpeech({ fetchFn: okFetch });
  const r = await tts.speak("hello");
  expect(r.ok).toBe(true);
  expect(r.audio?.length).toBe(4);

  const badFetch = (async () => {
    throw new Error("no tts");
  }) as unknown as typeof fetch;
  const tts2 = new TextToSpeech({ fetchFn: badFetch });
  const r2 = await tts2.speak("hello there");
  expect(r2.ok).toBe(false);
  expect(r2.audio).toBeNull();
  expect(r2.spokenText).toContain("hello"); // still gives text
});

// ---- pipeline: voice-confirm approval ----
function makePipeline(transcripts: string[]) {
  let i = 0;
  const stt = new SpeechToText({ fetchFn: (async () => new Response("{}")) as any });
  // override transcribe to return scripted transcripts
  (stt as any).transcribe = async () => ({ ok: true, text: transcripts[Math.min(i++, transcripts.length - 1)] });
  const tts = new TextToSpeech({ fetchFn: (async () => new Response(new Uint8Array([1]).buffer)) as any });
  const played: number[] = [];
  const pipe = new VoicePipeline({
    store,
    stt,
    tts,
    play: () => ({ stop: () => played.push(1) }),
    listen: async () => new Uint8Array([0]),
  });
  return { pipe, played };
}

test("voiceApprover approves on spoken 'confirm'", async () => {
  const { pipe } = makePipeline(["confirm"]);
  const ok = await pipe.voiceApprover()({ tool: "write_file", reason: "create x" });
  expect(ok).toBe(true);
});

test("voiceApprover denies on spoken 'cancel'", async () => {
  const { pipe } = makePipeline(["cancel"]);
  const ok = await pipe.voiceApprover()({ tool: "shell", reason: "run x" });
  expect(ok).toBe(false);
});

test("voiceApprover fails closed after repeated 'unclear'", async () => {
  const { pipe } = makePipeline(["uhh", "what", "hmm", "still nothing"]);
  const ok = await pipe.voiceApprover()({ tool: "delete_file", reason: "delete x" });
  expect(ok).toBe(false);
});

test("voiceApprover fails closed with no microphone", async () => {
  const stt = new SpeechToText({ fetchFn: (async () => new Response("{}")) as any });
  const tts = new TextToSpeech({ fetchFn: (async () => new Response(new Uint8Array([1]).buffer)) as any });
  const pipe = new VoicePipeline({ store, stt, tts, play: () => ({ stop() {} }) }); // no listen
  const ok = await pipe.voiceApprover()({ tool: "shell", reason: "x" });
  expect(ok).toBe(false);
});

// ---- barge-in ----
test("bargeIn stops current speech", async () => {
  const { pipe, played } = makePipeline(["x"]);
  await pipe.say("a long sentence");
  pipe.bargeIn();
  expect(played.length).toBeGreaterThan(0); // stop() was called
});

// ---- wake gating ----
test("processUtterance ignores speech without wake word when required", async () => {
  const stt = new SpeechToText({ fetchFn: (async () => new Response("{}")) as any });
  (stt as any).transcribe = async () => ({ ok: true, text: "random chatter, not for the agent" });
  const tts = new TextToSpeech({ fetchFn: (async () => new Response(new Uint8Array([1]).buffer)) as any });
  const pipe = new VoicePipeline({ store, stt, tts, play: () => ({ stop() {} }), listen: async () => new Uint8Array([0]), requireWake: true });
  const r = await pipe.processUtterance(new Uint8Array([0]));
  expect(r.handled).toBe(false);
});
