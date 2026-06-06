/**
 * XR — Voice CLI Handlers.
 */
import { VoiceSession, routeVoiceCommand, checkVoiceStack } from "./index.ts";
import { VoicePipeline } from "./pipeline.ts";
import { Store } from "../state/db.ts";
import { SpeechToText } from "./stt.ts";
import { TextToSpeech } from "./tts.ts";
import { VoiceHardware } from "./hardware.ts";
import { banner, ok, warn, info, colors as C } from "../interfaces/cli.ts";
import { loadConfig } from "../config/config.ts";

export async function handleVoiceCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0];

  if (!sub || sub === "status") {
    banner();
    console.log(C.bold("🎤 Voice System Status"));
    const health = checkVoiceStack();
    for (const detail of health.details) {
      console.log(`  ${detail}`);
    }
    if (!health.stt || !health.tts) {
      warn("Voice system is partially degraded. Check your XR_STT_URL and XR_TTS_URL.");
    } else {
      ok("Voice system is fully operational.");
    }
    return;
  }

  if (sub === "test") {
    banner();
    console.log(C.bold("🧪 Voice Loopback Test"));
    const session = new VoiceSession();
    
    info("Testing STT... Please say 'Hello XR' (wait 5s)");
    const text = await session.listenForCommand();
    if (!text) {
      warn("STT failed to capture speech.");
      return;
    }
    ok(`Captured: "${text}"`);

    info("Testing TTS... Speaking back");
    await session.speak(`I heard you say ${text}. The voice system is working.`);
    ok("TTS test complete.");
    return;
  }

  if (sub === "start") {
    banner();
    console.log(C.bold("🚀 Starting Voice Interaction Mode"));
    info("Press Ctrl+C to stop.");
    
    const { config } = loadConfig();
    const hw = new VoiceHardware();
    const stt = new SpeechToText();
    const tts = new TextToSpeech();
    
    const pipeline = new VoicePipeline({
      store,
      stt,
      tts,
      play: (audio) => ({ stop: () => {} }), // Simplified for CLI loop
      listen: async () => {
        // We use a temporary file for the pipeline's listen method
        const audio = await hw.record(5000);
        return audio;
      },
      requireWake: config.voice?.alwaysListen ?? false,
    });

    const session = new VoiceSession({ stt, tts });
    await session.speak("Voice mode active. How can I help you?");

    // Main loop for PTT (Push-to-Talk) simulated via repeated listening
    // In a real app, we'd use a keypress event
    while (true) {
      const text = await session.listenForCommand();
      if (text) {
        console.log(C.cyan(`You: ${text}`));

        // v0.9 — memory voice commands ("remember …", "forget …", "what do
        // you know …"). Explicit + spoken-back; never a silent auto-save.
        if (await tryHandleMemoryByVoice(text, store, session)) continue;

        // v0.8 — first chance to handle the text as a safe computer-control
        // command.  Voice never bypasses the approval gate; the service still
        // enforces step/auto/destructive rules.
        if (await tryHandleControlByVoice(text, store)) continue;

        const routed = routeVoiceCommand(text);
        if (routed) {
          console.log(C.dim(`Routing to action: ${routed.action} with args: ${routed.args}`));
          await pipeline.processText(text);
        } else {
          // General agent task
          await pipeline.processText(text);
        }
      }
    }
  }

  if (sub === "stop") {
    ok("Voice session stopped.");
    return;
  }

  console.log(C.yellow(`Unknown voice command: ${sub}. Use status, test, or start.`));
}

export async function handleSpeak(text: string): Promise<void> {
  const session = new VoiceSession();
  await session.speak(text);
}

export async function handleListen(): Promise<void> {
  const session = new VoiceSession();
  const text = await session.listenForCommand();
  if (text) {
    console.log(C.cyan(`Heard: ${text}`));
  } else {
    warn("No speech detected.");
  }
}

