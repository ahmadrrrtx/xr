import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AppShell, type Area } from "./components/AppShell";
import { ToastBus, pushToast } from "./components/ToastBus";
import { Palette } from "./components/Palette";
import { CheatSheet } from "./components/CheatSheet";
import { VoiceProvider, useVoice } from "./voice/session";
import { DockedVoice } from "./voice/DockedVoice";
import { GlobalApprovalBar } from "./voice/GlobalApprovalBar";
import { native } from "./native";
import { EngineDownBanner } from "./components/EngineDownBanner";
import { Onboarding } from "./components/Onboarding";

import { Home } from "./screens/Home";
const Workbench = lazy(() => import("./screens/Workbench").then(m => ({ default: m.Workbench })));
const Placeholder = lazy(() => import("./screens/Placeholder").then(m => ({ default: m.Placeholder })));
const Trust = lazy(() => import("./screens/Trust").then(m => ({ default: m.Trust })));
const Runs = lazy(() => import("./screens/Runs").then(m => ({ default: m.Runs })));
const Research = lazy(() => import("./screens/Research").then(m => ({ default: m.Research })));
const Teams = lazy(() => import("./screens/Teams").then(m => ({ default: m.Teams })));
const Library = lazy(() => import("./screens/Library").then(m => ({ default: m.Library })));
const Memory = lazy(() => import("./screens/Memory").then(m => ({ default: m.Memory })));
const Voice = lazy(() => import("./screens/Voice").then(m => ({ default: m.Voice })));
const ControlRoom = lazy(() => import("./screens/ControlRoom").then(m => ({ default: m.ControlRoom })));
const Diagnostics = lazy(() => import("./screens/Diagnostics").then(m => ({ default: m.Diagnostics })));
const ModelCenter = lazy(() => import("./screens/ModelCenter").then(m => ({ default: m.ModelCenter })));
import { Settings } from "./screens/Settings";

import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/prism2.css";
import "./styles/phase6.css";
import "./styles/phase9.css";
import "./styles/phase7.css";
import "./styles/phase8.css";
import "./styles/phase10.css";

/* Lightweight boot — Phase 1 preview: don't block on engine connectivity.
   When running inside Tauri with the sidecar, poll.ts/api/client.ts still
   work; in the web preview we render the UI against stub state so the
   design is reviewable without the daemon. */

type ProviderState = { name: string; kind: "ok" | "warn" | "err" | "info" | "idle" | "working"; label?: string };

