/*
 * Crash recovery screen (Phase 27).
 *
 * Shown BEFORE the router mounts, only when `~/.xr/crash-dirty.json` was still
 * on disk at launch — i.e. the previous session never reached its clean-exit
 * path. That is the whole trigger: no heuristics, no "we think something went
 * wrong", just a flag the shell writes after spawning its engine and deletes on
 * the way out.
 *
 * Design rules the brief sets, and how they show up here:
 *
 *   · **Calm, not alarming.** No red. One warm accent (the sigil), muted body
 *     copy, and a headline that states the fact without adjectives.
 *   · **Three real choices.** Resume keeps the session as it was; Start fresh
 *     drops the interrupted runs; "Send a crash report" is a fourth path that
 *     sits *beside* them because it never blocks the app from starting. The
 *     report is assembled locally, shown to the user, and only emailed if they
 *     send it — XR has no telemetry and this is not a loophole.
 *   · **A way out of a crash loop.** When the previous session's engine failed
 *     to start, or this is the second interruption in a row, the screen offers
 *     "Start without the local engine" and, if something is already listening on
 *     127.0.0.1:3141, an attach path that runs the evidence check the Rust side
 *     requires before it links.
 *   · **Honest about runs.** Interrupted runs are marked `killed` with the note
 *     "App was interrupted" — never silently "completed".
 */
import { useEffect, useState } from 'react';
import { AlertCircle, ArrowRight, FileText, Play, RotateCcw, Zap } from 'lucide-react';

import { Logo } from '@/components/brand/Logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { invokeShell, type RecoveryInfo, type ReportTicket } from '@/lib/shellApi';
import { useBrainStore } from '@/stores/brainStore';

interface CrashRecoveryProps {
  info: RecoveryInfo;
  /** Resolve the screen: 'resume' | 'fresh' | 'without-engine' | 'attach'. */
  onResolve: (action: 'resume' | 'fresh' | 'without-engine', info?: RecoveryInfo) => void;
}

function Row({
  icon,
  title,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border-subtle bg-bg-ink/60 flex items-start gap-3 rounded-lg border p-3.5">
      <div className="text-text-tertiary mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-text-primary text-[13px] font-medium">{title}</p>
        <p className="text-text-secondary mt-0.5 text-xs leading-relaxed">{detail}</p>
        {children}
      </div>
    </div>
  );
}

