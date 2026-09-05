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
