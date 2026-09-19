/**
 * Phase 4 · avatar state machine — the extended voice vocabulary.
 *
 * Proves, offline and without a mic:
 *   • the session accepts and emits the FULL state set the desktop renders
 *     (planning/tool/success join the original five + interrupted)
 *   • barge-in while SPEAKING stops the utterance and drops the session back
 *     to listening (tts_stop emitted) — the honest interrupt path
 *   • pipeline onPhase wiring: planning/tool phases surface as state events
 *     for subscribers (the shell only renders what the engine reports)
 */
import { describe, expect, test } from "bun:test";
import { VoiceSession } from "../../src/daemon/routes/voice.routes.ts";
import { defaultVoiceSettings } from "../../src/voice/types.ts";

function stubStore(): any {
  return { audit: () => undefined, workspaceId: "test" };
}

const settings = () => ({ ...defaultVoiceSettings(), sttBackend: "disabled" as const, ttsBackend: "disabled" as const });

describe("voice avatar state machine", () => {
  test("subscribers observe the extended state vocabulary", () => {
    const session = new VoiceSession(stubStore(), settings());
    const states: string[] = [];
    session.subscribe((e) => { if (e.type === "state" && e.state) states.push(e.state); });
    for (const s of ["planning", "tool", "working", "success", "listening"] as const) {
      session.setState(s);
    }
    expect(states).toEqual(["idle", "planning", "tool", "working", "success", "listening"]);
    session.stop();
  });

  test("barge-in while speaking emits tts_stop and returns to listening", () => {
    const session = new VoiceSession(stubStore(), settings());
    const events: string[] = [];
    session.subscribe((e) => events.push(e.type));
    session.start();
    session.setState("speaking");
    session.bargeIn();
    expect(events).toContain("tts_stop");
    expect(session.state).toBe("listening");
    session.stop();
  });

  test("pipeline onPhase surfaces planning/tool as session states", async () => {
    const session = new VoiceSession(stubStore(), settings());
    const states: string[] = [];
    session.subscribe((e) => { if (e.type === "state" && e.state) states.push(e.state); });
    // the engine wires pipeline.onPhase → setState; exercise the same path
    // the voice route uses at construction time.
    (session as unknown as { pipeline: { deps?: { onPhase?: (p: "planning" | "tool") => void } } })
      .pipeline.deps?.onPhase?.("planning");
    (session as unknown as { pipeline: { deps?: { onPhase?: (p: "planning" | "tool") => void } } })
      .pipeline.deps?.onPhase?.("tool");
    expect(states).toContain("planning");
    expect(states).toContain("tool");
    session.stop();
  });
});
