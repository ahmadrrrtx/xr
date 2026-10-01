/*
 * Settings (Phase 8) — the macOS System Settings-style two-pane preference
 * pane (SCREEN 14). Left: 180px category sidebar with search + groups.
 * Right: scrollable 720px content with a calm 80ms tab transition.
 *
 * The active tab lives in the URL hash (`/settings#appearance`) so deep
 * links work and Cmd+R stays on the same tab. `flush` routing (AppShell)
 * gives this screen the full content height.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  Bell,
  Cpu,
  Info,
  Keyboard,
  Mic,
  Palette,
  RefreshCw,
  Settings2,
  Shield,
  type LucideIcon,
} from 'lucide-react';

import { SearchInput } from '@/components/settings/controls';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AboutTab } from './tabs/AboutTab';
import { AppearanceTab } from './tabs/AppearanceTab';
import { GeneralTab } from './tabs/GeneralTab';
import { ModelsTab } from './tabs/ModelsTab';
import { NotificationsTab } from './tabs/NotificationsTab';
import { PrivacyTab } from './tabs/PrivacyTab';
import { ShortcutsTab } from './tabs/ShortcutsTab';
import { UpdatesTab } from './tabs/UpdatesTab';
import { VoiceTab } from './tabs/VoiceTab';

export type SettingsTabId =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'models'
  | 'shortcuts'
  | 'voice'
  | 'privacy'
  | 'updates'
  | 'about';

type GroupId = 'account' | 'app' | 'preferences' | 'privacy' | 'system';

interface TabDef {
  id: SettingsTabId;
  icon: LucideIcon;
  labelKey: string;
  group: GroupId;
  subtitle: string;
}

const TABS: readonly TabDef[] = [
  { id: 'general', icon: Settings2, labelKey: 'tab.general', group: 'account', subtitle: '' },
  { id: 'appearance', icon: Palette, labelKey: 'tab.appearance', group: 'app', subtitle: 'Change how XR looks and feels.' },
  { id: 'notifications', icon: Bell, labelKey: 'tab.notifications', group: 'app', subtitle: 'Choose what XR tells you about, and when.' },
  { id: 'models', icon: Cpu, labelKey: 'tab.models', group: 'preferences', subtitle: 'Connect providers and pick the models XR uses.' },
  { id: 'shortcuts', icon: Keyboard, labelKey: 'tab.shortcuts', group: 'preferences', subtitle: 'Rebind every chord to your hands.' },
  { id: 'voice', icon: Mic, labelKey: 'tab.voice', group: 'preferences', subtitle: 'Microphone, speech and push-to-talk.' },
  { id: 'privacy', icon: Shield, labelKey: 'tab.privacy', group: 'privacy', subtitle: 'Local-first by design. You decide what leaves the machine.' },
  { id: 'updates', icon: RefreshCw, labelKey: 'tab.updates', group: 'system', subtitle: 'Keep XR current.' },
  { id: 'about', icon: Info, labelKey: 'tab.about', group: 'system', subtitle: 'The AI agent you can actually trust.' },
];

const GROUP_ORDER: readonly GroupId[] = [
  'account',
  'app',
  'preferences',
  'privacy',
  'system',
];

function tabById(id: SettingsTabId): TabDef {
  return TABS.find((tab) => tab.id === id) ?? TABS[0];
}

/** One sidebar category row — 32px, 10px radius, 3px accent bar when active. */
function SidebarRow({
  tab,
  label,
  active,
  onSelect,
}: {
  tab: TabDef;
  label: string;
  active: boolean;
  onSelect: (id: SettingsTabId) => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(tab.id)}
      className={cn(
        'focus-visible:ring-accent/50 relative flex h-8 w-full items-center gap-2 rounded-[10px] px-2 text-left text-[13px] outline-none transition-colors duration-150 focus-visible:ring-2',
        active
          ? 'bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-accent'
          : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
      )}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="bg-accent absolute top-1/2 left-0 h-[18px] w-[3px] -translate-y-1/2 rounded-r-[3px]"
        />
      ) : null}
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

