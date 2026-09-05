/** XR Stage 9 / XR 5.1 — deterministic voice intent router. */
import type { Store } from "../state/workspace-store.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { runEnvironmentAction } from "../platform/environment/service.ts";
import { environmentForAction } from "../platform/environment/classify.ts";
import { ActionSchema } from "../control/types.ts";
import { parseMemoryIntent } from "../context/memory/intent.ts";
import { MemoryStore, projectScopeFromCwd } from "../context/memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";
import { getVoiceSettings } from "./settings.ts";

export type VoiceIntentKind =
  | "control"
  | "research"
  | "memory"
  | "provider"
  | "model"
  | "budget"
  | "doctor"
  | "general"
  | "stop";

export interface VoiceIntent {
  kind: VoiceIntentKind;
  confidence: number;
  args: string;
  action?: unknown;
}

export function parseVoiceIntent(text: string): VoiceIntent {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if (/^(stop|cancel|abort|never mind|nevermind|pause)$/i.test(t)) return { kind: "stop", confidence: 1, args: "" };
  if (/^(doctor|health check|check system|system status)$/i.test(t)) return { kind: "doctor", confidence: 0.95, args: "" };
  if ((m = t.match(/^(?:research|investigate|look up deeply|make a report on|give me a brief on)\s+(.+)$/i))) return { kind: "research", confidence: 0.9, args: m[1].trim() };
  if ((m = t.match(/^(?:remember|forget|what do you remember|what do you know)\b(.*)$/i))) return { kind: "memory", confidence: 0.9, args: t };
  if ((m = t.match(/^(?:switch|change|set)\s+(?:provider|ai provider)\s+(?:to\s+)?([a-z0-9_-]+)$/i))) return { kind: "provider", confidence: 0.9, args: m[1].trim() };
  if ((m = t.match(/^(?:switch|change|set)\s+(?:model)\s+(?:to\s+)?(.+)$/i))) return { kind: "model", confidence: 0.85, args: m[1].trim() };
  if (/\b(budget|spend|cost|remaining)\b/i.test(t)) return { kind: "budget", confidence: 0.75, args: t };
  const action = parseControlAction(t);
  if (action) return { kind: "control", confidence: 0.88, args: t, action };
  return { kind: "general", confidence: 0.5, args: t };
}

