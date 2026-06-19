/**
 * XR Stage 8 — Voice pipeline orchestrator.
 *
 * Audio transport, STT, agent/action routing, TTS, barge-in, confirmation, and
 * transcript privacy are coordinated here.  The pipeline is still dependency
 * injected for tests and desktop/dashboard frontends.
 */
import type { Store } from "../state/db.ts";
import { SpeechToText } from "./stt.ts";
import { TextToSpeech } from "./tts.ts";
import { detectWake, parseConfirmation, parseSpokenMetaCommand } from "./wake.ts";
import { runAgent } from "../core/agent.ts";
import { loadConfig, isMemoryEnabled } from "../config/config.ts";
import { buildProvider } from "../providers/factory.ts";
import { priceFor, isLocal } from "../cost/pricing.ts";
import { MemoryStore } from "../memory/store.ts";
import type { ApprovalRequest } from "../core/types.ts";
import { appendTranscript, markVoiceUsed } from "./settings.ts";
import { defaultVoiceSettings, type VoiceSettings } from "./types.ts";
import { handleDeterministicVoiceIntent, parseVoiceIntent } from "./intents.ts";

export interface VoiceDeps {
  store: Store;
  stt: SpeechToText;
  tts: TextToSpeech;
  play?: (audio: Uint8Array) => { stop: () => void; done?: Promise<void> };
  listen?: () => Promise<Uint8Array>;
  requireWake?: boolean;
  settings?: VoiceSettings;
  onText?: (entry: { role: "user" | "assistant" | "system"; text: string }) => void;
}

export class VoicePipeline {
  private speaking: { stop: () => void; done?: Promise<void> } | null = null;
  private lastAssistantText = "";
  private muted = false;
  private settings: VoiceSettings;

  constructor(private deps: VoiceDeps) {
    this.settings = deps.settings ?? defaultVoiceSettings();
  }

  bargeIn(): void {
    if (this.speaking) {
      this.speaking.stop();
      this.speaking = null;
      this.deps.store.audit("voice.bargein", {});
    }
  }

  async say(text: string): Promise<string> {
    if (this.settings.interruptionPolicy === "barge-in") this.bargeIn();
    const trimmed = text.replace(/\s+/g, " ").trim();
    if (!trimmed) return "";
    this.lastAssistantText = trimmed;
    this.deps.onText?.({ role: "assistant", text: trimmed });
    appendTranscript({ at: new Date().toISOString(), role: "assistant", text: trimmed, mode: this.settings.mode, ttsBackend: this.settings.ttsBackend }, this.settings);
    if (this.muted || this.settings.ttsBackend === "disabled") return trimmed;
    const r = await this.deps.tts.speak(trimmed);
    if (r.ok && r.audio && this.deps.play) {
      this.speaking = this.deps.play(r.audio);
      this.speaking.done?.finally(() => { if (this.speaking) this.speaking = null; });
    }
    return r.spokenText;
  }

