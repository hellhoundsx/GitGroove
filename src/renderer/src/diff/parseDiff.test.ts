import { describe, expect, it } from 'vitest';
import { alignHunks, buildHunkPatch, buildLinePatch, hunkWordSpans, parseUnifiedDiff, splitHunkHeader, wordDiff, type DiffHunk, type DiffLine, type DiffRow, type FileDiff } from './parseDiff';

/** Build a diff body the way `git diff` prints it: every line ends with \n. */
const diff = (...lines: string[]): string => lines.join('\n') + '\n';

describe('parseUnifiedDiff', () => {
  it('parses the file header of a modified file', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git a/src/app.ts b/src/app.ts',
        'index 1234567..89abcde 100644',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,2 +1,2 @@',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 3;',
      ),
    );
    expect(files).toHaveLength(1);
    expect(files[0]!.oldPath).toBe('src/app.ts');
    expect(files[0]!.newPath).toBe('src/app.ts');
    expect(files[0]!.isNew).toBe(false);
    expect(files[0]!.isDeleted).toBe(false);
    expect(files[0]!.binary).toBe(false);
    expect(files[0]!.adds).toBe(1);
    expect(files[0]!.dels).toBe(1);
  });

  it('numbers hunk lines from the @@ header', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -10,4 +20,5 @@ function ctx()',
        ' one',
        '-two',
        '+TWO',
        '+two and a half',
        ' three',
        ' four',
      ),
    );
    const hunk = file!.hunks[0]!;
    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldLines).toBe(4);
    expect(hunk.newStart).toBe(20);
    expect(hunk.newLines).toBe(5);
    expect(hunk.lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['context', 10, 20],
      ['del', 11, null],
      ['add', null, 21],
      ['add', null, 22],
      ['context', 12, 23],
      ['context', 13, 24],
    ]);
  });

  it('defaults the line counts a @@ header omits', () => {
    const [file] = parseUnifiedDiff(
      diff('diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', '@@ -7 +7 @@', '-old', '+new'),
    );
    const hunk = file!.hunks[0]!;
    expect(hunk.oldLines).toBe(1);
    expect(hunk.newLines).toBe(1);
    expect(hunk.oldStart).toBe(7);
  });

  it('keeps "\\ No newline at end of file" as a meta line that consumes no line number', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/f.txt b/f.txt',
        '--- a/f.txt',
        '+++ b/f.txt',
        '@@ -1,2 +1,2 @@',
        ' first',
        '-second',
        '\\ No newline at end of file',
        '+second!',
        '\\ No newline at end of file',
      ),
    );
    const lines = file!.hunks[0]!.lines;
    expect(lines.map((l) => l.type)).toEqual(['context', 'del', 'meta', 'add', 'meta']);
    const meta = lines[2]!;
    expect(meta.oldNo).toBeNull();
    expect(meta.newNo).toBeNull();
    expect(meta.text).toBe('\\ No newline at end of file');
    // The add after the meta line still gets the next new-file number.
    expect(lines[3]!.newNo).toBe(2);
  });

  it('flags a new file and clears its old path', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/new.txt b/new.txt',
        'new file mode 100644',
        'index 0000000..e69de29',
        '--- /dev/null',
        '+++ b/new.txt',
        '@@ -0,0 +1,1 @@',
        '+hello',
      ),
    );
    expect(file!.isNew).toBe(true);
    expect(file!.oldPath).toBeNull();
    expect(file!.newPath).toBe('new.txt');
    expect(file!.adds).toBe(1);
  });

  it('flags a deleted file and clears its new path', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/gone.txt b/gone.txt',
        'deleted file mode 100644',
        '--- a/gone.txt',
        '+++ /dev/null',
        '@@ -1,1 +0,0 @@',
        '-bye',
      ),
    );
    expect(file!.isDeleted).toBe(true);
    expect(file!.newPath).toBeNull();
    expect(file!.oldPath).toBe('gone.txt');
    expect(file!.dels).toBe(1);
  });

  it('flags binary files and gives them no hunks', () => {
    const [textual, literal] = parseUnifiedDiff(
      diff(
        'diff --git a/logo.png b/logo.png',
        'index 1111111..2222222 100644',
        'Binary files a/logo.png and b/logo.png differ',
        'diff --git a/blob.bin b/blob.bin',
        'index 3333333..4444444 100644',
        'GIT binary patch',
        'literal 4',
        'zcmZQ',
      ),
    );
    expect(textual!.binary).toBe(true);
    expect(textual!.hunks).toHaveLength(0);
    expect(literal!.binary).toBe(true);
    expect(literal!.hunks).toHaveLength(0);
  });

  it('reads both paths of a rename that has no hunks', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/old/name.txt b/new/name.txt',
        'similarity index 100%',
        'rename from old/name.txt',
        'rename to new/name.txt',
      ),
    );
    expect(file!.oldPath).toBe('old/name.txt');
    expect(file!.newPath).toBe('new/name.txt');
    expect(file!.hunks).toHaveLength(0);
  });

  it('reads both paths of a rename with edits', () => {
    const [file] = parseUnifiedDiff(
      diff(
        'diff --git a/src/old.ts b/src/new.ts',
        'similarity index 88%',
        'rename from src/old.ts',
        'rename to src/new.ts',
        'index aaaaaaa..bbbbbbb 100644',
        '--- a/src/old.ts',
        '+++ b/src/new.ts',
        '@@ -1,1 +1,1 @@',
        '-export const x = 1;',
        '+export const x = 2;',
      ),
    );
    expect(file!.oldPath).toBe('src/old.ts');
    expect(file!.newPath).toBe('src/new.ts');
    expect(file!.hunks).toHaveLength(1);
  });

  it('splits a multi-file diff and keeps per-file counts', () => {
    const files = parseUnifiedDiff(
      diff(
        'diff --git a/one.txt b/one.txt',
        '--- a/one.txt',
        '+++ b/one.txt',
        '@@ -1,1 +1,2 @@',
        ' keep',
        '+added',
        'diff --git a/two.txt b/two.txt',
        '--- a/two.txt',
        '+++ b/two.txt',
        '@@ -1,2 +1,1 @@',
        ' keep',
        '-removed',
      ),
    );
    expect(files.map((f) => f.newPath)).toEqual(['one.txt', 'two.txt']);
    expect([files[0]!.adds, files[0]!.dels]).toEqual([1, 0]);
    expect([files[1]!.adds, files[1]!.dels]).toEqual([0, 1]);
  });
});

