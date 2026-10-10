/**
 * Syntax highlighting for code blocks. A fixed set of languages keeps the
 * bundle small. highlight.js escapes its own input, and its HTML output is
 * converted into React nodes (see HighlightedCode), never inserted as HTML.
 */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const ALIASES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  html: "xml",
  svg: "xml",
  yml: "yaml",
  toml: "ini",
  rs: "rust",
  md: "markdown",
  "c++": "cpp",
  cc: "cpp",
  patch: "diff",
};

const LANGS: Record<string, Parameters<typeof hljs.registerLanguage>[1]> = {
  bash,
  c,
  cpp,
  css,
  diff,
  go,
  ini,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, mod] of Object.entries(LANGS)) {
  hljs.registerLanguage(name, mod);
}

/** Returns highlight.js HTML for the code, or null when the language is unknown. */
export function highlightToHtml(code: string, lang: string): string | null {
  const name = ALIASES[lang] ?? lang;
  if (!name || !hljs.getLanguage(name)) return null;
  try {
    return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
