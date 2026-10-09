/*
 * Detail panel for one memory. Shows where it came from (engine provenance),
 * lets the user edit it in place, and surfaces sensitive-content warnings.
 * Every change is one PATCH through the store; the engine validates and
 * audits it. Nothing here decides what is allowed.
 */
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryStore } from '@/stores/memoryStore';
import {
  CATEGORY_LABEL,
  EXPIRY_OPTIONS,
  SENSITIVE_LABEL,
  SOURCE_LABEL,
  expiryOptionFor,
  expiryText,
  linkedEntries,
  parseTags,
  relativeTime,
  scopeKind,
  userTags,
  type MemoryView,
  type SensitiveKind,
} from '@/memory/core';
import { describeMemoryError } from '@/memory/api';

interface Props {
  entry: MemoryView;
  all: MemoryView[];
}

const fmt = (ts: number) => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function EntryDetail({ entry, all }: Props) {
  const update = useMemoryStore((s) => s.update);
  const remove = useMemoryStore((s) => s.remove);
  const select = useMemoryStore((s) => s.select);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    content: entry.content,
    tags: userTags(entry.tags).join(', '),
    importance: entry.importance,
    expiresInDays: expiryOptionFor(entry.expiresAt),
  });
  const [saving, setSaving] = useState(false);
  const [needsAck, setNeedsAck] = useState<SensitiveKind[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    draft.content !== entry.content ||
    draft.tags !== userTags(entry.tags).join(', ') ||
    draft.importance !== entry.importance ||
    draft.expiresInDays !== expiryOptionFor(entry.expiresAt);

  const cancel = () => {
    setDraft({
      content: entry.content,
      tags: userTags(entry.tags).join(', '),
      importance: entry.importance,
      expiresInDays: expiryOptionFor(entry.expiresAt),
    });
    setNeedsAck(null);
    setError(null);
    setEditing(false);
  };

  const save = async (acknowledgeSensitive = false) => {
    setSaving(true);
    setError(null);
    let res;
    try {
      res = await update(entry.id, {
        content: draft.content.trim(),
        tags: parseTags(draft.tags),
        importance: draft.importance,
        expiresInDays: draft.expiresInDays,
        ...(acknowledgeSensitive ? { acknowledgeSensitive: true } : {}),
      });
    } catch (e) {
      setSaving(false);
      setError(describeMemoryError(e));
      return;
    }
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      setNeedsAck(null);
      return;
    }
    if (res.reason === 'sensitive') {
      setNeedsAck((res.sensitive ?? []).map((s) => s.kind));
      return;
    }
    setError(res.reason ?? 'Not saved.');
  };

  const linked = linkedEntries(entry, all, 5);
  const scopeLabel = scopeKind(entry.scope) === 'global' ? 'Everywhere' : 'This workspace';

  return (
    <article aria-labelledby="mx-detail-title" className="mx-enter" data-testid="memory-detail">
      {entry.sensitive.length > 0 && (
        <div className="mx-banner" role="alert" style={{ marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <strong>May contain sensitive data.</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {entry.sensitive.map((k) => (
                <li key={k}>{SENSITIVE_LABEL[k]}</li>
              ))}
            </ul>
          </div>
          <Button type="button" size="sm" variant="destructive" onClick={() => void remove(entry.id)}>
            Delete this
          </Button>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="mx-detail-title" style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {CATEGORY_LABEL[entry.category]}
          </h2>
          <div className="mx-item-meta" style={{ marginTop: 6 }}>
            <span className="mx-pill">{scopeLabel}</span>
            <span className="mx-pill">{SOURCE_LABEL[entry.source] ?? entry.source}</span>
            <span className="mx-pill">Importance {entry.importance}/5</span>
            <span className="mx-pill">{expiryText(entry.expiresAt)}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!editing && (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
          )}
          <Button type="button" variant="ghost" size="sm" aria-label="Delete memory" onClick={() => void remove(entry.id)}>
            <Trash2 /> Delete
          </Button>
        </div>
      </header>

      <section className="mx-section" aria-label="Content">
        {editing ? (
          <>
            <label htmlFor="mx-edit-content" className="mx-field" style={{ marginBottom: 4 }}>
              Content {dirty && <span className="mx-hint">· unsaved</span>}
            </label>
            <textarea
              id="mx-edit-content"
              className="mx-textarea"
              rows={5}
              maxLength={2000}
              value={draft.content}
              onChange={(e) => {
                setDraft({ ...draft, content: e.target.value });
                setNeedsAck(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  cancel();
                }
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void save(false);
                }
              }}
            />
            <div className="mx-row-inline" style={{ marginTop: 10 }}>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
                <legend className="mx-field" style={{ padding: 0 }}>
                  Importance
                </legend>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="mx-chip"
                    aria-pressed={draft.importance === n}
                    aria-label={`Importance ${n} of 5`}
                    onClick={() => setDraft({ ...draft, importance: n })}
                    style={{ minWidth: 32, padding: '3px 0' }}
                  >
                    {n}
                  </button>
                ))}
              </fieldset>
              <label className="mx-field" style={{ flex: '1 1 150px' }}>
                Expires
                <select
                  className="mx-select"
                  aria-label="Expiry"
                  value={draft.expiresInDays ?? ''}
                  onChange={(e) => setDraft({ ...draft, expiresInDays: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  {EXPIRY_OPTIONS.map((o) => (
                    <option key={o.label} value={o.value ?? ''}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="mx-field" style={{ marginTop: 10 }}>
              Tags (comma separated)
              <input className="mx-input" value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} />
            </label>
            {needsAck && (
              <div className="mx-banner" role="alert" style={{ marginTop: 10 }}>
                <div style={{ flex: 1 }}>
                  <strong>This may contain sensitive data.</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {needsAck.map((k) => (
                      <li key={k}>{SENSITIVE_LABEL[k]}</li>
                    ))}
                  </ul>
                </div>
                <Button type="button" size="sm" variant="destructive" onClick={() => void save(true)} disabled={saving}>
                  Save anyway
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>
                {error}
              </p>
            )}
            <div className="mx-row-inline" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
              <Button type="button" variant="outline" size="sm" onClick={cancel} disabled={saving}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={() => void save(false)} disabled={!dirty || saving || !draft.content.trim()}>
                Save
              </Button>
            </div>
          </>
        ) : (
          <p style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.55, margin: 0 }} data-testid="memory-content">
            {entry.content}
          </p>
        )}
      </section>

      <section className="mx-section" aria-label="Tags">
        <h3 className="mx-section-title">Tags</h3>
        <div className="mx-tags">
          {userTags(entry.tags).length === 0 && <span className="mx-hint">No tags</span>}
          {userTags(entry.tags).map((t) => (
            <span key={t} className="mx-pill mx-pill-accent">
              {t}
            </span>
          ))}
        </div>
      </section>

      <section className="mx-section" aria-label="Provenance">
        <h3 className="mx-section-title">Where this came from</h3>
        <dl className="mx-kv">
          <dt>Source</dt>
          <dd>{SOURCE_LABEL[entry.source] ?? entry.source}</dd>
          {entry.provenanceKind && (
            <>
              <dt>Recorded as</dt>
              <dd>{entry.provenanceKind}</dd>
            </>
          )}
          {entry.provenanceRef && (
            <>
              <dt>Reference</dt>
              <dd style={{ fontFamily: 'var(--font-mono)', fontSize: 12, wordBreak: 'break-all' }}>{entry.provenanceRef}</dd>
            </>
          )}
          <dt>Scope</dt>
          <dd>{scopeLabel}</dd>
          <dt>Saved</dt>
          <dd>{fmt(entry.createdAt)}</dd>
          <dt>Last edited</dt>
          <dd>{fmt(entry.updatedAt)}</dd>
          <dt>Used in answers</dt>
          <dd>
            {entry.accessCount > 0
              ? `${entry.accessCount} time${entry.accessCount === 1 ? '' : 's'}${entry.lastAccessedAt ? `, last ${relativeTime(entry.lastAccessedAt)}` : ''}`
              : 'Not used yet'}
          </dd>
          <dt>Status</dt>
          <dd>{entry.consentState === 'approved' || entry.consentState === 'legacy_unknown' ? 'Kept' : entry.consentState}</dd>
        </dl>
      </section>

      {linked.length > 0 && (
        <section className="mx-section" aria-label="Related memories">
          <h3 className="mx-section-title">Related</h3>
          <div className="mx-tags">
            {linked.map((l) => (
              <button key={l.id} type="button" className="mx-chip" onClick={() => select(l.id)}>
                {l.content.length > 40 ? `${l.content.slice(0, 39)}…` : l.content}
              </button>
            ))}
          </div>
          <p className="mx-hint">Related means they share a tag.</p>
        </section>
      )}

      {!editing && (
        <p className="mx-hint" style={{ marginTop: 18 }}>
          Edit or delete any time. Deletion is final, except for the 10 seconds after you delete.
        </p>
      )}
    </article>
  );
}
