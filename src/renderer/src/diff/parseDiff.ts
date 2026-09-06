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

/** One run of a changed line: the text, and whether it is part of what actually differs. */
export interface WordSpan {
  text: string;
  changed: boolean;
}

/** What `wordDiff` returns: the spans to draw on each side of one paired line. */
export interface WordDiff {
  left: WordSpan[];
  right: WordSpan[];
}

/** Words, whitespace runs and single punctuation characters, which is the granularity we mark at. */
const TOKEN_RE = /[A-Za-z0-9_]+|\s+|[^\sA-Za-z0-9_]/g;

/** How much of the longer line the two must still share before marking spans says anything. */
const MIN_COMMON = 0.25;
/** Above this many tokens a side, the quadratic LCS is not worth running on a single row. */
const MAX_TOKENS = 400;

const isSpace = (t: string): boolean => /^\s+$/.test(t);
const width = (tokens: string[]): number => tokens.reduce((n, t) => n + t.length, 0);

/**
 * The word-level spans that differ between the two versions of one line (GC-104).
 *
 * A common prefix and suffix come off first — most edits are surrounded by text that did not move
 * — and only what is left goes through a word LCS, so the quadratic part runs on the changed
 * middle rather than on the whole line. `null` means "mark nothing": the lines are identical, or
 * they have so little in common that spans would be confetti rather than an edit, and there the
 * plain line tint says more.
 */
export function wordDiff(oldText: string, newText: string): WordDiff | null {
  if (oldText === newText) return null;
  const a = oldText.match(TOKEN_RE) ?? [];
  const b = newText.match(TOKEN_RE) ?? [];
  if (a.length === 0 || b.length === 0) return null;
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) return null;

  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const midA = a.slice(pre, a.length - suf);
  const midB = b.slice(pre, b.length - suf);

  // Longest common subsequence of the two middles: what it keeps is what stays unmarked inside
  // the edit, and everything else is a span.
  const n = midA.length;
  const m = midB.length;
  const table: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const changedA = new Array<boolean>(n).fill(true);
  const changedB = new Array<boolean>(m).fill(true);
  let common = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (midA[i] === midB[j]) {
      changedA[i] = false;
      changedB[j] = false;
      common += midA[i]!.length;
      i++;
      j++;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i++;
    else j++;
  }

  // Two lines with nothing much in common are a replacement, not an edit.
  const shared = width(a.slice(0, pre)) + width(a.slice(a.length - suf)) + common;
  if (shared < MIN_COMMON * Math.max(oldText.length, newText.length)) return null;

  return { left: spans(a, pre, suf, changedA), right: spans(b, pre, suf, changedB) };
}

/** Glue the token flags back into runs, never starting or ending one on whitespace. */
function spans(tokens: string[], pre: number, suf: number, changedMid: boolean[]): WordSpan[] {
  const flags = tokens.map((_, i) => (i < pre || i >= tokens.length - suf ? false : changedMid[i - pre]!));
  // A run that begins or ends on a space would highlight the gap beside the edited word rather
  // than the word, so that space stays with the text that did not change.
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i] || !isSpace(tokens[i]!)) continue;
    if (!flags[i - 1] || !flags[i + 1]) flags[i] = false;
  }
  const out: WordSpan[] = [];
  for (const [i, token] of tokens.entries()) {
    const last = out[out.length - 1];
    if (last && last.changed === flags[i]) last.text += token;
    else out.push({ text: token, changed: flags[i]! });
  }
  return out;
}

/**
 * The intra-line spans for every paired line of a hunk, keyed by the line itself (GC-104).
 *
 * The pairing is `alignHunks`', so the unified layout marks exactly the same spans on exactly the
 * same lines as the split one: only a removal sitting opposite an addition is paired, and a padded
 * side, a pure addition and a pure removal are left to the plain line tint.
 */
export function hunkWordSpans(hunk: DiffHunk): Map<DiffLine, WordSpan[]> {
  const out = new Map<DiffLine, WordSpan[]>();
  for (const { left, right } of alignHunks(hunk)) {
    if (!left || !right || left.type !== 'del' || right.type !== 'add') continue;
    const d = wordDiff(left.text, right.text);
    if (!d) continue;
    out.set(left, d.left);
    out.set(right, d.right);
  }
  return out;
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
