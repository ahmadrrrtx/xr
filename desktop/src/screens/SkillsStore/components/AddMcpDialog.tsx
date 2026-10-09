/*
 * Custom MCP server form (Phase 20 §11). Reuses POST /api/mcp/add — the same
 * registry the `xr mcp` CLI writes. Trust stays "unknown" on add: the engine
 * assigns nothing higher, so this form doesn't pretend otherwise.
 */
import { Plus, Trash2, X } from 'lucide-react';
import { useId, useState } from 'react';

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useSkillsStore } from '@/stores/skillsStore';
import type { McpServer } from '@/skills/core';

const TRANSPORTS: Array<{ id: McpServer['transport']; label: string; hint: string }> = [
  { id: 'stdio', label: 'stdio', hint: 'Run a local command and talk over stdin/stdout.' },
  { id: 'sse', label: 'SSE', hint: 'Connect to a remote server over Server-Sent Events.' },
  { id: 'http', label: 'HTTP', hint: 'Connect to a remote JSON-RPC endpoint over HTTP.' },
  { id: 'streamable-http', label: 'Streamable HTTP', hint: 'Connect to a remote streamable-HTTP endpoint.' },
];

function slugify(v: string): string {
  return v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

export function AddMcpDialog() {
  const f = useSkillsStore((s) => s.addMcp);
  const set = useSkillsStore((s) => s.setMcpField);
  const close = useSkillsStore((s) => s.closeAddMcp);
  const submit = useSkillsStore((s) => s.submitAddMcp);
  const [idTouched, setIdTouched] = useState(false);
  const titleId = useId();

  const idValue = f.id || slugify(f.name);
  const idValid = /^[a-z0-9_-]+$/i.test(idValue);
  const isStdio = f.transport === 'stdio';

  return (
    <Dialog open={f.open} onOpenChange={(o) => { if (!o && !f.busy) close(); }}>
      <DialogContent className="sk-dialog" aria-labelledby={titleId} aria-describedby={`${titleId}-d`} data-testid="add-mcp-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle id={titleId} className="sk-h">Add a custom MCP server</DialogTitle>
          <DialogDescription id={`${titleId}-d`} className="sk-sub">
            MCP servers run as separate processes or remote endpoints. XR calls only the tools you approve.
          </DialogDescription>
        </DialogHeader>
        <form
          className="sk-dialog-body"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="sk-field">
            <label className="sk-label" htmlFor="mcp-name">Name</label>
            <input
              id="mcp-name"
              className="sk-input"
              value={f.name}
              onChange={(e) => set({ name: e.target.value, ...(idTouched ? {} : { id: '' }) })}
              placeholder="My filesystem server"
              required
            />
          </div>
          <div className="sk-field">
            <label className="sk-label" htmlFor="mcp-id">ID</label>
            <input
              id="mcp-id"
              className="sk-input"
              value={idValue}
              onChange={(e) => {
                setIdTouched(true);
                set({ id: slugify(e.target.value) });
              }}
              aria-invalid={!idValid}
              aria-describedby="mcp-id-hint"
            />
            <span id="mcp-id-hint" className="sk-hint">{idValid ? 'Letters, digits, - and _ only.' : 'Use letters, digits, - and _ only.'}</span>
          </div>

          <div className="sk-field">
            <span className="sk-label" id="mcp-transport-label">Transport</span>
            <div className="sk-seg" role="group" aria-labelledby="mcp-transport-label">
              {TRANSPORTS.map((t) => (
                <button key={t.id} type="button" aria-pressed={f.transport === t.id} onClick={() => set({ transport: t.id })}>
                  {t.label}
                </button>
              ))}
            </div>
            <span className="sk-hint">{TRANSPORTS.find((t) => t.id === f.transport)?.hint}</span>
          </div>

          {isStdio ? (
            <>
              <div className="sk-field">
                <label className="sk-label" htmlFor="mcp-cmd">Command</label>
                <input id="mcp-cmd" className="sk-input" value={f.command} onChange={(e) => set({ command: e.target.value })} placeholder="npx" spellCheck={false} />
              </div>
              <div className="sk-field">
                <span className="sk-label">Arguments</span>
                {f.args.map((arg, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="sk-input"
                      aria-label={`Argument ${i + 1}`}
                      value={arg}
                      onChange={(e) => set({ args: f.args.map((a, j) => (j === i ? e.target.value : a)) })}
                      spellCheck={false}
                    />
                    <button type="button" className="sk-close" aria-label={`Remove argument ${i + 1}`} onClick={() => set({ args: f.args.filter((_, j) => j !== i) })}>
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
                <div>
                  <button type="button" className="sk-btn sk-btn--ghost" onClick={() => set({ args: [...f.args, ''] })}>
                    <Plus size={14} strokeWidth={1.5} aria-hidden="true" /> Add argument
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="sk-field">
              <label className="sk-label" htmlFor="mcp-url">URL</label>
              <input id="mcp-url" className="sk-input" type="url" value={f.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://example.com/mcp" />
              <span className="sk-hint">Remote servers are subject to XR’s egress allow-list.</span>
            </div>
          )}

          <div className="sk-toggle-row">
            <span>
              Enable on save
              <span className="sk-hint" style={{ display: 'block' }}>Off means it is registered but not started.</span>
            </span>
            <Switch checked={f.enableOnSave} onCheckedChange={(v) => set({ enableOnSave: v })} aria-label="Enable on save" />
          </div>

          <div className="sk-notice" data-tone="warn" role="note" style={{ margin: 0 }}>
            <div className="sk-notice-body">
              <strong>Trust: unknown.</strong> Custom servers start unverified. Pin the tool contract after you review it, and XR will ask you to approve any change to it.
            </div>
          </div>

          {f.lastHealth ? <p className="sk-sub" role="status">Health: {f.lastHealth}</p> : null}
          {f.error ? <p className="sk-error" role="alert" data-testid="mcp-error">{f.error}</p> : null}
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <button type="button" className="sk-btn sk-btn--ghost" disabled={f.busy}>
              <X size={14} strokeWidth={1.5} aria-hidden="true" /> Cancel
            </button>
          </DialogClose>
          <button type="button" className="sk-btn sk-btn--primary" disabled={f.busy || !idValid} onClick={() => void submit()} data-testid="mcp-submit">
            {f.busy ? 'Adding…' : 'Add server'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
