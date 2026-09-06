// What the routine asks the backlog before it reads anything: is a batch running, and if not,
// which tickets are eligible (GC-174).
//
// The routine fires every few minutes and most runs do nothing, but its step 0 used to be "read
// `CLAUDE.md`, then `TICKETS.md` in full" — about 56k tokens — and only then did step 2 look for
// an `in-progress` line and exit. This script is that lock check and the batch selection in one
// line of output, so a run that has nothing to do reads nothing else:
//
//   locked: GC-123, GC-124 (claimed 2026-09-06 09:12, 5h ago)
//   eligible: GC-128 (M, TICKETS.md:674), GC-139 (S, TICKETS.md:875)
//   nothing eligible
//
// The selection rule is the routine's step 3, stated there for checking by hand: walk the board
// top to bottom, take a `todo` row whose every `Depends on` ticket is `done`, up to six, or just
// one when the first eligible ticket is size L. A ticket is `done` when its row is on the archive's
// board (GC-174 moved the `done` rows there) or its section says so.
//
// Board rows are read cell by cell, never with a regex built from an id: the routine forbids that
// for the reason `TICKETS.md` gives, and `tools/repo-hygiene.test.ts` reads them the same way.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Up to this many tickets in a batch, in board order. */
export const MAX_BATCH = 6;

/** A claim older than this is worth a line in the report, though never a takeover. */
export const STALE_HOURS = 6;

/** The `| GC-0NN | title | area | size | priority | status |` rows of a file, in board order. */
export function boardRows(lines) {
  const rows = [];
  for (const line of lines) {
    if (!line.startsWith('| GC-')) continue;
    // `| a | b |` splits into ['', 'a', 'b', ''], so the six cells are 1..6.
    const c = line.split('|').map((cell) => cell.trim());
    rows.push({ id: c[1], title: c[2], area: c[3], size: c[4], priority: c[5], status: c[6] });
  }
  return rows;
}

/**
 * Every `### GC-0NN` / `### GR-0NN` section: id, the status its own line claims, the ids its
 * `Depends on` names (none for `none`), the last `claimed` log line's time, and the 1-based line
 * the section starts on, which is what a session re-reads instead of the whole file.
 */
export function sections(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('### ')) continue;
    const s = { id: lines[i].slice(4).split(' ')[0], status: '', dependsOn: [], claimed: null, line: i + 1 };
    for (let j = i + 1; j < lines.length && !lines[j].startsWith('### '); j++) {
      const l = lines[j];
      if (l.startsWith('- **Status:** ')) s.status = l.slice('- **Status:** '.length).trim();
      else if (l.startsWith('- **Depends on:** ')) {
        const rest = l.slice('- **Depends on:** '.length).trim();
        s.dependsOn = rest.startsWith('none') ? [] : (rest.match(/GC-\d{3}/g) ?? []);
      } else if (/^\s+- \d{4}-\d{2}-\d{2} \d{2}:\d{2} claimed\b/.test(l)) s.claimed = l.trim().slice(2, 18);
    }
    out.push(s);
  }
  return out;
}

/** `YYYY-MM-DD HH:MM` in local time, the way the routine writes a claim line. */
export function parseClaim(text) {
  const [date, time] = text.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi);
}

/**
 * The routine's steps 1 and 3 as one answer: `{ kind: 'locked', ids, claimed, hours }` while any
 * ticket is `in-progress`, `{ kind: 'eligible', tickets: [{ id, size, line }] }` when there is a
 * batch to take, `{ kind: 'nothing' }` otherwise. Pure, so the rule is tested on synthetic text.
 */
export function decide(ticketLines, archiveLines, now = new Date()) {
  const secs = sections(ticketLines).filter((s) => s.id.startsWith('GC-'));
  const byId = new Map(secs.map((s) => [s.id, s]));
  const done = new Set([
    ...boardRows(archiveLines).filter((r) => r.status === 'done').map((r) => r.id),
    ...[...secs, ...sections(archiveLines)].filter((s) => s.status === 'done').map((s) => s.id),
  ]);

  const running = secs.filter((s) => s.status === 'in-progress');
  if (running.length > 0) {
    const claims = running.map((s) => s.claimed).filter(Boolean).sort();
    const claimed = claims.length ? claims[claims.length - 1] : null;
    const hours = claimed ? (now.getTime() - parseClaim(claimed).getTime()) / 3600000 : null;
    return { kind: 'locked', ids: running.map((s) => s.id), claimed, hours };
  }

  const tickets = [];
  for (const row of boardRows(ticketLines)) {
    if (row.status !== 'todo') continue;
    const s = byId.get(row.id);
    // A row and a section that disagree are the hygiene test's to report, not a batch to take.
    if (!s || s.status !== 'todo') continue;
    if (!s.dependsOn.every((id) => done.has(id))) continue;
    tickets.push({ id: row.id, size: row.size, line: s.line });
    if (tickets.length === 1 && row.size === 'L') break;
    if (tickets.length === MAX_BATCH) break;
  }
  return tickets.length > 0 ? { kind: 'eligible', tickets } : { kind: 'nothing' };
}

/** The one line the routine reads. */
export function format(decision) {
  if (decision.kind === 'locked') {
    const when = decision.claimed
      ? `claimed ${decision.claimed}, ${Math.floor(decision.hours)}h ago${decision.hours >= STALE_HOURS ? '; older than six hours, mention it in the report' : ''}`
      : 'no claim line found';
    return `locked: ${decision.ids.join(', ')} (${when})`;
  }
  if (decision.kind === 'eligible') return `eligible: ${decision.tickets.map((t) => `${t.id} (${t.size}, TICKETS.md:${t.line})`).join(', ')}`;
  return 'nothing eligible';
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const read = (name) => readFileSync(join(ROOT, name), 'utf8').split('\n');
  console.log(format(decide(read('TICKETS.md'), read('TICKETS-ARCHIVE.md'))));
}
