/**
 * `@file`, `@folder/`, `@file:10-40` references in a prompt.
 *
 * References are resolved against the working directory and may not escape it.
 * File reads are capped per file and per prompt so a stray `@` cannot blow up
 * the context window (Art. XII·3: bounded resources).
 */

import { FilesystemAuthority, FilesystemError } from "../../security/filesystem.ts";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { isSecretPath } from "../../security/guard.ts";

export const MAX_FILE_BYTES = 200_000;
export const MAX_FOLDER_FILES = 20;
const RANGE_READ_BYTES = 5_000_000;
export const MAX_TOTAL_BYTES = 400_000;

export interface Mention {
  raw: string;
  kind: "file" | "folder";
  path: string;
  range?: [number, number];
}

const MENTION_RE = /(^|\s)@([^\s@]+)/g;

export function parseMentions(prompt: string): Mention[] {
  const out: Mention[] = [];
  for (const m of prompt.matchAll(MENTION_RE)) {
    const raw = m[2] ?? "";
    // Trailing punctuation is part of the sentence, not the path.
    const cleaned = raw.replace(/[),.;:!?]+$/, (tail) => (/^:\d/.test(tail) ? tail : ""));
    if (!cleaned) continue;
    const rangeMatch = /^(.*?):(\d+)(?:-(\d+))?$/.exec(cleaned);
    const path = rangeMatch ? rangeMatch[1]! : cleaned;
    if (!path) continue;
    if (path.endsWith("/")) {
      out.push({ raw: `@${cleaned}`, kind: "folder", path: path.replace(/\/+$/, "") || "." });
      continue;
    }
    const range = rangeMatch
      ? ([Number(rangeMatch[2]), Number(rangeMatch[3] ?? rangeMatch[2])] as [number, number])
      : undefined;
    out.push({ raw: `@${cleaned}`, kind: "file", path, ...(range ? { range } : {}) });
  }
  return out;
}

export interface Attachment {
  label: string;
  content: string;
  lang: string;
}

export interface MentionResult {
  attachments: Attachment[];
  notes: string[];
}

function langFor(path: string): string {
  const ext = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
  return ext;
}

function safe(cwd: string, p: string): string | null {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return abs;
}

/** Resolve mentions to attachment blocks. Unresolvable mentions become notes, never errors. */
export function resolveMentions(cwd: string, prompt: string): MentionResult {
  const attachments: Attachment[] = [], notes: string[] = [];
  let total = 0, fs: FilesystemAuthority | undefined;
  try {
    fs = new FilesystemAuthority(cwd, "context");
    const authority = fs;
    const addFile = (display: string, range?: [number, number]) => {
      if (isSecretPath(display)) { notes.push(`skipped ${display}: looks like a secret file`); return; }
      try {
        let text = authority.read(display, range ? RANGE_READ_BYTES : MAX_FILE_BYTES).content;
        let label = display;
        if (range) { const [start, end] = range; text = text.split("\n").slice(Math.max(0, start - 1), end).join("\n"); label = `${display}:${start}-${end}`; }
        if (total + text.length > MAX_TOTAL_BYTES) { notes.push(`skipped ${display}: attachment budget exceeded`); return; }
        total += text.length;
        attachments.push({ label, content: text, lang: langFor(display) });
      } catch (e) {
        notes.push(e instanceof FilesystemError && e.code === "limit" ? `skipped ${display}: larger than ${MAX_FILE_BYTES} bytes (use a range)` : `skipped ${display}: unavailable or unsafe path`);
      }
    };
    for (const mention of parseMentions(prompt)) {
      if (!safe(cwd, mention.path)) { notes.push(`skipped @${mention.path}: outside the working directory`); continue; }
      try {
        const meta = authority.metadata(mention.path);
        if (mention.kind === "file") {
          if (meta.directory) { notes.push(`@${mention.path} is not a file (use a folder mention)`); continue; }
          addFile(meta.path, mention.range);
        } else {
          for (const entry of authority.list(mention.path, 600).filter(e => !e.directory).slice(0, MAX_FOLDER_FILES)) addFile(entry.path);
        }
      } catch { notes.push(`no such path or unsafe path: @${mention.path}`); }
    }
  } catch { notes.push("file attachments unavailable: filesystem authority unsupported"); }
  finally { fs?.close(); }
  return { attachments, notes };
}

/** Append attachment blocks to the user's prompt for the model. */
export function withAttachments(prompt: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return prompt;
  const blocks = attachments.map(
    (a) => `### ${a.label}\n\`\`\`${a.lang}\n${a.content}\n\`\`\``,
  );
  return `${prompt}\n\n<attached-files>\n${blocks.join("\n\n")}\n</attached-files>`;
}

export function displayRel(cwd: string, abs: string): string {
  return relative(cwd, abs).split(sep).join("/");
}
