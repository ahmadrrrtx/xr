/**
 * XR Phase 4 / 15 — Voice daemon surface (the transport for src/voice).
 *
 * The pipeline (src/voice/pipeline.ts) is dependency-injected; this module is
 * the daemon surface a desktop talks to, and it is deliberately THIN:
 *
 *   - audio UP:    POST /api/voice/audio   (pcm16-le 16 kHz chunks, base64)
 *   - events DOWN: GET  /api/voice/events  (SSE: state/final/tts/tts_stop/
 *                  approval/status/error/download/cost)
 *   - control:     POST /api/voice/session {start|stop}, /barge-in, /played, /say
 *   - facts:       GET  /api/voice/status · /models · /voices · /settings
 *   - Phase 15:    POST /settings · /download · /cancel-download · /clear-models
 *                  · /test-tts · /transcribe
 *
 * Everything smart lives in the engine: endpointing uses the existing VAD
 * primitives, transcripts go through SpeechToText (offline sherpa-onnx first,
 * whisper CLI next, cloud only if explicitly allowed), replies through
 * VoicePipeline.processText (wake word, meta-commands, deterministic intents,
 * agent fallback) and TextToSpeech (offline Piper first, espeak next).
 * The shell renders states and forwards bytes; it computes nothing (SEC-07).
 *
 * Approvals-in-voice: a voice run's approvals are DURABLE records (surface
 * "voice") announced on the event stream; saying confirm/cancel, pressing the
 * desktop buttons, or the TTL decides them through the SAME store every other
 * surface uses (channel "voice").
 */
import { route, sseResponse, type DaemonRoute } from "./router.ts";
import type { VoiceSettings } from "../../voice/types.ts";
import { patchVoiceSettings, sanitizeVoicePatch, VoiceSettingsConflict } from "../../voice/settings.ts";
import { resetNativeVoice } from "../../voice/native.ts";
import { modelCatalogue, voiceCatalogue } from "../../voice/catalogue.ts";
import { DEFAULT_TTS_VOICE, ESPEAK_ENTRY, clearVoiceModels, entryBytes, entryInstalled, findEntry, firstRunPlan, type VoiceComponent } from "../../voice/models.ts";
import { voiceSessionFor, type VoiceEvent } from "../voice-session.ts";
export { VoiceSession, voiceSessionFor, pcm16ToWav, speechRmsFor, type VoiceEvent, type VoiceSessionState } from "../voice-session.ts";

