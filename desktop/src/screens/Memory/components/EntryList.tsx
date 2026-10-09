/*
 * Left column of the List tab: search, filter chips, and the entries listbox.
 * Filtering and ordering are pure (memory/core.ts); recall ids come from the
 * engine's search and are passed in, never computed here.
 */
import { useState } from 'react';
import { Ban, Brain, Folder, Lightbulb, Search, Star, Trash2, User, Workflow as WorkflowIcon, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  CATEGORY_LABEL,
  SOURCE_LABEL,
  highlightSegments,
  isEntity,
  relativeTime,
  scopeKind,
  summarize,
  type CategoryFilter,
  type MemoryView,
  type ScopeFilter,
} from '@/memory/core';

interface Props {
  entries: MemoryView[];
  all: MemoryView[];
  loading: boolean;
  query: string;
  searchValue: string;
  onSearch: (v: string) => void;
  counts: Record<CategoryFilter, number>;
  expiredHidden: number;
  onShowExpired: () => void;
  hasAny: boolean;
  engineDown: boolean;
}

const CATEGORY_CHIPS: Array<{ id: CategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'preference', label: 'Preferences' },
  { id: 'fact', label: 'Facts' },
  { id: 'project', label: 'Projects' },
  { id: 'workflow', label: 'Workflows' },
  { id: 'entities', label: 'Entities' },
  { id: 'exclusion', label: 'Do not remember' },
];

const SCOPE_CHIPS: Array<{ id: ScopeFilter; label: string }> = [
  { id: 'all', label: 'Any scope' },
  { id: 'workspace', label: 'This workspace' },
  { id: 'global', label: 'Everywhere' },
];

const ICON: Record<string, LucideIcon> = {
  preference: Star,
  fact: Lightbulb,
  project: Folder,
  workflow: WorkflowIcon,
  exclusion: Ban,
};
const ICON_COLOR: Record<string, string> = {
  preference: 'var(--accent)',
  fact: '#A78BFA',
  project: '#60A5FA',
  workflow: '#4ADE80',
  exclusion: 'var(--danger)',
};

