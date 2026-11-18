import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';

const vendor = resolve(import.meta.dir, '../../vendor/picomatch');
const require = createRequire(import.meta.url);
const pm = require(vendor) as {
  makeRe(pattern: string, options?: Record<string, unknown>): RegExp;
  isMatch(input: string, pattern: string, options?: Record<string, unknown>): boolean;
};
const wildcardCases = ['+(*)', '*(*)', '+(*a)', '*(a*)', '+(a*b)',
  '+(@(*a))', '+([[]*a)', 'x+(*a)y', 'path/+(*a)/end'];
const bypassCases = ['+(a+(a))', '+(@(a|aa))', '+({a,aa})', '+(a|ab|ba)', '+("a"|"aa")'];

describe('GHSA-fc5q-39xc-vjpf: real repeated-wildcard mitigation', () => {
  for (const pattern of wildcardCases) {
    test(`literalizes the unsafe repeated body: ${pattern}`, () => {
      // Assert the compiled language BEFORE trying an adversarial input: a
      // missing guard must fail promptly, not hang the test runner itself.
      const source = pm.makeRe(pattern).source;
      expect(source).toContain(pattern.includes('+(') ? '\\+\\(' : '\\*\\(');
      expect(pm.isMatch(pattern, pattern)).toBe(true);
    });
  }

  test('the new wildcard guard cannot be disabled by a recursion-only option', () => {
    for (const options of [{ maxExtglobRecursion: false }, { maxExtglobRecursion: 10 },
      { fastpaths: false }, { capture: true }, { windows: true }, { contains: true }]) {
      expect(pm.makeRe('+(*a)', options).source).toContain('\\+\\(');
    }
  });

  test('multi-character prefix-overlap bypass is also literalized', () => {
    for (const pattern of ['+(ab|abab)', '*(abc|abcabc)']) {
      expect(pm.makeRe(pattern).source).toContain('\\(');
      expect(pm.isMatch(pattern, pattern)).toBe(true);
    }
  });

  test('remaining nested, quoted, brace and three-word ambiguity bypasses fail closed', () => {
    for (const pattern of bypassCases) {
      for (const options of [{}, { maxExtglobRecursion: false }, { maxExtglobRecursion: 10 }, { capture: true }]) {
        expect(pm.makeRe(pattern, options).source).toContain('\\+\\(');
        expect(pm.isMatch(pattern, pattern, options)).toBe(true);
      }
    }
    expect(pm.makeRe('+(a|A)', { nocase: true }).source).toContain('\\+\\(');
  });

  test('ordinary glob APIs, fixed extglobs and existing safe rewrites remain usable', () => {
    expect(pm.isMatch('src/main.ts', '**/*.{ts,tsx}')).toBe(true);
    expect(pm.isMatch('src/main.js', '**/*.{ts,tsx}')).toBe(false);
    expect(pm.isMatch('abcabc', '+(abc)')).toBe(true);
    expect(pm.isMatch('foobar', '*(foo|bar)')).toBe(true);
    expect(pm.isMatch('baz.jsx', '*.+(js|jsx)')).toBe(true);
    expect(pm.isMatch('fofoofoofofoo', '*(fo|foo)')).toBe(true);
    expect(pm.isMatch('fffooo', '*(*(f)*(o))')).toBe(true);
    expect(pm.isMatch('ab', '+(*(a)|*(b))')).toBe(true);
    expect(pm.isMatch('*a*a', '+(\\*a)')).toBe(true);
    expect(pm.isMatch('*a*a', '+("*"a)')).toBe(true);
  });

  test('finite codeword ambiguity is checked as a whole, not just pairwise', () => {
    const words = ['a', 'b', 'aa', 'ab', 'ba', 'bb'];
    let collisions = 0;
    for (let mask = 1; mask < 1 << words.length; mask++) {
      const code = words.filter((_, i) => mask & 1 << i);
      if (code.length < 2 || code.length > 3) continue;
      const seen = new Map<string, string>();
      let frontier = [{ value: '', path: '' }], ambiguous = false;
      for (let depth = 0; depth < 5 && !ambiguous; depth++) {
        const next: typeof frontier = [];
        for (const prefix of frontier) for (const [index, word] of code.entries()) {
          const value = prefix.value + word, path = prefix.path + index;
          if (seen.has(value) && seen.get(value) !== path) ambiguous = true;
          seen.set(value, path); next.push({ value, path });
        }
        frontier = next;
      }
      if (ambiguous) {
        collisions++;
        expect(pm.makeRe(`+(${code.join('|')})`).source).toContain('\\+\\(');
      }
    }
    expect(collisions).toBeGreaterThan(10);
  });

  test('unsupported syntax and analysis budgets reject conservatively; proven fixed-width classes survive', () => {
    for (const body of ['a'.repeat(2049), Array.from({ length: 65 }, (_, i) => `word${i}`).join('|'), '!(foo)', 'f*(o)', 'a|']) {
      expect(pm.makeRe(`+(${body})`).source).toContain('\\+\\(');
    }
    expect(pm.isMatch('0377', '+([0-7])')).toBe(true);
    expect(pm.isMatch('a.c', '+([[:alpha:].])')).toBe(true);
    expect(pm.isMatch('abab', '+(@(a|b))')).toBe(true);
  });

  test('50,000-character rejects finish in an isolated, bounded real Node process', () => {
    const isBun = basename(process.execPath).replace(/\.exe$/i, '').toLowerCase() === 'bun';
    const result = spawnSync(isBun ? 'node' : process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      assert(process.versions.node && !process.versions.bun, 'must execute real Node, including on Windows');
      const pm = require(${JSON.stringify(vendor)});
      for (const pattern of ${JSON.stringify(wildcardCases)}) {
        assert(pm.makeRe(pattern).source.includes(pattern.includes('+(') ? '\\\\+\\\\(' : '\\\\*\\\\('));
        assert.equal(pm.isMatch('a'.repeat(50000) + '!', pattern), false);
      }
      for (const pattern of ${JSON.stringify(bypassCases)}) {
        assert(pm.makeRe(pattern).source.includes('\\\\+\\\\('));
        assert.equal(pm.isMatch((pattern.includes('ab|ba') ? 'aba' : 'a').repeat(50000) + '!', pattern), false);
      }
      assert.equal(pm.isMatch('ab'.repeat(25000) + '!', '+(ab|abab)'), false);
      assert.equal(pm.isMatch('fo'.repeat(25000) + '!', '*(fo|foo)'), false);
      console.log('real-node-repeated-extglob-rejects-passed');
    `], { encoding: 'utf8', timeout: 1500 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('real-node-repeated-extglob-rejects-passed');
  });
});
