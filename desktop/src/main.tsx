import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, type Area } from "./components/AppShell";
import { Home } from "./screens/Home";
import { Work } from "./screens/Work";
import { Workspace } from "./screens/Workspace";
import { Library } from "./screens/Library";
import { Runs } from "./screens/Runs";
import { Teams } from "./screens/Teams";
import { Trust } from "./screens/Trust";
import { Settings } from "./screens/Settings";
import { Voice } from "./screens/Voice";
import { Onboarding } from "./screens/Onboarding";
import { VoiceProvider, useVoice } from "./voice/session";
import { DockedVoice } from "./voice/DockedVoice";
import { ToastBus, pushToast } from "./components/ToastBus";
import { Palette } from "./components/Palette";
import { api, EngineDown } from "./api/client";
import { XrLogo } from "./components/Brand";
import "./styles/tokens.css";
import "./styles/phase6.css";
import "./styles/phase7.css";

function AppInner({ engine, onOnboard }: { engine: string | null; onOnboard: () => void }) {
  const voice = useVoice();
  const [area, setArea] = useState<Area>("home");
  const [preVoice, setPreVoice] = useState<Area>("home");
  const [runId, setRunId] = useState<string | null>(null);
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [libQuery, setLibQuery] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);

  const go = (a: Area) => {
    if (a === "voice" && area !== "voice") setPreVoice(area);
    setArea(a);
    if (a !== "runs") setRunId(null);
  };

  return (
    <AppShell
      area={area}
      onArea={go}
      engineVersion={engine}
      onSearch={(q) => { setLibQuery(q); setArea("library"); }}
      onOpenRun={(id) => { setRunId(id); setArea("runs"); }}
      voiceState={voice.state}
      onVoiceOpen={() => go("voice")}
      onPalette={() => setPalette(true)}
    >
      {area === "home" && (
        <Home
          onOpenRun={(id) => { setRunId(id); setArea("runs"); }}
          onGoWork={(t) => { setWorkSeed(t); setArea("work"); }}
          onReview={() => setArea("work")}
        />
      )}
      {area === "work" && <Work seed={workSeed} onConsumed={() => setWorkSeed(null)} />}
      {area === "workspace" && <Workspace onAskXr={(p) => { setWorkSeed(p); setArea("work"); }} />}
      {area === "agents" && <Teams />}
      {area === "runs" && <Runs openId={runId} onOpen={setRunId} />}
      {area === "library" && (
        <Library
          onRun={(p) => { setWorkSeed(p); setArea("work"); }}
          initialQuery={libQuery}
          onQueryConsumed={() => setLibQuery(null)}
        />
      )}
      {area === "trust" && <Trust />}
      {area === "settings" && <Settings onOnboard={onOnboard} />}
      {area === "voice" && <Voice onDock={() => go(preVoice)} />}
      {voice.state !== "idle" && area !== "voice" && <DockedVoice onExpand={() => go("voice")} />}
      <Palette
        open={palette}
        onClose={() => setPalette(false)}
        onArea={go}
        onNewTask={() => go("work")}
        onVoice={() => go("voice")}
        onOnboard={onOnboard}
        onRunSkill={(id, name) => { setWorkSeed(`Use the "${id}" skill (${name}): `); go("work"); }}
      />
      <ToastBus />
    </AppShell>
  );
}

type Onb = "unknown" | "show" | "hidden";

function App() {
  const [engine, setEngine] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const [onb, setOnb] = useState<Onb>("unknown");
  const [retryN, setRetryN] = useState(0);

  useEffect(() => {
    let live = true;
    const probe = () =>
      api
        .health()
        .then((h) => {
          if (!live) return;
          const v = (h.version as { version?: string } | undefined)?.version ?? (typeof h.version === "string" ? h.version : "ok");
          setEngine(v); setDown(false);
        })
        .catch((e) => { if (live) { setDown(e instanceof EngineDown); setEngine(null); } });
    probe();
    const t = setInterval(probe, 4000);
    return () => { live = false; clearInterval(t); };
  }, [retryN]);

  // First-run gate: ask the ENGINE whether setup is needed (honest, re-runnable).
  useEffect(() => {
    if (down || onb !== "unknown") return;
    let live = true;
    api.onboardingStatus()
      .then((s) => { if (live && s.needsSetup) setOnb("show"); else if (live) setOnb("hidden"); })
      .catch(() => { if (live) setOnb("hidden"); });
    return () => { live = false; };
  }, [down, onb, engine]);

  if (down) {
    return (
      <div className="splash">
        <XrLogo height={96} radius={10} dim />
        <div>XR engine is unreachable</div>
        <div className="faint" style={{ fontSize: 12, maxWidth: "46ch", lineHeight: 1.6 }}>
          The desktop attaches to the local daemon. Start it with{" "}
          <span className="mono">xr serve</span> (or wait for the packaged sidecar), then retry —
          interrupted work resumes from checkpoints automatically.
        </div>
        <div className="splash-actions">
          <button className="btn" onClick={() => setRetryN((n) => n + 1)}>Retry now</button>
        </div>
      </div>
    );
  }

  if (onb === "show") {
    return (
      <Onboarding
        onDone={() => { setOnb("hidden"); pushToast("ok", "Welcome to XR", "setup complete — audited by the engine"); }}
        onSkip={() => setOnb("hidden")}
      />
    );
  }

  return (
    <VoiceProvider>
      <AppInner engine={engine} onOnboard={() => setOnb("show")} />
    </VoiceProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
