import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This test checks the *repository*, not any one module, so it sits beside the other repository
// tooling (GC-070): `vitest.config.ts`'s node project includes `tools/**/*.test.ts` and
// `tsconfig.node.json`, which already carries the node types, covers it for `npm run typecheck`.
//
// Why it exists (GC-047): GC-042 found a literal U+0000 that a session had typed straight into
// `shortcuts.test.ts`. vitest, `tsc` and the build all read the file happily, so it survived a
// whole ticket cycle; git, though, classified the file as binary, which silently drops it out of
// `git diff`, `git blame`, review and the `.gitattributes` LF normalisation. A byte-level scan
// catches it in milliseconds. Control characters belong in source as escapes, never as bytes.

/** Repo root: this file is at <root>/tools/. */
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

/** Trees walked in full. */
const TREES = ['src', 'tools'];

/**
 * Individual files at the root that are worth the same guarantee.
 *
 * `TICKETS-ARCHIVE.md` is on the list because of what GC-145 did (GC-158): it moved 630 KB of
 * backlog prose — every `done` ticket's section and every superseded review, 8,233 of the
 * backlog's 10,189 lines — out of `TICKETS.md` and into a file this list did not name, so the
 * prose that was guarded before the split was unguarded after it. Moving a section between two
 * files is exactly the kind of bulk copy that carries a stray byte, and the omission read as
 * deliberate because the split's own consistency checks below read both files.
 */
const ROOT_FILES = ['TICKETS.md', 'TICKETS-ARCHIVE.md', 'CLAUDE.md', 'README.md'];

/** Never descend into these: not ours, and huge. */
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git']);

/** Genuinely binary payloads, where control bytes are the point. */
const SKIP_EXTENSIONS = ['.png', '.woff2', '.ico'];

/** TAB and LF are the only C0 controls a text file in this repo may contain. */
const ALLOWED = new Set([0x09, 0x0a]);

function isBinaryName(name: string): boolean {
  return SKIP_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile() && !isBinaryName(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Every file the check covers, as repository-relative paths with forward slashes. */
function scannedFiles(): string[] {
  const files: string[] = [];
  for (const tree of TREES) walk(join(ROOT, tree), files);
  for (const name of ROOT_FILES) {
    const path = join(ROOT, name);
    try {
      if (statSync(path).isFile()) files.push(path);
    } catch {
      // A root file that does not exist is not this test's problem.
    }
  }
  return files.map((path) => relative(ROOT, path).split('\\').join('/'));
}

/** `<path>: <name> (0xNN) at byte offset N` for the first offending byte in the file, or null. */
function firstControlByte(relPath: string): string | null {
  const bytes = readFileSync(join(ROOT, relPath));
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x20 && !ALLOWED.has(byte)) {
      const hex = byte.toString(16).padStart(2, '0');
      const name = byte === 0x0d ? 'CR' : 'control character';
      return `${relPath}: ${name} (0x${hex}) at byte offset ${i}`;
    }
  }
  return null;
}

