/*
 * Left column — query, depth, filters, PDFs; while running: progress, step
 * chip, cancel, live log; when done: stats, actions, follow-ups; always:
 * recent research.
 */
import { useReducedMotion } from 'framer-motion';
import { Brain, ChevronDown, ChevronRight, FileUp, Paperclip, RotateCcw, Save, Share2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import TextareaAutosize from 'react-textarea-autosize';

import { cn } from '@/lib/utils';
import { PHASE_LABEL, depthHint, fmtAgo, isRunningPhase, planSteps, statsLine, type UiDepth } from '@/research/core';
import { useResearchStore, type Filters } from '@/stores/researchStore';

const DEPTHS: Array<{ id: UiDepth; label: string }> = [
  { id: 'quick', label: 'Quick' },
  { id: 'standard', label: 'Standard' },
  { id: 'deep', label: 'Deep' },
  { id: 'academic', label: 'Academic' },
];

const FILTERS: Array<{ id: keyof Filters; label: string; disabled?: string }> = [
  { id: 'web', label: 'Web' },
  { id: 'arxiv', label: 'ArXiv & papers', disabled: 'Paper search is not wired yet — the engine has no papers lane.' },
  { id: 'local', label: 'Local files' },
  { id: 'connected', label: 'Connected apps', disabled: 'Coming in Phase 22' },
];

function StatusDot({ pulse }: { pulse: boolean }) {
  return <span aria-hidden="true" className={cn('inline-block size-2 shrink-0 rounded-full', pulse && 'xr-dot-pulse')} style={{ backgroundColor: 'var(--accent)' }} />;
}

export function QueryPanel({ textareaRef }: { textareaRef: React.MutableRefObject<HTMLTextAreaElement | null> }) {
  const st = useResearchStore();
  const reduced = useReducedMotion() ?? false;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const running = isRunningPhase(st.phase);
  const finished = st.phase === 'done' || st.phase === 'partial' || st.phase === 'cancelled';
  const budgets = st.budgetsFor();
  const steps = planSteps(st.phase);
  const activeStep = steps.find((s) => s.state === 'active');
  const webOff = st.settings ? !st.settings.allowPublicWeb : false;

  const onFiles = (files: FileList | File[] | null): void => {
    if (!files) return;
    for (const f of Array.from(files)) void st.addPdf(f);
  };

  return (
    <div className="xr-pane xr-left" data-testid="research-query-panel">
      <div className="xr-section flex items-center justify-between">
        <h1 className="m-0 text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
          Research
        </h1>
        {st.readOnly ? <span className="xr-badge">stored</span> : null}
      </div>

      <div className="xr-section">
        <label htmlFor="xr-query" className="xr-label">
          Question
        </label>
        <TextareaAutosize
          id="xr-query"
          ref={textareaRef}
          className="xr-query"
          minRows={2}
          maxRows={7}
          placeholder="What do you want to discover?"
          value={st.query}
          onChange={(e) => st.setQuery(e.target.value)}
          disabled={running}
          data-testid="research-query"
        />
        {webOff && !running ? (
          <p className="xr-hint" data-testid="egress-hint">
            By default XR doesn't access the public internet. Enable web egress in Shield to research online sources, or drop PDFs/local files.
          </p>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="xr-hint m-0">⌘Enter to run</span>
          <button type="button" className="xr-btn primary" disabled={running || !st.query.trim()} onClick={() => void st.start()} data-testid="research-start">
            Research
          </button>
        </div>
      </div>

      <div className="xr-section">
        <span className="xr-label" id="xr-depth-label">
          Depth
        </span>
        <div className="xr-seg" role="radiogroup" aria-labelledby="xr-depth-label">
          {DEPTHS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={st.depth === d.id}
              disabled={running || d.id === 'academic'}
              title={d.id === 'academic' ? 'Academic depth needs the papers lane (ArXiv) — not wired yet.' : depthHint(d.id, budgets)}
              onClick={() => st.setDepth(d.id)}
              data-testid={`depth-${d.id}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <p className="xr-hint">{depthHint(st.depth, budgets)}</p>
      </div>

      <div className="xr-section">
        <span className="xr-label">Sources</span>
        {FILTERS.map((f) => {
          const id = `xr-filter-${f.id}`;
          const disabled = Boolean(f.disabled) || running;
          return (
            <div key={f.id} className="xr-filter" data-disabled={f.disabled ? 'true' : 'false'} title={f.disabled}>
              <label htmlFor={id}>{f.label}</label>
              <button id={id} type="button" role="switch" aria-checked={st.filters[f.id]} aria-label={f.label} disabled={disabled} className="xr-switch" onClick={() => st.setFilter(f.id, !st.filters[f.id])} data-testid={`filter-${f.id}`} />
            </div>
          );
        })}
        {st.filters.local && st.localFiles ? (
          <p className="xr-hint">
            {st.localFiles.files} file{st.localFiles.files === 1 ? '' : 's'} from {st.localFiles.workspace}
            {st.localFiles.skipped ? ` · ${st.localFiles.skipped} skipped (12 files / 200 KB cap)` : ''}
          </p>
        ) : null}
      </div>

      <div className="xr-section">
        <span className="xr-label">PDFs</span>
        <div
          className="xr-drop"
          data-over={over ? 'true' : 'false'}
          data-testid="pdf-drop"
          onDragOver={(e) => {
            e.preventDefault();
            if (!running) setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!running) onFiles(e.dataTransfer.files);
          }}
        >
          <FileUp size={18} strokeWidth={1.5} aria-hidden="true" />
          <span>Drop PDFs here · up to 20 MB each</span>
          <button type="button" className="xr-btn ghost" style={{ minHeight: 28, fontSize: 12 }} disabled={running} onClick={() => fileRef.current?.click()} data-testid="pdf-attach">
            <Paperclip size={13} strokeWidth={1.75} aria-hidden="true" />
            Attach PDF
          </button>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} data-testid="pdf-input" />
        </div>
        {st.pdfs.length ? (
          <ul className="mt-2 list-none p-0" aria-label="Attached PDFs">
            {st.pdfs.map((p) => (
              <li key={p.id} className="xr-pdf" data-testid="pdf-item">
                <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--text-tertiary)' }} />
                <span className="name" title={p.name}>
                  {p.name}
                </span>
                <span style={{ color: p.state === 'error' ? 'var(--danger)' : 'var(--text-tertiary)' }} className="shrink-0 text-[11px]">
                  {p.state === 'uploading' ? 'extracting…' : p.state === 'error' ? 'failed' : `${p.pages} p · ${Math.round(p.chars / 1000)}k chars${p.truncated ? ' · truncated' : ''}`}
                </span>
                <button type="button" className="xr-mini" style={{ width: 28, height: 28 }} aria-label={`Remove ${p.name}`} disabled={running} onClick={() => st.removePdf(p.id)}>
                  <X size={13} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {running ? (
        <div className="xr-section" data-testid="research-running">
          <div
            className="xr-progress"
            role="progressbar"
            aria-label="Research progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={st.progress.percent ?? undefined}
            aria-valuetext={st.progress.percent == null ? `${PHASE_LABEL[st.phase]}…` : `${PHASE_LABEL[st.phase]} — ${st.progress.percent}%`}
            data-indeterminate={st.progress.percent == null ? 'true' : 'false'}
          >
            <span style={st.progress.percent == null ? undefined : { width: `${st.progress.percent}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="xr-chip" data-testid="step-chip">
              <StatusDot pulse={!reduced} />
              {activeStep?.label ?? PHASE_LABEL[st.phase]}
              {st.progress.sourcesDiscovered ? (
                <span style={{ color: 'var(--text-tertiary)' }}>
                  · {st.progress.sourcesFetched}/{st.progress.sourcesDiscovered}
                </span>
              ) : null}
            </span>
            <button type="button" className="xr-btn danger" onClick={() => void st.cancel()} data-testid="research-cancel" title="Esc">
              Cancel
            </button>
          </div>
          {st.downshift ? (
            <p className="xr-hint" data-testid="downshift-note">
              Budget governor routed this run to {st.downshift.to}
              {st.downshift.why ? ` — ${st.downshift.why}` : ''}
            </p>
          ) : null}
          <button type="button" className="mt-3 flex min-h-8 w-full items-center gap-1 border-0 bg-transparent p-0 text-left text-[12px]" style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }} aria-expanded={st.logOpen} onClick={st.toggleLog} data-testid="log-toggle">
            {st.logOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
            Live log ({st.log.length})
          </button>
          {st.logOpen ? (
            <pre className="xr-log mt-1" data-testid="live-log" aria-live="off">
              {st.log.slice(-120).join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}

      {finished ? (
        <div className="xr-section" data-testid="research-done">
          {st.stats ? (
            <p className="m-0 text-[12px]" style={{ color: 'var(--text-secondary)' }} data-testid="stats-line">
              {st.stats.local ? (
                <>
                  {statsLine(st.stats).replace(/ • local$/, '')}
                  <span className="xr-badge ml-1.5" title={`${st.stats.provider}/${st.stats.model} runs locally — $0`}>
                    local
                  </span>
                </>
              ) : (
                statsLine(st.stats)
              )}
            </p>
          ) : (
            <p className="m-0 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
              Stored session — usage was not recorded.
            </p>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="xr-btn" onClick={() => void st.restart()} data-testid="research-restart" title="⌘R">
              <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
              Restart
            </button>
            <button type="button" className="xr-btn" disabled={!st.report || st.saving} onClick={() => void st.saveToWorkspace()} data-testid="research-save" title="⌘S">
              <Save size={14} strokeWidth={1.75} aria-hidden="true" />
              {st.saving ? 'Saving…' : 'Save to workspace'}
            </button>
            <button type="button" className="xr-btn" onClick={() => toast('Shareable links coming in a future update')} data-testid="research-share">
              <Share2 size={14} strokeWidth={1.75} aria-hidden="true" />
              Share
            </button>
            <button type="button" className="xr-btn" disabled={!st.report} onClick={() => void st.exportMd()} data-testid="research-export">
              Export .md
            </button>
          </div>
          {st.sessionId && st.report ? (
            <div className="xr-filter mt-3" data-testid="remember-row">
              <label htmlFor="xr-remember" className="flex items-center gap-1.5">
                <Brain size={13} strokeWidth={1.75} aria-hidden="true" />
                Save to memory
              </label>
              <button
                id="xr-remember"
                type="button"
                role="switch"
                aria-checked={st.remember === 'saved' || st.remember === 'duplicate'}
                aria-label="Save to memory"
                disabled={st.remember === 'saving' || st.remember === 'saved' || st.remember === 'duplicate'}
                className="xr-switch"
                onClick={() => void st.rememberRun()}
                data-testid="remember-toggle"
              />
            </div>
          ) : null}
          {st.followUps.length && st.report ? (
            <div className="mt-4">
              <span className="xr-label">Follow up</span>
              <div className="flex flex-col gap-1.5">
                {st.followUps.map((q) => (
                  <button key={q} type="button" className="xr-followup" onClick={() => void st.start({ query: q })} data-testid="followup-chip">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="xr-section" style={{ borderBottom: 0 }}>
        <button type="button" className="flex min-h-8 w-full items-center gap-1 border-0 bg-transparent p-0 text-left" style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }} aria-expanded={recentOpen} onClick={() => setRecentOpen((v) => !v)} data-testid="recent-toggle">
          {recentOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          <span className="xr-label m-0">Recent research</span>
          <span className="ml-auto text-[11px] tabular-nums">{st.recent.length}</span>
        </button>
        {recentOpen ? (
          st.recent.length ? (
            <ul className="mt-1 list-none p-0" aria-label="Recent research">
              {st.recent.map((r) => (
                <li key={r.id}>
                  <button type="button" className="xr-recent" disabled={running} onClick={() => void st.loadSession(r.id)} data-testid="recent-item" title={r.topic}>
                    <span className="when">
                      {new Date(r.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(r.updated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {fmtAgo(r.updated_at)}
                      {r.status !== 'done' ? ` · ${r.status}` : ''}
                    </span>
                    <span className="q">{r.topic.length > 40 ? `${r.topic.slice(0, 40)}…` : r.topic}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="xr-hint">No past research on this engine yet.</p>
          )
        ) : null}
      </div>
    </div>
  );
}
