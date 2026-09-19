import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { XrLogo, XrAvatar } from "./Brand";
import { api, asList, type ProviderInfo, type SessionSummary, type SkillInfo } from "../api/client";
import { notify } from "../notify";
import { StatusDot, providerLabel, type DotState } from "./StatusDot";
import { notificationsEnabled } from "../prefs";
import { engineLinkReason } from "../tauri-bridge";

export type Area = "home" | "projects" | "work" | "workspace" | "research" | "memory" | "models" | "control" | "agents" | "library" | "trust" | "runs" | "settings" | "voice";

/* Phase 6 · mock-accurate icon rail. Left: work areas. Bottom: settings + presence. */
const NAV: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "home", label: "Home", icon: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" /> },
  { id: "projects", label: "Projects", icon: <path d="M3 6h6l2 2h10v4H3zM3 14h18v5H3z" /> },
  { id: "work", label: "Work (chat)", icon: <path d="M4 5h16v10H9l-5 4z" /> },
  { id: "workspace", label: "Workspace (files)", icon: <path d="M3 6h6l2 2h10v11H3zM10 12v4M8 14h4" /> },
  { id: "research", label: "Research", icon: <path d="M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM15 15l5 5M10 7v6M7 10h6" /> },
  { id: "memory", label: "Memory", icon: <path d="M12 4a4 4 0 0 0-4 4c-2 0-3 2-3 3.5S6.5 15 8 15c0 2.5 2 4 4 4s4-1.5 4-4c1.5 0 3-2 3-3.5S18 8 16 8a4 4 0 0 0-4-4zM12 8v11" /> },
  { id: "models", label: "Model Center", icon: <path d="M12 3l8 4.5-8 4.5-8-4.5zM4 12.5l8 4.5 8-4.5M4 17l8 4.5 8-4.5" /> },
  { id: "control", label: "Control Room", icon: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" /> },
  { id: "agents", label: "Multi-agent", icon: <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 6a3 3 0 0 1 0 6M18 20a5.5 5.5 0 0 0-2-4M16 11h5M18.5 8.5V13.5" /> },
  { id: "runs", label: "Team runs", icon: <path d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M17 20a5.5 5.5 0 0 0-2-4" /> },
  { id: "library", label: "Library", icon: <path d="M6 4h3v16H6zM11 4h3v16h-3zM16.5 5.2l2.9.8-3.6 13.6-2.9-.8z" /> },
  { id: "trust", label: "Trust Center", icon: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4" /> },
  { id: "voice", label: "Voice mode", icon: <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3" /> },
];

const BOTTOM: { id: Area; label: string; icon: ReactNode }[] = [
  { id: "settings", label: "Settings", icon: <path d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4.5 12l-1.8 1 1 1.8-.5 2 2 .5 1 1.8 1.8-1 2 .5.5-2 1.8-1-1-1.8.5-2-2-.5-1-1.8-1.8 1-2-.5-.5 2-1.8 1zM21.3 13l-1.8-1 .5-2-2-.5-1-1.8" /> },
];

/**
 * Rail destination button.
 *
 * Phase 1 · this used to be declared INSIDE AppShell's body. A component
 * defined during render is a NEW type on every render, so React unmounted and
 * remounted all 17 rail buttons on each status poll (every 4 s). The visible
 * effects: keyboard focus was silently destroyed while a user was on the rail,
 * and any click that straddled a re-render landed on a detached node — which
 * is how the renderer lane caught it ("element was detached from the DOM,
 * retrying", indefinitely). Hoisting it is the fix: stable type, stable DOM.
 */
const NavBtn = memo(function NavBtn({
  n,
  active,
  onArea,
}: {
  n: { id: Area; label: string; icon: ReactNode };
  active: boolean;
  onArea: (a: Area) => void;
}) {
  return (
    <button
      className={active ? "rbtn on" : "rbtn"}
      title={n.label}
      aria-label={n.label}
      aria-current={active ? "page" : undefined}
      onClick={() => onArea(n.id)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {n.icon}
      </svg>
    </button>
  );
});

export function AppShell({
  area,
  onArea,
  engineVersion,
  onSearch,
  onOpenRun,
  voiceState,
  onVoiceOpen,
  onCheatSheet,
  onRefresh,
  onOpenPalette,
  children,
}: {
  area: Area;
  onArea: (a: Area) => void;
  engineVersion: string | null;
  onSearch: (q: string) => void;
  onOpenRun: (id: string) => void;
  voiceState?: string;
  onVoiceOpen?: () => void;
  /** Phase 1 · ⌘K opens the palette; `?` opens the generated cheat-sheet. */
  onCheatSheet?: () => void;
  /**
   * Phase 1 · the palette opener. ⌘K used to call preventDefault() and then do
   * nothing — the shortcut was swallowed and the palette was unreachable from
   * the UI entirely (the renderer lane's Ctrl+K test failed against a running
   * app). This prop is required so a missing wiring fails the build, not the
   * user.
   */
  onOpenPalette: () => void;
  /** Re-read engine truth (used by the palette "Refresh engine data" command). */
  onRefresh?: () => void;
  children: ReactNode;
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [up, setUp] = useState(true);
  const [linkReason, setLinkReason] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  /* Phase 5 · opt-in OS notifications: approval due + run done, engine-polled.
   * Phase 1 · the gate now reads the shared preference (prefs.ts) so Settings,
   * the palette command and this poller cannot disagree. */
  useEffect(() => {
    let prevPending = -1;
    const seenRuns = new Map<string, string>();
    const t = setInterval(() => {
      if (!notificationsEnabled()) return;
      api.controlPending().then((r) => {
        const n = (r.pending ?? []).length;
        if (prevPending >= 0 && n > prevPending) void notify("XR — approval due", `${n} request(s) waiting in the Trust Center`);
        prevPending = n;
        setPending(n);
      }).catch(() => undefined);
      api.agents().then((a) => {
        for (const w of a.workflows ?? []) {
          const id = String((w as { id?: unknown }).id ?? "");
          const st = String((w as { state?: unknown; status?: unknown }).state ?? (w as { status?: unknown }).status ?? "");
          const prev = seenRuns.get(id);
          if (prev && prev !== st && /completed|failed|done/.test(st)) {
            void notify(`XR — run ${st}`, String((w as { goal?: unknown; name?: unknown }).goal ?? (w as { name?: unknown }).name ?? id).slice(0, 80));
          }
          if (id) seenRuns.set(id, st);
        }
      }).catch(() => undefined);
    }, 10_000);
    return () => clearInterval(t);
  }, []);

  const [voiceCap, setVoiceCap] = useState<boolean>(false);
  useEffect(() => {
    api.voiceStatus().then((v) => setVoiceCap(Boolean((v?.stt as { available?: boolean } | undefined)?.available || (v?.tts as { available?: boolean } | undefined)?.available))).catch(() => setVoiceCap(false));
  }, []);
  const [q, setQ] = useState("");
  const [pop, setPop] = useState<{ skills: SkillInfo[]; runs: SessionSummary[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounced universal search: skills via the engine index, runs via live sessions.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setPop(null); return; }
    let live = true;
    const t = setTimeout(() => {
      Promise.allSettled([api.skills(term), api.sessions()]).then(([s, r]) => {
        if (!live) return;
        const skills = (s.status === "fulfilled" ? (s.value.skills ?? []) : []).slice(0, 5);
        const all = r.status === "fulfilled" ? asList<SessionSummary>(r.value, "sessions") : [];
        const low = term.toLowerCase();
        const runs = all.filter((x) => `${x.title ?? ""} ${x.prompt ?? ""}`.toLowerCase().includes(low)).slice(0, 5);
        setPop({ skills, runs });
      });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  /* ⌘K palette · `?` cheat-sheet · Esc closes the search popover. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenPalette();
        return;
      }
      // `?` is Shift+/ — never steal it while the user is typing.
      if (!typing && (e.key === "?" || (e.key === "/" && e.shiftKey))) {
        e.preventDefault();
        onCheatSheet?.();
      }
      if (e.key === "Escape") setPop(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCheatSheet, onOpenPalette]);

  /* Poll engine truth. Phase 1 · also reads the engine's OWN primary provider
   * (AppShell previously rendered the first array entry, which could be a
   * provider the engine is not routing to) and the sidecar link reason. */
  useEffect(() => {
    let live = true;
    const poll = () => {
      api.health()
        .then(() => { if (live) { setUp(true); setLinkReason(null); } })
        .catch(() => {
          if (!live) return;
          setUp(false);
          // Surface WHY, instead of a bare red dot (audit D-10).
          void engineLinkReason().then((r) => { if (live) setLinkReason(r); });
        });
      api.providers().then((p) => {
        if (!live) return;
        setProviders(asList<ProviderInfo>(p, "providers", "items"));
        const prim = (p as { primary?: unknown }).primary;
        setPrimaryId(typeof prim === "string" ? prim : null);
      }).catch(() => {});
      api.controlPending().then((r) => { if (live) setPending((r.pending ?? []).length); }).catch(() => {});
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  /* The engine's primary provider, falling back to any LOCAL provider that is
   * actually healthy, then nothing — never an arbitrary first entry. */
  const primary =
    (primaryId ? providers.find((p) => p.id === primaryId) : undefined) ??
    providers.find((p) => p.kind === "local" && p.healthy === true);
  const prov = providerLabel(primary as Parameters<typeof providerLabel>[0]);
  const engineState: DotState = up ? (prov.state === "unknown" ? "ok" : prov.state) : "danger";

  return (
    <div className="shell">
      <header className="titlebar">
        <XrLogo height={22} radius={5} />
        <span className="appname">XR Desktop</span>
        <span className="tb-sep" />
        <span className="crumb mono faint">{NAV.find((n) => n.id === area)?.label ?? (area === "settings" ? "Settings" : "")}</span>
        <div className="gsearch-wrap">
          <form
            className="gsearch"
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) { onSearch(q.trim()); setPop(null); } }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search skills, runs… · ⌘K palette"
              aria-label="Global search"
            />
          </form>
          {pop && (pop.skills.length > 0 || pop.runs.length > 0) && (
            <div className="gpop" role="listbox" aria-label="Search results">
              {pop.skills.length > 0 && <div className="gpop-h">Skills · engine index</div>}
              {pop.skills.map((s) => (
                <button key={s.id} className="gpop-item" role="option" aria-selected={false} onClick={() => { onSearch(s.name ?? s.id); setPop(null); setQ(""); }}>
                  <span className="chip tiny">skill</span> {s.name ?? s.id}
                </button>
              ))}
              {pop.runs.length > 0 && <div className="gpop-h">Runs · live sessions</div>}
              {pop.runs.map((r) => (
                <button key={r.id} className="gpop-item" role="option" aria-selected={false} onClick={() => { onOpenRun(r.id); setPop(null); setQ(""); }}>
                  <span className="chip tiny">run</span> {r.title || r.prompt?.slice(0, 48) || r.id}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* The palette must be discoverable without knowing the shortcut —
            a command surface that only exists behind ⌘K is a hidden feature. */}
        <button
          className="tb-icon tb-pal"
          onClick={onOpenPalette}
          title="Command palette (Ctrl/⌘ K)"
          aria-label="Command palette"
          aria-keyshortcuts="Control+K Meta+K"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 7h16M4 12h10M4 17h7" />
          </svg>
        </button>
        <button
          className="tb-icon"
          onClick={onCheatSheet}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
          </svg>
        </button>
        <span className="mono faint tb-right" title={linkReason ?? `engine ${engineVersion ?? "—"}`}>
          engine {engineVersion ?? "—"}
        </span>
      </header>
      <nav className="rail" aria-label="Primary">
        {NAV.map((n) => <NavBtn key={n.id} n={n} active={n.id === area} onArea={onArea} />)}
        <div className="spacer" />
        {BOTTOM.map((n) => <NavBtn key={n.id} n={n} active={n.id === area} onArea={onArea} />)}
        <span className="rail-presence" title="XR presence" aria-label="XR presence">
          <XrAvatar size={26} />
        </span>
      </nav>
      <main className="main">{children}</main>
      <footer className="statusbar" aria-label="Status">
        <span
          className={up ? (engineState === "ok" ? "sb-item ok" : `sb-item ${engineState}`) : "sb-item bad"}
          title={up ? "Engine connected" : linkReason ?? "Engine offline — start it with `xr serve`"}
        >
          Engine <StatusDot state={up ? "ok" : "danger"} /> {up ? "" : "offline"}
        </span>
        <span className="sb-sep" aria-hidden="true" />
        {/* Honest provider state (audit D-07): grey when unknown, amber when
            configured-but-unreachable, red when the key is missing. */}
        <span className={`sb-item sb-prov ${prov.state === "ok" ? "ok" : prov.state}`} title={prov.detail}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="5" y="5" width="14" height="14" rx="3" /><path d="M9.5 9.5h5v5h-5z" />
          </svg>
          <StatusDot state={prov.state} />
          {prov.text}
        </span>
        {prov.state !== "ok" && prov.state !== "unknown" && (
          <>
            <span className="sb-sep" aria-hidden="true" />
            <span className="sb-prov-detail" title={prov.detail}>{prov.detail}</span>
          </>
        )}
        <span className="sb-spacer" />
        {pending > 0 && (
          <>
            <button className="sb-item sb-approvals" onClick={() => onArea("trust")} title={`${pending} request(s) waiting for you`}>
              <StatusDot state="warn" /> {pending} approval{pending === 1 ? "" : "s"}
            </button>
            <span className="sb-sep" aria-hidden="true" />
          </>
        )}
        {/* D-03 · was <span role="button" tabIndex={0}> with hand-rolled key
            handling. A button element gives the same interaction with correct
            semantics, and the status text below stays readable to AT. */}
        <button
          type="button"
          className={voiceState && voiceState !== "idle" ? "sb-item ok sb-btn" : "sb-item off sb-btn"}
          title={voiceState && voiceState !== "idle" ? `Voice session ${voiceState} — open voice mode` : `Voice idle — open voice mode (offline on-device pipeline ${voiceCap ? "available" : "unavailable"})`}
          onClick={onVoiceOpen}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 3v12M8 11a4 4 0 0 0 8 0M5 21h14" /></svg>
          <span className="sb-voice-cap">
            {voiceState && voiceState !== "idle" ? `VOICE ${voiceState.toUpperCase()}` : "OFFLINE VOICE"}
          </span>
        </button>
        <span className="sb-sep" aria-hidden="true" />
        <span className="sb-item mono">{engineVersion ?? "v—"}</span>
      </footer>
    </div>
  );
}
