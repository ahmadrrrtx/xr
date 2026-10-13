/**
 * Tiny syntax highlighter (~1.5 KB).
 *
 * Deliberately NOT shiki/highlight.js: a trimmed shiki build is 100 KB+ gzipped,
 * which blows the 200 KB mobile budget on its own. We need "readable code on a
 * phone", not a full TextMate grammar engine. Tokens are mapped to theme
 * variables so every one of the 5 themes (light + dark) renders correctly.
 *
 * Covers: ts/js/tsx/jsx, json, bash/sh, python, rust, go, sql, yaml, diff,
 * plain text. Unknown languages fall back to escaped plain text — never wrong,
 * never dangerous (all output is HTML-escaped first).
 */

type Lang = keyof typeof KEYWORDS;

const KEYWORDS = {
  ts: 'abstract as async await break case catch class const constructor continue declare default delete do else enum export extends finally for from function get if implements import in instanceof interface is keyof let new of private protected public readonly return satisfies set static super switch this throw try type typeof var void while yield',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case',
  rs: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  sql: 'select from where insert into values update set delete create table alter drop index join left right inner outer group by order limit offset having as on and or not null distinct union case when then else end',
  sh: 'if then else elif fi for while do done case esac function return in export local echo exit cd source set unset trap',
  yaml: 'true false null yes no',
  json: 'true false null',
} as Record<string, string>;

/** Extra "builtin / type" words that render in the function colour. */
const BUILTINS: Record<string, string> = {
  ts: 'string number boolean any unknown never void object symbol bigint Array Promise Map Set Record Partial Required Readonly console window document Math JSON Date RegExp Error',
  py: 'print len range str int float bool list dict set tuple open enumerate zip map filter sum min max abs type isinstance super Exception self True False None',
  rs: 'String Vec Option Result Box Some None println format todo unwrap expect i32 i64 u32 u64 usize f32 f64 bool char',
  go: 'string int int64 float64 bool byte rune error nil make new len cap append panic recover print println',
  sh: 'npm npx node bun git docker curl sudo apt brew pnpm yarn cargo python pip xr',
};

const ALIAS: Record<string, Lang | 'plain'> = {
  ts: 'ts',
  tsx: 'ts',
  typescript: 'ts',
  js: 'ts',
  jsx: 'ts',
  javascript: 'ts',
  mjs: 'ts',
  json: 'json',
  jsonc: 'json',
  py: 'py',
  python: 'py',
  rs: 'rs',
  rust: 'rs',
  go: 'go',
  sql: 'sql',
  sh: 'sh',
  bash: 'sh',
  zsh: 'sh',
  shell: 'sh',
  console: 'sh',
  yaml: 'yaml',
  yml: 'yaml',
  diff: 'diff',
  patch: 'diff',
  text: 'plain',
  plain: 'plain',
  txt: 'plain',
};

export function languageOf(lang: string | undefined): string {
  if (!lang) return 'plain';
  return ALIAS[lang.toLowerCase()] ?? 'plain';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function keywordSet(lang: string): Set<string> {
  const list = KEYWORDS[lang];
  return new Set(list ? list.split(' ') : []);
}

function builtinSet(lang: string): Set<string> {
  const list = BUILTINS[lang];
  return new Set(list ? list.split(' ') : []);
}

interface Rule {
  re: RegExp;
  cls: string;
}

const RULES: Rule[] = [
  { re: /^\/\*[\s\S]*?\*\/|^\/\/[^\n]*|^#[^\n]*/, cls: 'hl-c' },
  { re: /^(?:r|b|f|rb|rf|fr)?`(?:\\[\s\S]|[^`\\])*`?/, cls: 'hl-s' },
  { re: /^(?:r|b|f|rb|rf|fr)?"(?:\\[\s\S]|[^"\\\n])*"?/, cls: 'hl-s' },
  { re: /^(?:r|b|f|rb|rf|fr)?'(?:\\[\s\S]|[^'\\\n])*'?/, cls: 'hl-s' },
  { re: /^0[xXbBoO][0-9a-fA-F_]+n?|^\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?/, cls: 'hl-n' },
  { re: /^[A-Za-z_$][\w$]*(?=\s*\()/, cls: 'hl-f' },
  { re: /^[A-Za-z_$][\w$]*/, cls: 'hl-w' },
  { re: /^[{}()[\].,;:+\-*/%=<>!&|^~?@]+/, cls: 'hl-p' },
  { re: /^\s+/, cls: '' },
  { re: /^[\s\S]/, cls: '' },
];

/**
 * Highlight a single line of code. Diff lines get whole-line add/del classes
 * (the most useful signal in an approval sheet) and are otherwise left plain.
 */
function highlightLine(line: string, lang: string, kw: Set<string>, bi: Set<string>): string {
  if (lang === 'diff') {
    if (/^\+/.test(line)) return `<span class="hl-add">${escapeHtml(line)}</span>`;
    if (/^-/.test(line)) return `<span class="hl-del">${escapeHtml(line)}</span>`;
    if (/^@@/.test(line)) return `<span class="hl-meta">${escapeHtml(line)}</span>`;
    return `<span class="hl-c">${escapeHtml(line)}</span>`;
  }

  let rest = line;
  let out = '';
  let guard = 0;
  while (rest.length > 0 && guard++ < 4000) {
    let matched = false;
    for (const rule of RULES) {
      const match = rule.re.exec(rest);
      if (!match || match[0].length === 0) continue;
      const token = match[0];
      rest = rest.slice(token.length);
      let cls = rule.cls;
      if (cls === 'hl-w') {
        if (kw.has(token)) cls = 'hl-k';
        else if (bi.has(token)) cls = 'hl-b';
        else cls = '';
      }
      out += cls.length > 0 ? `<span class="${cls}">${escapeHtml(token)}</span>` : escapeHtml(token);
      matched = true;
      break;
    }
    if (!matched) {
      out += escapeHtml(rest.charAt(0));
      rest = rest.slice(1);
    }
  }
  return out;
}

/** Highlight a whole code block → HTML string safe for dangerouslySetInnerHTML. */
export function highlight(code: string, lang?: string): string {
  const resolved = languageOf(lang);
  if (resolved === 'plain') return escapeHtml(code);
  const kw = keywordSet(resolved);
  const bi = builtinSet(resolved);
  return code.split('\n').map((line) => highlightLine(line, resolved, kw, bi)).join('\n');
}

/** Strip markdown code fences from a model response for "copy code". */
export function extractFence(text: string): { lang: string; code: string } | null {
  const match = /```([\w+-]*)\n([\s\S]*?)```/.exec(text);
  if (!match) return null;
  return { lang: match[1] ?? '', code: match[2] ?? '' };
}

/** Pull `path/to/file.ts` references out of assistant text (read-only viewer). */
export function extractFileRefs(text: string): string[] {
  const found = new Set<string>();
  const re = /(?:^|[\s(`'"])((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|json|md|toml|yaml|yml|sh|css|html|sql|rb|java|c|cpp|h))\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const value = match[1];
    if (value) found.add(value);
  }
  return [...found].slice(0, 6);
}
