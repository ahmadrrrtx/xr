/**
 * XR-LAUNCH-035 — `xr voice status` shows ✓ for STT/TTS only after a probe.
 *
 * Before: SpeechToText/TextToSpeech.describe() answered `available: true`
 * ("run transcribe() / describeAsync() for live probe"), so status printed ✓
 * for backends that did not exist. Now:
 *   · local binaries / the native library are probed;
 *   · an HTTP endpoint is contacted ONLY on loopback, with a 1.5 s timeout;
 *   · cloud backends are never contacted (key presence only) → "unknown";
 *   · `--no-probe` → "unknown" ("? not probed");
 *   · doctor maps "unknown" to warn (JSON) / "?" (text).
 * The STT/TTS lines are pinned verbatim below (a status snapshot).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVoiceStack } from "../../src/voice/index.ts";
import { defaultVoiceSettings, type VoiceSettings } from "../../src/voice/types.ts";

const saved = { groq: process.env.GROQ_API_KEY, openai: process.env.OPENAI_API_KEY, stt: process.env.XR_STT_URL, tts: process.env.XR_TTS_URL };
afterAll(() => {
  for (const [k, v] of [["GROQ_API_KEY", saved.groq], ["OPENAI_API_KEY", saved.openai], ["XR_STT_URL", saved.stt], ["XR_TTS_URL", saved.tts]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
delete process.env.XR_STT_URL;
delete process.env.XR_TTS_URL;

const settings = (over: Partial<VoiceSettings>): VoiceSettings => ({ ...defaultVoiceSettings(), sttBackend: "disabled", ttsBackend: "disabled", ...over });
/** A fetch that records calls and answers 404 (any HTTP answer = reachable). */
function recorder() {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, impl };
}
const lines = (h: Awaited<ReturnType<typeof checkVoiceStack>>) =>
  h.details.filter((d) => d.startsWith("Speech-to-text") || d.startsWith("Text-to-speech"));

describe("XR-LAUNCH-035 · STT/TTS states come from probes", () => {
  test("--no-probe: both are '?' (unknown), never ✓ — snapshot", async () => {
    const h = await checkVoiceStack(settings({ sttBackend: "auto", ttsBackend: "auto" }), { probe: false });
    expect(lines(h)).toEqual(["Speech-to-text: ? not probed (--no-probe)", "Text-to-speech: ? not probed (--no-probe)"]);
    expect(h.stt).toBe(false);
    expect(h.tts).toBe(false);
    expect(h.checks.find((c) => c.id === "voice-stt")?.remediation).toBeUndefined();
  });

  test("disabled backends are a warning, not a ✓ — snapshot", async () => {
    const h = await checkVoiceStack(settings({}));
    expect(lines(h)).toEqual(["Speech-to-text: ! disabled: STT disabled", "Text-to-speech: ! disabled: TTS disabled"]);
  });

  test("a loopback HTTP endpoint is contacted once (1.5 s budget) and ✓ only when it answers — snapshot", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    try {
      const url = `http://127.0.0.1:${server.port}`;
      const h = await checkVoiceStack(settings({ sttBackend: "http", sttUrl: url, ttsBackend: "http", ttsUrl: url }));
      expect(lines(h)).toEqual([
        `Speech-to-text: ✓ http: HTTP STT at ${url} — reachable (HTTP 200)`,
        `Text-to-speech: ✓ http: HTTP TTS at ${url} — reachable (HTTP 200)`,
      ]);
      expect(h.stt && h.tts).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("a loopback endpoint that is down is a warning with a remediation", async () => {
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const url = `http://127.0.0.1:${probe.port}`;
    probe.stop(true); // the port is now closed
    const h = await checkVoiceStack(settings({ sttBackend: "http", sttUrl: url }));
    const stt = h.checks.find((c) => c.id === "voice-stt")!;
    expect(stt.state).toBe("warn");
    expect(stt.detail).toEndWith("— not reachable");
    expect(stt.remediation).toBeTruthy();
  });

  test("a non-loopback endpoint is never contacted: '?' not probed", async () => {
    const { calls, impl } = recorder();
    const h = await checkVoiceStack(settings({ sttBackend: "http", sttUrl: "http://192.168.1.20:8080", ttsBackend: "http", ttsUrl: "https://tts.example.com" }), { fetcher: impl });
    expect(calls).toEqual([]);
    expect(lines(h)).toEqual([
      "Speech-to-text: ? http: HTTP STT at http://192.168.1.20:8080 — not probed (192.168.1.20:8080 is not loopback)",
      "Text-to-speech: ? http: HTTP TTS at https://tts.example.com — not probed (tts.example.com is not loopback)",
    ]);
  });

  test("loopback spellings (localhost, 127.x, [::1]) are probed through the injected fetch", async () => {
    for (const host of ["localhost:8081", "127.0.0.2:8081", "[::1]:8081"]) {
      const { calls, impl } = recorder();
      const h = await checkVoiceStack(settings({ sttBackend: "http", sttUrl: `http://${host}` }), { fetcher: impl });
      expect(calls).toEqual([`http://${host}/`]);
      expect(h.checks.find((c) => c.id === "voice-stt")?.state).toBe("ok");
    }
  });

  test("cloud STT is never contacted: a key makes it '?', a missing key is a warning", async () => {
    const { calls, impl } = recorder();
    process.env.GROQ_API_KEY = "REDACTED-TEST-KEY";
    const withKey = await checkVoiceStack(settings({ sttBackend: "groq", allowCloudStt: true }), { fetcher: impl });
    expect(lines(withKey)[0]).toBe("Speech-to-text: ? groq: cloud key present — cloud, not contacted");
    delete process.env.GROQ_API_KEY;
    const noKey = await checkVoiceStack(settings({ sttBackend: "groq", allowCloudStt: true }), { fetcher: impl });
    expect(lines(noKey)[0]).toBe("Speech-to-text: ! groq: missing GROQ_API_KEY");
    expect(calls).toEqual([]);
  });

  test("the CLI prints '?' for unknown and doctor maps unknown to warn / '?'", async () => {
    process.env.XR_HOME = join(mkdtempSync(join(tmpdir(), "xr-voice-035-")), "home");
    const out: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => out.push(a.map(String).join(" "));
    try {
      const { printVoiceStatus } = await import("../../src/voice/cli.ts");
      await printVoiceStatus({ probe: false });
    } finally {
      console.log = log;
    }
    const text = out.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
    expect(text).toMatch(/\? Speech-to-text\s+not probed \(--no-probe\)/);
    expect(text).not.toMatch(/✓ Speech-to-text/);
    const doctor = await Bun.file(join(import.meta.dir, "..", "..", "src", "commands", "doctor.ts")).text();
    expect(doctor).toContain('state:c.state === "unknown" ? "warn" : c.state');
    expect(doctor).toContain('c.state === "unknown" ? C.amber("?")');
  });
});