/**
 * git's answer for an unmerged path (GC-180), copied verbatim out of a throwaway repository with
 * one content conflict — `diff --cc`, an `@@@` header and two prefix columns per line. Before this
 * ticket every one of these lines fell into `headerLines` and the file came back with zero hunks,
 * which `DiffView` rendered as an empty body.
 */
const CONFLICT_DIFF = diff(
  'diff --cc f.txt',
  'index 90eb71e,6a9aab3..0000000',
  '--- a/f.txt',
  '+++ b/f.txt',
  '@@@ -1,3 -1,3 +1,7 @@@',
  '  alpha',
  '++<<<<<<< HEAD',
  ' +OURS',
  '++=======',
  '+ THEIRS',
  '++>>>>>>> other',
  '  gamma',
);

describe('parseUnifiedDiff, combined form (GC-180)', () => {
  it('names the file and opens the hunk from the @@@ header', () => {
    const files = parseUnifiedDiff(CONFLICT_DIFF);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.combined).toBe(true);
    expect(f.oldPath).toBe('f.txt');
    expect(f.newPath).toBe('f.txt');
    expect(f.binary).toBe(false);
    // The zero-hunk guard's other half: there is something to draw, so `DiffView` never reaches it.
    expect(f.hunks).toHaveLength(1);
    expect([f.hunks[0]!.oldStart, f.hunks[0]!.oldLines]).toEqual([1, 3]);
    expect([f.hunks[0]!.newStart, f.hunks[0]!.newLines]).toEqual([1, 7]);
  });

  it('reads each line against both parents', () => {
    const lines = parseUnifiedDiff(CONFLICT_DIFF)[0]!.hunks[0]!.lines;
    expect(lines.map((l) => [l.combined, l.type, l.text, l.oldNo, l.newNo])).toEqual([
      ['  ', 'context', 'alpha', 1, 1],
      ['++', 'add', '<<<<<<< HEAD', null, 2],
      // In the first parent and not the second, so it advances both numberings.
      [' +', 'add', 'OURS', 2, 3],
      ['++', 'add', '=======', null, 4],
      // In the second parent only: nothing in the first parent's numbering to advance.
      ['+ ', 'add', 'THEIRS', null, 5],
      ['++', 'add', '>>>>>>> other', null, 6],
      ['  ', 'context', 'gamma', 3, 7],
    ]);
  });

  it('counts what the merge result gained', () => {
    const f = parseUnifiedDiff(CONFLICT_DIFF)[0]!;
    expect([f.adds, f.dels]).toEqual([5, 0]);
  });

  it('counts a line no parent kept as a removal', () => {
    // `- ` is in the first parent and not in the result, so it is a removal and the result's
    // numbering does not advance over it.
    const f = parseUnifiedDiff(diff('diff --cc f.txt', '@@@ -1,2 -1,2 +1,1 @@@', '- dropped', '  kept'))[0]!;
    expect(f.hunks[0]!.lines.map((l) => [l.type, l.oldNo, l.newNo])).toEqual([
      ['del', 1, null],
      ['context', 2, 1],
    ]);
    expect([f.adds, f.dels]).toEqual([0, 1]);
  });

  it('parses an octopus merge without crashing', () => {
    const f = parseUnifiedDiff(diff('diff --cc f.txt', '@@@@ -1,1 -1,1 -1,1 +1,2 @@@@', '+++new', '   same'))[0]!;
    expect(f.combined).toBe(true);
    expect(f.hunks[0]!.lines.map((l) => [l.combined, l.type, l.text])).toEqual([
      ['+++', 'add', 'new'],
      ['   ', 'context', 'same'],
    ]);
  });

  it('leaves an ordinary diff alone after a combined one', () => {
    // `parents` is hunk state, so an ordinary `@@` header following a combined file must clear it
    // or every later line would be read two columns in.
    const files = parseUnifiedDiff(
      CONFLICT_DIFF + diff('diff --git a/two.txt b/two.txt', '--- a/two.txt', '+++ b/two.txt', '@@ -1,2 +1,2 @@', ' keep', '-old', '+new'),
    );
    expect(files.map((f) => f.combined)).toEqual([true, false]);
    expect(files[1]!.hunks[0]!.lines.map((l) => [l.type, l.text, l.combined])).toEqual([
      ['context', 'keep', undefined],
      ['del', 'old', undefined],
      ['add', 'new', undefined],
    ]);
  });

  it('gives a payload it cannot read a file with no hunks, which is the empty body DiffView guards', () => {
    // The pre-GC-180 behaviour on any unknown payload, kept as a test because the guard in
    // `DiffView` is written against exactly this shape.
    const files = parseUnifiedDiff(diff('diff --git a/f.txt b/f.txt', 'Something git prints that nothing here parses'));
    expect(files).toHaveLength(1);
    expect(files[0]!.hunks).toHaveLength(0);
    expect(files[0]!.binary).toBe(false);
  });
});