describe('repository hygiene', () => {
  it('walks the source trees without descending into build or dependency output', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => /(^|\/)(node_modules|out|dist)\//.test(f))).toEqual([]);
    // The root markdown files and both trees are actually reached. The archive is named here
    // rather than left to `ROOT_FILES` alone, so the next file the backlog grows cannot fall out
    // of the scan the way it did after GC-145 with nothing failing (GC-158).
    expect(files).toContain('CLAUDE.md');
    expect(files).toContain('TICKETS.md');
    expect(files).toContain('TICKETS-ARCHIVE.md');
    expect(files.some((f) => f.startsWith('src/'))).toBe(true);
    expect(files.some((f) => f.startsWith('tools/'))).toBe(true);
  });

  it('has no raw C0 control byte other than TAB and LF in any tracked source file', () => {
    const offenders = scannedFiles()
      .map(firstControlByte)
      .filter((hit): hit is string => hit !== null);
    // On failure vitest prints this array, so the file and the offset are in the output alone.
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The backlog's two files (GC-145)
//
// `TICKETS.md` holds the scaffolding, the whole board and every ticket a session can act on;
// `TICKETS-ARCHIVE.md` holds every `done` ticket's section and every review a newer one has
// superseded. The split is by status, so it stays correct as tickets move: a `todo` never
// migrates however old it gets, and a `done` always does. That only holds while every session
// remembers to move a section in the same commit as the status change, which is what these
// checks are for — the failure mode is silent, since both files render perfectly well with a
// section in the wrong one, or in both.

/** Both backlog files, as line arrays. Missing means empty, which every check below reports on. */
function backlogFiles(): { tickets: string[]; archive: string[] } {
  const read = (name: string): string[] => {
    try {
      return readFileSync(join(ROOT, name), 'utf8').split('\n');
    } catch {
      return [];
    }
  };
  return { tickets: read('TICKETS.md'), archive: read('TICKETS-ARCHIVE.md') };
}

/** Every `GC-0NN`/`GR-0NN` section in a file, with the status its own `Status:` line claims. */
export function sectionsOf(lines: string[]): { id: string; status: string }[] {
  const out: { id: string; status: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith('### ')) continue;
    const id = lines[i]!.slice(4).split(' ')[0]!;
    let status = '';
    for (let j = i + 1; j < lines.length && !lines[j]!.startsWith('### '); j++) {
      if (lines[j]!.startsWith('- **Status:** ')) {
        status = lines[j]!.slice('- **Status:** '.length).trim();
        break;
      }
    }
    out.push({ id, status });
  }
  return out;
}

/**
 * Every board row's id, read line by line. Never a regex: a pattern built by interpolating an id
 * into this table has silently matched the wrong line before, because the pipes were parsed as
 * alternation and `test()` still returned true — which is why the routine forbids it and why this
 * check reads the cells rather than matching them.
 */
export function boardIds(lines: string[]): string[] {
  return lines.filter((l) => l.startsWith('| GC-')).map((l) => l.split('|')[1]!.trim());
}

/**
 * What is wrong with the two files, one plain sentence each; empty means the split is intact.
 * Pure, so the cases that must fail can be fed synthetic text rather than staged in the real
 * backlog, which a test may not edit.
 */
export function backlogProblems(tickets: string[], archive: string[]): string[] {
  const problems: string[] = [];
  const open = sectionsOf(tickets);
  const closed = sectionsOf(archive);
  const byId = new Map<string, number>();
  for (const s of [...open, ...closed]) byId.set(s.id, (byId.get(s.id) ?? 0) + 1);

  for (const [id, n] of byId) if (n > 1) problems.push(`${id} has ${n} sections across the two files; it must have exactly one`);
  // Tickets only: a review is written `done` and the newest one belongs here, so `done` says
  // nothing about where a `GR-0NN` goes. Which review stays is its own rule, at the end.
  for (const s of open) if (s.id.startsWith('GC-') && s.status === 'done') problems.push(`${s.id} is done but its section is still in TICKETS.md; move it to the archive`);
  for (const s of closed) {
    if (s.id.startsWith('GC-') && s.status !== 'done') problems.push(`${s.id} is ${s.status || 'statusless'} but its section is in the archive; only done tickets belong there`);
  }

  // Every board row resolves to exactly one section, and every ticket section has a row.
  const rows = boardIds(tickets);
  for (const id of rows) if (!byId.has(id)) problems.push(`board row ${id} resolves to no section in either file`);
  const rowSet = new Set(rows);
  for (const s of [...open, ...closed]) if (s.id.startsWith('GC-') && !rowSet.has(s.id)) problems.push(`${s.id} has a section but no board row`);
  const seenRows = new Set<string>();
  for (const id of rows) {
    if (seenRows.has(id)) problems.push(`board row ${id} appears more than once`);
    seenRows.add(id);
  }

  // Exactly one review stays: the newest, whose `Window` sha the reviewer reads for the next one.
  const reviews = open.filter((s) => s.id.startsWith('GR-')).map((s) => s.id);
  if (reviews.length !== 1) problems.push(`TICKETS.md holds ${reviews.length} reviews; it must hold exactly the newest one`);
  else {
    const older = closed.filter((s) => s.id.startsWith('GR-')).map((s) => s.id);
    const newest = [...older, ...reviews].sort().pop();
    if (newest !== reviews[0]) problems.push(`TICKETS.md keeps ${reviews[0]} but ${newest} is newer; the newest review is the one that stays`);
  }
  return problems;
}

describe('the backlog is split by status across its two files (GC-145)', () => {
  it('has every board row resolving to exactly one section, and no done ticket left in TICKETS.md', () => {
    const { tickets, archive } = backlogFiles();
    expect(tickets.length).toBeGreaterThan(100);
    expect(archive.length).toBeGreaterThan(100);
    // On failure vitest prints this array, so each problem names its own id and file.
    expect(backlogProblems(tickets, archive)).toEqual([]);
  });

  it('keeps TICKETS.md small enough that "read it fully" is an instruction a session can follow', () => {
    // The reason the split exists: 8,796 lines, of which 70.6% were done tickets (GC-145).
    expect(backlogFiles().tickets.length).toBeLessThan(2500);
  });

  const board = ['## Board', '| ID | Title | Area | Size | Priority | Status |', '| --- | --- | --- | --- | --- | --- |', '| GC-001 | A | ui | S | P1 | todo |'];
  const section = (id: string, status: string): string[] => [`### ${id} A`, '', `- **Status:** ${status}`, ''];

  it('fails when one id has a section in both files', () => {
    const tickets = [...board, ...section('GC-001', 'todo'), ...section('GR-002', 'done')];
    const archive = [...section('GC-001', 'done'), ...section('GR-001', 'done')];
    expect(backlogProblems(tickets, archive)).toContain('GC-001 has 2 sections across the two files; it must have exactly one');
  });

  it('fails when a board row resolves to no section at all', () => {
    const tickets = [...board, ...section('GR-002', 'done')];
    const archive = [...section('GR-001', 'done')];
    expect(backlogProblems(tickets, archive)).toContain('board row GC-001 resolves to no section in either file');
  });

  it('fails when a done ticket is left in TICKETS.md, or an open one is filed in the archive', () => {
    expect(backlogProblems([...board, ...section('GC-001', 'done'), ...section('GR-002', 'done')], [...section('GR-001', 'done')])).toContain(
      'GC-001 is done but its section is still in TICKETS.md; move it to the archive',
    );
    expect(backlogProblems([...board, ...section('GR-002', 'done')], [...section('GC-001', 'todo'), ...section('GR-001', 'done')])).toContain(
      'GC-001 is todo but its section is in the archive; only done tickets belong there',
    );
  });

  it('fails when a superseded review is left beside the newest one', () => {
    const tickets = [...board, ...section('GC-001', 'todo'), ...section('GR-001', 'done'), ...section('GR-002', 'done')];
    expect(backlogProblems(tickets, [])).toContain('TICKETS.md holds 2 reviews; it must hold exactly the newest one');
    // And when the one kept is not the newest, which is the way round that loses the Window sha.
    expect(backlogProblems([...board, ...section('GC-001', 'todo'), ...section('GR-001', 'done')], [...section('GR-002', 'done')])).toContain(
      'TICKETS.md keeps GR-001 but GR-002 is newer; the newest review is the one that stays',
    );
  });

  it('passes on a pair of files that are split correctly', () => {
    const tickets = [...board, '| GC-002 | B | ui | S | P1 | done |', ...section('GC-001', 'todo'), ...section('GR-002', 'done')];
    const archive = [...section('GC-002', 'done'), ...section('GR-001', 'done')];
    expect(backlogProblems(tickets, archive)).toEqual([]);
  });
});
