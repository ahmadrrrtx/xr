/** XR Stage 8 — deterministic voice intent router. */
import type { Store } from "../state/db.ts";
import { loadConfig, saveConfig } from "../config/config.ts";
import { runAction } from "../control/service.ts";
import { parseMemoryIntent } from "../memory/intent.ts";
import { MemoryStore, projectScopeFromCwd } from "../memory/store.ts";
import { isMemoryEnabled } from "../config/config.ts";

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
  if (/^(stop|cancel|abort|never mind|nevermind)$/i.test(t)) return { kind: "stop", confidence: 1, args: "" };
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
  if ((m = t.match(/^(?:go to|visit|navigate to)\s+(.+)$/i))) {
    const target = m[1].trim();
    return { type: "open", target: /^https?:\/\//i.test(target) ? target : `https://${target}` };
  }
  if ((m = t.match(/^type(?:\s+this)?(?:\s+message)?[:\s]+(.+)$/i))) return { type: "type", text: m[1].trim() };
  if ((m = t.match(/^click(?:\s+(left|right|double))?(?:\s+(?:at\s+)?)?(\d+)\s*[, ]\s*(\d+)$/i))) return { type: "click", button: (m[1] ?? "left").toLowerCase(), x: Number(m[2]), y: Number(m[3]) };
  if ((m = t.match(/^click\s+(.+)$/i))) return { type: "click", target: m[1].trim() };
  if ((m = t.match(/^move(?:\s+mouse)?(?:\s+to)?\s+(\d+)\s*[, ]\s*(\d+)$/i))) return { type: "move", x: Number(m[1]), y: Number(m[2]) };
  if ((m = t.match(/^press\s+(.+)$/i))) return { type: "key", keys: m[1].split(/[+\s]+/).filter(Boolean) };
  if ((m = t.match(/^focus\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+window)?$/i))) return { type: "focus", name: m[1].trim() };
  if ((m = t.match(/^scroll\s+(up|down|left|right)(?:\s+(\d+))?/i))) return { type: "scroll", direction: m[1].toLowerCase(), amount: Number(m[2] ?? 3) };
  if ((m = t.match(/^(?:close|quit)\s+(?:the\s+)?(?:app\s+)?(.+)$/i))) {
    const app = m[1].trim();
    return process.platform === "darwin" ? { type: "key", keys: ["cmd", "q"] } : { type: "key", keys: ["alt", "f4"] };
  }
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
    const result = await runAction(store, intent.action, { mode: "auto", autoApproveSensitive: false, delayMs: config.control.stepDelayMs });
    await speak(result.result.ok ? `Done. ${result.result.message}` : `I could not do that. ${result.result.message}`);
    return true;
  }

  if (intent.kind === "memory") {
    if (!isMemoryEnabled()) {
      await speak("Memory is disabled.");
      return true;
    }
    const parsed = parseMemoryIntent(text);
    if (parsed.kind === "none") return false;
    const mem = new MemoryStore(store);
    const scope = projectScopeFromCwd(process.cwd());
    if (parsed.kind === "add") {
      const res = mem.add({ content: parsed.content, category: parsed.category, scope: parsed.category === "project" ? scope : undefined, source: "voice" });
      await speak(!res.ok ? `I could not save that. ${res.reason}.` : res.duplicate ? "I already remembered that." : parsed.category === "exclusion" ? "Understood. I will not remember that." : "Got it. I'll remember that.");
      return true;
    }
    if (parsed.kind === "forget") {
      const matches = mem.search(parsed.query, { scope });
      for (const x of matches) mem.remove(x.id);
      await speak(matches.length ? `Forgotten ${matches.length} note${matches.length === 1 ? "" : "s"}.` : "I have no note matching that.");
      return true;
    }
    const results = mem.recall(parsed.query || "preferences", { scope });
    await speak(results.length ? `Here's what I remember. ${results.slice(0, 4).map((e) => e.content).join(". ")}.` : "I don't have anything saved that's relevant.");
    return true;
  }

  if (intent.kind === "provider") {
    const { config } = loadConfig();
    config.defaults.provider = intent.args;
    saveConfig(config);
    await speak(`Provider switched to ${intent.args}.`);
    return true;
  }

  if (intent.kind === "model") {
    const { config } = loadConfig();
    config.defaults.model = intent.args;
    saveConfig(config);
    await speak(`Model switched to ${intent.args}.`);
    return true;
  }

  if (intent.kind === "budget") {
    const { config } = loadConfig();
    await speak(`Your per-task cloud budget is ${config.budget.perTaskUsd} dollars and ${config.budget.perTaskTokens.toLocaleString()} tokens.`);
    return true;
  }

  return false;
}
