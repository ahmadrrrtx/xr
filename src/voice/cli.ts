/** XR Stage 8 — Voice CLI handlers. */
import { VoiceSession, checkVoiceStack } from "./index.ts";
import { VoicePipeline } from "./pipeline.ts";
import { Store } from "../state/db.ts";
import { sttFromSettings } from "./stt.ts";
import { ttsFromSettings } from "./tts.ts";
import { VoiceHardware } from "./hardware.ts";
import { banner, ok, warn, info, ask, confirm, colors as C } from "../interfaces/cli.ts";
import { getVoiceSettings, patchVoiceSettings, recordVoiceTest } from "./settings.ts";
import { VoiceActivityDetector } from "./vad.ts";
import type { VoiceSettings, VoiceMode, VoiceSttBackend, VoiceTtsBackend } from "./types.ts";

export async function handleVoiceCommand(argv: string[], store: Store): Promise<void> {
  const sub = argv[0] || "status";
  if (sub === "status") return printVoiceStatus();
  if (sub === "devices") return printDevices();
  if (sub === "setup") return setupVoiceInteractive(argv.includes("--yes"));
  if (sub === "test") return testVoice(store);
  if (sub === "start") return startVoice(store, argv);
  if (sub === "stop") return stopVoice();
  if (sub === "on") return startVoice(store, argv);
  if (sub === "off") return stopVoice();
  if (sub === "listen") return handleListen();
  if (sub === "speak") return handleSpeak(argv.slice(1).join(" "));
  if (sub === "config") return configureInline(argv.slice(1));
  banner();
  warn(`Unknown voice command: ${sub}`);
  printVoiceUsage();
}

function printVoiceUsage(): void {
  console.log(C.bold("Voice commands"));
  for (const line of [
    "xr voice status              show privacy, devices, STT/TTS health",
    "xr voice setup               optional guided setup",
    "xr voice devices             list microphones and speakers",
    "xr voice test                record, transcribe, speak back",
    "xr voice start               start push-to-talk voice loop",
    "xr voice start --wake-word   opt-in wake-word transcript gating",
    "xr voice stop                disable voice",
    "xr speak <text>              speak text once",
    "xr listen                    listen once and print transcript",
  ]) console.log(`  ${C.cyan(line)}`);
}

export function printVoiceStatus(): void {
  banner();
  console.log(C.bold("🎤 XR Voice Stack"));
  const settings = getVoiceSettings();
  console.log(`  enabled ........ ${settings.enabled ? C.green("✓ yes") : C.amber("off")}`);
  console.log(`  mode ........... ${C.cyan(settings.mode)}`);
  console.log(`  wake word ...... ${C.dim(settings.wakeWord)}`);
  console.log(`  push-to-talk ... ${C.dim(settings.pushToTalkKey)}`);
  console.log(`  cloud STT ...... ${settings.allowCloudStt ? C.amber("allowed") : C.green("off")}`);
  console.log(`  transcripts .... ${settings.transcriptPolicy === "local-private" ? C.amber("local-private") : C.green(settings.transcriptPolicy)}`);
  console.log(`  confirmation ... ${C.cyan(settings.confirmationPolicy)}`);
  console.log(`  interruption ... ${C.cyan(settings.interruptionPolicy)}`);
  console.log("");
  const health = checkVoiceStack(settings);
  for (const c of health.checks) {
    const icon = c.state === "ok" ? C.green("✓") : c.state === "warn" ? C.amber("!") : C.red("✗");
    console.log(`  ${icon} ${c.label.padEnd(20)} ${C.dim(c.detail)}`);
    if (c.remediation) console.log(`      ${C.dim(c.remediation)}`);
  }
  console.log("");
  if (!settings.enabled) info("Voice is disabled until you run xr voice start or enable it in setup.");
}

export function printDevices(): void {
  banner();
  const hw = new VoiceHardware();
  const devices = hw.devices();
  console.log(C.bold("Input devices"));
  for (const d of devices.inputs) console.log(`  ${d.isDefault ? C.green("●") : " "} ${C.cyan(d.id.padEnd(24))} ${d.label}`);
  console.log("");
  console.log(C.bold("Output devices"));
  for (const d of devices.outputs) console.log(`  ${d.isDefault ? C.green("●") : " "} ${C.cyan(d.id.padEnd(24))} ${d.label}`);
}

