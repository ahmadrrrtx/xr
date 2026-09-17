import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, type Area } from "./components/AppShell";
import { Home } from "./screens/Home";
import { Work } from "./screens/Work";
import { Workspace } from "./screens/Workspace";
import { Library } from "./screens/Library";
import { Runs } from "./screens/Runs";
import { api, EngineDown } from "./api/client";
import { XrLogo } from "./components/Brand";
import "./styles/tokens.css";

function Stub({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="stub">
      <h2>{title}</h2>
      <p>
        Lands in {phase} per the master plan
        (<span className="mono">docs/xr-rebuild/XR_MASTER_IMPLEMENTATION_PLAN.md</span>).
      </p>
    </div>
  );
}

function App() {
  const [area, setArea] = useState<Area>("home");
  const [runId, setRunId] = useState<string | null>(null);
  const [workSeed, setWorkSeed] = useState<string | null>(null);
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
    return () => { live = false; clearInterval(t); };
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
    <AppShell area={area} onArea={(a) => { setArea(a); if (a !== "runs") setRunId(null); }} workspace="default" engineVersion={engine}>
      {area === "home" && (
        <Home
          onOpenRun={(id) => { setRunId(id); setArea("runs"); }}
          onGoWork={(t) => { setWorkSeed(t); setArea("work"); }}
        />
      )}
      {area === "work" && <Work seed={workSeed} onConsumed={() => setWorkSeed(null)} />}
      {area === "workspace" && <Workspace onAskXr={(p) => { setWorkSeed(p); setArea("work"); }} />}
      {area === "agents" && <Stub title="Agents — team-run board" phase="Phase 3" />}
      {area === "library" && <Library />}
      {area === "trust" && <Stub title="Trust Center — approvals, modes, audit, budgets, network, shield" phase="Phase 4" />}
      {area === "runs" && <Runs openId={runId} onOpen={setRunId} />}
      {area === "settings" && <Stub title="Settings — general, models, local, automations, voice, privacy, advanced" phase="Phase 2–4" />}
    </AppShell>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
