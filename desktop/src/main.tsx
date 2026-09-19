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
import { api, EngineDown, engineEndpointFacts } from "./api/client";
import { poll } from "./poll";
import { BootSplash } from "./components/BootSplash";
import { engineLinkSnapshot } from "./tauri-bridge";
import { INITIAL_FACTS, SPLASH_GRACE_MS, allOk, anyFailed, settle, shouldShowSplash, type BootFact } from "./boot";
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
import "./styles/fonts.css"; /* bundled type identity — first, so tokens can name the families */
import "./styles/tokens.css";
import "./styles/phase6.css";
import "./styles/phase7.css";
import "./styles/phase8.css";
import "./styles/phase9.css";
import "./styles/phase10.css"; /* Phase 2 · PTY pane + hunk review */
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

/**
 * S0 · boot. Three facts gate the shell, and the splash shows exactly those
 * three (src/boot.ts):
 *   link    the endpoint decision the API client makes (sidecar port or dev proxy)
 *   health  the first answer from the shared poll hub
 *   setup   the engine's own first-run verdict (/onboarding/status)
 * The shell mounts the instant all three are ok. If that happens inside the
 * grace window the splash is never painted (HIG: a splash must not feel like
 * a delay). A failure paints it immediately, with the engine's reason and —
 * when the sidecar wrote one — its stderr tail (W-5).
 */
function App() {
  const [engine, setEngine] = useState<string | null>(null);
  const [down, setDown] = useState(false);
  const [onb, setOnb] = useState<Onb>("unknown");
  const [retryN, setRetryN] = useState(0);
  const [facts, setFacts] = useState<BootFact[]>(INITIAL_FACTS);
  const [bootedAt, setBootedAt] = useState(() => performance.now());
  const [graceOver, setGraceOver] = useState(false);
  const since = useCallback(() => performance.now() - bootedAt, [bootedAt]);

  /* The grace window: nothing is painted before it ends unless a fact fails. */
  useEffect(() => {
    setGraceOver(false);
    const t = window.setTimeout(() => setGraceOver(true), SPLASH_GRACE_MS);
    return () => window.clearTimeout(t);
  }, [bootedAt]);

  /* Fact 1 · link — the same endpoint promise the first request awaits. */
  useEffect(() => {
    let live = true;
    void engineEndpointFacts().then(async (f) => {
      if (!live) return;
      if (f.via === "sidecar") {
        setFacts((cur) => settle(cur, "link", { state: "ok", atMs: since(), detail: `sidecar :${f.port}` }));
        return;
      }
      /* Dev proxy is a legitimate host in a browser; inside the packaged app it
         means the sidecar did not pair — say so, with the shell's reason. */
      const shell = await engineLinkSnapshot();
      if (!live) return;
      if (!shell) {
        setFacts((cur) => settle(cur, "link", { state: "ok", atMs: since(), detail: "dev proxy → local daemon" }));
      } else {
        setFacts((cur) =>
          settle(cur, "link", {
            state: "fail",
            atMs: since(),
            detail: shell.error ?? shell.reason ?? f.reason ?? "the sidecar did not pair",
            stderr: shell.stderr,
          }),
        );
      }
    });
    return () => { live = false; };
  }, [retryN, since]);

  /* Fact 2 · health — a SUBSCRIBER of the shared poll hub, not its own timer
     (see src/poll.ts). The very first observation also settles the boot fact. */
  useEffect(() => {
    poll.refresh(["health"]); // do not wait for the scheduler's first tick to learn the engine is there
    const off = poll.subscribe(["health"], (o) => {
      if (o.ok) {
        const h = o.value as Record<string, unknown>;
        const v = (h.version as { version?: string } | undefined)?.version ?? (typeof h.version === "string" ? h.version : "ok");
        setEngine(v);
        setDown(false);
        setFacts((cur) => (cur.find((f) => f.key === "health")?.state === "ok" ? cur : settle(cur, "health", { state: "ok", atMs: since(), detail: `engine ${v}` })));
      } else {
        const isDown = o.error instanceof EngineDown;
        setDown(isDown);
        setEngine(null);
        setFacts((cur) =>
          settle(cur, "health", {
            state: "fail",
            atMs: since(),
            detail: o.error instanceof Error ? o.error.message : "engine unreachable",
          }),
        );
      }
    });
    return off;
  }, [retryN, since]);

  /* Fact 3 · setup — ask the ENGINE whether first-run setup is needed (honest, re-runnable). */
  useEffect(() => {
    if (down || onb !== "unknown") return;
    let live = true;
    api.onboardingStatus()
      .then((s) => {
        if (!live) return;
        setOnb(s.needsSetup ? "show" : "hidden");
        setFacts((cur) => settle(cur, "setup", { state: "ok", atMs: since(), detail: s.needsSetup ? "first run → setup" : "configured" }));
      })
      .catch((e: unknown) => {
        if (!live) return;
        if (e instanceof EngineDown) {
          setFacts((cur) => settle(cur, "setup", { state: "fail", atMs: since(), detail: e.message }));
          return;
        }
        /* Any other answer means the engine is up but the route misbehaved —
           the shell can still run; the setup gate simply does not open. */
        setOnb("hidden");
        setFacts((cur) => settle(cur, "setup", { state: "ok", atMs: since(), detail: "status unavailable — continuing" }));
      });
    return () => { live = false; };
  }, [down, onb, engine, since]);

  const retry = useCallback(() => {
    setFacts(INITIAL_FACTS);
    setOnb("unknown");
    setDown(false);
    setBootedAt(performance.now());
    setRetryN((n) => n + 1);
  }, []);

  if (!allOk(facts)) {
    /* Phase 1 · the shell must not mount until the first-run question is
       ANSWERED (an unconfigured install used to flash a live workstation for a
       beat before the gate replaced it under the user's cursor). Inside the
       grace window we paint nothing — the window background is the splash. */
    return shouldShowSplash(facts, graceOver ? SPLASH_GRACE_MS : since())
      ? <BootSplash facts={facts} failed={anyFailed(facts)} onRetry={retry} />
      : null;
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
