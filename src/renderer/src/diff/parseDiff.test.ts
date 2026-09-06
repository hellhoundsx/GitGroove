import { describe, expect, it } from 'vitest';
import { alignHunks, buildHunkPatch, parseUnifiedDiff, type DiffRow } from './parseDiff';

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
