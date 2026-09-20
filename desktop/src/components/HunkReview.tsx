/**
 * HunkReview — the engine's diff of one file, hunk by hunk, with REJECT.
 *
 * "Keep this change, throw that one away." Reject sends the hunk id to the
 * engine, which raises ONE approval whose preview shows exactly that hunk;
 * only after the human approves does git reverse-apply it. Accept is not a
 * button on purpose: the working tree already has the change, and a button
 * that does nothing would be a fake control. Staging lives in the Git card.
 *
 * Every number here is the engine's (files.diff): counts, headers, lines.
 * A stale id (file changed underneath) is a 409 from the engine and the
 * card reloads the truth instead of guessing.
 */

import { useState } from "react";
import { api, type DiffHunk, type FileDiff } from "../api/client";

type Pending = { hunkId: string; phase: "awaiting" | "applying" } | null;

export function HunkReview({
  path,
  diff,
  baseMtimeMs,
  onChanged,
}: {
  path: string | null;
  diff: FileDiff | null;
  baseMtimeMs?: number;
  /** After a revert: the engine's new diff + mtime; the editor buffer must reload from disk. */
  onChanged: (next: { hunks: DiffHunk[]; diff: string; mtimeMs?: number }) => void;
}) {
  const [pending, setPending] = useState<Pending>(null);
  const [note, setNote] = useState<string | null>(null);

  if (!path) return <div className="faint ar-tip">select a file to see its diff</div>;
  if (!diff) return <div className="faint ar-tip">no diff loaded</div>;
  if (!diff.tracked) return <div className="faint ar-tip mono">{path} is untracked — nothing to diff against</div>;
  const hunks = diff.hunks ?? [];
  if (hunks.length === 0) return <div className="faint ar-tip mono">no working-tree changes in {path.split("/").pop()}</div>;

  async function reject(h: DiffHunk) {
    if (pending) return;
    setNote(null);
    setPending({ hunkId: h.id, phase: "awaiting" });
    try {
      const r = await api.hunksRevert(path!, [h.id], baseMtimeMs);
      if (r.applied) {
        setNote(`reverted hunk ${h.index + 1} (−${h.added}/+${h.removed} lines undone)`);
        onChanged({ hunks: r.hunks ?? [], diff: r.diff ?? "", mtimeMs: r.mtimeMs });
      } else {
        setNote(r.stale ? "file changed on disk — diff reloaded, nothing reverted" : `not reverted (${r.decision ?? r.error ?? "denied"})`);
        if (r.stale) {
          const fresh = await api.fileDiff(path!);
          onChanged({ hunks: fresh.hunks ?? [], diff: fresh.diff, mtimeMs: undefined });
        }
      }
    } catch (e) {
      // 409 = stale hunk id or changed file: reload the engine's truth.
      const msg = e instanceof Error ? e.message : String(e);
      if (/^409\b/.test(msg)) {
        setNote("the file changed since this diff was loaded — reloaded, nothing reverted");
        try {
          const fresh = await api.fileDiff(path!);
          onChanged({ hunks: fresh.hunks ?? [], diff: fresh.diff, mtimeMs: undefined });
        } catch { /* engine down: the note stands */ }
      } else {
        setNote(`engine rejected: ${msg}`);
      }
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="hunks" role="list" aria-label={`Hunks in ${path}`}>
      {hunks.map((h) => {
        const isPending = pending?.hunkId === h.id;
        return (
          <div key={h.id} className="hunk" role="listitem" data-pending={isPending || undefined}>
            <div className="hunk-head mono">
              <span className="faint">#{h.index + 1}</span>
              <span className="hunk-range">{h.header.replace(/ @@.*$/, " @@")}</span>
              <span className="chip add">+{h.added}</span>
              <span className="chip rem">−{h.removed}</span>
              <button
                className="chipbtn"
                disabled={pending !== null}
                onClick={() => void reject(h)}
                title="Revert this hunk through the engine (asks for your approval; git reverse-applies it)"
              >
                {isPending ? "awaiting approval…" : "Reject"}
              </button>
            </div>
            <pre className="hunk-body raw">
              {h.lines.map((l, i) => (
                <span key={i} className={l.startsWith("+") ? "dl-add" : l.startsWith("-") ? "dl-rem" : l.startsWith("\\") ? "faint" : undefined}>
                  {l}
                  {"\n"}
                </span>
              ))}
            </pre>
          </div>
        );
      })}
      {note && <div className="faint ar-tip mono" role="status">{note}</div>}
    </div>
  );
}