export default function SettingsScreen() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement>(null);

  const hashCandidate = location.hash.replace('#', '') as SettingsTabId;
  const active = TABS.some((tab) => tab.id === hashCandidate)
    ? hashCandidate
    : 'general';
  const activeDef = tabById(active);

  // Keep the hash in sync (deep links, reload persistence) without history spam.
  useEffect(() => {
    if (location.hash !== `#${active}`) {
      navigate(`/settings#${active}`, { replace: true });
    }
  }, [active, location.hash, navigate]);

  // Search: simple case-insensitive includes over the (translated) labels.
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TABS;
    return TABS.filter((tab) =>
      t(tab.labelKey).toLowerCase().includes(needle)
    );
  }, [query, t]);

  // Arrow-key navigation across the visible (flat) tab order.
  const onTablistKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const order = filtered.map((tab) => tab.id);
    const index = order.indexOf(active);
    const next =
      event.key === 'ArrowDown'
        ? order[(index + 1) % order.length]
        : order[(index - 1 + order.length) % order.length];
    if (next) navigate(`/settings#${next}`);
  };

  return (
    <div className="flex h-full min-h-0">
      <nav
        aria-label="Settings"
        className="border-border-subtle bg-bg-ink/60 flex w-[180px] shrink-0 flex-col border-r p-2"
      >
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={t('settings.search')}
          id="xr-settings-search"
          className="mb-1.5"
        />
        <div
          ref={listRef}
          role="tablist"
          aria-orientation="vertical"
          aria-label="Settings categories"
          onKeyDown={onTablistKeyDown}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {GROUP_ORDER.map((group) => {
            const tabs = filtered.filter((tab) => tab.group === group);
            if (tabs.length === 0) return null;
            return (
              <div key={group} className="mb-1.5 last:mb-0">
                <div className="text-text-tertiary px-2 pt-2.5 pb-1 text-[11px] font-medium tracking-[0.08em] uppercase">
                  {t(`group.${group}`)}
                </div>
                {tabs.map((tab) => (
                  <SidebarRow
                    key={tab.id}
                    tab={tab}
                    label={t(tab.labelKey)}
                    active={tab.id === active}
                    onSelect={(id) => navigate(`/settings#${id}`)}
                  />
                ))}
              </div>
            );
          })}
          {filtered.length === 0 ? (
            <p className="text-text-tertiary px-2 py-3 text-xs">
              No matching settings.
            </p>
          ) : null}
        </div>
      </nav>

      <div className="bg-bg-void min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={active}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.08 },
                default: { type: 'spring', stiffness: 300, damping: 26 },
              }}
            >
              <header>
                {active === 'general' ? (
                  <h1 className="text-text-primary text-[24px] font-semibold">
                    {t('tab.general') === 'General' ? 'Settings' : t('tab.general')}
                  </h1>
                ) : (
                  <>
                    <h1 className="text-text-primary text-[24px] font-semibold">
                      {t(activeDef.labelKey)}
                    </h1>
                    <p className="text-text-tertiary mt-1 text-[13px]">
                      {activeDef.subtitle}
                    </p>
                  </>
                )}
              </header>
              <div className="mt-6">
                {active === 'general' ? <GeneralTab /> : null}
                {active === 'appearance' ? <AppearanceTab /> : null}
                {active === 'notifications' ? <NotificationsTab /> : null}
                {active === 'models' ? <ModelsTab /> : null}
                {active === 'shortcuts' ? <ShortcutsTab /> : null}
                {active === 'voice' ? <VoiceTab /> : null}
                {active === 'privacy' ? <PrivacyTab /> : null}
                {active === 'updates' ? <UpdatesTab /> : null}
                {active === 'about' ? <AboutTab /> : null}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
