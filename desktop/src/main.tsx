import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell, type Area } from "./components/AppShell";
import { Onboarding } from "./screens/Onboarding";

/* Phase 2 · route-level code splitting: each screen (and its heavy deps, e.g.
   CodeMirror in Workspace) lands in its own chunk; the shell stays tiny. */
const Home = lazy(() => import("./screens/Home").then((m) => ({ default: m.Home })));
const Work = lazy(() => import("./screens/Work").then((m) => ({ default: m.Work })));
const Workspace = lazy(() => import("./screens/Workspace").then((m) => ({ default: m.Workspace })));
const Library = lazy(() => import("./screens/Library").then((m) => ({ default: m.Library })));
const Runs = lazy(() => import("./screens/Runs").then((m) => ({ default: m.Runs })));
const Teams = lazy(() => import("./screens/Teams").then((m) => ({ default: m.Teams })));
const Trust = lazy(() => import("./screens/Trust").then((m) => ({ default: m.Trust })));
const Settings = lazy(() => import("./screens/Settings").then((m) => ({ default: m.Settings })));
const Voice = lazy(() => import("./screens/Voice").then((m) => ({ default: m.Voice })));
const Projects = lazy(() => import("./screens/Projects").then((m) => ({ default: m.Projects })));
const Memory = lazy(() => import("./screens/Memory").then((m) => ({ default: m.Memory })));
const Research = lazy(() => import("./screens/Research").then((m) => ({ default: m.Research })));
const ModelCenter = lazy(() => import("./screens/ModelCenter").then((m) => ({ default: m.ModelCenter })));
const ControlRoom = lazy(() => import("./screens/ControlRoom").then((m) => ({ default: m.ControlRoom })));
import { VoiceProvider, useVoice } from "./voice/session";
import { DockedVoice } from "./voice/DockedVoice";
import { ToastBus, pushToast } from "./components/ToastBus";
import { Palette } from "./components/Palette";
import { CheatSheet } from "./components/CheatSheet";
import { api, EngineDown } from "./api/client";
import { poll } from "./poll";
import { XrLogo } from "./components/Brand";
import {
  getDensity,
  getTheme,
  initPrefs,
  isLightActive,
  notificationsEnabled,
  setDensity,
  setNotificationsEnabled,
  setTheme,
  watchOsTheme,
} from "./prefs";
import { requestNotificationPermission } from "./notify";
import type { Command } from "./commands/registry";
import { staticCommands, type RegistryDeps } from "./commands/registry";
import "./styles/tokens.css";
import "./styles/phase6.css";
import "./styles/phase7.css";
import "./styles/phase8.css";
import "./styles/phase9.css";
/* Prism II foundation — must load last so the layer/space/type scales and the
   corrected voice-surface geometry win over the phase CSS. */
import "./styles/prism2.css";

