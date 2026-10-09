/*
 * "Remember…" composer — the only way to add a memory by hand. Explicit by
 * default: nothing is saved until the user presses Remember. Sensitive content
 * stops here with a warning the user must acknowledge; the engine decides
 * whether the text is sensitive and whether it matches a do-not-remember rule.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMemoryStore } from '@/stores/memoryStore';
import { EXPIRY_OPTIONS, SENSITIVE_LABEL, parseTags, type SensitiveKind } from '@/memory/core';

type ScopeChoice = 'workspace' | 'global';

export function QuickAdd() {
  const add = useMemoryStore((s) => s.add);
  const [content, setContent] = useState('');
  const [tagText, setTagText] = useState('');
  const [scope, setScope] = useState<ScopeChoice>('workspace');
  const [category, setCategory] = useState<'fact' | 'preference' | 'project' | 'workflow'>('fact');
  const [importance, setImportance] = useState(3);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ kinds: SensitiveKind[] } | null>(null);

  const submit = async (acknowledgeSensitive = false) => {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    const res = await add({
      content: text,
      category,
      scope,
      tags: parseTags(tagText),
      importance,
      expiresInDays,
      ...(acknowledgeSensitive ? { acknowledgeSensitive: true } : {}),
    });
    setBusy(false);
    if (res.ok) {
      setContent('');
      setTagText('');
      setPending(null);
      return;
    }
    if (res.reason === 'sensitive') {
      setPending({ kinds: (res.sensitive ?? []).map((s) => s.kind) });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit(false);
    }
  };

  return (
    <form
      className="mx-composer"
      aria-label="Remember something"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      <label className="mx-field" htmlFor="mx-composer">
        Remember…
      </label>
      <textarea
        id="mx-composer"
        className="mx-textarea"
        rows={2}
        value={content}
        placeholder="e.g. “I prefer Vim bindings when editing”"
        onChange={(e) => {
          setContent(e.target.value);
          if (pending) setPending(null);
        }}
        onKeyDown={onKeyDown}
        maxLength={2000}
        aria-describedby="mx-composer-hint"
      />
      <div className="mx-row-inline">
        <label className="mx-field" style={{ flex: '1 1 110px' }}>
          Where
          <select className="mx-select" value={scope} onChange={(e) => setScope(e.target.value as ScopeChoice)} aria-label="Scope">
            <option value="workspace">This workspace</option>
            <option value="global">Everywhere (global)</option>
          </select>
        </label>
        <label className="mx-field" style={{ flex: '1 1 100px' }}>
          Kind
          <select className="mx-select" value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="Kind">
            <option value="fact">Fact</option>
            <option value="preference">Preference</option>
            <option value="project">Project</option>
            <option value="workflow">Workflow</option>
          </select>
        </label>
        <label className="mx-field" style={{ flex: '1 1 110px' }}>
          Expires
          <select
            className="mx-select"
            value={expiresInDays ?? ''}
            onChange={(e) => setExpiresInDays(e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Expiry"
          >
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.label} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mx-row-inline">
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', gap: 4, alignItems: 'center' }}>
          <legend className="mx-field" style={{ padding: 0 }}>
            Importance
          </legend>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className="mx-chip"
              aria-pressed={importance === n}
              aria-label={`Importance ${n} of 5`}
              onClick={() => setImportance(n)}
              style={{ minWidth: 32, padding: '3px 0' }}
            >
              {n}
            </button>
          ))}
        </fieldset>
        <input
          className="mx-input"
          style={{ flex: '1 1 140px', width: 'auto' }}
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="Tags, comma separated"
          aria-label="Tags"
        />
        <Button type="submit" size="sm" disabled={!content.trim() || busy} data-testid="remember-submit">
          <Plus /> Remember
        </Button>
      </div>
      <p id="mx-composer-hint" className="mx-hint">
        Saved on this device only. Enter saves; Shift+Enter adds a line.
      </p>
      {pending && (
        <div className="mx-banner" role="alert">
          <div style={{ flex: 1 }}>
            <strong>This may contain sensitive data.</strong>
            <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
              {pending.kinds.map((k) => (
                <li key={k}>{SENSITIVE_LABEL[k]}</li>
              ))}
            </ul>
            <p className="mx-hint" style={{ marginTop: 6 }}>
              Keeping it means it stays on this device until you delete it. Consider saving only the part you need to recall.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Button type="button" size="sm" variant="destructive" onClick={() => void submit(true)} disabled={busy}>
              Save anyway
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}
