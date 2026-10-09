/*
 * Import, "forget everything" and settings. All three act through the store and
 * therefore through the engine. The settings dialog only shows controls that do
 * something today; anything not wired yet is described, not faked.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useMemoryStore } from '@/stores/memoryStore';
import { describeMemoryError } from '@/memory/api';
import { previewImport } from '@/memory/core';
import { toast } from 'sonner';

export function MemoryDialogs() {
  const dialog = useMemoryStore((s) => s.dialog);
  const setDialog = useMemoryStore((s) => s.setDialog);
  return (
    <>
      <ImportDialog open={dialog === 'import'} onOpenChange={(o) => setDialog(o ? 'import' : null)} />
      <ClearDialog open={dialog === 'clear'} onOpenChange={(o) => setDialog(o ? 'clear' : null)} />
      <SettingsDialog open={dialog === 'settings'} onOpenChange={(o) => setDialog(o ? 'settings' : null)} />
    </>
  );
}

async function pickText(): Promise<{ name: string; text: string } | null> {
  const { isTauri } = await import('@/lib/tauri');
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const path = await open({ multiple: false, filters: [{ name: 'XR memory', extensions: ['json'] }] });
      if (!path || Array.isArray(path)) return null;
      return { name: String(path).split(/[\\/]/).pop() ?? 'file', text: await readTextFile(String(path)) };
    } catch {
      /* fall through to the browser picker */
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, text: await f.text() } : null);
    };
    input.click();
  });
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const importText = useMemoryStore((s) => s.importText);
  const existing = useMemoryStore((s) => s.entries.length);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const pre = file ? previewImport(file.text) : null;

  const close = (o: boolean) => {
    if (!o) {
      setFile(null);
      setMode('merge');
      setAck(false);
    }
    onOpenChange(o);
  };

  const run = async () => {
    if (!file || !pre?.ok) return;
    setBusy(true);
    try {
      const res = await importText(file.text, mode);
      if (res) {
        toast('Import finished', {
          description: `${res.added} added${res.skippedSensitive ? ` · ${res.skippedSensitive} sensitive skipped` : ''}`,
        });
        close(false);
      }
    } catch (e) {
      toast.error('Import failed', { description: describeMemoryError(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import memories</DialogTitle>
          <DialogDescription>Choose an XR memory export (.json). Files are checked before anything changes.</DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
          <Button variant="outline" onClick={() => void pickText().then((f) => f && setFile(f))}>
            {file ? `Choose another file (${file.name})` : 'Choose file…'}
          </Button>
          {pre && !pre.ok && (
            <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
              {pre.reason}
            </p>
          )}
          {pre?.ok && (
            <>
              <p style={{ margin: 0 }}>
                {pre.count} memor{pre.count === 1 ? 'y' : 'ies'} found in {file?.name}. Entries that are sensitive, or match a do-not-remember rule, are skipped.
              </p>
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <legend className="mx-field" style={{ padding: 0, marginBottom: 6 }}>
                  How to import
                </legend>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="radio" name="mx-import-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                  <span>
                    <strong>Merge</strong>: add to what you have. Identical memories are not duplicated.
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 8 }}>
                  <input type="radio" name="mx-import-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                  <span>
                    <strong>Replace all</strong>: delete the {existing} memor{existing === 1 ? 'y' : 'ies'} here first. This cannot be undone.
                  </span>
                </label>
              </fieldset>
              {mode === 'replace' && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I understand the current memories will be deleted.</span>
                </label>
              )}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void run()}
            disabled={!pre?.ok || busy || (mode === 'replace' && !ack)}
            variant={mode === 'replace' ? 'destructive' : 'default'}
          >
            {mode === 'replace' ? 'Replace and import' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClearDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const clearAll = useMemoryStore((s) => s.clearAll);
  const count = useMemoryStore((s) => s.entries.length);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const close = (o: boolean) => {
    if (!o) setTyped('');
    onOpenChange(o);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Forget everything</DialogTitle>
          <DialogDescription>
            Type FORGET to delete all memories. This cannot be undone except from an export you made earlier.
          </DialogDescription>
        </DialogHeader>
        <p style={{ fontSize: 13, margin: 0 }}>
          {count} memor{count === 1 ? 'y' : 'ies'} will be removed from this device. Do-not-remember rules are removed too.
        </p>
        <label className="mx-field">
          Type FORGET to confirm
          <input className="mx-input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-describedby="mx-forget-hint" />
        </label>
        <p id="mx-forget-hint" className="mx-hint" style={{ margin: 0 }}>
          Export first if you may want these back.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={typed !== 'FORGET' || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const removed = await clearAll();
                toast('Forgotten', { description: `${removed} memor${removed === 1 ? 'y' : 'ies'} deleted.` });
                close(false);
              } catch (e) {
                toast.error('Not deleted', { description: describeMemoryError(e) });
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete all memories
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const showExpired = useMemoryStore((s) => s.showExpired);
  const setShowExpired = useMemoryStore((s) => s.setShowExpired);
  const setDialog = useMemoryStore((s) => s.setDialog);
  const setCategory = useMemoryStore((s) => s.setCategory);
  const exportAll = useMemoryStore((s) => s.exportAll);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Memory settings</DialogTitle>
          <DialogDescription>Local-first. Everything here changes only this device.</DialogDescription>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, fontSize: 13 }}>
          <section>
            <h3 className="mx-section-title" style={{ margin: 0 }}>
              Automatic memories
            </h3>
            <p style={{ margin: '6px 0 0' }}>
              <strong>Off.</strong> XR saves only what you ask it to remember. Suggestions from conversations are not available in this version.
            </p>
          </section>
          <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <span>
              <strong>Show expired memories</strong>
              <br />
              <span className="mx-hint">Expired memories are hidden from recall either way. Turning this on only shows them here.</span>
            </span>
            <Switch checked={showExpired} onCheckedChange={(v) => void setShowExpired(v)} aria-label="Show expired memories" />
          </label>
          <section>
            <h3 className="mx-section-title" style={{ margin: 0 }}>
              Sensitive data
            </h3>
            <p style={{ margin: '6px 0 0' }}>
              New and edited memories are checked for card numbers, social security numbers, API keys and private keys before they are saved. Checks run on this device.
            </p>
          </section>
          <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 className="mx-section-title" style={{ margin: 0 }}>
              Your data
            </h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button variant="outline" size="sm" onClick={() => void exportAll()}>
                Export JSON
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDialog('import');
                }}
              >
                Import…
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setCategory('exclusion');
                  onOpenChange(false);
                }}
              >
                Do-not-remember rules
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setDialog('clear')}>
                Forget everything…
              </Button>
            </div>
          </section>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