export function EntryList(props: Props) {
  const { entries, all, loading, query, searchValue, onSearch, counts, expiredHidden, onShowExpired, hasAny, engineDown } = props;
  const category = useMemoryStore((s) => s.category);
  const scope = useMemoryStore((s) => s.scope);
  const setCategory = useMemoryStore((s) => s.setCategory);
  const setScope = useMemoryStore((s) => s.setScope);
  const selectedId = useMemoryStore((s) => s.selectedId);
  const select = useMemoryStore((s) => s.select);
  const remove = useMemoryStore((s) => s.remove);
  const matching = query.trim().length > 0;

  let emptyText: string | null = null;
  if (!loading && entries.length === 0) {
    if (engineDown) emptyText = 'Memory is unavailable while the engine is offline.';
    else if (matching) emptyText = `No memories match “${query.trim()}”.`;
    else if (!hasAny) emptyText = 'No memories yet. XR only remembers what you ask it to. Type something above to remember it.';
    else emptyText = 'Nothing in this view.';
  }

  return (
    <>
      <div className="mx-search">
        <label htmlFor="mx-search" className="mx-field" style={{ marginBottom: 4 }}>
          Search memory
        </label>
        <div style={{ position: 'relative' }}>
          <Search size={14} aria-hidden style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-tertiary)' }} />
          <input
            id="mx-search"
            type="search"
            className="mx-input"
            style={{ paddingLeft: 30 }}
            placeholder="Search memory… (press /)"
            value={searchValue}
            onChange={(e) => onSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mx-chips" role="group" aria-label="Filter by kind">
        {CATEGORY_CHIPS.map((c) => (
          <button key={c.id} type="button" className="mx-chip" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
            {c.label} <span style={{ opacity: 0.7 }}>{counts[c.id]}</span>
          </button>
        ))}
      </div>
      <div className="mx-chips" role="group" aria-label="Filter by scope" style={{ paddingTop: 0 }}>
        {SCOPE_CHIPS.map((c) => (
          <button key={c.id} type="button" className="mx-chip" aria-pressed={scope === c.id} onClick={() => setScope(c.id)}>
            {c.label}
          </button>
        ))}
      </div>

      {category === 'exclusion' && <ExclusionForm />}

      <p className="mx-hint" aria-live="polite" style={{ padding: '0 14px 4px' }}>
        {loading ? 'Loading…' : `${entries.length} of ${all.length} shown`}
        {expiredHidden > 0 && !loading && (
          <>
            {' · '}
            {expiredHidden} expired hidden{' '}
            <button type="button" className="mx-chip" style={{ marginLeft: 4 }} onClick={onShowExpired}>
              Show
            </button>
          </>
        )}
      </p>

      <div className="mx-list" role="listbox" aria-label="Memories" aria-multiselectable={false}>
        {emptyText && (
          <div className="mx-empty">
            <Brain size={26} aria-hidden />
            <p style={{ margin: 0, maxWidth: '34ch' }}>{emptyText}</p>
          </div>
        )}
        {entries.map((e, i) => {
          const Icon: LucideIcon = isEntity(e) && e.category !== 'exclusion' ? User : ICON[e.category] ?? Lightbulb;
          const selected = e.id === selectedId;
          return (
            <div
              key={e.id}
              id={`mx-item-${e.id}`}
              role="option"
              tabIndex={0}
              aria-selected={selected}
              className="mx-item mx-enter"
              style={{ animationDelay: `${Math.min(i, 12) * 30}ms`, position: 'relative' }}
              onClick={() => select(e.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  select(e.id);
                }
              }}
            >
              <Icon size={16} aria-hidden={true} style={{ color: ICON_COLOR[e.category] ?? 'var(--text-secondary)', marginTop: 2 }} />
              <div style={{ minWidth: 0 }}>
                <div className="mx-item-title">
                  {highlightSegments(summarize(e.content), query).map((seg, j) =>
                    seg.match ? (
                      <mark key={j} className="mx-mark">
                        {seg.text}
                      </mark>
                    ) : (
                      <span key={j}>{seg.text}</span>
                    ),
                  )}
                </div>
                <div className="mx-item-meta">
                  <span className="mx-pill">{CATEGORY_LABEL[e.category]}</span>
                  <span className="mx-pill">{scopeKind(e.scope) === 'global' ? 'Everywhere' : 'This workspace'}</span>
                  <span>{SOURCE_LABEL[e.source] ?? e.source}</span>
                  {e.sensitive.length > 0 && <span className="mx-pill mx-pill-warn">Sensitive</span>}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="mx-item-time">{relativeTime(e.updatedAt)}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete memory: ${summarize(e.content, 40)}`}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    void remove(e.id);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Do-not-remember rules. The engine blocks any future write that contains the phrase (case-insensitive). */
function ExclusionForm() {
  const add = useMemoryStore((s) => s.add);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const rules = useMemoryStore((s) => s.entries).filter((e) => e.category === 'exclusion');
  return (
    <div className="mx-composer" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <p className="mx-hint" style={{ margin: 0 }}>
        XR will not save anything that contains one of these phrases (case-insensitive). Existing memories are not changed.
      </p>
      <form
        className="mx-row-inline"
        onSubmit={async (e) => {
          e.preventDefault();
          const text = phrase.trim();
          if (!text || busy) return;
          setBusy(true);
          const res = await add({ content: text, category: 'exclusion', scope: 'global' });
          setBusy(false);
          if (res.ok) setPhrase('');
        }}
      >
        <input
          className="mx-input"
          style={{ flex: '1 1 160px', width: 'auto' }}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Phrase XR must never remember"
          aria-label="Phrase XR must never remember"
          maxLength={200}
        />
        <Button type="submit" size="sm" variant="outline" disabled={!phrase.trim() || busy}>
          Add rule
        </Button>
      </form>
      {rules.length > 0 && (
        <p className="mx-hint" style={{ margin: 0 }}>
          {rules.length} rule{rules.length === 1 ? '' : 's'}. Select one in the list to remove it.
        </p>
      )}
    </div>
  );
}