export function parseControlAction(t: string): unknown | null {
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(?:open|launch|start)\s+(?:the\s+)?(?:app\s+)?(.+)$/i))) {
    const target = m[1].trim();
    if (/^https?:\/\//i.test(target)) return { type: "open", target };
    if (/\.[a-z]{2,}(?:\/.*)?$/i.test(target) && !/\s/.test(target)) return { type: "open", target: target.startsWith("http") ? target : `https://${target}` };
    return { type: "app", name: target };
  }
  if ((m = t.match(/^(?:close|quit)\s+(?:the\s+)?(.+)$/i))) return { type: "close", name: m[1].trim() };
  if ((m = t.match(/^(?:go to|visit|navigate to)\s+(.+)$/i))) {
    const target = m[1].trim();
    return { type: "open", target: /^https?:\/\//i.test(target) ? target : `https://${target}` };
  }
  if ((m = t.match(/^type(?:\s+.+?)?[:\s]+(.+)$/i))) return { type: "type", text: m[1].trim() };
  if ((m = t.match(/^click(?:\s+(left|right|double))?(?:\s+at)?\s+(\d+)[,\s]+(\d+)/i))) return { type: "click", button: (m[1] || "left").toLowerCase(), x: Number(m[2]), y: Number(m[3]) };
  if ((m = t.match(/^drag\s+(\d+)[,\s]+(\d+)\s+(?:to|->)\s+(\d+)[,\s]+(\d+)/i))) return { type: "drag_drop", x1: Number(m[1]), y1: Number(m[2]), x2: Number(m[3]), y2: Number(m[4]) };
  if ((m = t.match(/^move(?:\s+mouse)?(?:\s+to)?\s+(\d+)[,\s]+(\d+)/i))) return { type: "move", x: Number(m[1]), y: Number(m[2]) };
  if ((m = t.match(/^press\s+(.+)$/i))) return { type: "key", keys: m[1].split(/[+\s]+/).filter(Boolean) };
  if ((m = t.match(/^focus\s+(.+)$/i))) return { type: "focus", name: m[1].trim() };
  if ((m = t.match(/^scroll\s+(up|down|left|right)(?:\s+(\d+))?/i))) return { type: "scroll", direction: m[1].toLowerCase(), amount: Number(m[2] || 3) };
  if (/screenshot|take a picture|snap/i.test(t)) return { type: "screenshot", target: "screen" };
  if ((m = t.match(/^(?:open|edit)\s+(?:in\s+)?(?:vscode|vs code|code|cursor)\s+(.+)$/i))) return { type: "editor", op: "open", editor: "auto", file: m[1].trim() };
  if ((m = t.match(/^computer(?:\s+use)?\s+(.+)$/i))) return { type: "computer_use", task: m[1].trim() };
  return null;
}

export async function handleDeterministicVoiceIntent(store: Store, text: string, speak: (text: string) => Promise<void>): Promise<boolean> {
  const intent = parseVoiceIntent(text);
  if (intent.kind === "control" && intent.action) {
    const { config } = loadConfig();
    if (!config.control.enabled) {
      await speak("Computer control is off. Enable it with xr control start before I can control the desktop.");
      return true;
    }
    // XR 5.1 — voice is an interface, not an authority bypass (§7.5). Control
    // intents pass through the Environment Interaction OS gate with voice
    // provenance: confidence threshold, confirmation policy (including
    // never-execute-risky), and stronger-channel rules for high-risk actions.
    const parsed = ActionSchema.safeParse(intent.action);
    if (!parsed.success) {
      await speak("I understood a control command, but it was not a valid action. Please rephrase.");
      return true;
    }
    const settings = getVoiceSettings();
    const run = await runEnvironmentAction(
      store,
      {
        environment: environmentForAction(parsed.data) === "vision" ? "desktop" : environmentForAction(parsed.data),
        action: parsed.data,
        target: { kind: "none" },
        sourceActor: "voice",
        confidence: intent.confidence >= 0.85 ? "medium" : "low",
        dryRun: false,
      },
      {
        workspaceId: process.cwd(),
        voice: { confidence: intent.confidence, confirmationPolicy: settings.confirmationPolicy },
        delayMs: config.control.stepDelayMs,
      },
    );
    if (run.record.outcome === "denied" && run.spokenRefusal) {
      await speak(run.spokenRefusal);
    } else if (run.record.outcome === "succeeded") {
      await speak(`Done. ${run.record.message}`);
    } else {
      await speak(`I could not do that. ${run.record.message}`);
    }
    return true;
  }
  if (intent.kind === "memory") {
    if (!isMemoryEnabled()) { await speak("Memory is disabled."); return true; }
    const parsed = parseMemoryIntent(text);
    if (parsed.kind === "none") return false;
    const mem = new MemoryStore(store);
    const scope = projectScopeFromCwd(process.cwd());
    if (parsed.kind === "add") {
      const res = mem.add({ content: parsed.content, category: parsed.category, scope: parsed.category === "project" ? scope : undefined, source: "voice", provenance: { source: "user", ref: "voice" } });
      await speak(!res.ok ? `I could not save that. ${res.reason}.` : res.duplicate ? "I already remembered that." : parsed.category === "exclusion" ? "Understood. I will not remember that." : "Got it. I'll remember that.");
      return true;
    }
    if (parsed.kind === "forget") {
      const matches = mem.search(parsed.query, { scope });
      for (const x of matches) mem.remove(x.id);
      await speak(matches.length ? `Forgotten ${matches.length} note${matches.length === 1 ? "" : "s"}.` : "I have no note matching that.");
      return true;
    }
    // XR 4.5 — revoke withdraws consent but keeps the record inspectable.
    if (parsed.kind === "revoke") {
      const matches = mem.search(parsed.query, { scope });
      let revoked = 0;
      for (const x of matches) if (mem.revoke(x.id, "user_revoked", "voice").ok) revoked++;
      await speak(
        revoked
          ? `Revoked ${revoked} note${revoked === 1 ? "" : "s"}. I will not use ${revoked === 1 ? "it" : "them"} again, but ${revoked === 1 ? "it is" : "they are"} still listed if you want to review or delete.`
          : "I have no note matching that.",
      );
      return true;
    }
    // Corrections must be unambiguous — XR never guesses which fact you meant.
    if (parsed.kind === "correct") {
      const matches = mem.search(parsed.query, { scope });
      if (matches.length === 0) {
        await speak("I have no note matching that, so there is nothing to correct.");
      } else if (matches.length > 1) {
        await speak(`${matches.length} notes match that. Please correct one by name in the terminal so I don't change the wrong thing.`);
      } else {
        const res = mem.correct(matches[0]!.id, parsed.replacement, "voice");
        await speak(res.ok ? "Corrected. I kept the old version marked as superseded." : `I could not correct that. ${res.reason ?? ""}`);
      }
      return true;
    }
    if (parsed.kind === "export") {
      await speak("You can export your memory with: x r memory export. I won't write files from voice without a confirmation.");
      return true;
    }
    if (parsed.kind === "inspect") {
      const found = mem.search(parsed.query, { scope });
      if (!found.length) {
        await speak("I have nothing saved about that.");
      } else {
        const e = found[0]!;
        await speak(
          `I have: ${e.content}. Source: ${e.source}. Consent: ${e.consentState ?? "unknown"}. Say "x r memory inspect" in the terminal for full provenance.`,
        );
      }
      return true;
    }
    const results = mem.recall(parsed.query || "preferences", { scope, principal: "user" });
    await speak(results.length ? `Here's what I remember. ${results.slice(0, 4).map((e) => e.content).join(". ")}.` : "I don't have anything saved that's relevant.");
    return true;
  }
  if (intent.kind === "provider") {
    const { config } = loadConfig(); config.defaults.provider = intent.args; saveConfig(config);
    await speak(`Provider switched to ${intent.args}.`); return true;
  }
  if (intent.kind === "model") {
    const { config } = loadConfig(); config.defaults.model = intent.args; saveConfig(config);
    await speak(`Model switched to ${intent.args}.`); return true;
  }
  if (intent.kind === "budget") {
    const { config } = loadConfig();
    await speak(`Your per-task cloud budget is ${config.budget.perTaskUsd} dollars and ${config.budget.perTaskTokens.toLocaleString()} tokens.`);
    return true;
  }
  return false;
}
