/*
 * Phase 10 — workspace landing (/workspaces/:id).
 *
 * Hero (64px icon · name · path · stack chips) + quick-action grid:
 *   Chat (live → /chat?workspace=:id) · Settings (live) · Reveal (live)
 *   Builder / Research / Files / Memory (grayed — their phases) · Delete
 * (confirm + "also move files to trash", unchecked by default).
 * Recent-runs strip ships empty on purpose — runs attach in Phase 14.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Brain,
  Files,
  FlaskConical,
  FolderOpen,
  Loader2,
  MessageSquare,
  Rocket,
  Settings,
  Trash2,
  Wrench,
} from 'lucide-react';

import { DeleteDialog } from '@/components/workspaces/DeleteDialog';
import { StackChips } from '@/components/workspaces/StackChips';
import { fmtRelative } from '@/brain/format';
import type { RunStatus } from '@/brain/types';
import { useRunsStore } from '@/stores/runsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { cn } from '@/lib/utils';
import {
  WORKSPACE_KIND_META,
  workspaceIcon,
  type Workspace,
} from '@/workspaces/types';

const RUN_DOT: Record<RunStatus, string> = {
  running: 'var(--accent)',
  completed: 'var(--success)',
  failed: 'var(--danger)',
  waiting: 'var(--warning)',
  killed: 'var(--text-tertiary)',
};

export default function WorkspaceLanding() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const loaded = useWorkspaceStore((s) => s.loaded);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const [deleting, setDeleting] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Make sure this workspace is in the working set (deep link / new window).
  useEffect(() => {
    if (!id) return;
    if (!loaded) {
      void refresh();
    } else if (!workspaces.some((w) => w.id === id)) {
      // Row may exist in the DB but not the (stale) list — reload once.
      void refresh();
    }
  }, [id, loaded, workspaces, refresh]);

  const ws: Workspace | null = useMemo(
    () => workspaces.find((w) => w.id === id) ?? null,
    [workspaces, id]
  );

  // Runs attached to this workspace (by id, or by name for seeded history),
  // newest first, capped at five. Structural changes only — no tick churn.
  const runsVersion = useRunsStore((s) => s.listVersion);
  const clock = useRunsStore((s) => s.clock);
  useEffect(() => {
    useRunsStore.getState().tick(); // fresh "now" for the relative times below
  }, [runsVersion]);
  const wsRuns = useMemo(() => {
    if (!ws) return [];
    const name = ws.name.toLowerCase();
    return Object.values(useRunsStore.getState().runs)
      .filter(
        (r) =>
          !r.archived &&
          (r.workspaceId === ws.id ||
            (r.workspace ?? '').toLowerCase() === name)
      )
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws, runsVersion]);

  const doLaunch = async (): Promise<void> => {
    if (!ws) return;
    setLaunching(true);
    try {
      await useWorkspaceStore.getState().launch([ws.id]);
    } finally {
      setLaunching(false);
    }
  };

  if (!ws) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8">
        {loaded ? (
          <>
            <p className="text-[14px]">This workspace no longer exists.</p>
            <Link
              to="/workspaces"
              className="text-accent text-[13px] font-medium hover:underline"
            >
              Back to Workspaces
            </Link>
          </>
        ) : (
          <Loader2
            className="text-text-tertiary size-5 animate-spin"
            strokeWidth={1.5}
          />
        )}
      </div>
    );
  }

  const meta = WORKSPACE_KIND_META[ws.kind];
  const { emoji, Icon } = workspaceIcon(ws);
  const gv = meta.gradientVar;

  return (
    <div
      className="h-full min-h-0 overflow-y-auto"
      data-screen="workspace-landing"
    >
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-5 px-6 py-8">
        <nav aria-label="Breadcrumb">
          <Link
            to="/workspaces"
            className="text-text-secondary hover:text-text-primary inline-flex items-center gap-1.5 text-[12.5px] transition-colors"
          >
            <ArrowLeft className="size-3.5" strokeWidth={1.5} />
            Workspaces
          </Link>
        </nav>

        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section
          aria-label="Workspace details"
          className="xr-glass relative overflow-hidden rounded-2xl p-6"
        >
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-1"
            style={{
              background: `linear-gradient(90deg, var(--ws-${gv}-from), var(--ws-${gv}-to))`,
            }}
          />
          <div className="flex flex-wrap items-start gap-5">
            <div
              className="flex size-16 shrink-0 items-center justify-center rounded-2xl text-[34px]"
              style={{
                background: `linear-gradient(135deg, color-mix(in oklab, var(--ws-${gv}-from) 22%, transparent), color-mix(in oklab, var(--ws-${gv}-to) 30%, transparent))`,
              }}
            >
              {emoji ? (
                <span aria-hidden>{emoji}</span>
              ) : (
                <Icon className="size-8" strokeWidth={1.5} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] leading-tight font-semibold tracking-tight">
                  {ws.name}
                </h1>
                <span
                  className={cn(
                    'border-border-subtle inline-flex h-[20px] items-center rounded-full border px-2 text-[11px]',
                    ws.pinned && 'border-accent/40 text-accent'
                  )}
                >
                  {meta.label}
                </span>
              </div>
              <p
                className="text-text-secondary mt-1.5 font-mono text-[12px] break-all"
                title={ws.path}
              >
                {ws.path}
              </p>
              <StackChips stack={ws.stack} max={6} className="mt-3" />
            </div>
            <button
              type="button"
              data-testid="landing-launch"
              disabled={launching}
              onClick={() => void doLaunch()}
              className="bg-accent text-accent-contrast flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg px-4 text-[13px] font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {launching ? (
                <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
              ) : (
                <Rocket className="size-4" strokeWidth={1.5} />
              )}
              Open window
            </button>
          </div>
        </section>

        {/* ── Quick actions ────────────────────────────────────────────── */}
        <section aria-label="Quick actions">
          <h2 className="text-text-tertiary mb-2 font-mono text-[10.5px] tracking-wider uppercase">
            Quick actions
          </h2>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            <QuickAction
              label="Chat"
              hint="Continue in chat"
              onClick={() =>
                navigate(`/chat?workspace=${encodeURIComponent(ws.id)}`)
              }
            >
              <MessageSquare className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction
              label="Builder"
              hint="Edit, preview, chat"
              onClick={() => navigate(`/builder/${ws.id}`)}
            >
              <Wrench className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction label="Research" hint="Coming soon" disabled iconMuted>
              <FlaskConical className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction label="Files" hint="Coming soon" disabled iconMuted>
              <Files className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction label="Memory" hint="Coming soon" disabled iconMuted>
              <Brain className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction
              label="Reveal"
              hint={ws.pathExists ? 'In file manager' : 'Path missing'}
              disabled={!ws.pathExists}
              onClick={() => void useWorkspaceStore.getState().reveal(ws)}
            >
              <FolderOpen className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction
              label="Settings"
              hint="App settings"
              onClick={() => navigate('/settings')}
            >
              <Settings className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
            <QuickAction
              label="Delete"
              hint="Remove workspace"
              danger
              onClick={() => setDeleting(true)}
            >
              <Trash2 className="size-4.5" strokeWidth={1.5} />
            </QuickAction>
          </div>
        </section>

        {/* ── Recent runs (Phase 11: fed by the Control Room store) ─────── */}
        <section aria-label="Recent runs">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-text-tertiary font-mono text-[10.5px] tracking-wider uppercase">
              Recent runs
            </h2>
            {wsRuns.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  useRunsStore.getState().setSearch(ws.name);
                  navigate('/runs');
                }}
                className="text-text-secondary hover:text-text-primary text-[11.5px] underline-offset-2 hover:underline"
              >
                All in Control Room →
              </button>
            )}
          </div>
          {wsRuns.length === 0 ? (
            <div className="border-border-subtle rounded-xl border border-dashed p-5 text-center">
              <p className="text-text-secondary text-[12.5px]">No runs yet.</p>
              <p className="text-text-tertiary mt-1 text-[11.5px]">
                Agent runs in this workspace will appear here and in the Control
                Room.
              </p>
            </div>
          ) : (
            <ul className="border-border-subtle bg-bg-ink divide-border-subtle divide-y overflow-hidden rounded-xl border">
              {wsRuns.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/brain/${r.id}`)}
                    className="hover:bg-bg-raised flex w-full items-center gap-3 px-3 py-2 text-left transition-colors"
                    aria-label={`Open run ${r.shortId}: ${r.title}`}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: RUN_DOT[r.status] }}
                    />
                    <span className="text-text-tertiary w-12 shrink-0 font-mono text-[11px]">
                      {r.shortId}
                    </span>
                    <span className="text-text-primary min-w-0 flex-1 truncate text-[12.5px]">
                      {r.title}
                    </span>
                    <span className="text-text-tertiary shrink-0 font-mono text-[11px]">
                      {fmtRelative(r.startedAt, clock)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {deleting && (
        <DeleteDialog
          open
          name={ws.name}
          path={ws.path}
          pathExists={ws.pathExists}
          onCancel={() => setDeleting(false)}
          onConfirm={(deleteFiles) => {
            setDeleting(false);
            void useWorkspaceStore
              .getState()
              .remove(ws.id, deleteFiles)
              .then(() => navigate('/workspaces'));
          }}
        />
      )}
    </div>
  );
}

function QuickAction({
  label,
  hint,
  disabled,
  danger,
  iconMuted,
  onClick,
  children,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  danger?: boolean;
  iconMuted?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={`qa-${label.toLowerCase()}`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'group border-border-subtle flex items-center gap-3 rounded-xl border p-3 text-left transition-all duration-150',
        disabled
          ? 'cursor-not-allowed opacity-45'
          : danger
            ? 'cursor-pointer hover:border-[color-mix(in_oklab,var(--danger)_45%,transparent)] hover:bg-[color-mix(in_oklab,var(--danger)_6%,transparent)]'
            : 'hover:border-border-default hover:bg-bg-raised/40 cursor-pointer'
      )}
    >
      <span
        className={cn(
          'bg-bg-raised flex size-9 shrink-0 items-center justify-center rounded-lg',
          danger
            ? 'text-danger'
            : iconMuted
              ? 'text-text-tertiary'
              : 'text-text-primary'
        )}
      >
        {children}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] leading-tight font-medium">
          {label}
        </span>
        <span
          className={cn(
            'block truncate text-[11px]',
            danger ? 'text-danger/80' : 'text-text-tertiary'
          )}
        >
          {hint}
        </span>
      </span>
    </button>
  );
}
