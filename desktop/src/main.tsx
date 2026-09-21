import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { AppShell, type Area } from "./components/AppShell";
import { ToastBus, pushToast } from "./components/ToastBus";
import { Palette } from "./components/Palette";
import { CheatSheet } from "./components/CheatSheet";

import { Home } from "./screens/Home";
const Workbench = lazy(() => import("./screens/Workbench").then(m => ({ default: m.Workbench })));
const Placeholder = lazy(() => import("./screens/Placeholder").then(m => ({ default: m.Placeholder })));

import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/app.css";

/* Lightweight boot — Phase 1 preview: don't block on engine connectivity.
   When running inside Tauri with the sidecar, poll.ts/api/client.ts still
   work; in the web preview we render the UI against stub state so the
   design is reviewable without the daemon. */

type ProviderState = { name: string; kind: "ok" | "warn" | "err" | "info" | "idle" | "working"; label?: string };

function App() {
  const [area, setArea] = useState<Area>("home");
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [engineVersion, setEngineVersion] = useState<string | null>(null);
  const [provider, setProvider] = useState<ProviderState>({ name: "Claude Opus", kind: "ok", label: "cloud" });
  const [approvalCount] = useState(2);

  // Attempt engine link once; if unavailable (web preview) show stub state.
  useEffect(() => {
    let live = true;
    import("./api/client").then(({ api, engineEndpointFacts }) => {
      engineEndpointFacts().then(f => {
        if (!live) return;
        if (f.via === "sidecar" || f.via === "proxy") {
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

  const chromeAreas: Area[] = ["workbench", "builder"];
  const isHome = area === "home";
  const isFullWidth = !chromeAreas.includes(area);
  const isChrome = chromeAreas.includes(area);

  return (
    <AppShell
      area={area}
      onArea={go}
      engineVersion={engineVersion}
      onSearch={(q) => { setWorkSeed(q); go("workbench"); }}
      onOpenRun={() => go("workbench")}
      voiceState="idle"
      onVoiceOpen={() => go("voice")}
      onCheatSheet={() => setCheat(true)}
      onRefresh={() => { pushToast("info", "Refreshing", "Reconnecting to XR engine…"); }}
      onOpenPalette={() => setPalette(true)}
      providerState={provider}
      projectName="xr"
      approvalCount={approvalCount}
      isHome={isHome}
      isFullWidth={isFullWidth}
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
        {area === "research" && <Placeholder title="Research" subtitle="Sources, notes, citations, findings. Coming Phase 2." comingSoon/>}
        {area === "agents" && <Placeholder title="Agents" subtitle="Team runs, skills, MCP, plugins. Coming Phase 3." comingSoon/>}
        {area === "trust" && <Placeholder title="Trust Center" subtitle="Overview · Approvals · Policy · Budget · Audit · Network · Advanced. Coming Phase 2." comingSoon/>}
        {area === "voice" && <Placeholder title="Voice" subtitle="Push-to-talk voice mode. Coming Phase 3." comingSoon/>}
        {area === "settings" && <Placeholder title="Settings" subtitle="General, Appearance, Models, Workspace, Agents, Trust… Coming Phase 3." comingSoon/>}
        {area === "memory" && <Placeholder title="Memory" subtitle="What XR remembers. Coming Phase 3." comingSoon/>}
        {area === "models" && <Placeholder title="Models & Providers" subtitle="26 providers — coming Phase 2." comingSoon/>}
        {area === "control" && <Placeholder title="Computer Control" subtitle="Coming Phase 3." comingSoon/>}
        {area === "runs" && <Placeholder title="Runs" subtitle="History and run detail. Coming Phase 2." comingSoon/>}
        {area === "library" && <Placeholder title="Skills Library" subtitle="65 skills. Coming Phase 3." comingSoon/>}
      </Suspense>

      <ToastBus/>
      {palette && <Palette onClose={() => setPalette(false)} onArea={(a) => { if (["home","workbench","builder","projects","research","agents","trust","voice","settings"].includes(a)) go(a as Area); }}/>}
      {cheat && <CheatSheet onClose={() => setCheat(false)}/>}
    </AppShell>
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

createRoot(document.getElementById("root")!).render(<App/>);