const TWO_HUNK_DIFF = diff(
  'diff --git a/two-hunks.txt b/two-hunks.txt',
  'index aaaaaaa..bbbbbbb 100644',
  '--- a/two-hunks.txt',
  '+++ b/two-hunks.txt',
  '@@ -1,3 +1,3 @@',
  ' alpha',
  '-beta',
  '+BETA',
  ' gamma',
  '@@ -20,3 +20,4 @@',
  ' delta',
  '+EPSILON',
  ' zeta',
  ' eta',
);

describe('buildHunkPatch', () => {
  it('round-trips a single hunk through the parser', () => {
    const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
    const second = file!.hunks[1]!;
    const patch = buildHunkPatch(file!, second);

    const [reparsed] = parseUnifiedDiff(patch);
    expect(reparsed!.oldPath).toBe('two-hunks.txt');
    expect(reparsed!.newPath).toBe('two-hunks.txt');
    expect(reparsed!.hunks).toHaveLength(1);
    expect(reparsed!.hunks[0]!.header).toBe(second.header);
    expect(reparsed!.hunks[0]!.raw).toBe(second.raw);
    expect(reparsed!.hunks[0]!.lines).toEqual(second.lines);
    expect(reparsed!.adds).toBe(1);
    expect(reparsed!.dels).toBe(0);
  });

  it('drops the index line so git apply ignores blob ids', () => {
    const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
    const patch = buildHunkPatch(file!, file!.hunks[0]!);
    expect(patch).not.toContain('index aaaaaaa..bbbbbbb');
    expect(patch.startsWith('diff --git a/two-hunks.txt b/two-hunks.txt\n')).toBe(true);
    expect(patch.endsWith('\n')).toBe(true);
  });

  it('synthesises the headers an untracked-file diff has no room for', () => {
    // Untracked files are synthesised in code and can arrive without a `diff --git` line.
    const [file] = parseUnifiedDiff(diff('--- /dev/null', '+++ b/fresh.txt', '@@ -0,0 +1,1 @@', '+hello'));
    const patch = buildHunkPatch(file!, file!.hunks[0]!);
    expect(patch.split('\n')[0]).toBe('diff --git a/fresh.txt b/fresh.txt');

    const [reparsed] = parseUnifiedDiff(patch);
    expect(reparsed!.oldPath).toBeNull();
    expect(reparsed!.newPath).toBe('fresh.txt');
    expect(reparsed!.hunks[0]!.lines.map((l) => l.text)).toEqual(['hello']);
  });
});

