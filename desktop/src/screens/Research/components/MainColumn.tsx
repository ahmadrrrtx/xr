/*
 * Centre column states — idle hero, live source feed (+ skeleton report
 * after 3 s of running), error card, and the finished article.
 */
import { useReducedMotion } from 'framer-motion';
import { Search, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { QUICK_STARTS, isLocalSource, isRunningPhase, type UiSource } from '@/research/core';
import { useResearchStore } from '@/stores/researchStore';

import { ReportView } from './ReportView';
import { Favicon } from './SourceCard';

const SLIDE_CAP = 30;

function Hero({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="xr-hero" data-testid="research-hero">
      <div className="icon">
        <Search size={24} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <h2>What do you want to discover?</h2>
      <p>XR searches, reads, and cites. Every claim links back to a source.</p>
      <div className="xr-quick" aria-label="Quick starts">
        {QUICK_STARTS.map((q) => (
          <button key={q} type="button" className="xr-followup" style={{ width: 'auto' }} onClick={() => onPick(q)} data-testid="quick-start">
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function FeedRow({ s, reduced }: { s: UiSource; reduced: boolean }) {
  const local = isLocalSource(s);
  const label = s.status === 'reading' ? 'reading' : s.status === 'fetched' ? 'read' : s.status === 'failed' ? 'failed' : 'found';
  return (
    <div className={reduced || s.seq >= SLIDE_CAP ? 'xr-feed-row' : 'xr-feed-row xr-feed-in'} style={!reduced && s.seq < SLIDE_CAP ? { animationDelay: `${s.seq * 60}ms` } : undefined} data-testid="feed-row" data-status={s.status}>
      <Favicon domain={s.domain} local={local} size={16} />
      <span className="domain">{local ? s.url.replace('local://', '') : s.domain}</span>
      <span className="title">{s.title}</span>
      <span className="xr-pill" data-status={s.status}>
        {label}
      </span>
    </div>
  );
}

function Skeleton() {
  const widths = ['62%', '100%', '96%', '88%', '100%', '72%', '0', '40%', '100%', '94%', '90%'];
  return (
    <div className="mt-8" aria-hidden="true" data-testid="report-skeleton">
      {widths.map((w, i) =>
        w === '0' ? <div key={i} style={{ height: 14 }} /> : <div key={i} className="xr-skel" style={{ height: i === 0 || i === 7 ? 22 : 13, width: w, marginBottom: 10 }} />,
      )}
    </div>
  );
}

function LiveFeed() {
  const sources = useResearchStore((s) => s.sources);
  const searches = useResearchStore((s) => s.searches);
  const plan = useResearchStore((s) => s.plan);
  const phase = useResearchStore((s) => s.phase);
  const startedAt = useResearchStore((s) => s.startedAt);
  const reduced = useReducedMotion() ?? false;
  // Skeleton report once the run has been going for 3 s (real elapsed time,
  // not a mock): the `now` tick is the only timer here.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const showSkeleton = startedAt != null && now - startedAt >= 3000;
  const done = searches.filter((s) => s.hits !== null);
  return (
    <div data-testid="live-feed">
      {plan ? (
        <p className="mb-4 text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }} data-testid="plan-objective">
          {plan.objective}
        </p>
      ) : (
        <p className="mb-4 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
          Planning the search…
        </p>
      )}
      {done.length ? (
        <p className="mb-3 text-[12px]" style={{ color: 'var(--text-tertiary)' }} data-testid="search-summary">
          {done.length} search{done.length === 1 ? '' : 'es'} · {done.reduce((n, s) => n + (s.hits ?? 0), 0)} hits
          {done.some((s) => s.unavailableReason) ? ` · ${done.find((s) => s.unavailableReason)?.unavailableReason}` : ''}
        </p>
      ) : null}
      <div role="list" aria-label="Sources found so far">
        {sources.map((s) => (
          <div role="listitem" key={s.id}>
            <FeedRow s={s} reduced={reduced} />
          </div>
        ))}
      </div>
      {phase === 'synthesizing' ? (
        <p className="mt-6 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Writing the report from {sources.filter((s) => s.status === 'fetched').length} read source{sources.filter((s) => s.status === 'fetched').length === 1 ? '' : 's'}…
        </p>
      ) : null}
      {showSkeleton ? <Skeleton /> : null}
    </div>
  );
}

function ErrorCard() {
  const error = useResearchStore((s) => s.error);
  const sources = useResearchStore((s) => s.sources);
  const navigate = useNavigate();
  const restart = useResearchStore((s) => s.restart);
  if (!error) return null;
  return (
    <div className="xr-error" role="alert" data-testid="research-error">
      <h3>Research couldn't complete</h3>
      <p>{error.message}</p>
      {error.egressBlocked ? (
        <p data-testid="egress-copy">By default XR doesn't access the public internet. Enable web egress in Shield to research online sources, or drop PDFs/local files.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="xr-btn" onClick={() => void restart()} data-testid="research-retry">
          Retry
        </button>
        {error.egressBlocked ? (
          <button type="button" className="xr-btn primary" onClick={() => navigate('/shield?tab=security&section=network')} data-testid="research-shield-link">
            <ShieldAlert size={14} strokeWidth={1.75} aria-hidden="true" />
            Enable web access in Shield
          </button>
        ) : null}
      </div>
      {sources.length ? (
        <p className="mt-4 mb-0 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          {sources.length} source{sources.length === 1 ? '' : 's'} listed on the right — none could be read.
        </p>
      ) : null}
    </div>
  );
}

export function MainColumn({ onPick }: { onPick: (q: string) => void }) {
  const phase = useResearchStore((s) => s.phase);
  const report = useResearchStore((s) => s.report);
  const topic = useResearchStore((s) => s.runTopic);
  const citations = useResearchStore((s) => s.citations);
  const sources = useResearchStore((s) => s.sources);
  const contradictions = useResearchStore((s) => s.contradictions);
  const stats = useResearchStore((s) => s.stats);
  const endedAt = useResearchStore((s) => s.endedAt);
  const depth = useResearchStore((s) => s.runDepth);
  const provider = useResearchStore((s) => s.provider);
  const model = useResearchStore((s) => s.model);
  const partialReason = useResearchStore((s) => s.partialReason);
  const partialNote = useResearchStore((s) => s.progress.partial);
  const voiceFollow = useResearchStore((s) => s.voiceFollow);

  if (phase === 'idle') {
    return (
      <>
        {voiceFollow ? (
          <div className="xr-banner info" role="status" data-testid="voice-follow">
            <span>Voice is researching “{voiceFollow.topic}” on the engine — the result appears here when it lands.</span>
          </div>
        ) : null}
        <Hero onPick={onPick} />
      </>
    );
  }
  if (isRunningPhase(phase)) return <LiveFeed />;
  if (phase === 'error') return <ErrorCard />;
  if (!report) {
    return (
      <div className="xr-banner info" role="status" data-testid="no-report">
        <span>{phase === 'cancelled' ? 'Cancelled before a report was written.' : 'The engine stopped before writing a report.'} {sources.length ? `${sources.length} source${sources.length === 1 ? '' : 's'} are listed on the right.` : ''}</span>
      </div>
    );
  }
  return (
    <ReportView
      topic={topic}
      report={report}
      index={citations}
      sources={sources}
      contradictions={contradictions}
      stats={stats}
      endedAt={endedAt}
      depth={depth}
      provider={provider}
      model={model}
      partialReason={phase === 'cancelled' ? 'Cancelled — showing what was gathered before the stop' : partialReason}
      partialNote={partialNote}
    />
  );
}
