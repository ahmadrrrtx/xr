/*
 * Attachment strip (Phase 4) — chips above the composer. Images get 40px
 * thumbnails (dataURL preview), docs get a file icon + name + size. Remove X
 * on hover. v1: files are in-memory only; on send they ride along as a text
 * note (no upload — Phase 14+).
 */
import { File as FileIcon, X } from 'lucide-react';

import type { FileAttachment } from '@/stores/chatStore';

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentStrip({
  attachments,
  onRemove,
}: {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-row flex-wrap gap-2" aria-label="Attachments">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="group/att border-border-subtle bg-bg-raised relative flex max-w-xs items-center gap-2 rounded-lg border p-2"
        >
          {a.preview ? (
            <img
              src={a.preview}
              alt=""
              className="size-10 rounded object-cover"
            />
          ) : (
            <FileIcon
              aria-hidden="true"
              className="text-text-tertiary size-5 shrink-0"
              strokeWidth={1.5}
            />
          )}
          <div className="min-w-0 pr-3">
            <div className="text-text-primary truncate text-[13px]">{a.name}</div>
            <div className="text-text-tertiary text-[11px]">{humanSize(a.size)}</div>
          </div>
          <button
            type="button"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.id)}
            className="text-text-tertiary hover:text-text-primary hover:bg-bg-raised absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-border-subtle bg-bg-ink opacity-0 transition-opacity group-hover/att:opacity-100 focus-visible:opacity-100"
          >
            <X aria-hidden="true" className="size-2.5" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}
