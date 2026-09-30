/*
 * Shiki highlighter (Phase 4) — lazy singleton, fine-grained bundle.
 *
 * One pass, dual themes (github-dark + github-light) with `defaultColor:
 * false`: every token carries `--shiki-light`/`--shiki-dark` CSS vars and a
 * small rule in globals.css maps the active XR theme onto them — theme
 * switching is pure CSS, no re-highlight. The JS regex engine avoids the
 * oniguruma wasm download entirely.
 */
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageInput,
  type ThemeInput,
} from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

const LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'python',
  'rust',
  'go',
  'json',
  'markdown',
  'bash',
  'shell',
  'css',
  'html',
  'sql',
  'yaml',
] as const;

export type SupportedLang = (typeof LANGS)[number];

/** Alias map for fence tags → shiki grammar ids. */
const ALIASES: Record<string, SupportedLang> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'shell',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  html: 'html',
  htm: 'html',
};

export function resolveLang(tag: string | undefined): SupportedLang | 'text' {
  if (!tag) return 'text';
  const key = tag.toLowerCase().trim();
  if ((LANGS as readonly string[]).includes(key)) return key as SupportedLang;
  return ALIASES[key] ?? 'text';
}

/** Static import map — the bundler needs literal specifiers to code-split. */
const LANG_IMPORTS: Record<SupportedLang, () => Promise<{ default: LanguageInput }>> = {
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  rust: () => import('shiki/dist/langs/rust.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  bash: () => import('shiki/dist/langs/bash.mjs'),
  shell: () => import('shiki/dist/langs/shell.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [themes, langMods] = await Promise.all([
      Promise.all([
        import('shiki/dist/themes/github-dark.mjs'),
        import('shiki/dist/themes/github-light.mjs'),
      ]),
      Promise.all(LANGS.map((l) => LANG_IMPORTS[l]())),
    ]);
    const themeInputs: ThemeInput[] = themes.map((t) => t.default);
    const langInputs: LanguageInput[] = langMods.map((m) => m.default);
    return createHighlighterCore({
      themes: themeInputs,
      langs: langInputs,
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return highlighterPromise;
}

/**
 * Highlight to HTML with both palettes baked in as CSS vars. `text` returns
 * null so the caller can render a plain <pre>.
 */
export async function highlightToHtml(
  code: string,
  lang: SupportedLang | 'text',
): Promise<string | null> {
  if (lang === 'text') return null;
  try {
    const hl = await getHighlighter();
    return hl.codeToHtml(code, {
      lang,
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: false,
    });
  } catch {
    return null; // unknown lang / engine hiccup → plain render
  }
}