export function voiceRoutes(): DaemonRoute[] {
  return [
    route({
      id: "voice.status",
      path: "/api/voice/status",
      method: "GET",
      handle: async ({ json, state }) => json(await voiceSessionFor(state.store).status()),
    }),
    route({
      id: "voice.session",
      path: "/api/voice/session",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { action?: string };
        const s = voiceSessionFor(state.store);
        if (body.action === "start") {
          const st = await s.status();
          if (!(st.stt as { loaded: boolean }).loaded) {
            return json({ error: "stt-model-missing", detail: (st.stt as { name: string }).name, firstRun: st.firstRun }, 409);
          }
          s.start();
        } else if (body.action === "stop") s.stop();
        else return json({ error: "expected { action: start|stop }" }, 400);
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.audio",
      path: "/api/voice/audio",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { pcm?: string };
        if (!body.pcm) return json({ error: "expected { pcm: base64 }" }, 400);
        const s = voiceSessionFor(state.store);
        s.feedAudio(new Uint8Array(Buffer.from(body.pcm, "base64")));
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.events",
      path: "/api/voice/events",
      method: "GET",
      handle: ({ state }) => {
        const s = voiceSessionFor(state.store);
        let cleanup: (() => void) | null = null;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const enc = new TextEncoder();
            const push = (e: VoiceEvent) => {
              try {
                controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
              } catch {
                /* client gone */
              }
            };
            const off = s.subscribe(push);
            push({ type: "state", state: s.state });
            const keepalive = setInterval(() => {
              try {
                controller.enqueue(enc.encode(": keepalive\n\n"));
              } catch {
                /* ignore */
              }
            }, 20_000);
            cleanup = () => { off(); clearInterval(keepalive); };
          },
          cancel() {
            cleanup?.();
          },
        });
        return sseResponse(stream);
      },
    }),
    route({
      id: "voice.barge",
      path: "/api/voice/barge-in",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        s.bargeIn();
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.played",
      path: "/api/voice/played",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        s.played();
        return json({ state: s.state });
      },
    }),
    route({
      id: "voice.say",
      path: "/api/voice/say",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { text?: string };
        if (!body.text) return json({ error: "expected { text }" }, 400);
        const s = voiceSessionFor(state.store);
        await s.say(body.text);
        return json({ state: s.state });
      },
    }),
    // ── Phase 15 ──────────────────────────────────────────────────────────
    route({
      id: "voice.models",
      path: "/api/voice/models",
      method: "GET",
      handle: async ({ json }) => json(await modelCatalogue()),
    }),
    route({
      id: "voice.voices",
      path: "/api/voice/voices",
      method: "GET",
      handle: ({ json }) => json({ voices: voiceCatalogue(), sample: "Ready when you are." }),
    }),
    route({
      id: "voice.settings.get",
      path: "/api/voice/settings",
      method: "GET",
      handle: ({ json, state }) => {
        const settings = { ...voiceSessionFor(state.store).currentSettings() };
        delete (settings as Partial<VoiceSettings>).lastTestResult;
        return json({ settings });
      },
    }),
    route({
      id: "voice.settings.set",
      path: "/api/voice/settings",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body !== "object") return json({ error: "expected a settings patch" }, 400);
        if (typeof body.expectedRevision !== "string") return json({ error: "expectedRevision is required; read voice settings first" }, 428);
        const patch = sanitizeVoicePatch(body);
        let next: VoiceSettings;
        try { next = patchVoiceSettings(patch, body.expectedRevision); }
        catch (e) { if (e instanceof VoiceSettingsConflict) return json({ error: e.message, revision: e.revision }, 409); throw e; }
        const s = voiceSessionFor(state.store);
        s.reconfigure(next);
        state.store.audit("voice.settings.update", { keys: Object.keys(patch) });
        const settings = { ...next };
        delete (settings as Partial<VoiceSettings>).lastTestResult;
        return json({ settings });
      },
    }),
    route({
      id: "voice.download",
      path: "/api/voice/download",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { component?: string; id?: string; firstRun?: boolean };
        const s = voiceSessionFor(state.store);
        const entries = body.firstRun
          ? firstRunPlan(body.id ?? (s.currentSettings().ttsVoice === "default" ? DEFAULT_TTS_VOICE : s.currentSettings().ttsVoice))
          : (() => {
              const e = body.component && body.id ? findEntry(body.component as VoiceComponent, body.id) : null;
              return e ? [e] : null;
            })();
        if (!entries) return json({ error: "unknown component/id" }, 400);
        // B1/B15 — typed, synchronous admission; the session owns the detached
        // completion chain (audited failure, isolated reconfigure, never rejects).
        const run = s.startDownload(entries);
        if (!run.started) return json({ error: "download-busy", download: run.current }, 409);
        state.store.audit("voice.models.download", { items: entries.map((e) => e.id) });
        return json({ started: entries.map((e) => ({ id: e.id, component: e.component, bytes: entryBytes(e) })), bytes: entries.reduce((n, e) => n + entryBytes(e), 0) });
      },
    }),
    route({
      id: "voice.download.cancel",
      path: "/api/voice/cancel-download",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        const was = s.downloader.current();
        const cancelled = s.downloader.busy();
        s.downloader.cancel();
        return json({ cancelled, download: was });
      },
    }),
    route({
      id: "voice.models.clear",
      path: "/api/voice/clear-models",
      method: "POST",
      handle: ({ json, state }) => {
        const s = voiceSessionFor(state.store);
        if (s.state !== "idle") s.stop();
        s.downloader.cancel();
        const out = clearVoiceModels();
        resetNativeVoice();
        s.reconfigure(s.currentSettings());
        state.store.audit("voice.models.clear", { removed: out.removed.length });
        return json(out);
      },
    }),
    route({
      id: "voice.test_tts",
      path: "/api/voice/test-tts",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { text?: string; voice?: string; speed?: number };
        const text = (body.text ?? "Ready when you are.").slice(0, 300);
        const s = voiceSessionFor(state.store);
        if (body.voice) {
          const entry = findEntry("tts", body.voice);
          if (entry && !(entryInstalled(entry) && entryInstalled(ESPEAK_ENTRY))) return json({ error: "voice-not-installed", id: body.voice, bytes: entryBytes(entry) }, 409);
        }
        const out = await s.preview(text, body.voice, typeof body.speed === "number" ? body.speed : undefined);
        return json(out, out.ok ? 200 : 409);
      },
    }),
    route({
      id: "voice.transcribe",
      path: "/api/voice/transcribe",
      method: "POST",
      handle: async ({ req, json, state }) => {
        const body = (await req.json().catch(() => ({}))) as { pcm?: string };
        if (!body.pcm) return json({ error: "expected { pcm: base64 }" }, 400);
        const s = voiceSessionFor(state.store);
        const out = await s.transcribe(new Uint8Array(Buffer.from(body.pcm, "base64")));
        return json(out, out.ok || !out.detail ? 200 : 409);
      },
    }),
  ];
}
