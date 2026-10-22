/**
 * XR-LAUNCH-031 — a small POSIX-style word splitter for the ADVISORY
 * secret-path heuristic in guard.ts.
 *
 * This is not a shell. It never expands, globs or executes anything. It only
 * does what a shell does to quoting before a command sees its arguments:
 *   · removes quotes and backslash escapes, so `~/.n''etrc`, `~/.s""sh/x` and
 *     `~/.a\ws/x` are seen as the paths the shell would actually open;
 *   · splits on unquoted whitespace and the control/redirect operators
 *     (`|`, `&`, `;`, `<`, `>`, `(`, `)`), so `echo x > ~/.npmrc` yields the
 *     word `~/.npmrc` instead of treating the whole command as one "path";
 *   · drops `# comments`;
 *   · marks words that contain something it cannot evaluate (`$VAR`, `$(…)`,
 *     backticks, globs, braces) as `dynamic`.
 *
 * Dynamic words are still checked as written (`$HOME/.netrc` still ends in
 * `/.netrc`), but a command can always hide a path from a static check
 * (`cat ~/.ne*`, `cat "$(printf …)"`). The heuristic is therefore advisory:
 * the boundary for shell commands is the OS sandbox (src/runtime/trust/**),
 * not this file.
 */

export interface ShellWord {
  /** The word after quote removal. */
  text: string;
  /** True when the word contains an expansion or glob this splitter cannot evaluate. */
  dynamic: boolean;
}

const OPERATORS = new Set(["|", "&", ";", "<", ">", "(", ")"]);
const WHITESPACE = /\s/;
const DYNAMIC = new Set(["$", "`", "*", "?", "[", "{"]);

/** Split a shell command into words (quote removal only; no expansion). */
export function shellWords(command: string): ShellWord[] {
  const words: ShellWord[] = [];
  let text = "";
  let dynamic = false;
  let inWord = false;
  const end = () => {
    if (inWord) words.push({ text, dynamic });
    text = "";
    dynamic = false;
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!;
    if (c === "'") {
      inWord = true;
      const close = command.indexOf("'", i + 1);
      const stop = close === -1 ? command.length : close;
      text += command.slice(i + 1, stop);
      i = stop;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < command.length && command[i] !== '"'; i++) {
        const d = command[i]!;
        if (d === "\\" && i + 1 < command.length && '$`"\\\n'.includes(command[i + 1]!)) {
          i++;
          if (command[i] !== "\n") text += command[i];
        } else {
          if (d === "$" || d === "`") dynamic = true;
          text += d;
        }
      }
    } else if (c === "\\") {
      if (i + 1 < command.length) {
        i++;
        if (command[i] !== "\n") {
          inWord = true;
          text += command[i];
        }
      }
    } else if (WHITESPACE.test(c) || OPERATORS.has(c)) {
      end();
    } else if (c === "#" && !inWord) {
      const nl = command.indexOf("\n", i);
      i = nl === -1 ? command.length : nl;
    } else {
      inWord = true;
      if (DYNAMIC.has(c)) dynamic = true;
      text += c;
    }
  }
  end();
  return words;
}

/**
 * The strings in a command that could name a file: every word, plus the value
 * of `NAME=value` and `--flag=value`, plus the path in a curl-style `@file`.
 */
export function shellPathCandidates(command: string): string[] {
  const out: string[] = [];
  for (const { text } of shellWords(command)) {
    if (!text) continue;
    out.push(text);
    const assigned = /^(?:[A-Za-z_][A-Za-z0-9_]*|-{1,2}[A-Za-z0-9][\w-]*)=(.+)$/.exec(text);
    if (assigned) out.push(assigned[1]!);
    if (text.startsWith("@") && text.length > 1) out.push(text.slice(1));
  }
  return out;
}
