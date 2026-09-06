/** Minimal unified-diff parser for `git diff` output. */

export type DiffLineType = 'context' | 'add' | 'del' | 'meta';

export interface DiffLine {
  type: DiffLineType;
  text: string; // without the leading marker
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string; // the full @@ line
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
  /** Raw hunk text including the header line, ready to be re-applied with `git apply`. */
  raw: string;
}

export interface FileDiff {
  oldPath: string | null; // null for new files
  newPath: string | null; // null for deleted files
  /** Lines from `diff --git` up to and including `+++`, used to rebuild a patch. */
  headerLines: string[];
  hunks: DiffHunk[];
  binary: boolean;
  isNew: boolean;
  isDeleted: boolean;
  adds: number;
  dels: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripPrefix(p: string): string | null {
  const t = p.trim();
  if (t === '/dev/null') return null;
  return t.replace(/^[ab]\//, '');
}

export function parseUnifiedDiff(text: string): FileDiff[] {
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  const startFile = (): FileDiff => {
    file = { oldPath: null, newPath: null, headerLines: [], hunks: [], binary: false, isNew: false, isDeleted: false, adds: 0, dels: 0 };
    hunk = null;
    files.push(file);
    return file;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const f = startFile();
      f.headerLines.push(line);
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (m) {
        f.oldPath = m[1]!;
        f.newPath = m[2]!;
      }
      continue;
    }
    if (!file) file = startFile();

    const m = HUNK_RE.exec(line);
    if (m) {
      hunk = {
        header: line,
        oldStart: Number(m[1]),
        oldLines: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newLines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
        raw: line + '\n',
      };
      oldNo = hunk.oldStart;
      newNo = hunk.newStart;
      file.hunks.push(hunk);
      continue;
    }

    if (!hunk) {
      // file header section
      if (line.startsWith('--- ')) file.oldPath = stripPrefix(line.slice(4));
      else if (line.startsWith('+++ ')) file.newPath = stripPrefix(line.slice(4));
      else if (line.startsWith('new file mode')) file.isNew = true;
      else if (line.startsWith('deleted file mode')) file.isDeleted = true;
      else if (/^Binary files .* differ$/.test(line) || line.startsWith('GIT binary patch')) file.binary = true;
      file.headerLines.push(line);
      continue;
    }

    hunk.raw += line + '\n';
    const marker = line[0];
    const body = line.slice(1);
    if (marker === '+') {
      hunk.lines.push({ type: 'add', text: body, oldNo: null, newNo: newNo++ });
      file.adds++;
    } else if (marker === '-') {
      hunk.lines.push({ type: 'del', text: body, oldNo: oldNo++, newNo: null });
      file.dels++;
    } else if (marker === '\\') {
      hunk.lines.push({ type: 'meta', text: line, oldNo: null, newNo: null });
    } else {
      // ' ' context (or an empty line that lost its marker)
      hunk.lines.push({ type: 'context', text: body, oldNo: oldNo++, newNo: newNo++ });
    }
  }

  for (const f of files) {
    if (f.isNew) f.oldPath = null;
    if (f.isDeleted) f.newPath = null;
  }
  return files;
}

/**
 * One row of the side-by-side view: the old file's line, the new file's line, or both (GC-014).
 * A context line is the same `DiffLine` on both sides — it carries `oldNo` and `newNo` — while a
 * changed line has whichever side it belongs to and `null` for the padding opposite it.
 */
export interface DiffRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pair a hunk's removed and added lines into rows for the split view (GC-014).
 *
 * Unified output emits a change block as a run of `-` lines followed by a run of `+` lines, so the
 * pairing is per block and index by index: the first removal sits beside the first addition, and
 * the shorter run is padded with `null` rather than the rows being allowed to drift. A context line
 * ends the block and occupies both sides. `\ No newline at end of file` describes the side above it
 * — the two sides can disagree about the trailing newline — so it is paired with the marker on the
 * other side if there is one, and after a context line, which both sides share, it appears on both.
 *
 * Every line of the hunk appears exactly once, on its own side: nothing is dropped and nothing is
 * duplicated except a context line, which genuinely is in both files.
 */
export function alignHunks(hunk: DiffHunk): DiffRow[] {
  const rows: DiffRow[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  /** The side the last non-meta line was on, which is what a `\ No newline` marker refers to. */
  let side: DiffLineType | null = null;

  const flush = (): void => {
    // Markers pair with markers, so a `\ No newline` on one side never lands beside a code line on
    // the other; both sub-lists keep the order they arrived in.
    const dl = dels.filter((l) => l.type !== 'meta');
    const al = adds.filter((l) => l.type !== 'meta');
    for (let i = 0; i < Math.max(dl.length, al.length); i++) rows.push({ left: dl[i] ?? null, right: al[i] ?? null });
    const dm = dels.filter((l) => l.type === 'meta');
    const am = adds.filter((l) => l.type === 'meta');
    for (let i = 0; i < Math.max(dm.length, am.length); i++) rows.push({ left: dm[i] ?? null, right: am[i] ?? null });
    dels = [];
    adds = [];
  };

  for (const line of hunk.lines) {
    if (line.type === 'del') {
      // A removal after an addition is a new block: git does not interleave them within one.
      if (adds.length) flush();
      dels.push(line);
      side = 'del';
    } else if (line.type === 'add') {
      adds.push(line);
      side = 'add';
    } else if (line.type === 'context') {
      flush();
      rows.push({ left: line, right: line });
      side = 'context';
    } else if (side === 'del') {
      dels.push(line);
    } else if (side === 'add') {
      adds.push(line);
    } else {
      rows.push({ left: line, right: line });
    }
  }
  flush();
  return rows;
}

/** Build a patch containing only the given hunk of a file, suitable for `git apply`. */
export function buildHunkPatch(file: FileDiff, hunk: DiffHunk): string {
  const header = file.headerLines.filter((l) => !l.startsWith('index ')); // let git apply ignore blob ids
  const hasOld = header.some((l) => l.startsWith('--- '));
  const hasNew = header.some((l) => l.startsWith('+++ '));
  const path = file.newPath ?? file.oldPath ?? '';
  if (!hasOld) header.push(file.oldPath ? `--- a/${file.oldPath}` : '--- /dev/null');
  if (!hasNew) header.push(file.newPath ? `+++ b/${file.newPath}` : '+++ /dev/null');
  if (!header.some((l) => l.startsWith('diff --git '))) header.unshift(`diff --git a/${path} b/${path}`);
  return header.join('\n') + '\n' + hunk.raw;
}