describe('alignHunks (GC-014)', () => {
  /** Parse one hunk body and align it; the file header is noise for these cases. */
  const rowsOf = (...body: string[]): DiffRow[] => {
    const [file] = parseUnifiedDiff(diff('diff --git a/f.txt b/f.txt', '--- a/f.txt', '+++ b/f.txt', ...body));
    return alignHunks(file!.hunks[0]!);
  };
  /** A row as [left text, right text], with `null` for the side that has no line. */
  const shape = (rows: DiffRow[]): (string | null)[][] => rows.map((r) => [r.left?.text ?? null, r.right?.text ?? null]);

  it('puts a context line on both sides, with a number for each file', () => {
    const rows = rowsOf('@@ -4,2 +9,2 @@', ' one', ' two');
    expect(shape(rows)).toEqual([
      ['one', 'one'],
      ['two', 'two'],
    ]);
    expect(rows[0]!.left!.oldNo).toBe(4);
    expect(rows[0]!.right!.newNo).toBe(9);
  });

  it('pairs a removal run with the addition run that follows it, index by index', () => {
    expect(shape(rowsOf('@@ -1,4 +1,4 @@', ' ctx', '-a', '-b', '+A', '+B', ' end'))).toEqual([
      ['ctx', 'ctx'],
      ['a', 'A'],
      ['b', 'B'],
      ['end', 'end'],
    ]);
  });

  it('pads the shorter side rather than letting the rows drift', () => {
    expect(shape(rowsOf('@@ -1,3 +1,2 @@', '-a', '-b', '-c', '+A'))).toEqual([
      ['a', 'A'],
      ['b', null],
      ['c', null],
    ]);
    expect(shape(rowsOf('@@ -1,1 +1,3 @@', '-a', '+A', '+B', '+C'))).toEqual([
      ['a', 'A'],
      [null, 'B'],
      [null, 'C'],
    ]);
  });

  it('leaves the old side empty for a pure addition and the new side empty for a pure removal', () => {
    expect(shape(rowsOf('@@ -0,0 +1,2 @@', '+one', '+two'))).toEqual([
      [null, 'one'],
      [null, 'two'],
    ]);
    expect(shape(rowsOf('@@ -1,2 +0,0 @@', '-one', '-two'))).toEqual([
      ['one', null],
      ['two', null],
    ]);
  });

  it('starts a new block when a removal follows an addition, so neither run absorbs the other', () => {
    // Two independent change groups with no context between them: `+A` replaces nothing that comes
    // after it, and pairing across the boundary would put `A` beside `b`.
    expect(shape(rowsOf('@@ -1,2 +1,2 @@', '+A', '-b', '+B'))).toEqual([
      [null, 'A'],
      ['b', 'B'],
    ]);
  });

  it('keeps a "\\ No newline" marker on the side it describes', () => {
    const rows = rowsOf('@@ -1,2 +1,2 @@', ' first', '-second', '\\ No newline at end of file', '+second!', '\\ No newline at end of file');
    expect(shape(rows)).toEqual([
      ['first', 'first'],
      ['second', 'second!'],
      ['\\ No newline at end of file', '\\ No newline at end of file'],
    ]);
    // Only one side loses its newline: the marker there has no partner to pair with.
    expect(shape(rowsOf('@@ -1,1 +1,1 @@', '-a', '+A', '\\ No newline at end of file'))).toEqual([
      ['a', 'A'],
      [null, '\\ No newline at end of file'],
    ]);
    // After a context line the marker belongs to both files, which still agree at that point.
    expect(shape(rowsOf('@@ -1,1 +1,1 @@', ' same', '\\ No newline at end of file'))).toEqual([
      ['same', 'same'],
      ['\\ No newline at end of file', '\\ No newline at end of file'],
    ]);
  });

  it('loses no line: every line of the hunk appears once on its own side', () => {
    const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
    for (const hunk of file!.hunks) {
      const rows = alignHunks(hunk);
      const left = rows.map((r) => r.left).filter((l) => l !== null);
      const right = rows.map((r) => r.right).filter((l) => l !== null);
      expect(left).toEqual(hunk.lines.filter((l) => l.type === 'del' || l.type === 'context'));
      expect(right).toEqual(hunk.lines.filter((l) => l.type === 'add' || l.type === 'context'));
    }
  });

  it('is unaffected by, and does not touch, the raw text a hunk patch is built from', () => {
    const [file] = parseUnifiedDiff(TWO_HUNK_DIFF);
    const hunk = file!.hunks[0]!;
    const before = hunk.raw;
    alignHunks(hunk);
    expect(hunk.raw).toBe(before);
    expect(buildHunkPatch(file!, hunk)).toContain(before);
  });
});

