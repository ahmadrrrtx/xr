import { useEffect, useMemo, useRef, useState } from "react";
import { api, asList, type SessionSummary, type SkillInfo } from "../api/client";
import type { Area } from "./AppShell";

interface Item { group: string; label: string; hint?: string; run: () => void }

/**
 * Phase 1 · Command Palette — ⌘K / Ctrl+K. Actions (navigation + verbs) plus
 * live engine search (skills index, sessions). Everything executed here is a
 * real navigation or a seeded Work prompt — nothing simulated.
 */
export function Palette({
  open,
  onClose,
  onArea,
  onNewTask,
  onVoice,
  onOnboard,
  onRunSkill,
}: {
  open: boolean;
  onClose: () => void;
  onArea: (a: Area) => void;
  onNewTask: () => void;
  onVoice: () => void;
  onOnboard: () => void;
  onRunSkill: (id: string, name: string) => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [runs, setRuns] = useState<SessionSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setSkills([]); setRuns([]); return; }
    let live = true;
    const t = setTimeout(() => {
      Promise.allSettled([api.skills(term), api.sessions()]).then(([s, r]) => {
        if (!live) return;
        setSkills((s.status === "fulfilled" ? (s.value.skills ?? []) : []).slice(0, 5));
        const all = r.status === "fulfilled" ? asList<SessionSummary>(r.value, "sessions") : [];
        const low = term.toLowerCase();
        setRuns(all.filter((x) => `${x.title ?? ""} ${x.prompt ?? ""}`.toLowerCase().includes(low)).slice(0, 4));
      });
    }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const actions = useMemo<Item[]>(() => {
    const nav: Array<[Area, string]> = [
      ["home", "Go to Home"], ["work", "Go to Work (chat)"], ["workspace", "Go to Workspace (editor)"],
      ["agents", "Go to Multi-agent"], ["runs", "Go to Team runs"], ["library", "Go to Library"],
      ["trust", "Go to Trust Center"], ["voice", "Open Voice mode"], ["settings", "Go to Settings"],
    ];
    const items: Item[] = nav.map(([a, label]) => ({ group: "Go", label, run: () => onArea(a) }));
    items.unshift(
      { group: "Actions", label: "New task", hint: "start a chat task", run: onNewTask },
      { group: "Actions", label: "Toggle voice session", run: onVoice },
      { group: "Actions", label: "Re-run onboarding", run: onOnboard },
    );
    return items;
  }, [onArea, onNewTask, onVoice, onOnboard]);

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const base = term
      ? actions.filter((i) => i.label.toLowerCase().includes(term))
      : actions;
    const skillItems: Item[] = skills.map((s) => ({
      group: "Skills · engine index",
      label: s.name ?? s.id,
      hint: "run in Work",
      run: () => onRunSkill(String(s.id), String(s.name ?? s.id)),
    }));
    const runItems: Item[] = runs.map((r) => ({
      group: "Runs · live sessions",
      label: (r.title || r.prompt?.slice(0, 60) || r.id) as string,
      hint: r.status,
      run: () => onArea("runs"),
    }));
    return [...base, ...skillItems, ...runItems];
  }, [actions, skills, runs, q, onArea, onRunSkill]);

  useEffect(() => { setIdx((i) => Math.min(i, Math.max(0, items.length - 1))); }, [items.length]);

  if (!open) return null;

  const exec = (it: Item) => { it.run(); onClose(); };

  return (
    <div className="pal-veil" onClick={onClose} role="presentation">
      <div className="pal" role="dialog" aria-modal="true" aria-label="Command palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="pal-input"
          placeholder="Type a command or search skills / runs…"
          value={q}
          aria-label="Command palette input"
          onChange={(e) => { setQ(e.target.value); setIdx(0); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, items.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
            if (e.key === "Enter" && items[idx]) { e.preventDefault(); exec(items[idx]); }
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="pal-list" role="listbox" aria-label="Commands">
          {items.length === 0 && <div className="pal-empty faint">no matches — actions, skills and runs are searched live</div>}
          {items.map((it, i) => (
            <div key={`${it.group}-${it.label}-${i}`}>
              {(i === 0 || items[i - 1].group !== it.group) && <div className="pal-h">{it.group}</div>}
              <button
                className={i === idx ? "pal-item on" : "pal-item"}
                role="option"
                aria-selected={i === idx}
                onMouseEnter={() => setIdx(i)}
                onClick={() => exec(it)}
              >
                <span className="pal-label">{it.label}</span>
                {it.hint && <span className="pal-hint faint">{it.hint}</span>}
              </button>
            </div>
          ))}
        </div>
        <div className="pal-foot faint mono">↑↓ navigate · ↵ run · esc close</div>
      </div>
    </div>
  );
}
