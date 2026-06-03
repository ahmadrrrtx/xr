/**
 * XR — voice pipeline orchestrator (Block 7).
 *
 * Ties the local voice stack into the agent:
 *   audio → STT → (wake check) → runAgent → TTS, with:
 *     • barge-in: if the user starts speaking while XR talks, TTS stops
 *     • voice-confirm: risky actions are spoken aloud and require a verbal
 *       "confirm"/"cancel" (high-risk safety, deterministic)
 *
 * Audio capture/playback is device-level (injected); this orchestrator is pure
 * logic and fully unit-testable.
 */
import type { Store } from "../state/db.ts";
import { SpeechToText } from "./stt.ts";
import { TextToSpeech } from "./tts.ts";
import { detectWake, parseConfirmation } from "./wake.ts";
import { runAgent } from "../core/agent.ts";
import { loadConfig } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import type { ApprovalRequest } from "../core/types.ts";

export interface VoiceDeps {
  store: Store;
  stt: SpeechToText;
  tts: TextToSpeech;
  /** Play audio bytes on the device. Returns a handle that can be stopped (barge-in). */
  play?: (audio: Uint8Array) => { stop: () => void };
  /** Capture one utterance (returns audio bytes). Device-level. */
  listen?: () => Promise<Uint8Array>;
  /** Require wake word before acting (true for always-listening). */
  requireWake?: boolean;
}

export class VoicePipeline {
  private speaking: { stop: () => void } | null = null;

  constructor(private deps: VoiceDeps) {}

  /** Stop any current speech (barge-in). */
  bargeIn(): void {
    if (this.speaking) {
      this.speaking.stop();
      this.speaking = null;
      this.deps.store.audit("voice.bargein", {});
    }
  }

  /** Speak text (interruptible). */
  async say(text: string): Promise<string> {
    this.bargeIn();
    const r = await this.deps.tts.speak(text);
    if (r.ok && r.audio && this.deps.play) {
      this.speaking = this.deps.play(r.audio);
    }
    return r.spokenText;
  }

  /**
   * Voice-confirm approval: speak the action, capture a verbal yes/no, allow up
   * to 2 retries on "unclear", default-deny otherwise. (Fail closed.)
   */
  voiceApprover(): (req: ApprovalRequest) => Promise<boolean> {
    return async (req: ApprovalRequest): Promise<boolean> => {
      this.deps.store.audit("voice.confirm.request", { tool: req.tool });
      await this.say(`I'm about to ${req.reason}. Say confirm or cancel.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.deps.listen) return false; // no mic → fail closed
        const audio = await this.deps.listen();
        const t = await this.deps.stt.transcribe(audio);
        const decision = parseConfirmation(t.text);
        if (decision === "confirm") {
          this.deps.store.audit("voice.confirm.approved", { tool: req.tool });
          return true;
        }
        if (decision === "cancel") {
          this.deps.store.audit("voice.confirm.cancelled", { tool: req.tool });
          return false;
        }
        await this.say("Sorry, I didn't catch that. Confirm or cancel?");
      }
      this.deps.store.audit("voice.confirm.timeout", { tool: req.tool });
      return false; // unclear after retries → deny
    };
  }

  /**
   * Process ONE captured utterance end-to-end. Returns a transcript of what
   * was done (for logging / display). Exposed for tests.
   */
  async processUtterance(audio: Uint8Array): Promise<{ handled: boolean; reply: string }> {
    const stt = await this.deps.stt.transcribe(audio);
    if (!stt.ok || !stt.text) return { handled: false, reply: "" };

    let command = stt.text;
    if (this.deps.requireWake) {
      const wake = detectWake(stt.text);
      if (!wake.triggered) return { handled: false, reply: "" };
      command = wake.command;
    }
    if (!command) {
      await this.say("Yes? What would you like me to do?");
      return { handled: true, reply: "awaiting command" };
    }

    this.deps.store.audit("voice.command", { text: command });
    const { config } = loadConfig();
    const providerId = config.defaults.provider;
    const model = config.defaults.model;
    const provider = buildProvider(config, {});

    const result = await runAgent(command, "agent", {
      store: this.deps.store,
      provider,
      cwd: process.cwd(),
      say: () => {},
      approve: this.voiceApprover(),
      budget: {
        maxUsd: isLocal(providerId) ? undefined : config.budget.perTaskUsd,
        maxTokens: config.budget.perTaskTokens,
      },
      pricing: priceFor(providerId, model),
      egressAllowlist: config.security.egressAllowlist,
    });

    const reply = result.finalMessage || `Done. ${result.meter ?? ""}`;
    await this.say(reply);
    return { handled: true, reply };
  }
}
