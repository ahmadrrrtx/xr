/*
 * QuickOpen (⌘P) + BuilderPalette (⌘⇧P) — Phase 17.
 *
 * Both are cmdk dialogs. Quick Open ranks the project's file list with the
 * pure fuzzy matcher (builderCore); the palette lists Builder commands with
 * their shortcuts. Neither one owns state: they call store actions.
 */
import { useMemo, useState } from 'react';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { basenameOf, dirnameOf, fileIconFor, rankFiles } from '@/lib/builderCore';
import { useBuilderStore } from '@/stores/builderStore';

function Shell({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description: string; children: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 overflow-hidden p-0 sm:max-w-[560px]">
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function QuickOpen({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const tree = useBuilderStore((s) => s.tree);
  const mru = useBuilderStore((s) => s.mru);
  const [query, setQuery] = useState('');
  const files = useMemo(() => tree.filter((e) => e.type === 'file').map((e) => e.rel), [tree]);
  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      const recent = mru.filter((p) => files.includes(p)).slice(0, 12);
      const rest = files.filter((p) => !recent.includes(p)).slice(0, 30);
      return [...recent, ...rest].map((path) => ({ path, positions: [] as number[] }));
    }
    return rankFiles(q, files, 40).map((r) => ({ path: r.path, positions: r.hit.positions }));
  }, [files, mru, query]);

  const pick = (path: string) => {
    onOpenChange(false);
    setQuery('');
    void useBuilderStore.getState().openFile(path, { pin: true });
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Quick open" description="Type to search files in this project">
      <Command shouldFilter={false} label="Quick open">
        <CommandInput value={query} onValueChange={setQuery} placeholder="Search files by name…" autoFocus />
        <CommandList className="max-h-[360px]">
          <CommandEmpty>No matching files.</CommandEmpty>
          <CommandGroup heading={query ? 'Files' : 'Recent'}>
            {results.map((r) => {
              const icon = fileIconFor(r.path);
              const dir = dirnameOf(r.path);
              return (
                <CommandItem key={r.path} value={r.path} onSelect={() => pick(r.path)} className="gap-2 text-[12.5px]">
                  <span className="xb-glyph" style={{ color: icon.color }} aria-hidden="true">
                    {icon.glyph}
                  </span>
                  <span className="xb-qo-path">
                    <Highlighted text={basenameOf(r.path)} positions={r.positions.map((p) => p - (r.path.length - basenameOf(r.path).length)).filter((p) => p >= 0)} />
                  </span>
                  {dir ? <span className="xb-qo-dir">{dir}</span> : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </Command>
    </Shell>
  );
}

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (!positions.length) return <>{text}</>;
  const set = new Set(positions);
  return (
    <>
      {Array.from(text, (ch, i) => (set.has(i) ? <mark key={i}>{ch}</mark> : <span key={i}>{ch}</span>))}
    </>
  );
}

export interface BuilderCommand {
  id: string;
  title: string;
  shortcut?: string;
  group: string;
  run: () => void;
  disabled?: boolean;
}

export function BuilderPalette({ open, onOpenChange, commands }: { open: boolean; onOpenChange: (o: boolean) => void; commands: BuilderCommand[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, BuilderCommand[]>();
    for (const c of commands) m.set(c.group, [...(m.get(c.group) ?? []), c]);
    return [...m.entries()];
  }, [commands]);
  return (
    <Shell open={open} onOpenChange={onOpenChange} title="Builder commands" description="Builder actions and their shortcuts">
      <Command label="Builder commands">
        <CommandInput placeholder="Builder command…" autoFocus />
        <CommandList className="max-h-[380px]">
          <CommandEmpty>No matching command.</CommandEmpty>
          {groups.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((c) => (
                <CommandItem
                  key={c.id}
                  value={`${group} ${c.title}`}
                  disabled={c.disabled}
                  onSelect={() => {
                    onOpenChange(false);
                    c.run();
                  }}
                  className="text-[12.5px]"
                >
                  <span>{c.title}</span>
                  {c.shortcut ? <span className="text-text-tertiary ml-auto font-mono text-[11px]">{c.shortcut}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </Shell>
  );
}
