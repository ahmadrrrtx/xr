/**
 * `@file`, `@folder/`, `@file:10-40` references in a prompt.
 *
 * References are resolved against the working directory and may not escape it.
 * File reads are capped per file and per prompt so a stray `@` cannot blow up
 * the context window (Art. XII·3: bounded resources).
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
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
  const attachments: Attachment[] = [];
  const notes: string[] = [];
  let total = 0;

  const addFile = (display: string, abs: string, range?: [number, number]): void => {
    // Secret-looking paths (.env, keys, credential stores) never reach the model.
    if (isSecretPath(abs)) {
      notes.push(`skipped ${display}: looks like a secret file`);
      return;
    }
    const st = statSync(abs);
    // A ranged mention reads only the slice, so the whole-file cap is larger.
    const cap = range ? RANGE_READ_BYTES : MAX_FILE_BYTES;
    if (st.size > cap) {
      notes.push(`skipped ${display}: larger than ${MAX_FILE_BYTES} bytes (use @${display}:start-end)`);
      return;
    }
    let text = readFileSync(abs, "utf8");
    let label = display;
    if (range) {
      const lines = text.split("\n");
      const [s, e] = range;
      text = lines.slice(Math.max(0, s - 1), e).join("\n");
      label = `${display}:${s}-${e}`;
    }
    total += text.length;
    if (total > MAX_TOTAL_BYTES) {
      notes.push(`skipped ${display}: attachment budget exceeded`);
      total -= text.length;
      return;
    }
    attachments.push({ label, content: text, lang: langFor(display) });
  };

  for (const mention of parseMentions(prompt)) {
    const abs = safe(cwd, mention.path);
    if (!abs) {
      notes.push(`skipped @${mention.path}: outside the working directory`);
      continue;
    }
    if (!existsSync(abs)) {
      notes.push(`no such path: @${mention.path}`);
      continue;
    }
    const st = statSync(abs);
    if (mention.kind === "file") {
      if (!st.isFile()) {
        notes.push(`@${mention.path} is not a file (use @${mention.path}/ for a folder)`);
        continue;
      }
      addFile(mention.path, abs, mention.range);
    } else {
      if (!st.isDirectory()) {
        notes.push(`@${mention.path}/ is not a folder`);
        continue;
      }
      const entries = readdirSync(abs)
        .filter((name) => statSync(join(abs, name)).isFile())
        .sort()
        .slice(0, MAX_FOLDER_FILES);
      for (const name of entries) {
        const display = mention.path === "." ? name : `${mention.path}/${name}`;
        addFile(display, join(abs, name));
      }
    }
  }
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
