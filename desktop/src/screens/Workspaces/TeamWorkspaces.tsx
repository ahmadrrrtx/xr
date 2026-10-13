/*
 * Workspaces → Team section (Phase 30 · §D).
 *
 * Shared workspaces are a different kind of object from the local workspaces in
 * the grid above: they live on a server, they are owned by an organization, and
 * they hold facts other people can see. Presenting them in the same grid would
 * invite exactly the mistake the whole team-memory design is built to prevent —
 * assuming a shared thing is local, or a local thing is shared.
 *
 * So they get their own section, their own visual language (a cyan rule rather
 * than a card border), and a heading that says where they live. It renders
 * **only when the team tier is active**: a Personal user sees nothing here, not
 * an empty state inviting them to upgrade. The upgrade lives in one place —
 * Settings → Billing & Account — and this is not that place.
 */
import { useCallback, useEffect, useState } from 'react';
import { Cloud, Loader2, Lock, RefreshCw, Users } from 'lucide-react';

import { engineJson } from '@/engine/transport';

interface TeamWorkspace {
  id: string;
  name: string;
  slug: string;
  memoryVisibility: string;
  ownerId: string;
  createdAt: string;
}

interface TeamWorkspacesView {
  available: boolean;
  reason?: string;
  repair?: string;
  orgId?: string;
  orgName?: string | null;
  workspaces?: TeamWorkspace[];
}

export function TeamWorkspaces({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [view, setView] = useState<TeamWorkspacesView | null>(null);
  const [loading, setLoading] = useState(true);

  // Written as a continuation rather than an `async` function the effect calls
  // straight away. A body like `setLoading(true); await fetch()` puts a setState
  // in the effect's own frame — the cascading render `set-state-in-effect`
  // exists to catch — and the linter cannot see past a bare `await` to prove
  // otherwise. Here every setState is inside a callback, so the effect only ever
  // starts the request.
  const load = useCallback((): Promise<void> => {
    return engineJson<TeamWorkspacesView>('/cloud/team-workspaces')
      .then((next) => setView(next))
      .catch(() => {
        // The engine link is down. That is not a team problem, and it is not
        // something to report here — the Workspaces screen already surfaces a
        // failed engine. Stay silent rather than inventing an error.
        setView({ available: false });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Nothing at all for Personal: no empty state, no invitation, no card.
  if (!loading && !view?.available) return null;

  if (loading) {
    return (
      <div className="text-text-tertiary mt-8 flex items-center gap-2 px-1 text-[12px]">
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
        Checking for team workspaces…
      </div>
    );
  }

  const workspaces = view?.workspaces ?? [];

  return (
    <section aria-labelledby="team-workspaces-heading" className="mt-9">
      <div className="border-accent/25 mb-3 flex items-center gap-2 border-l-2 pl-3">
        <Users size={14} className="text-accent" aria-hidden="true" />
        <h2 id="team-workspaces-heading" className="text-[13px] font-medium">
          Team workspaces
        </h2>
        <span className="text-text-tertiary text-[11.5px]">
          {view?.orgName ? `· ${view.orgName}` : ''}
        </span>
        <button
          type="button"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          className="text-text-tertiary hover:text-text-secondary ml-auto flex cursor-pointer items-center gap-1 text-[11.5px]"
        >
          <RefreshCw size={12} strokeWidth={1.5} aria-hidden="true" />
          Refresh
        </button>
      </div>

      <p className="text-text-tertiary mb-3 pl-3 text-[11.5px] leading-relaxed">
        Shared with your organization and stored on the XR service. Memory written here is
        visible to everyone in the team; anything you write in a local workspace stays on this
        machine and is never uploaded.
      </p>

      {workspaces.length === 0 ? (
        <div className="border-border-subtle text-text-tertiary rounded-xl border border-dashed px-4 py-6 text-center text-[12px]">
          No team workspaces yet. An owner or admin can create one from{' '}
          <button
            type="button"
            onClick={onOpenSettings}
            className="text-accent cursor-pointer underline decoration-dotted underline-offset-2"
          >
            Billing &amp; Account
          </button>{' '}
          — or from the web console.
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {workspaces.map((ws) => (
            <li
              key={ws.id}
              className="border-border-subtle bg-bg-ink hover:bg-bg-raised/60 flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors"
            >
              <Cloud size={14} className="text-accent/80 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium">{ws.name}</div>
                <div className="text-text-tertiary truncate font-mono text-[11px]">{ws.slug}</div>
              </div>
              <span className="text-text-tertiary ml-auto flex shrink-0 items-center gap-1.5 text-[11.5px]">
                {ws.memoryVisibility === 'private' ? (
                  <>
                    <Lock size={12} strokeWidth={1.5} aria-hidden="true" />
                    Private to one member
                  </>
                ) : (
                  <>
                    <Users size={12} strokeWidth={1.5} aria-hidden="true" />
                    Team
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {view?.reason ? (
        // A spoken reason when a team exists but the cloud is unreachable, so the
        // section does not simply vanish and leave someone wondering whether they
        // were removed from their own team.
        <p className="text-text-tertiary mt-2 pl-3 text-[11.5px]">{view.reason}</p>
      ) : null}
    </section>
  );
}
