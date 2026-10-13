import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, ShieldCheck, Wallet } from 'lucide-react';
import { Screen } from '../components/Screen';
import { PullToRefresh } from '../components/PullToRefresh';
import { Sheet } from '../components/Sheet';
import { CodeBlock } from '../components/CodeBlock';
import { EmptyState, ErrorState, SkeletonRows } from '../components/ui';
import { useApprovals, pendingApprovals, resolvedApprovals } from '../stores/approvals';
import { useConnection } from '../stores/connection';
import { deepLink } from '../main';
import { haptic } from '../lib/haptics';
import { clockTime, money, relativeTime, splitActionTitle } from '../lib/format';
import type { Approval } from '../types';

export function ApprovalsScreen() {
  const items = useApprovals((s) => s.items);
  const loading = useApprovals((s) => s.loading);
  const refreshing = useApprovals((s) => s.refreshing);
  const error = useApprovals((s) => s.error);
  const showResolved = useApprovals((s) => s.showResolved);
  const toggleResolved = useApprovals((s) => s.toggleResolved);
  const load = useApprovals((s) => s.load);
  const refresh = useApprovals((s) => s.refresh);
  const decide = useApprovals((s) => s.decide);
  const status = useConnection((s) => s.status);

  const [detail, setDetail] = useState<Approval | null>(null);
  const offline = status === 'offline';

  useEffect(() => {
    void load().then(() => {
      // Arrived by tapping a push notification → open that approval directly.
      const link = deepLink();
      if (!link.approvalId) return;
      const found = useApprovals.getState().items.find((a) => a.id === link.approvalId);
      if (found) setDetail(found);
    });
    // Cross-surface: a decision made on desktop/Telegram/Discord must show up
    // here too. Poll while connected; push wakes us us the rest of the time.
    const timer = window.setInterval(() => {
      if (useConnection.getState().status === 'connected') void load();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const pending = useMemo(() => pendingApprovals(items), [items]);
  const resolved = useMemo(() => resolvedApprovals(items), [items]);

  const groups = useMemo(() => {
    const map = new Map<string, Approval[]>();
    for (const approval of pending) {
      const list = map.get(approval.workspace) ?? [];
      list.push(approval);
      map.set(approval.workspace, list);
    }
    return [...map.entries()];
  }, [pending]);

  return (
    <Screen title="Approvals">
      <PullToRefresh onRefresh={refresh} refreshing={refreshing}>
        {loading && items.length === 0 ? (
          <SkeletonRows rows={3} />
        ) : error && items.length === 0 ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : pending.length === 0 && resolved.length === 0 ? (
          <EmptyState
            icon={<ShieldCheck size={26} strokeWidth={1.4} />}
            title="Nothing waiting on you"
            detail="When XR wants to run something risky, it asks here first."
          />
        ) : (
          <div className="pb-8">
            {pending.length === 0 ? (
              <p className="px-4 py-6 text-center text-[14px]" style={{ color: 'var(--text-tertiary)' }}>
                No pending approvals.
              </p>
            ) : (
              groups.map(([workspace, list]) => (
                <section key={workspace}>
                  <p
                    className="px-4 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    {workspace}
                  </p>
                  <div className="flex flex-col gap-3 px-3">
                    {list.map((approval) => (
                      <ApprovalCard
                        key={approval.id}
                        approval={approval}
                        offline={offline}
                        onOpen={() => setDetail(approval)}
                        onDecide={(decision) => void decide(approval.id, decision)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}

            {resolved.length > 0 ? (
              <section className="mt-2">
                <button
                  type="button"
                  onClick={() => {
                    haptic('light');
                    toggleResolved();
                  }}
                  aria-expanded={showResolved}
                  className="flex w-full items-center gap-1.5 px-4 py-3"
                  style={{ minHeight: 44 }}
                >
                  {showResolved ? (
                    <ChevronDown size={15} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
                  ) : (
                    <ChevronRight size={15} strokeWidth={1.8} style={{ color: 'var(--text-tertiary)' }} aria-hidden />
                  )}
                  <span
                    className="text-[11px] font-semibold uppercase tracking-[0.06em]"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Resolved ({resolved.length})
                  </span>
                </button>

                {showResolved ? (
                  <ul>
                    {resolved.slice(0, 40).map((approval) => (
                      <li
                        key={approval.id}
                        className="flex items-center justify-between gap-3 px-4 py-[10px]"
                        style={{ borderTop: '1px solid var(--border-subtle)' }}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14.5px]" style={{ color: 'var(--text-secondary)' }}>
                            {approval.title}
                          </p>
                          <p className="text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
                            {relativeTime(approval.resolvedAt ?? approval.createdAt)}
                          </p>
                        </div>
                        <span
                          className="shrink-0 rounded-full px-2 py-[3px] text-[11px] font-medium"
                          style={{
                            color: approval.status === 'approved' ? 'var(--success)' : 'var(--danger)',
                            background:
                              approval.status === 'approved'
                                ? 'color-mix(in srgb, var(--success) 15%, transparent)'
                                : 'color-mix(in srgb, var(--danger) 15%, transparent)',
                          }}
                        >
                          {approval.status === 'approved' ? 'Approved' : 'Denied'}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ) : null}
          </div>
        )}
      </PullToRefresh>

      <Sheet
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.title ?? 'Approval'}
        compact
        footer={
          detail && detail.status === 'pending' ? (
            <DecisionButtons
              offline={offline}
              onDecide={(decision) => {
                void decide(detail.id, decision);
                setDetail(null);
              }}
            />
          ) : undefined
        }
      >
        {detail ? (
          <div className="px-4 pb-4">
            <p className="text-[13.5px] leading-[1.5]" style={{ color: 'var(--text-secondary)' }}>
              {detail.summary}
            </p>

            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12px]">
              <div className="flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
                <Clock size={12} strokeWidth={1.6} aria-hidden />
                {clockTime(detail.createdAt)}
              </div>
              <div style={{ color: 'var(--text-tertiary)' }}>{detail.workspace}</div>
              {detail.budgetCents ? (
                <div className="flex items-center gap-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  <Wallet size={12} strokeWidth={1.6} aria-hidden />
                  ~{money(detail.budgetCents)}
                </div>
              ) : null}
            </dl>

            {detail.diff ? (
              <CodeBlock
                code={detail.diff}
                lang={detail.language ?? 'diff'}
                maxHeight={340}
              />
            ) : (
              <p className="mt-3 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>
                No preview attached to this action.
              </p>
            )}
          </div>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function ApprovalCard({
  approval,
  offline,
  onOpen,
  onDecide,
}: {
  approval: Approval;
  offline: boolean;
  onOpen: () => void;
  onDecide: (decision: 'approve' | 'deny') => void;
}) {
  const { verb, rest } = splitActionTitle(approval.title);

  return (
    <article
      className="overflow-hidden rounded-[14px]"
      style={{
        border: '1px solid var(--border-default)',
        background: 'color-mix(in srgb, var(--bg-ink) 90%, transparent)',
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="w-full px-3.5 pb-3 pt-3 text-left"
        aria-label={`Open approval: ${approval.title}`}
      >
        <h3 className="text-[16px] font-medium leading-[1.3]" style={{ color: 'var(--text-primary)' }}>
          {verb ? <span style={{ color: 'var(--accent)' }}>{verb}</span> : null}
          {verb ? ' ' : null}
          {rest}
        </h3>

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
          <span>{relativeTime(approval.createdAt)}</span>
          <span>{approval.workspace}</span>
          {approval.budgetCents ? <span>~{money(approval.budgetCents)}</span> : null}
        </div>

        {approval.summary ? (
          <p className="mt-2 line-clamp-2 text-[13.5px] leading-[1.45]" style={{ color: 'var(--text-secondary)' }}>
            {approval.summary}
          </p>
        ) : null}
      </button>

      <div className="flex gap-2 px-3.5 pb-3.5">
        <button
          type="button"
          disabled={offline}
          onClick={() => onDecide('approve')}
          aria-label={`Approve ${approval.title}`}
          title={offline ? 'You’re offline — reconnect to approve' : undefined}
          className="tap flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--success)', color: '#04140C', minHeight: 46 }}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={offline}
          onClick={() => onDecide('deny')}
          aria-label={`Deny ${approval.title}`}
          title={offline ? 'You’re offline — reconnect to deny' : undefined}
          className="tap flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
          style={{
            border: '1.5px solid var(--danger)',
            color: 'var(--danger)',
            background: 'transparent',
            minHeight: 46,
          }}
        >
          Deny
        </button>
      </div>

      {offline ? (
        <p className="px-3.5 pb-3 text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
          You’re offline — you can’t approve or deny until reconnected.
        </p>
      ) : null}
    </article>
  );
}

function DecisionButtons({
  offline,
  onDecide,
}: {
  offline: boolean;
  onDecide: (decision: 'approve' | 'deny') => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={offline}
        onClick={() => onDecide('approve')}
        className="tap flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
        style={{ background: 'var(--success)', color: '#04140C', minHeight: 46 }}
      >
        Approve
      </button>
      <button
        type="button"
        disabled={offline}
        onClick={() => onDecide('deny')}
        className="tap flex-1 rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
        style={{ border: '1.5px solid var(--danger)', color: 'var(--danger)', minHeight: 46 }}
      >
        Deny
      </button>
    </div>
  );
}
