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
import { VoiceProvider, useVoice } from "./voice/session";
import { DockedVoice } from "./voice/DockedVoice";
import { api, EngineDown } from "./api/client";
import { XrLogo } from "./components/Brand";
import "./styles/tokens.css";
import "./styles/phase6.css";

function AppInner({ engine }: { engine: string | null }) {
  const voice = useVoice();
  const [area, setArea] = useState<Area>("home");
  const [preVoice, setPreVoice] = useState<Area>("home");
  const [runId, setRunId] = useState<string | null>(null);
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [libQuery, setLibQuery] = useState<string | null>(null);

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
      {area === "settings" && <Settings />}
      {area === "voice" && <Voice onDock={() => go(preVoice)} />}
      {voice.state !== "idle" && area !== "voice" && <DockedVoice onExpand={() => go("voice")} />}
    </AppShell>
  );
}

function App() {
  const [engine, setEngine] = useState<string | null>(null);
  const [down, setDown] = useState(false);

  useEffect(() => {
    let live = true;
    const probe = () =>
      api
        .health()
        .then((h) => { if (live) { const v = (h.version as { version?: string } | undefined)?.version ?? (typeof h.version === "string" ? h.version : "ok"); setEngine(v); setDown(false); } })
        .catch((e) => { if (live) { setDown(e instanceof EngineDown); setEngine(null); } });
    probe();
    const t = setInterval(probe, 4000);
    return () => { live = false; clearInterval(t); }
  }, []);

  if (down) {
    return (
      <div className="splash">
        <XrLogo height={96} radius={10} dim />
        <div>XR engine is starting…</div>
        <div className="faint" style={{ fontSize: 12 }}>
          desktop attaches to the local daemon (<span className="mono">xr serve</span>); work resumes from checkpoints automatically
        </div>
      </div>
    );
  }

  return (
    <VoiceProvider>
      <AppInner engine={engine} />
    </VoiceProvider>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