function AppInner() {
  const [area, setArea] = useState<Area>("home");
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [provider] = useState<ProviderState>({ name: "Claude Opus", kind: "ok", label: "cloud" });
  const [approvalCount] = useState(2);
  const voice = useVoice();

  // Attempt engine link once; if unavailable (web preview) show stub state.
  useEffect(() => {
    let live = true;
    import("./api/client").then(({ api, engineEndpointFacts }) => {
      engineEndpointFacts().then(f => {
        if (!live) return;
        if (f.via === "sidecar" || (f.via as string) === "proxy" || (f.via as string) === "dev-proxy") {
          api.health?.()?.then((h: unknown) => {
            const v = (h as { version?: string })?.version ?? null;
            if (live) setEngineVersion(v);
          }).catch(() => { if (live) setEngineVersion(null); });
        } else {
          if (live) setEngineVersion(null);
        }
      }).catch(() => { if (live) setEngineVersion(null); });
    }).catch(() => { if (live) setEngineVersion(null); });
    return () => { live = false; };
  }, []);

  // Esc handling
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (palette) { setPalette(false); return; }
      if (cheat) { setCheat(false); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [palette, cheat]);

  const go = useCallback((a: Area) => {
    setArea(a);
    setPalette(false);
  }, []);

  // Phase 4 · native integration (graceful no-op outside Tauri):
  //  - tray "New task"       -> Workbench
  //  - tray "Pending approvals" -> Trust
  //  - xr://<area> deep links -> nav to area
  //  - notification "confirm"/"deny" -> barge-in (voice) / no-op stub
  useEffect(() => {
    const VALID: Area[] = ["home","workbench","builder","projects","research","agents","trust","voice","settings","control","library","memory","runs","diagnostics","models"];
    const off1 = native.onTrayAction((a) => {
      if (a === "new-task") go("workbench");
      else if (a === "pending-approvals") go("trust");
    });
    const off2 = native.onDeepLink((path) => {
      const area = path.split("/")[0]?.split("?")[0]?.toLowerCase() ?? "";
      if ((VALID as string[]).includes(area)) go(area as Area);
    });
    const off3 = native.onNotificationAction((action, tag) => {
      // Engine-side will also receive the action via named-pipe / child-channel
      // transport; here we just give a UI cue when visible.
      if (action === "confirm" || action === "deny") {
        pushToast(action === "confirm" ? "ok" : "warn", action === "confirm" ? "Approved" : "Denied", tag ? `Request ${tag}` : "Notification action");
      }
    });
    return () => { off1(); off2(); off3(); };
  }, [go]);

  const chromeAreas: Area[] = ["workbench", "builder"];
  const isFullWidth = !chromeAreas.includes(area);

  return (
    <>
    <Onboarding/>
    <EngineDownBanner onDiagnostics={() => go("diagnostics")} onRetry={() => window.location.reload()}/>
    <AppShell
      area={area}
      onArea={go}
      engineVersion={engineVersion}
      onSearch={(q) => { setWorkSeed(q); go("workbench"); }}
      onOpenRun={() => go("workbench")}
      voiceState={voice.state}
      onVoiceOpen={() => go("voice")}
      dockedVoice={area !== "voice" && voice.state !== "idle" ? <DockedVoice onExpand={() => go("voice")}/> : null}
      onCheatSheet={() => setCheat(true)}
      onRefresh={() => { pushToast("info", "Refreshing", "Reconnecting to XR engine…"); }}
      onOpenPalette={() => setPalette(true)}
      providerState={provider}
      projectName="xr"
      approvalCount={approvalCount}
      isHome={area === "home"}
      isFullWidth={isFullWidth}
      footer={
        <div className="xr-art50" aria-label="AI system disclosure">
          <b>AI disclosure (Art. 50 EU AI Act).</b> XR is an AI assistant — per-action approval required for files, shells, network. Stop anytime from <span className="mono">Computer Control</span>.
        </div>
      }
    >
      {/* SR live region */}
      <div className="xr-sr-only" aria-live="polite" aria-atomic="true">XR {area}</div>

      <Suspense fallback={<div className="lazy-fb mono">loading…</div>}>
        {area === "home" && (
          <Home
            onOpenRun={() => go("workbench")}
            onGoWork={(t) => { setWorkSeed(t ?? null); go("workbench"); }}
            onReview={() => go("trust")}
          />
        )}
        {area === "workbench" && (
          <Workbench seed={workSeed} onConsumed={() => setWorkSeed(null)}/>
        )}
        {area === "builder" && <Placeholder title="Builder" subtitle="Live preview + code split — ships in Phase 2 (screen 03b)." comingSoon/>}
        {area === "projects" && <Placeholder title="Projects" subtitle="Recent projects / open folder. Browse below in Phase 1 final polish." comingSoon/>}
        {area === "research" && <Research/>}
        {area === "agents" && <Teams/>}
        {area === "trust" && <Trust/>}
        {area === "voice" && <Voice onDock={() => go("workbench")} onDecide={() => go("trust")}/>}
        {area === "settings" && <Settings/>}
        {area === "memory" && <Memory/>}
        {area === "models" && <ModelCenter/>}
        {area === "control" && <ControlRoom/>}
        {area === "runs" && <Runs/>}
        {area === "diagnostics" && <Diagnostics/>}
        {area === "library" && <Library/>}
      </Suspense>

      <ToastBus/>
      {palette && <Palette onClose={() => setPalette(false)} onArea={(a) => { if (["home","workbench","builder","projects","research","agents","trust","voice","settings","control","library","memory","runs","diagnostics","models"].includes(a)) go(a as Area); }}/>}
      {cheat && <CheatSheet onClose={() => setCheat(false)}/>}
      {area !== "voice" && <GlobalApprovalBar onDecide={() => go("trust")}/>}
    </AppShell>
    </>
  );
}

// Apply prefs before paint — keep the existing bootstrap logic light.
try {
  const t = localStorage.getItem("xr.theme") || "dark";
  const light = t === "light" || (t === "system" && window.matchMedia("(prefers-color-scheme: light)").matches);
  document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
  document.documentElement.setAttribute("data-theme-pref", t);
  document.documentElement.setAttribute("data-density", localStorage.getItem("xr.density") || "comfortable");
  document.documentElement.style.colorScheme = light ? "light" : "dark";
} catch { /* ignore */ }

function App() {
  return <VoiceProvider><AppInner/></VoiceProvider>;
}

createRoot(document.getElementById("root")!).render(<App/>);
