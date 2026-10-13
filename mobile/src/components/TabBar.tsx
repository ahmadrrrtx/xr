import { motion } from 'framer-motion';
import { MessageCircle, Mic, ShieldCheck, Settings as SettingsIcon } from 'lucide-react';
import { useNav, type TabId } from '../stores/nav';
import { useApprovals, pendingApprovals } from '../stores/approvals';
import { useQueue } from '../stores/queue';
import { haptic } from '../lib/haptics';

const TABS: ReadonlyArray<{ id: TabId; label: string; Icon: typeof MessageCircle }> = [
  { id: 'chat', label: 'Chat', Icon: MessageCircle },
  { id: 'voice', label: 'Voice', Icon: Mic },
  { id: 'approvals', label: 'Approvals', Icon: ShieldCheck },
  { id: 'settings', label: 'Settings', Icon: SettingsIcon },
];

export function TabBar() {
  const tab = useNav((s) => s.tab);
  const setTab = useNav((s) => s.setTab);
  const pending = useApprovals((s) => pendingApprovals(s.items).length);
  const queued = useQueue((s) => s.items.length);

  return (
    <nav
      className="glass shrink-0 border-t border-[var(--border-subtle)] pb-safe"
      aria-label="Primary"
      style={{ boxShadow: '0 -1px 0 0 var(--border-subtle)' }}
    >
      <div className="flex h-[56px] items-stretch px-safe">
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          const badge = id === 'approvals' ? pending : id === 'chat' ? queued : 0;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                haptic('light');
                setTab(id);
              }}
              aria-label={badge > 0 ? `${label}, ${badge} waiting` : label}
              aria-current={active ? 'page' : undefined}
              className="tap relative flex flex-1 flex-col items-center justify-center gap-[3px]"
            >
              <span className="relative">
                <Icon
                  size={23}
                  strokeWidth={1.5}
                  style={{
                    color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                    transition: 'color 180ms ease-out',
                  }}
                  aria-hidden
                />
                {badge > 0 && (
                  <motion.span
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="absolute -right-[9px] -top-[6px] flex min-w-[17px] items-center justify-center rounded-full px-[4px] text-[10px] font-semibold leading-[16px] tabular-nums"
                    style={{
                      background: id === 'chat' ? 'var(--wait)' : 'var(--danger)',
                      color: '#fff',
                    }}
                  >
                    {badge > 99 ? '99+' : badge}
                  </motion.span>
                )}
              </span>
              <span
                className="text-[10px] font-medium tracking-[0.01em]"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-tertiary)',
                  transition: 'color 180ms ease-out',
                }}
              >
                {label}
              </span>
              {active && (
                <motion.span
                  layoutId="tab-dot"
                  className="absolute bottom-[3px] h-[2px] w-6 rounded-full"
                  style={{ background: 'var(--accent)' }}
                  transition={{ type: 'spring', stiffness: 500, damping: 34 }}
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