  voiceApprover(): (req: ApprovalRequest) => Promise<boolean> {
    return async (req: ApprovalRequest): Promise<boolean> => {
      const policy = this.settings.confirmationPolicy;
      if (policy === "never-execute-risky") {
        await this.say("For safety, I cannot execute that action from voice. Please confirm in text mode.");
        return false;
      }
      this.deps.store.audit("voice.confirm.request", { tool: req.tool });
      await this.say(`I'm about to ${req.reason}. Say confirm or cancel.`);
      for (let attempt = 0; attempt < 3; attempt++) {
        if (!this.deps.listen) return false;
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
      return false;
    };
  }

  async processText(text: string): Promise<{ handled: boolean; reply: string }> {
    markVoiceUsed();
    let command = text.replace(/\s+/g, " ").trim();
    if (!command) return { handled: false, reply: "" };

    const requireWake = this.deps.requireWake ?? (this.settings.mode === "wake-word" || this.settings.mode === "always-listen");
    if (requireWake) {
      const wake = detectWake(command, this.settings.wakeWord);
      if (!wake.triggered) return { handled: false, reply: "" };
      command = wake.command;
    }

    const meta = parseSpokenMetaCommand(command);
    if (meta === "stop" || meta === "cancel") {
      this.bargeIn();
      await this.say(meta === "stop" ? "Stopped." : "Cancelled.");
      return { handled: true, reply: meta };
    }
    if (meta === "repeat" || meta === "say-again") {
      await this.say(this.lastAssistantText || "I haven't said anything yet.");
      return { handled: true, reply: this.lastAssistantText };
    }
    if (meta === "mute") {
      this.muted = true;
      this.bargeIn();
      return { handled: true, reply: "muted" };
    }
    if (meta === "unmute") {
      this.muted = false;
      await this.say("Voice is back on.");
      return { handled: true, reply: "unmuted" };
    }

    this.deps.onText?.({ role: "user", text: command });
    appendTranscript({ at: new Date().toISOString(), role: "user", text: command, mode: this.settings.mode, sttBackend: this.settings.sttBackend }, this.settings);
    this.deps.store.audit("voice.command", { length: command.length, intent: parseVoiceIntent(command).kind });

    if (await handleDeterministicVoiceIntent(this.deps.store, command, async (line) => { await this.say(line); })) {
      return { handled: true, reply: this.lastAssistantText };
    }

    const routed = parseVoiceIntent(command);
    if (routed.kind === "research") return this.runVoiceResearch(routed.args || command);
    if (routed.kind === "doctor") {
      const reply = "Run xr doctor in the terminal for the full health report. Voice health is included there.";
      await this.say(reply);
      return { handled: true, reply };
    }

    const { config } = loadConfig();
    const providerId = config.defaults.provider;
    const model = config.defaults.model;
    const provider = buildProvider(config, {});
    const memoryEngine = new MemoryStore(this.deps.store);
    const memEnabled = isMemoryEnabled();

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
      memory: {
        enabled: memEnabled && config.memory.injectInChat,
        recallLimit: config.memory.recallLimit,
        semantic: config.memory.semanticRecall,
      },
      memoryStore: memoryEngine,
      sessionSummary: {
        enabled: memEnabled && config.memory.saveSessionSummaries,
        minTurns: config.memory.sessionSummaryMinTurns,
      },
    });

    const reply = result.finalMessage || `Done. ${result.meter ?? ""}`;
    await this.say(reply);
    return { handled: true, reply };
  }

  private async runVoiceResearch(topic: string): Promise<{ handled: boolean; reply: string }> {
    await this.say(`Researching ${topic}. Let me gather sources.`);
    try {
      const { config } = loadConfig();
      const providerId = config.defaults.provider;
      const model = config.defaults.model;
      const provider = buildProvider(config, {});
      const { WebSearchCapability } = await import("../research/search.ts");
      const { GovernedResearchBudget, LocalResearchBudget } = await import("../research/budget.ts");
      const { runResearch } = await import("../research/engine.ts");
      const toolCtx = {
        cwd: process.cwd(),
        approve: async () => false,
        audit: (event: string, detail: Record<string, unknown>) => this.deps.store.audit(event, detail),
        egressAllowlist: config.security.egressAllowlist,
        dryRun: false,
      };
      const budget: import("../research/engine.ts").ResearchBudgetGuard = isLocal(providerId)
        ? new LocalResearchBudget()
        : new GovernedResearchBudget(this.deps.store, { maxUsd: config.budget.perTaskUsd, maxTokens: config.budget.perTaskTokens }, priceFor(providerId, model));
      const session = await runResearch({
        provider,
        store: this.deps.store,
        search: new WebSearchCapability(toolCtx),
        budget,
        say: () => {},
        audit: (event: string, detail: Record<string, unknown>) => this.deps.store.audit(event, detail),
      }, { topic, depth: "quick" });
      const reply = session.synthesis
        ? `${session.synthesis.shortAnswer} I checked ${session.sources.length} sources.`
        : `I couldn't gather enough verified sources on ${topic}.`;
      await this.say(reply);
      return { handled: true, reply };
    } catch (e) {
      const reply = `Research failed: ${(e as Error).message}`;
      await this.say(reply);
      return { handled: true, reply };
    }
  }

  async processUtterance(audio: Uint8Array): Promise<{ handled: boolean; reply: string }> {
    if (this.settings.interruptionPolicy === "barge-in") this.bargeIn();
    const stt = await this.deps.stt.transcribe(audio);
    if (!stt.ok || !stt.text) return { handled: false, reply: stt.detail ?? "" };
    return this.processText(stt.text);
  }
}
