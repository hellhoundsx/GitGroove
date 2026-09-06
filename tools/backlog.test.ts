import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// This test covers `tools/backlog.mjs`, so it sits next to it (GC-070, GC-174). The script is the
// routine's lock check and batch selection as one printed line, and the rule it applies is the
// protocol's step 3; a wrong answer here is a run that takes a batch out of order, skips one whose
// dependency shipped, or starts work beside a batch already running. So the rule is pinned on
// synthetic text — the real files change under every run — and the real files are only asked to
// parse without throwing.

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

type Decision =
  | { kind: 'locked'; ids: string[]; claimed: string | null; hours: number | null }
  | { kind: 'eligible'; tickets: { id: string; size: string; line: number }[] }
  | { kind: 'nothing' };

type Backlog = {
  MAX_BATCH: number;
  boardRows(lines: string[]): { id: string; size: string; status: string }[];
  sections(lines: string[]): { id: string; status: string; dependsOn: string[]; claimed: string | null; line: number }[];
  decide(tickets: string[], archive: string[], now?: Date): Decision;
  format(decision: Decision): string;
};

const mod = (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'tools', 'backlog.mjs')).href)) as Backlog;

const header = ['## Board', '', '| ID | Title | Area | Size | Priority | Status |', '| --- | --- | --- | --- | --- | --- |'];
const row = (id: string, status: string, size = 'S'): string => `| ${id} | A ticket | ui | ${size} | P1 | ${status} |`;
const section = (id: string, status: string, opts: { depends?: string; claimed?: string } = {}): string[] => [
  `### ${id} A ticket`,
  '',
  `- **Status:** ${status}`,
  `- **Depends on:** ${opts.depends ?? 'none'}`,
  '- **Log:**',
  ...(opts.claimed ? [`  - ${opts.claimed} claimed`] : []),
  '',
  '---',
  '',
];

describe('the backlog answers the routine in one line (GC-174)', () => {
  it('is locked while any ticket is in-progress, and says how old the claim is', () => {
    const tickets = [...header, row('GC-001', 'in-progress'), row('GC-002', 'todo'), ...section('GC-001', 'in-progress', { claimed: '2026-09-06 09:12' }), ...section('GC-002', 'todo')];
    const d = mod.decide(tickets, [], new Date(2026, 8, 6, 14, 30));
    expect(d.kind).toBe('locked');
    if (d.kind !== 'locked') return;
    expect(d.ids).toEqual(['GC-001']);
    expect(d.claimed).toBe('2026-09-06 09:12');
    expect(mod.format(d)).toBe('locked: GC-001 (claimed 2026-09-06 09:12, 5h ago)');
    // Past six hours the line says so, since that is the one thing the report has to mention.
    expect(mod.format(mod.decide(tickets, [], new Date(2026, 8, 6, 16, 30)))).toContain('older than six hours');
  });

  it('walks the board in order and takes a todo only once every dependency is done', () => {
    const tickets = [
      ...header,
      row('GC-003', 'todo'),
      row('GC-004', 'todo'),
      row('GC-005', 'todo'),
      ...section('GC-003', 'todo', { depends: 'GC-001 (`done`)' }),
      ...section('GC-004', 'todo', { depends: 'GC-005 (`todo`, for its dialog)' }),
      ...section('GC-005', 'todo'),
    ];
    // GC-001 is done: its row is on the archive's board, where GC-174 moved the done rows.
    const archive = [...header, row('GC-001', 'done'), ...section('GC-001', 'done')];
    const d = mod.decide(tickets, archive);
    expect(d.kind).toBe('eligible');
    if (d.kind !== 'eligible') return;
    expect(d.tickets.map((t) => t.id)).toEqual(['GC-003', 'GC-005']);
    // The line is where the section starts, 1-based, so a session can read that and nothing else.
    expect(tickets[d.tickets[0]!.line - 1]).toBe('### GC-003 A ticket');
    expect(mod.format(d)).toBe(`eligible: GC-003 (S, TICKETS.md:${d.tickets[0]!.line}), GC-005 (S, TICKETS.md:${d.tickets[1]!.line})`);
  });

  it('takes at most six, or exactly one when the first eligible ticket is size L', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `GC-00${i + 1}`);
    const many = [...header, ...ids.map((id) => row(id, 'todo')), ...ids.flatMap((id) => section(id, 'todo'))];
    const d = mod.decide(many, []);
    expect(d.kind === 'eligible' && d.tickets.length).toBe(mod.MAX_BATCH);

    const largeFirst = [...header, row('GC-001', 'todo', 'L'), row('GC-002', 'todo'), ...section('GC-001', 'todo'), ...section('GC-002', 'todo')];
    expect(mod.decide(largeFirst, [])).toEqual({ kind: 'eligible', tickets: [{ id: 'GC-001', size: 'L', line: largeFirst.indexOf('### GC-001 A ticket') + 1 }] });

    // An L that is not first rides along: the rule only speaks of the first eligible ticket.
    const largeSecond = [...header, row('GC-001', 'todo'), row('GC-002', 'todo', 'L'), ...section('GC-001', 'todo'), ...section('GC-002', 'todo')];
    const both = mod.decide(largeSecond, []);
    expect(both.kind === 'eligible' && both.tickets.length).toBe(2);
  });

  it('has nothing when no todo is eligible, and never takes a row its section disagrees with', () => {
    const tickets = [
      ...header,
      row('GC-001', 'blocked'),
      row('GC-002', 'todo'),
      row('GC-003', 'todo'),
      ...section('GC-001', 'blocked'),
      ...section('GC-002', 'todo', { depends: 'GC-009' }),
      // The row says todo, the section says blocked: the hygiene test reports that, this skips it.
      ...section('GC-003', 'blocked'),
    ];
    expect(mod.decide(tickets, [])).toEqual({ kind: 'nothing' });
    expect(mod.format({ kind: 'nothing' })).toBe('nothing eligible');
  });

  it('reads a Depends on of "none" as no dependency, whatever ids its aside mentions', () => {
    const [s] = mod.sections(section('GC-002', 'todo', { depends: 'none (GC-001 shipped the dialog)' }));
    expect(s!.dependsOn).toEqual([]);
    const [t] = mod.sections(section('GC-002', 'todo', { depends: 'GC-001 (`todo`), GC-003' }));
    expect(t!.dependsOn).toEqual(['GC-001', 'GC-003']);
  });

  it('answers the real backlog without throwing', () => {
    const read = (name: string): string[] => readFileSync(join(ROOT, name), 'utf8').split('\n');
    const line = mod.format(mod.decide(read('TICKETS.md'), read('TICKETS-ARCHIVE.md')));
    expect(line).toMatch(/^(locked: GC-|eligible: GC-|nothing eligible$)/);
  });
});