describe('wordDiff', () => {
  /** Just the marked runs of a side, which is what the highlight actually draws. */
  const marks = (spans: { text: string; changed: boolean }[] | undefined): string[] => (spans ?? []).filter((s) => s.changed).map((s) => s.text);

  it('marks only the word that was added at the end of the line', () => {
    const d = wordDiff('row 3', 'row 3 edited')!;
    expect(d).not.toBeNull();
    expect(marks(d.left)).toEqual([]);
    expect(marks(d.right)).toEqual(['edited']);
    // Nothing is lost: each side still spells its own line.
    expect(d.left.map((s) => s.text).join('')).toBe('row 3');
    expect(d.right.map((s) => s.text).join('')).toBe('row 3 edited');
  });

  it('marks only the word that changed in the middle of the line', () => {
    const d = wordDiff('const b = 2;', 'const b = 3;')!;
    expect(marks(d.left)).toEqual(['2']);
    expect(marks(d.right)).toEqual(['3']);
  });

  it('marks nothing when the lines are identical', () => {
    expect(wordDiff('same line', 'same line')).toBeNull();
  });

  it('falls back rather than marking everything when the lines are unrelated', () => {
    expect(wordDiff('const total = items.reduce(sum, 0);', 'throw new Error("nothing here matches");')).toBeNull();
  });

  it('marks a one-character edit inside a word, not the whole line', () => {
    const d = wordDiff('  const timeout = 500;', '  const timeout = 900;')!;
    expect(marks(d.left)).toEqual(['500']);
    expect(marks(d.right)).toEqual(['900']);
  });

  it('never starts or ends a marked run on whitespace', () => {
    const d = wordDiff('a b c', 'a b b c')!;
    for (const side of [d.left, d.right]) for (const s of side.filter((x) => x.changed)) expect(s.text).toBe(s.text.trim());
  });
});

