import type { Commit } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { layoutGraph, type RowLayout } from './lanes';

/** A commit with only the fields the layout reads; everything else is filler. */
const commit = (sha: string, ...parents: string[]): Commit => ({
  sha,
  parents,
  authorName: 'Test',
  authorEmail: 'test@example.com',
  authorDate: '2026-01-01T00:00:00Z',
  committerName: 'Test',
  committerDate: '2026-01-01T00:00:00Z',
  summary: sha,
  body: '',
  refs: [],
});

const row = (rows: RowLayout[], sha: string): RowLayout => {
  const found = rows.find((r) => r.sha === sha);
  if (!found) throw new Error(`no row for ${sha}`);
  return found;
};

describe('layoutGraph', () => {
  it('handles an empty history', () => {
    const { rows, laneCount } = layoutGraph([]);
    expect(rows).toEqual([]);
    expect(laneCount).toBe(0);
  });

  it('keeps a linear history in a single lane', () => {
    const { rows, laneCount } = layoutGraph([commit('c3', 'c2'), commit('c2', 'c1'), commit('c1')]);
    expect(laneCount).toBe(1);
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0]);
    expect(rows.map((r) => r.color)).toEqual([0, 0, 0]);
    expect(rows.every((r) => r.through.length === 0)).toBe(true);
    expect(rows.every((r) => r.incoming.length === 0 && r.outgoing.length === 0)).toBe(true);
    // The tip has no child above it and the root no parent below it.
    expect(rows[0]!.hasChildAbove).toBe(false);
    expect(rows[0]!.hasParentBelow).toBe(true);
    expect(rows[2]!.hasChildAbove).toBe(true);
    expect(rows[2]!.hasParentBelow).toBe(false);
  });

  it('forks a merge commit to its second parent and closes the lane at the join', () => {
    // m merges b into a; both sides descend from base.
    const { rows, laneCount } = layoutGraph([
      commit('m', 'a', 'b'),
      commit('a', 'base'),
      commit('b', 'base'),
      commit('base'),
    ]);
    expect(laneCount).toBe(2);

    const m = row(rows, 'm');
    expect(m.lane).toBe(0);
    expect(m.outgoing).toEqual([{ lane: 1, color: 1 }]);
    expect(m.maxLane).toBe(1);

    expect(row(rows, 'a').lane).toBe(0);
    expect(row(rows, 'b').lane).toBe(1);

    // The two lines only join on the shared parent's own row.
    const base = row(rows, 'base');
    expect(base.lane).toBe(0);
    expect(base.incoming).toEqual([{ lane: 1, color: 1 }]);
    expect(base.hasParentBelow).toBe(false);
  });

  it('does not fork early when two lanes wait for the same parent', () => {
    // Regression guard: forking at `a`/`b` handed the checked-out branch's line to the
    // side branch (the bug that split master at 1.86.1 on catena-feed).
    const { rows } = layoutGraph([commit('a', 'base'), commit('b', 'base'), commit('base')]);

    const a = row(rows, 'a');
    const b = row(rows, 'b');
    expect(a.outgoing).toEqual([]);
    expect(b.outgoing).toEqual([]);
    // Both lines run to the parent's row, so each still has a parent below it...
    expect(a.hasParentBelow).toBe(true);
    expect(b.hasParentBelow).toBe(true);
    // ...and `b`'s row shows `a`'s lane passing straight through.
    expect(b.through).toEqual([{ lane: 0, color: 0 }]);
    expect(row(rows, 'base').incoming).toEqual([{ lane: 1, color: 1 }]);
  });

  it('reserves column 0 for HEAD lineage when HEAD is pinned', () => {
    // `side` is newer, so without a pin it claims column 0 first.
    const commits = [commit('side', 'base'), commit('head', 'base'), commit('base')];

    const unpinned = layoutGraph(commits);
    expect(row(unpinned.rows, 'side').lane).toBe(0);
    expect(row(unpinned.rows, 'head').lane).toBe(1);

    const pinned = layoutGraph(commits, 'head');
    expect(row(pinned.rows, 'head').lane).toBe(0);
    expect(row(pinned.rows, 'head').color).toBe(0);
    expect(row(pinned.rows, 'side').lane).toBe(1);
  });

  it('gives column 0 to a pinned sha that is not HEAD', () => {
    // GC-005 pins an arbitrary branch; `layoutGraph` must treat it exactly like HEAD.
    const commits = [commit('head', 'base'), commit('side', 'base'), commit('base')];

    expect(row(layoutGraph(commits).rows, 'head').lane).toBe(0);

    const pinned = layoutGraph(commits, 'side');
    expect(row(pinned.rows, 'side').lane).toBe(0);
    expect(row(pinned.rows, 'head').lane).toBe(1);
  });

  it('ignores a pinned sha that is not in the loaded commits', () => {
    const commits = [commit('c2', 'c1'), commit('c1')];
    expect(layoutGraph(commits, 'nope')).toEqual(layoutGraph(commits));
  });

  it('keeps a colour stable when a lane index is recycled', () => {
    // `y` opens lane 1; it closes on `base`; `z` then re-opens the same index.
    const { rows, laneCount } = layoutGraph([
      commit('x', 'base'),
      commit('y', 'base'),
      commit('base', 'root'),
      commit('z', 'root'),
      commit('root'),
    ]);
    expect(laneCount).toBe(2);

    const y = row(rows, 'y');
    const z = row(rows, 'z');
    expect(y.lane).toBe(1);
    expect(z.lane).toBe(1);
    // Colour follows the column index, so the recycled lane keeps lane 1's colour.
    expect(y.color).toBe(1);
    expect(z.color).toBe(1);
    expect(row(rows, 'base').lane).toBe(0);
    expect(row(rows, 'root').incoming).toEqual([{ lane: 1, color: 1 }]);
  });

  it('reports maxLane wide enough for every segment drawn in a row', () => {
    const { rows } = layoutGraph([commit('m', 'a', 'b'), commit('a', 'base'), commit('b', 'base'), commit('base')]);
    for (const r of rows) {
      const touched = [r.lane, ...r.through.map((s) => s.lane), ...r.incoming.map((s) => s.lane), ...r.outgoing.map((s) => s.lane)];
      expect(r.maxLane).toBe(Math.max(...touched));
    }
  });
});
