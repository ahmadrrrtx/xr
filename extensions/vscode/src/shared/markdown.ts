/**
 * A small, safe markdown model for chat answers.
 *
 * The webview renders this tree with React elements, never with innerHTML, so
 * model output cannot inject markup. Supported: fenced code, headings, bullet
 * and numbered lists, paragraphs, **strong**, *emphasis*, `code`, [links](url)
 * and file references (`path/to/file.ts:42`). Anything else stays plain text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "fileref"; path: string; line: number };

export type Block =
  | { type: "code"; lang: string; code: string; open: boolean }
  | { type: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "paragraph"; children: Inline[] };

/** Extensions that count as a source file reference. Keeps `host:8080` out. */
const SOURCE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "rs", "go", "java", "kt", "swift", "rb", "php",
  "c", "h", "cc", "cpp", "hpp", "cs", "sh", "bash", "zsh", "json", "yaml", "yml", "toml", "md",
  "css", "scss", "html", "vue", "svelte", "sql", "lua", "dart", "ex", "exs", "hs", "ml", "scala",
]);

const FILEREF_RE = /(?<![\w/.-])((?:[\w.-]+\/)*[\w-][\w.-]*\.([A-Za-z]{1,5})):(\d{1,7})(?::\d{1,5})?(?![\w])/g;

/** Returns a file reference when the whole string is `path:line`, else null. */
export function parseFileRef(text: string): { path: string; line: number } | null {
  const m = /^((?:[\w.-]+\/)*[\w-][\w.-]*\.([A-Za-z]{1,5})):(\d{1,7})(?::\d{1,5})?$/.exec(text.trim());
  if (!m || !SOURCE_EXT.has(m[2].toLowerCase())) return null;
  const line = Number(m[3]);
  if (!Number.isSafeInteger(line) || line < 1) return null;
  return { path: m[1], line };
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^\s*```\s*([\w+#.-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        if (/^\s*```\s*$/.test(lines[i])) {
          closed = true;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", lang: fence[1].toLowerCase(), code: body.join("\n"), open: !closed });
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2]) });
      i++;
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = !bullet;
      const itemRe = ordered ? /^\s*\d{1,3}[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = itemRe.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^\s*```/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d{1,3}[.)]\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.join("\n")) });
  }

  return blocks;
}

/** Inline parser: code spans, strong, emphasis, links, file references. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push(...splitFileRefs(buf));
      buf = "";
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        const inner = text.slice(i + 1, end);
        const ref = parseFileRef(inner);
        out.push(ref ? { type: "fileref", ...ref } : { type: "code", text: inner });
        i = end + 1;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] === "*") {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: "strong", children: parseInline(text.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (ch === "*" && text[i + 1] !== " " && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && text[end - 1] !== " ") {
        flush();
        out.push({ type: "em", children: parseInline(text.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/.exec(text.slice(i));
      if (m) {
        flush();
        out.push({ type: "link", href: m[2], children: [{ type: "text", text: m[1] }] });
        i += m[0].length;
        continue;
      }
    }

    buf += ch;
    i++;
  }
  flush();
  return out;
}

/** Split plain text into text and file-reference nodes. */
export function splitFileRefs(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  FILEREF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FILEREF_RE.exec(text)) !== null) {
    if (!SOURCE_EXT.has(m[2].toLowerCase())) continue;
    const line = Number(m[3]);
    if (!Number.isSafeInteger(line) || line < 1) continue;
    if (m.index > last) out.push({ type: "text", text: text.slice(last, m.index) });
    out.push({ type: "fileref", path: m[1], line });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", text: text.slice(last) });
  return out;
}

/** Plain-text view of inline nodes (used for copy and tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.text;
        case "fileref":
          return `${n.path}:${n.line}`;
        case "strong":
        case "em":
        case "link":
          return inlineText(n.children);
      }
    })
    .join("");
}
