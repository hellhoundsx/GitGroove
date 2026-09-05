import { describe, expect, it } from 'vitest';
import { buildHunkPatch, parseUnifiedDiff } from './parseDiff';

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