async function setupVoiceInteractive(yes: boolean): Promise<void> {
  banner();
  console.log(C.bold("🎙 Voice Setup"));
  info("Voice is optional. XR will not silently listen, and push-to-talk is the safe default.");
  const current = getVoiceSettings();
  let next: VoiceSettings = { ...current };

  const enable = yes ? true : await confirm("Enable voice now?", current.enabled);
  next.enabled = enable;
  if (!enable) {
    next.mode = "push-to-talk";
    next.alwaysListen = false;
    patchVoiceSettings(next);
    ok("Voice remains off. You can run xr voice setup later.");
    return;
  }

  const modeChoice = yes ? "1" : await ask("Mode: 1 push-to-talk, 2 wake word, 3 always-listen", { default: current.mode === "wake-word" ? "2" : current.mode === "always-listen" ? "3" : "1" });
  next.mode = modeChoice === "3" ? "always-listen" : modeChoice === "2" ? "wake-word" : "push-to-talk";
  next.alwaysListen = next.mode === "always-listen";
  if (next.alwaysListen && !yes) {
    const explicit = await confirm("Always-listen keeps the microphone active. Explicitly enable it?", false);
    if (!explicit) {
      next.mode = "push-to-talk";
      next.alwaysListen = false;
    }
  }

  const hw = new VoiceHardware();
  const devices = hw.devices();
  if (devices.inputs.length > 1 && !yes) {
    printDevices();
    const input = await ask("Input device id", { default: current.inputDevice ?? "default" });
    next.inputDevice = input === "default" ? undefined : input;
  }
  if (devices.outputs.length > 1 && !yes) {
    const output = await ask("Output device id", { default: current.outputDevice ?? "default" });
    next.outputDevice = output === "default" ? undefined : output;
  }

  const stt = yes ? current.sttBackend : await ask("STT backend (auto/http/whisper-cli/whispercpp/groq/openai/disabled)", { default: current.sttBackend }) as VoiceSttBackend;
  next.sttBackend = stt;
  if ((stt === "groq" || stt === "openai") && !yes) {
    next.allowCloudStt = await confirm("Allow audio upload to this cloud STT provider?", false);
  }
  const tts = yes ? current.ttsBackend : await ask("TTS backend (auto/http/piper/kokoro-cli/system/say/espeak/powershell/disabled)", { default: current.ttsBackend }) as VoiceTtsBackend;
  next.ttsBackend = tts;
  next.wakeWord = yes ? current.wakeWord : await ask("Wake phrase", { default: current.wakeWord });
  next.transcriptPolicy = yes ? current.transcriptPolicy : await ask("Transcript history (off/session/local-private)", { default: current.transcriptPolicy }) as any;
  next.microphonePermission = "granted";
  next.speakerPermission = "granted";

  patchVoiceSettings(next);
  ok("Voice settings saved.");
  info("Run xr voice test to verify microphone, STT, TTS, and speaker output.");
}

async function configureInline(args: string[]): Promise<void> {
  const patch: Partial<VoiceSettings> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const v = args[i + 1];
    if (a === "--mode" && v) { patch.mode = v as VoiceMode; i++; }
    else if (a === "--stt" && v) { patch.sttBackend = v as VoiceSttBackend; i++; }
    else if (a === "--tts" && v) { patch.ttsBackend = v as VoiceTtsBackend; i++; }
    else if (a === "--wake-word" && v) { patch.wakeWord = v; i++; }
    else if (a === "--input" && v) { patch.inputDevice = v; i++; }
    else if (a === "--output" && v) { patch.outputDevice = v; i++; }
    else if (a === "--enable") patch.enabled = true;
    else if (a === "--disable") patch.enabled = false;
  }
  patchVoiceSettings(patch);
  ok("Voice config updated.");
}