describe('hunkWordSpans', () => {
  const hunkOf = (...lines: string[]): DiffHunk => parseUnifiedDiff(diff('diff --git a/f b/f', '--- a/f', '+++ b/f', ...lines))[0]!.hunks[0]!;

  it('marks a paired removal and addition, and both layouts get the same map', () => {
    const hunk = hunkOf('@@ -1,2 +1,2 @@', ' row 2', '-row 3', '+row 3 edited');
    const spans = hunkWordSpans(hunk);
    const del = hunk.lines.find((l) => l.type === 'del')!;
    const add = hunk.lines.find((l) => l.type === 'add')!;
    expect(spans.get(add)!.filter((s) => s.changed).map((s) => s.text)).toEqual(['edited']);
    expect(spans.get(del)!.some((s) => s.changed)).toBe(false);
    // The rows the split view renders hold the very same line objects, so both look the map up.
    const row = alignHunks(hunk).find((r) => r.left?.type === 'del')!;
    expect(spans.get(row.left!)).toBe(spans.get(del));
    expect(spans.get(row.right!)).toBe(spans.get(add));
  });

  it('leaves an unpaired line to the plain line tint', () => {
    // Two additions against one removal: only the first has anything opposite it, and here even
    // that pair has nothing in common, so nothing is marked at all.
    const hunk = hunkOf('@@ -1,2 +1,3 @@', ' kept', '-row 3', '+row 3 edited', '+row 4 appended');
    const spans = hunkWordSpans(hunk);
    const unpaired = hunk.lines.filter((l) => l.type === 'add').at(-1)!;
    expect(unpaired.text).toBe('row 4 appended');
    expect(spans.has(unpaired)).toBe(false);
    expect(hunkWordSpans(hunkOf('@@ -1,1 +1,2 @@', ' kept', '+brand new line')).size).toBe(0);
  });
});