/**
 * v0.9 — voice → durable memory. Uses the shared NL intent parser so chat and
 * voice behave identically. Honours the global memory off-switch. Returns true
 * if the text was a memory command (handled + spoken back).
 */
async function tryHandleMemoryByVoice(
  text: string,
  store: Store,
  session: VoiceSession,
): Promise<boolean> {
  const { isMemoryEnabled } = await import("../config/config.ts");
  if (!isMemoryEnabled()) return false;

  const { parseMemoryIntent } = await import("../memory/intent.ts");
  const { MemoryStore, projectScopeFromCwd } = await import("../memory/store.ts");
  const intent = parseMemoryIntent(text);
  if (intent.kind === "none") return false;

  const mem = new MemoryStore(store);
  const scope = projectScopeFromCwd(process.cwd());

  if (intent.kind === "add") {
    const res = mem.add({
      content: intent.content,
      category: intent.category,
      scope: intent.category === "project" ? scope : undefined,
      source: "voice",
    });
    if (!res.ok) await session.speak(`I could not save that. ${res.reason}.`);
    else if (res.duplicate) await session.speak("I already remembered that.");
    else if (intent.category === "exclusion")
      await session.speak("Understood. I will not remember that.");
    else await session.speak("Got it. I'll remember that.");
    return true;
  }

  if (intent.kind === "forget") {
    const matches = mem.search(intent.query, { scope });
    if (!matches.length) {
      await session.speak("I have no note matching that.");
      return true;
    }
    for (const m of matches) mem.remove(m.id);
    await session.speak(
      `Forgotten ${matches.length} note${matches.length === 1 ? "" : "s"}.`,
    );
    return true;
  }

  // recall
  const results = mem.recall(intent.query || "preferences", { scope });
  if (!results.length) {
    await session.speak("I don't have anything saved that's relevant.");
    return true;
  }
  const spoken = results
    .slice(0, 4)
    .map((e) => e.content)
    .join(". ");
  await session.speak(`Here's what I remember. ${spoken}.`);
  return true;
}

/**
 * v0.8 — minimal intent parser for voice → computer-control.  Recognized
 * patterns are routed through the safety pipeline (every action is classified
 * and approved like a manual `xr control …` call).  Returns true if the text
 * was handled.
 */
async function tryHandleControlByVoice(text: string, store: Store): Promise<boolean> {
  const t = text.trim();
  const { runAction } = await import("../control/service.ts");
  const opts = { mode: "auto" as const, autoApproveSensitive: false, delayMs: 0 };

  let m: RegExpMatchArray | null;

  if ((m = t.match(/^(?:open|launch|start)\s+(?:the\s+)?app\s+(.+)$/i))) {
    await runAction(store, { type: "app", name: m[1].trim() }, opts);
    return true;
  }
  if ((m = t.match(/^(?:go to|open|visit|navigate to)\s+(https?:\/\/\S+)\s*$/i))) {
    await runAction(store, { type: "open", target: m[1] }, opts);
    return true;
  }
  if ((m = t.match(/^type(?:\s+this\s+message)?[:\s]+(.+)$/i))) {
    await runAction(store, { type: "type", text: m[1] }, opts);
    return true;
  }
  if ((m = t.match(/^press\s+(.+)$/i))) {
    const keys = m[1].split(/[+\s]+/).filter(Boolean);
    await runAction(store, { type: "key", keys }, opts);
    return true;
  }
  if ((m = t.match(/^focus\s+(?:on\s+)?(?:the\s+)?(.+)\s+window$/i))) {
    await runAction(store, { type: "focus", name: m[1] }, opts);
    return true;
  }
  if (/^scroll\s+(up|down|left|right)\b/i.test(t)) {
    const dir = t.match(/^scroll\s+(up|down|left|right)/i)![1].toLowerCase() as any;
    await runAction(store, { type: "scroll", direction: dir, amount: 3 }, opts);
    return true;
  }
  return false;
}
