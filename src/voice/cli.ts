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
