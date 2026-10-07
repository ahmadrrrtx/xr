/*
 * Research screen (Phase 18) — three columns over the existing research
 * engine: query panel · article · sources. The store owns the run; this
 * component owns layout, keyboard, URL intents and the aria-live region.
 *
 * URL intents: /research?q=…            prefill
 *              /research?q=…&start=1    prefill + run (palette "?" prefix)
 *              /research?q=…&via=voice  follow the engine's voice run
 *              /research?session=r_…    open a stored session
 */
import { PanelRightOpen } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Resizer } from '@/components/Resizer';
import { clampPane } from '@/lib/builderCore';
import { isRunningPhase } from '@/research/core';
import { useResearchStore } from '@/stores/researchStore';
import '@/styles/research.css';

import { MainColumn } from './components/MainColumn';
import { QueryPanel } from './components/QueryPanel';
import { SourcesPanel } from './components/SourcesPanel';

const SOURCES_MIN = 200;
const SOURCES_MAX = 560;
const SOURCES_DEFAULT = 320;

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

export default function ResearchScreen() {
  const [params, setParams] = useSearchParams();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [sourcesW, setSourcesW] = useState(SOURCES_DEFAULT);
  const [bodyH, setBodyH] = useState(600);
  const phase = useResearchStore((s) => s.phase);
  const collapsed = useResearchStore((s) => s.sourcesCollapsed);
  const announce = useResearchStore((s) => s.announce);
  const errorMessage = useResearchStore((s) => s.error?.message ?? null);
  const sourceCount = useResearchStore((s) => s.sources.length);

  // Boot: engine posture + budgets, recent sessions, persisted prefs.
  useEffect(() => {
    const st = useResearchStore.getState();
    void st.loadSettings();
    void st.loadRecent();
    return () => useResearchStore.getState().leaveScreen();
  }, []);

  // URL intents (consumed once, then cleared so a refresh doesn't re-run).
  useEffect(() => {
    const q = params.get('q');
    const start = params.get('start') === '1';
    const via = params.get('via');
    const session = params.get('session');
    if (!q && !session) return;
    const st = useResearchStore.getState();
    if (session) void st.loadSession(session);
    else if (q && via === 'voice') st.followVoice(q);
    else if (q) {
      st.setQuery(q);
      if (start && !isRunningPhase(st.phase)) void st.start({ query: q });
    }
    setParams(new URLSearchParams(), { replace: true });
  }, [params, setParams]);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setBodyH(Math.round(entry.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pick = useCallback((q: string) => {
    const st = useResearchStore.getState();
    st.setQuery(q);
    void st.start({ query: q });
  }, []);

  // Keyboard: / focus · ⌘Enter run · Esc cancel/collapse · ⌘S save · 1–9 citation · ⌘/ sources · ⌘R restart.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useResearchStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      const editing = isEditable(e.target);
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (!isRunningPhase(st.phase)) void st.start();
        return;
      }
      if (mod && e.key === '/') {
        e.preventDefault();
        st.toggleSources();
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        if (st.report && !isRunningPhase(st.phase)) {
          e.preventDefault();
          void st.saveToWorkspace();
        }
        return;
      }
      if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') {
        if (st.runTopic || st.query.trim()) {
          e.preventDefault();
          void st.restart();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (isRunningPhase(st.phase)) {
          e.preventDefault();
          void st.cancel();
        } else if (!editing && st.phase === 'idle') {
          st.toggleSources(true);
        }
        return;
      }
      if (editing || mod || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        textareaRef.current?.focus();
        return;
      }
      if (/^[1-9]$/.test(e.key) && st.citations.order.length) {
        const id = st.citations.order[Number(e.key) - 1];
        if (id) {
          e.preventDefault();
          st.focusCitation(id);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const width = clampPane(sourcesW, SOURCES_MIN, SOURCES_MAX);
  return (
    <div className="xr-root" data-testid="research-screen" data-phase={phase}>
      <QueryPanel textareaRef={textareaRef} />
      <main className="xr-pane xr-main" aria-label="Research report" ref={bodyRef}>
        <div className="xr-main-inner">
          <MainColumn onPick={pick} />
        </div>
      </main>
      {collapsed ? (
        <div className="xr-pane xr-right" style={{ width: 40, alignItems: 'center', paddingTop: 10 }}>
          <button type="button" className="xr-mini" aria-label={`Show sources panel (${sourceCount})`} title="Sources (⌘/)" onClick={() => useResearchStore.getState().toggleSources(false)} data-testid="sources-expand">
            <PanelRightOpen size={15} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {sourceCount ? (
            <span className="mt-1 text-[11px] tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {sourceCount}
            </span>
          ) : null}
        </div>
      ) : (
        <>
          <Resizer orientation="vertical" storageKey="xr.research.panes.sources" value={width} onChange={setSourcesW} min={SOURCES_MIN} max={SOURCES_MAX} defaultValue={SOURCES_DEFAULT} invert label="Resize sources" />
          <div style={{ width, flex: 'none', minHeight: 0, display: 'flex' }}>
            <SourcesPanel height={bodyH} />
          </div>
        </>
      )}
      {/* Phase announcements + errors for assistive tech (brief §10). */}
      <div className="sr-only" aria-live="polite" aria-atomic="true" data-testid="research-live">
        {announce ? <span key={announce.n}>{announce.text}</span> : null}
      </div>
      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {errorMessage}
      </div>
    </div>
  );
}