async function testVoice(store: Store): Promise<void> {
  banner();
  console.log(C.bold("🧪 Voice Test"));
  const settings = getVoiceSettings();
  const hw = new VoiceHardware();
  const stt = sttFromSettings(settings);
  const tts = ttsFromSettings(settings);
  const vad = new VoiceActivityDetector(settings);

  info("Recording for 5 seconds. Say: Hello XR.");
  let transcript = "";
  let detail = "";
  let okResult = false;
  try {
    const audio = await hw.recordWav({ durationMs: 5000, inputDevice: settings.inputDevice });
    const vadResult = vad.analyze(audio);
    console.log(`  VAD ............ ${vadResult.speech ? C.green("speech") : C.amber("no speech")} ${C.dim(vadResult.reason)}`);
    const sttResult = await stt.transcribe(audio);
    transcript = sttResult.text;
    console.log(`  STT ............ ${sttResult.ok ? C.green(sttResult.backend) : C.red(sttResult.backend)} ${C.dim(sttResult.detail ?? transcript)}`);
    if (sttResult.ok && transcript) {
      const ttsResult = await tts.speak(`I heard: ${transcript}. XR voice is working.`);
      console.log(`  TTS ............ ${ttsResult.ok ? C.green(ttsResult.engine) : C.amber(ttsResult.engine)} ${C.dim(ttsResult.detail ?? "")}`);
      if (ttsResult.audio) await hw.play(ttsResult.audio, { outputDevice: settings.outputDevice }).done;
      okResult = true;
      store.audit("voice.test.ok", { stt: sttResult.backend, tts: ttsResult.engine });
      ok("Voice loopback completed.");
    } else {
      detail = sttResult.detail ?? "empty transcript";
      warn(`No transcript captured: ${detail}`);
    }
  } catch (e) {
    detail = (e as Error).message;
    warn(`Voice test failed: ${detail}`);
  }
  recordVoiceTest({ ok: okResult, at: new Date().toISOString(), inputDevice: settings.inputDevice, outputDevice: settings.outputDevice, sttBackend: settings.sttBackend, ttsBackend: settings.ttsBackend, transcript, detail });
}

async function startVoice(store: Store, argv: string[]): Promise<void> {
  let settings = getVoiceSettings();
  const requestedWake = argv.includes("--wake-word");
  const requestedAlways = argv.includes("--always-listen");
  if (requestedAlways) {
    const explicit = await confirm("Always-listen keeps the microphone active. Enable for this session?", false);
    if (!explicit) return;
  }
  settings = patchVoiceSettings({
    enabled: true,
    mode: requestedAlways ? "always-listen" : requestedWake ? "wake-word" : settings.mode === "off" ? "push-to-talk" : settings.mode,
    alwaysListen: requestedAlways,
    microphonePermission: "granted",
    speakerPermission: "granted",
  });

  banner();
  console.log(C.bold("🎧 Voice Mode"));
  info(settings.mode === "push-to-talk" ? "Press Enter to talk. Type q then Enter to quit." : `Say ${settings.wakeWord}, then your command. Ctrl+C to quit.`);
  const hw = new VoiceHardware();
  const stt = sttFromSettings(settings);
  const tts = ttsFromSettings(settings);
  const pipeline = new VoicePipeline({
    store,
    stt,
    tts,
    settings,
    play: (audio) => hw.play(audio, { outputDevice: settings.outputDevice }),
    listen: () => hw.recordWav({ durationMs: settings.endpointing.maxUtteranceMs, inputDevice: settings.inputDevice }),
    requireWake: settings.mode === "wake-word" || settings.mode === "always-listen",
  });
  await pipeline.say("Voice mode active. How can I help?");

  while (true) {
    if (settings.mode === "push-to-talk") {
      const line = await ask("Press Enter to talk, or q to quit", { default: "" });
      if (line.toLowerCase() === "q") break;
    }
    try {
      const audio = await hw.recordWav({ durationMs: settings.endpointing.maxUtteranceMs, inputDevice: settings.inputDevice });
      const r = await pipeline.processUtterance(audio);
      if (!r.handled && settings.fallbackTextMode) console.log(C.dim("  (No command handled. In wake-word mode, include the wake phrase.)"));
    } catch (e) {
      warn(`Voice loop error: ${(e as Error).message}`);
      if (settings.fallbackTextMode) info("Falling back safely. You can continue using text mode.");
      break;
    }
  }
  ok("Voice session ended.");
}

async function stopVoice(): Promise<void> {
  patchVoiceSettings({ enabled: false, alwaysListen: false, mode: "push-to-talk" });
  ok("Voice disabled. Microphone listening is off.");
}

export async function handleSpeak(text: string): Promise<void> {
  if (!text.trim()) {
    warn("Usage: xr speak <text>");
    return;
  }
  const session = new VoiceSession();
  await session.speak(text);
}

export async function handleListen(): Promise<void> {
  const session = new VoiceSession();
  const text = await session.listenForCommand(7000);
  if (text) console.log(C.cyan(`Heard: ${text}`));
  else warn("No speech detected.");
}