describe('buildLinePatch', () => {
  const fileOf = (...lines: string[]): FileDiff => parseUnifiedDiff(diff('diff --git a/f b/f', 'index 1111111..2222222 100644', '--- a/f', '+++ b/f', ...lines))[0]!;
  /** The hunk body of a patch: everything after the file preamble, which both builders share. */
  const bodyOf = (patch: string): string[] => patch.split('\n').slice(3, -1);
  const pick = (hunk: DiffHunk, ...texts: string[]): Set<DiffLine> =>
    new Set(hunk.lines.filter((l) => (l.type === 'add' || l.type === 'del') && texts.includes(l.text)));

  it('keeps the selected additions and drops the rest', () => {
    const file = fileOf('@@ -1,1 +1,4 @@', ' kept', '+one', '+two', '+three');
    const hunk = file.hunks[0]!;
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'one', 'three')))).toEqual(['@@ -1 +1,3 @@', ' kept', '+one', '+three']);
  });

  it('turns an unselected removal into context rather than dropping it', () => {
    // The old side must still describe the file on disk, so `three` stays — as a context line, which
    // is what says it is in both versions.
    const file = fileOf('@@ -1,4 +1,1 @@', ' kept', '-one', '-two', '-three');
    const hunk = file.hunks[0]!;
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'one', 'two')))).toEqual(['@@ -1,4 +1,2 @@', ' kept', '-one', '-two', ' three']);
  });

  it('handles a mixed hunk, marking each side by what was picked', () => {
    const file = fileOf('@@ -1,3 +1,3 @@', ' kept', '-old a', '-old b', '+new a', '+new b');
    const hunk = file.hunks[0]!;
    // Take the first removal and the first addition: the second removal becomes context and the
    // second addition disappears, so the new side is `kept`, `new a`, `old b`.
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'old a', 'new a')))).toEqual(['@@ -1,3 +1,3 @@', ' kept', '-old a', ' old b', '+new a']);
  });

  it('equals buildHunkPatch byte for byte when every changed line is selected', () => {
    for (const lines of [
      // Headers in git's own form: it omits the count when it is 1, which is what the rebuilt
      // header has to reproduce for the two patches to match byte for byte.
      ['@@ -1 +1,3 @@', ' kept', '+one', '+two'],
      ['@@ -1,4 +1 @@', ' kept', '-one', '-two', '-three'],
      ['@@ -10,3 +10,3 @@ function foo()', ' kept', '-old a', '-old b', '+new a', '+new b'],
      ['@@ -1,2 +1,2 @@', ' kept', '-no trailing', '\\ No newline at end of file', '+no trailing now', '\\ No newline at end of file'],
    ]) {
      const file = fileOf(...lines);
      const hunk = file.hunks[0]!;
      const all = new Set(hunk.lines.filter((l) => l.type === 'add' || l.type === 'del'));
      expect(buildLinePatch(file, hunk, all)).toBe(buildHunkPatch(file, hunk));
    }
  });

  it('drops the no-newline marker of a dropped addition and keeps the one of a kept line', () => {
    const file = fileOf('@@ -1 +1,3 @@', ' kept', '+one', '+two', '\\ No newline at end of file');
    const hunk = file.hunks[0]!;
    // `two` is not selected, so the marker describing it goes with it.
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'one')))).toEqual(['@@ -1 +1,2 @@', ' kept', '+one']);
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'one', 'two')))).toEqual(['@@ -1 +1,3 @@', ' kept', '+one', '+two', '\\ No newline at end of file']);
  });

  // The reverse direction is the one a Discard needs, and it is not the same patch: it is applied
  // to the working tree, which is the new file, so the unselected lines swap roles. Built the
  // staging way and reversed onto the working tree, `git apply` refuses it — the unselected
  // additions are in the file with nothing in the patch accounting for them.
  it('makes an unselected addition context and drops an unselected removal, in reverse', () => {
    const file = fileOf('@@ -1 +1,4 @@', ' kept', '+one', '+two', '+three');
    const hunk = file.hunks[0]!;
    // Discarding `two` alone: the other two additions stay in the working tree, so they are context,
    // and the new side therefore describes the file on disk exactly.
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'two'), { reverse: true }))).toEqual(['@@ -1,3 +1,4 @@', ' kept', ' one', '+two', ' three']);
  });

  it('drops an unselected removal in reverse, where the staging direction keeps it', () => {
    const file = fileOf('@@ -1,3 +1 @@', ' kept', '-one', '-two');
    const hunk = file.hunks[0]!;
    // `one` is not coming back, and it is not in the working tree, so the patch cannot mention it.
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'two'), { reverse: true }))).toEqual(['@@ -1,2 +1 @@', ' kept', '-two']);
    // The same selection for staging keeps it, as context: there the patch meets the index.
    expect(bodyOf(buildLinePatch(file, hunk, pick(hunk, 'two')))).toEqual(['@@ -1,3 +1,2 @@', ' kept', ' one', '-two']);
  });

  it('is the whole hunk in either direction when everything is selected', () => {
    const file = fileOf('@@ -1,3 +1,3 @@', ' kept', '-old a', '-old b', '+new a', '+new b');
    const hunk = file.hunks[0]!;
    const all = new Set(hunk.lines.filter((l) => l.type === 'add' || l.type === 'del'));
    expect(buildLinePatch(file, hunk, all, { reverse: true })).toBe(buildHunkPatch(file, hunk));
    expect(buildLinePatch(file, hunk, all)).toBe(buildHunkPatch(file, hunk));
  });

  it('selects nothing into a patch that changes nothing', () => {
    const file = fileOf('@@ -1,2 +1,2 @@', ' kept', '-old', '+new');
    const hunk = file.hunks[0]!;
    // Every removal is context and every addition is gone, so both sides are the old file.
    expect(bodyOf(buildLinePatch(file, hunk, new Set()))).toEqual(['@@ -1,2 +1,2 @@', ' kept', ' old']);
  });
});

// The hunk header's two halves (GC-180). A combined hunk is fenced with one more `@` than it has
// parents, so the pair of regexes that assumed two matched nothing and printed the whole header
// twice — the range beside itself, measured on screen in a real conflict.
describe('splitHunkHeader', () => {
  const cases: Array<[string, [string, string], string]> = [
    ['@@ -1,2 +1,2 @@', ['@@ -1,2 +1,2 @@', ''], 'an ordinary hunk with no context after it'],
    ['@@ -1,2 +1,2 @@ function foo() {', ['@@ -1,2 +1,2 @@', 'function foo() {'], 'and one with the enclosing line git found'],
    ['@@@ -1,3 -1,3 +1,7 @@@', ['@@@ -1,3 -1,3 +1,7 @@@', ''], 'a two-parent combined hunk'],
    ['@@@@ -1,1 -1,1 -1,1 +1,2 @@@@', ['@@@@ -1,1 -1,1 -1,1 +1,2 @@@@', ''], 'and an octopus one'],
    ['not a hunk header', ['not a hunk header', ''], 'anything else is left whole rather than mangled'],
  ];
  for (const [header, expected, why] of cases) {
    it(why, () => {
      expect(splitHunkHeader(header)).toEqual(expected);
    });
  }
});