export function CrashRecovery({ info, onResolve }: CrashRecoveryProps) {
  const [busy, setBusy] = useState<'resume' | 'fresh' | 'without-engine' | 'attach' | 'report' | null>(
    null
  );
  const [report, setReport] = useState<ReportTicket | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [token, setToken] = useState('');
  const [attachError, setAttachError] = useState<string | null>(null);
  const settleRuns = useBrainStore((state) => state.settleInterruptedRuns);

  // The runs this screen is about: mark them the moment it appears, so leaving
  // the screen by any route cannot leave a run claiming to be live.
  useEffect(() => {
    settleRuns('App was interrupted');
  }, [settleRuns]);

  const resolve = (action: 'resume' | 'fresh' | 'without-engine'): void => {
    setBusy(action);
    void (async () => {
      if (action === 'fresh') {
        // Dropping the rows is a decision about *this* session's history; the
        // host only needs to know the flag is settled.
        useBrainStore.getState().dropInterruptedRuns();
      }
      const command =
        action === 'without-engine' ? 'crash_start_without_engine' : 'crash_resolve';
      const payload =
        action === 'without-engine' ? undefined : { action: action === 'fresh' ? 'fresh' : 'resume' };
      const next = await invokeShell<RecoveryInfo>(command, payload);
      setBusy(null);
      onResolve(action, next ?? undefined);
    })();
  };

  const makeReport = (): void => {
    setBusy('report');
    void (async () => {
      const ticket = await invokeShell<ReportTicket>('crash_report');
      setBusy(null);
      if (!ticket) return;
      setReport(ticket);
      setReportOpen(true);
    })();
  };

  const attach = (): void => {
    setBusy('attach');
    setAttachError(null);
    void (async () => {
      const result = await invokeShell<{ attached: boolean; message: string }>(
        'crash_attach_external',
        { token, port: 3141 }
      );
      setBusy(null);
      if (result?.attached) {
        onResolve('without-engine');
        return;
      }
      setAttachError(
        result?.message ??
          'Could not attach to the engine on 127.0.0.1:3141 — check that it is running and that the token matches.'
      );
    })();
  };

  const repeat = info.consecutiveInterruptions > 1;
  const offerEngineLess = info.engineSpawnFailed || repeat;

  return (
    <div className="bg-bg-void flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-[540px]">
        <div className="mb-5 flex items-center gap-3">
          <Logo variant="icon" size={40} />
          <div>
            <h1 className="text-text-primary text-[17px] font-semibold">
              XR did not shut down cleanly last time
            </h1>
            <p className="text-text-tertiary mt-0.5 text-xs">
              {info.previousVersion
                ? `The last session was running XR ${info.previousVersion}.`
                : 'The last session left its session marker behind.'}
              {repeat ? ` This is interruption ${info.consecutiveInterruptions} in a row.` : ''}
            </p>
          </div>
        </div>

        {/* What we know, in the order a user asks it. */}
        <div className="mb-5 space-y-2">
          <Row
            icon={<AlertCircle size={15} strokeWidth={1.6} />}
            title="Nothing was sent anywhere"
            detail="XR has no telemetry — not for usage, not for crashes. Anything below stays on this machine until you choose to send it."
          />
          <Row
            icon={<FileText size={15} strokeWidth={1.6} />}
            title={
              info.logFiles > 0
                ? `${info.logFiles} local log${info.logFiles === 1 ? '' : 's'} available`
                : 'Local logs are available'
            }
            detail={`The shell keeps its own bounded log (~${Math.max(
              1,
              Math.round((info.shellLogBytes ?? 0) / 1024)
            )} KB this session). A report copies the tail of it, redacted.`}
          >
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              disabled={busy !== null}
              onClick={makeReport}
            >
              {busy === 'report' ? 'Assembling…' : 'Send a crash report'}
            </Button>
          </Row>
        </div>

        {/* The decision. */}
        <div className="space-y-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => resolve('resume')}
            className="border-border-subtle hover:border-accent/60 bg-bg-ink flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-colors disabled:opacity-50"
          >
            <Play size={16} strokeWidth={1.6} className="text-accent shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="text-text-primary block text-[13px] font-medium">
                Resume where I left off
              </span>
              <span className="text-text-secondary block text-xs">
                Sessions, chats and workspaces stay as they are. Runs that were in flight are marked
                killed.
              </span>
            </span>
            <ArrowRight size={15} strokeWidth={1.6} className="text-text-tertiary shrink-0" />
          </button>

          <button
            type="button"
            disabled={busy !== null}
            onClick={() => resolve('fresh')}
            className="border-border-subtle hover:border-border-subtle bg-bg-ink flex w-full items-center gap-3 rounded-lg border p-3.5 text-left transition-colors disabled:opacity-50"
          >
            <RotateCcw size={16} strokeWidth={1.6} className="text-text-tertiary shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="text-text-primary block text-[13px] font-medium">Start fresh</span>
              <span className="text-text-secondary block text-xs">
                Same as resume, but the interrupted runs are dropped instead of marked.
              </span>
            </span>
            <ArrowRight size={15} strokeWidth={1.6} className="text-text-tertiary shrink-0" />
          </button>

          {offerEngineLess ? (
            <div className="border-border-subtle bg-bg-ink rounded-lg border p-3.5">
              <div className="flex items-start gap-3">
                <Zap size={16} strokeWidth={1.6} className="text-warning mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-text-primary text-[13px] font-medium">
                    Start without the local engine
                  </p>
                  <p className="text-text-secondary mt-0.5 text-xs leading-relaxed">
                    {info.engineSpawnFailed
                      ? 'The engine did not start in the last session. Starting XR without it keeps your history and lets you attach to an engine you run yourself.'
                      : 'This has happened more than once, so starting without the engine is the safer way in.'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => resolve('without-engine')}
                    >
                      {busy === 'without-engine' ? 'Starting…' : 'Start without the engine'}
                    </Button>
                    {info.externalEngineListening ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => setAttachOpen(true)}
                      >
                        Attach to 127.0.0.1:3141
                      </Button>
                    ) : (
                      <span className="text-text-tertiary text-xs">
                        You can attach to a running engine later in Settings.
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {attachOpen ? (
                <div className="border-border-subtle mt-3 border-t pt-3">
                  <p className="text-text-secondary text-xs leading-relaxed">
                    XR's engine authenticates even on loopback. Paste the token it printed when it
                    started (the <code className="text-text-primary">Token:</code> line); it is
                    checked against the running engine before anything is linked, and never stored in
                    a log.
                  </p>
                  <input
                    type="password"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder="engine token"
                    className="border-border-subtle bg-bg-void text-text-primary mt-2 w-full rounded-md border px-3 py-2 font-mono text-xs"
                  />
                  {attachError ? (
                    <p className="text-danger mt-2 text-xs">{attachError}</p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" disabled={busy !== null || token.trim() === ''} onClick={attach}>
                      {busy === 'attach' ? 'Checking…' : 'Attach'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setAttachOpen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <p className="text-text-tertiary mt-4 text-[11px] leading-relaxed">
          XR {info.currentVersion} · {info.platform}. The marker is removed as soon as you choose,
          so this screen appears once per interruption.
        </p>
      </div>

      {/* ── Report preview ── */}
      {reportOpen && report ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="bg-bg-ink border-border-subtle flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-xl border">
            <div className="border-border-subtle flex items-center justify-between border-b px-4 py-3">
              <div className="min-w-0">
                <p className="text-text-primary text-[13px] font-medium">Crash report</p>
                <p className="text-text-tertiary mt-0.5 text-xs">
                  {Math.round(report.bytes / 1024)} KB · redacted · written to {report.path}
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                local only
              </Badge>
            </div>

            <div className="border-border-subtle border-b px-4 py-3">
              <p className="text-text-secondary text-xs font-medium">What is in this report</p>
              <ul className="text-text-tertiary mt-1.5 space-y-0.5 text-xs">
                {report.included.map((source) => (
                  <li key={source} className="truncate font-mono text-[11px]">
                    · {source}
                  </li>
                ))}
              </ul>
              <p className="text-text-tertiary mt-2 text-[11px] leading-relaxed">
                Your home directory is replaced with <code>$HOME</code>, and anything shaped like a
                token, API key or the engine's pairing token is replaced with{' '}
                <code>[redacted]</code>. Nothing is uploaded: the button below opens a mail draft
                with the file attached.
              </p>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <pre className="text-text-secondary font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {report.preview}
              </pre>
            </div>

            <div className="border-border-subtle flex items-center justify-between gap-2 border-t px-4 py-3">
              <span className="text-text-tertiary min-w-0 flex-1 truncate text-[11px]">
                {report.mailto.length > 90 ? 'Opens your mail app with the summary filled in.' : ''}
              </span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => setReportOpen(false)}>
                  Close
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    void invokeShell('open_url', { url: report.mailto });
                  }}
                >
                  Open mail draft
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
