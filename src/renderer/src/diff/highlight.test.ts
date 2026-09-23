import { describe, expect, it } from 'vitest';
import { parseUnifiedDiff } from './parseDiff';
import { hunkSyntax, languageFor, mergeMarks, splitHighlighted, type SynToken } from './highlight';

// Syntax colour in the diff view (asked for by Ricardo). Everything here is pure: which language a
// path is, how highlight.js's markup becomes one list of tokens per line, how a hunk is highlighted
// one side at a time, and how those tokens meet the changed-word marks of GC-104.

describe('languageFor', () => {
  it('answers by extension, case-insensitively', () => {
    expect(languageFor('src/renderer/src/App.tsx')).toBe('typescript');
    expect(languageFor('tools/e2e/run.mjs')).toBe('javascript');
    expect(languageFor('package.JSON')).toBe('json');
    expect(languageFor('docs/README.md')).toBe('markdown');
    expect(languageFor('api/handler.py')).toBe('python');
  });

  it('answers by file name where the name is the type', () => {
    expect(languageFor('deploy/Dockerfile')).toBe('dockerfile');
    expect(languageFor('Makefile')).toBe('makefile');
  });

  it('answers null for what it cannot name, which draws plain text', () => {
    expect(languageFor('.gitignore')).toBeNull();
    expect(languageFor('LICENSE')).toBeNull();
    expect(languageFor('assets/logo.png')).toBeNull();
  });
});

describe('splitHighlighted', () => {
  it('splits a span that crosses a line break into one token per line, keeping its kind', () => {
    const lines = splitHighlighted('<span class="hljs-comment">/* a\nb */</span>\nx');
    expect(lines).toEqual([[{ text: '/* a', kind: 'comment' }], [{ text: 'b */', kind: 'comment' }], [{ text: 'x', kind: null }]]);
  });

  it('decodes the entities highlight.js escapes', () => {
    const [line] = splitHighlighted('a &lt; b &amp;&amp; c &gt; &quot;d&quot; &#x27;e&#x27;');
    expect(line!.map((t) => t.text).join('')).toBe(`a < b && c > "d" 'e'`);
  });

  it('lets an inner span override its parent, and a substitution drop back to plain', () => {
    const [line] = splitHighlighted('<span class="hljs-string">`a${<span class="hljs-subst">x</span>}`</span>');
    expect(line).toEqual([
      { text: '`a${', kind: 'string' },
      { text: 'x', kind: null },
      { text: '}`', kind: 'string' },
    ]);
  });

  it('reads a function name and a class name as different kinds', () => {
    const [line] = splitHighlighted('<span class="hljs-title function_">run</span> <span class="hljs-title class_">App</span>');
    expect(line!.filter((t) => t.kind).map((t) => t.kind)).toEqual(['function', 'type']);
  });
});

describe('hunkSyntax', () => {
  const diff = [
    'diff --git a/x.ts b/x.ts',
    '--- a/x.ts',
    '+++ b/x.ts',
    '@@ -1,2 +1,3 @@',
    ' const a = 1;',
    '-const b = 2;',
    '+const b = `two',
    '+lines`;',
  ].join('\n');
  const hunk = parseUnifiedDiff(diff)[0]!.hunks[0]!;
  const syntax = hunkSyntax(hunk, 'typescript');
  const kinds = (i: number): (string | null)[] => (syntax.get(hunk.lines[i]!) ?? []).map((t) => t.kind);

  it('gives every code line tokens that spell out its text exactly', () => {
    for (const line of hunk.lines) expect((syntax.get(line) ?? []).map((t) => t.text).join('')).toBe(line.text);
  });

  it('highlights each side on its own, so a string opened on the new side carries on to its next line', () => {
    expect(kinds(0)).toContain('keyword'); // context
    expect(kinds(1)).toContain('keyword'); // removal
    expect(kinds(3)).toEqual(expect.arrayContaining(['string'])); // `lines`` is still inside the template
  });

  it('draws nothing for a language it was not given', () => {
    expect(hunkSyntax(hunk, 'no-such-language').size).toBe(0);
  });
});

describe('mergeMarks', () => {
  const tokens: SynToken[] = [
    { text: 'const', kind: 'keyword' },
    { text: ' total = ', kind: null },
    { text: '42', kind: 'number' },
  ];

  it('is the syntax tokens alone when nothing is marked as changed', () => {
    expect(mergeMarks('const total = 42', tokens, undefined)).toEqual(tokens.map((t) => ({ ...t, changed: false })));
  });

  it('cuts a token where a changed run starts or ends, keeping both the kind and the mark', () => {
    const marks = mergeMarks('const total = 42', tokens, [
      { text: 'const to', changed: false },
      { text: 'tal = 4', changed: true },
      { text: '2', changed: false },
    ]);
    expect(marks.map((m) => m.text).join('')).toBe('const total = 42');
    expect(marks).toContainEqual({ text: 'tal = ', kind: null, changed: true });
    expect(marks).toContainEqual({ text: '4', kind: 'number', changed: true });
    expect(marks).toContainEqual({ text: '2', kind: 'number', changed: false });
  });

  it('marks the plain text when there are no syntax tokens at all', () => {
    expect(mergeMarks('ab', undefined, [{ text: 'a', changed: true }, { text: 'b', changed: false }])).toEqual([
      { text: 'a', kind: null, changed: true },
      { text: 'b', kind: null, changed: false },
    ]);
  });
});