function AppInner({ engine, onOnboard }: { engine: string | null; onOnboard: () => void }) {
  const voice = useVoice();
  const [area, setArea] = useState<Area>("home");
  const [preVoice, setPreVoice] = useState<Area>("home");
  const [runId, setRunId] = useState<string | null>(null);
  const [workSeed, setWorkSeed] = useState<string | null>(null);
  const [libQuery, setLibQuery] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [cheat, setCheat] = useState(false);
  const [, forceChrome] = useState(0);

  const go = useCallback((a: Area) => {
    setArea((prev) => {
      if (a === "voice" && prev !== "voice") setPreVoice(prev);
      return a;
    });
    if (a !== "runs") setRunId(null);
  }, []);

  /* ------------------------------------------------------------------
     D-01 · VOICE ESCAPE.
     Before this, Esc did nothing inside Voice mode and the nav rail was
     covered by a fixed overlay, so the only exit was a 34px corner button.
     Voice now renders inside the content grid (prism2.css), so the rail is
     always live — and Esc is a second, discoverable way out.
     ------------------------------------------------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (palette || cheat) return; // those dialogs own Esc while open
      if (area === "voice") {
        e.preventDefault();
        go(preVoice);
        pushToast("info", "Voice docked", "voice keeps running while you work");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [area, preVoice, palette, cheat, go]);

  const onToggleNotifications = useCallback(async () => {
    const next = !notificationsEnabled();
    if (next && (await requestNotificationPermission()) !== "granted") {
      pushToast("warn", "Notifications blocked", "the OS denied permission — enable XR in system notification settings");
      return false;
    }
    setNotificationsEnabled(next);
    forceChrome((n) => n + 1);
    pushToast("ok", next ? "OS notifications on" : "OS notifications off", "approval due + run finished only");
    return next;
  }, []);

  const registryDeps: RegistryDeps = {
    onArea: go,
    onNewTask: () => go("work"),
    onVoiceSession: () => (voice.state === "idle" ? void voice.start() : voice.stop()),
    onOnboard,
    onRunSkill: (id, name) => { setWorkSeed(`Use the "${id}" skill (${name}): `); go("work"); },
    onTheme: (t) => { setTheme(t); forceChrome((n) => n + 1); pushToast("info", `Theme: ${t}`, t === "system" ? "following the OS" : "preference saved"); },
    onDensity: (d) => { setDensity(d); forceChrome((n) => n + 1); pushToast("info", `Density: ${d}`, "layout spacing saved"); },
    onToggleNotifications,
    notificationsEnabled,
    onCheatSheet: () => setCheat(true),
    /* Phase 1 · the refresh command now asks the hub for an immediate fetch of
       the shared shell state (links, providers, approvals, sessions) instead of
       only remounting the chrome; the remount still re-runs each screen's own
       mount-time read. */
    onRefresh: () => { poll.refresh(); forceChrome((n) => n + 1); },
  };

  /* Commands for the cheat-sheet (static set is enough — the sheet lists
     bindings and searchable commands, not live engine results). */
  const [cheatCommands, setCheatCommands] = useState<Command[]>([]);
  useEffect(() => {
    if (cheat) setCheatCommands(staticCommands(registryDeps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheat, area]);

  return (
    <AppShell
      area={area}
      onArea={go}
      engineVersion={engine}
      onSearch={(q) => { setLibQuery(q); setArea("library"); }}
      onOpenRun={(id) => { setRunId(id); setArea("runs"); }}
      voiceState={voice.state}
      onVoiceOpen={() => go("voice")}
      onCheatSheet={() => setCheat(true)}
      onRefresh={() => { poll.refresh(); forceChrome((n) => n + 1); }}
      onOpenPalette={() => setPalette(true)}
    >
      {/* Screen-reader region — audit found liveRegions: 0, so streaming and
          status changes were invisible to assistive technology. */}
      <div className="xr-sr-only" aria-live="polite" aria-atomic="true">
        {voice.state !== "idle" ? `Voice ${voice.state}` : ""}
      </div>
      <Suspense fallback={<div className="lazy-fb mono" role="status">loading…</div>}>
      {area === "projects" && <Projects onOpenWorkspace={() => go("workspace")} />}
      {area === "memory" && <Memory />}
      {area === "research" && <Research />}
      {area === "models" && <ModelCenter />}
      {area === "control" && <ControlRoom />}
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
      {/* D-01 · the docked chip is only for BACKGROUND voice. Previously it
          rendered alongside the full surface, giving two competing controls. */}
      {voice.state !== "idle" && area !== "voice" && <DockedVoice onExpand={() => go("voice")} />}
      </Suspense>
      <Palette
        open={palette}
        onClose={() => setPalette(false)}
        onArea={go}
        onNewTask={() => go("work")}
        onVoice={() => go("voice")}
        onOnboard={onOnboard}
        onRunSkill={(id, name) => { setWorkSeed(`Use the "${id}" skill (${name}): `); go("work"); }}
        onVoiceSession={() => (voice.state === "idle" ? void voice.start() : voice.stop())}
        onTheme={registryDeps.onTheme}
        onDensity={registryDeps.onDensity}
        onToggleNotifications={onToggleNotifications}
        notificationsEnabled={notificationsEnabled}
        onCheatSheet={() => { setPalette(false); setCheat(true); }}
      />
      <CheatSheet open={cheat} onClose={() => setCheat(false)} commands={cheatCommands} />
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
    /* Phase 1 · the link probe is a SUBSCRIBER of the shared poll hub, not its
       own timer. It used to be a fourth independent interval asking the same
       daemon the same question on a different schedule (see src/poll.ts). */
    const off = poll.subscribe(["health"], (o) => {
      if (o.ok) {
        const h = o.value as Record<string, unknown>;
        const v = (h.version as { version?: string } | undefined)?.version ?? (typeof h.version === "string" ? h.version : "ok");
        setEngine(v);
        setDown(false);
      } else {
        setDown(o.error instanceof EngineDown);
        setEngine(null);
      }
    });
    return off;
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
      <div className="splash" data-state="offline" role="alert">
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

  /* Phase 1 · the shell must not mount until the first-run question is
     ANSWERED. It used to render here while `/onboarding/status` was still in
     flight, so an unconfigured install flashed a fully interactive
     workstation for a beat and then had the gate replace it under the user's
     cursor — a click or shortcut landing in that window hit a control that was
     about to be unmounted, and the renderer lane reproduced it as a click that
     retried against a detached node forever. Waiting costs one probe; guessing
     costs the user's trust in every control on screen. */
  if (onb === "unknown") {
    return (
      <div className="splash" data-state="checking" role="status" aria-live="polite">
        <XrLogo height={72} radius={9} dim />
        <div className="faint" style={{ fontSize: 12 }}>checking setup…</div>
      </div>
    );
  }

  return (
    <VoiceProvider>
      <AppInner engine={engine} onOnboard={() => setOnb("show")} />
    </VoiceProvider>
  );
}

/* Phase 1 · preferences must be applied BEFORE first paint so a light-OS user
   never sees a dark flash, and the OS theme must be followed live. */
initPrefs();
watchOsTheme(() => {
  /* applyTheme already re-ran; nudge aria/color-scheme consumers by re-reading. */
  document.documentElement.style.colorScheme = isLightActive() ? "light" : "dark";
});
if (getTheme() === "system") {
  // Reflect the resolved scheme on <html> for hosts that read it pre-CSS.
  document.documentElement.dataset.themeResolved = isLightActive() ? "light" : "dark";
}
document.documentElement.dataset.density = getDensity();

createRoot(document.getElementById("root")!).render(<App />);
