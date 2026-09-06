import type { Commit } from '@shared/types';
import { describe, expect, it } from 'vitest';
import { continuesRange, layoutGraph, wipDashFor, type RowLayout } from './lanes';

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

  it('keeps both lines continuous when a side branch is pinned', () => {
    // GC-005: pinning `side` must move its whole lineage to column 0 and push HEAD's to lane 1,
    // with neither line breaking or forking before the row where they actually meet.
    const commits = [
      commit('h2', 'h1'),
      commit('s2', 's1'),
      commit('h1', 'base'),
      commit('s1', 'base'),
      commit('base'),
    ];
    const { rows, laneCount } = layoutGraph(commits, 's2');
    expect(laneCount).toBe(2);

    expect([row(rows, 's2').lane, row(rows, 's1').lane]).toEqual([0, 0]);
    expect([row(rows, 'h2').lane, row(rows, 'h1').lane]).toEqual([1, 1]);
    // No line is handed over early: every row keeps its own lane down to the shared parent.
    expect(rows.every((r) => r.outgoing.length === 0)).toBe(true);
    expect(row(rows, 's2').through).toEqual([{ lane: 1, color: 1 }]);
    expect(row(rows, 'h1').through).toEqual([{ lane: 0, color: 0 }]);
    // They join on `base`, which sits in the pinned column.
    const base = row(rows, 'base');
    expect(base.lane).toBe(0);
    expect(base.incoming).toEqual([{ lane: 1, color: 1 }]);
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

  // Paging past the first MAX_COMMITS lays out each page as it arrives, so a page has to continue
  // the lanes the one before it left open rather than starting again at column 0 (GC-012). The
  // property that matters is that paging changes nothing: one call over the whole range and one
  // call per page must produce the same rows, in the same lanes, in the same colours.
  describe('paging (GC-012)', () => {
    // A history that still has three lines open at every split point below, so a page boundary
    // falls in the middle of lanes that are carrying colour: two side branches over a shared base.
    const history = [
      commit('m', 'a', 'b'),
      commit('a', 'a2'),
      commit('b', 'b2'),
      commit('a2', 'base'),
      commit('b2', 'base'),
      commit('base', 'root'),
      commit('root'),
    ];

    for (const at of [1, 2, 3, 4, 5, 6]) {
      it(`lays out the same graph split after row ${at} as in one call`, () => {
        const whole = layoutGraph(history, 'm');
        const head = layoutGraph(history.slice(0, at), 'm');
        const tail = layoutGraph(history.slice(at), 'm', head.state);
        expect([...head.rows, ...tail.rows]).toEqual(whole.rows);
        expect(tail.laneCount).toBe(whole.laneCount);
      });
    }

    it('carries an open lane into the next page rather than reopening it', () => {
      // Split between `b` and `a2`: both lanes are still waiting for a commit further down. The
      // trailing free lanes are trimmed as the layout goes, so the state carries no tail of nulls.
      const head = layoutGraph(history.slice(0, 3), 'm');
      expect(head.state.active).toEqual(['a2', 'b2']);
      const tail = layoutGraph(history.slice(3), 'm', head.state);
      // `a2` continues in lane 0 and `b2` in lane 1 — neither is handed a fresh lane.
      expect(row(tail.rows, 'a2').lane).toBe(0);
      expect(row(tail.rows, 'b2').lane).toBe(1);
      expect(row(tail.rows, 'a2').hasChildAbove).toBe(true);
      expect(row(tail.rows, 'b2').hasChildAbove).toBe(true);
    });

    it('does not re-seed the pinned lane on a later page', () => {
      // The pin reserved column 0 on the first page; a later page must take column 0 from what is
      // actually still in it, not push a second reservation on top.
      const head = layoutGraph(history.slice(0, 2), 'm');
      const tail = layoutGraph(history.slice(2), 'm', head.state);
      expect(tail.rows.every((r) => r.lane <= head.laneCount)).toBe(true);
      expect([...head.rows, ...tail.rows]).toEqual(layoutGraph(history, 'm').rows);
    });

    it('leaves the caller free to keep paging: the state after a page continues the one after that', () => {
      const whole = layoutGraph(history, 'm');
      const p1 = layoutGraph(history.slice(0, 3), 'm');
      const p2 = layoutGraph(history.slice(3, 5), 'm', p1.state);
      const p3 = layoutGraph(history.slice(5), 'm', p2.state);
      expect([...p1.rows, ...p2.rows, ...p3.rows]).toEqual(whole.rows);
    });

    it('does not mutate the state it was handed, so a page can be laid out twice', () => {
      const head = layoutGraph(history.slice(0, 3), 'm');
      const before = JSON.stringify(head.state);
      const once = layoutGraph(history.slice(3), 'm', head.state);
      expect(JSON.stringify(head.state)).toBe(before);
      const twice = layoutGraph(history.slice(3), 'm', head.state);
      expect(twice.rows).toEqual(once.rows);
    });
  });

  // What `CommitGraph` uses to decide whether the range it already laid out can be continued or
  // has to be laid out again (GC-106). Getting this wrong is not a slow graph, it is a wrong one:
  // continuing a range that was actually replaced would carry lanes from commits no longer there.
  describe('continuesRange (GC-106)', () => {
    const history = [commit('m', 'a', 'b'), commit('a', 'a2'), commit('b', 'b2'), commit('a2', 'base'), commit('b2', 'base'), commit('base')];
    const page1 = history.slice(0, 3);

    it('accepts a page appended to the range already laid out', () => {
      expect(continuesRange(page1, history)).toBe(true);
    });

    it('rejects the same range, so nothing is appended twice', () => {
      expect(continuesRange(page1, page1)).toBe(false);
    });

    it('rejects a shorter range', () => {
      expect(continuesRange(history, page1)).toBe(false);
    });

    it('rejects a longer range with a new commit at the top', () => {
      // A reload after a commit: the array grew, but not on the end.
      expect(continuesRange(page1, [commit('new', 'm'), ...history])).toBe(false);
    });

    it('rejects a longer range with a commit removed from the middle', () => {
      // A reload with another branch hidden: longer than the first page, but not an extension of it.
      const reloaded = [history[0]!, history[2]!, history[3]!, history[4]!, history[5]!];
      expect(reloaded.length).toBeGreaterThan(page1.length);
      expect(continuesRange(page1, reloaded)).toBe(false);
    });

    it('rejects anything against an empty range', () => {
      expect(continuesRange([], history)).toBe(false);
    });

    it('appending a page gives exactly the rows of laying out the concatenation', () => {
      // The path the component takes, end to end: lay out a page, continue it, concatenate.
      const first = layoutGraph(page1, 'm');
      const next = layoutGraph(history.slice(page1.length), 'm', first.state);
      expect(continuesRange(page1, history)).toBe(true);
      expect([...first.rows, ...next.rows]).toEqual(layoutGraph(history, 'm').rows);
      expect(next.laneCount).toBe(layoutGraph(history, 'm').laneCount);
    });

    it('a replaced range laid out afresh matches a single call, as the fallback must', () => {
      const reloaded = [history[0]!, history[2]!, history[4]!, history[5]!];
      expect(continuesRange(page1, reloaded)).toBe(false);
      expect(layoutGraph(reloaded, 'm').rows).toEqual(layoutGraph(reloaded, 'm').rows);
    });
  });

  it('reports maxLane wide enough for every segment drawn in a row', () => {
    const { rows } = layoutGraph([commit('m', 'a', 'b'), commit('a', 'base'), commit('b', 'base'), commit('base')]);
    for (const r of rows) {
      const touched = [r.lane, ...r.through.map((s) => s.lane), ...r.incoming.map((s) => s.lane), ...r.outgoing.map((s) => s.lane)];
      expect(r.maxLane).toBe(Math.max(...touched));
    }
  });
});

describe('wipDashFor', () => {
  // The run has to be dashed for its whole length, and the rows it crosses are exactly the ones
  // whose lane 0 is the seed `layoutGraph` reserved for HEAD — a through segment, which is what
  // the old "only a lane nothing is using" rule refused, leaving the WIP row's 14px stub alone
  // dashed (GC-144).
  const dashes = (rows: RowLayout[], headSha: string, owns = true): (string | null)[] => {
    const at = rows.findIndex((r) => r.sha === headSha);
    return rows.map((r, i) => wipDashFor(r, i, at, rows[at]!.lane, owns));
  };

  it('dashes the row between the WIP node and HEAD, and above HEAD s node', () => {
    // `a` sits above HEAD's commit `b`; both reach the root `c`, so lane 0 carries HEAD's seed
    // through row `a` and `b` has a child line above it.
    const { rows } = layoutGraph([commit('a', 'c'), commit('b', 'c'), commit('c')], 'b');
    expect(row(rows, 'a').through.map((s) => s.lane)).toContain(0); // the lane the run travels in
    expect(row(rows, 'b').hasChildAbove).toBe(true); // and it is the seed, not a real child
    expect(dashes(rows, 'b')).toEqual(['through', 'toNode', null]);
  });

  it('dashes every row in between when HEAD is several rows down', () => {
    const history = [commit('a', 'e'), commit('b', 'e'), commit('c', 'e'), commit('d', 'e'), commit('e')];
    const { rows } = layoutGraph(history, 'd');
    expect(rows.findIndex((r) => r.sha === 'd')).toBe(3);
    expect(dashes(rows, 'd')).toEqual(['through', 'through', 'through', 'toNode', null]);
  });

  it('never dashes below HEAD s node or when HEAD is not in the loaded range', () => {
    const { rows } = layoutGraph([commit('a', 'b'), commit('b')], 'a');
    expect(wipDashFor(row(rows, 'b'), 1, 0, 0, true)).toBe(null);
    // headRowIndex of -1 is HEAD past the end of the page: nothing may be dashed at all.
    expect(rows.map((r, i) => wipDashFor(r, i, -1, 0, true))).toEqual([null, null]);
  });

  it('with another branch pinned to column 0, only a lane nothing else uses carries the run', () => {
    // `p` is pinned, so HEAD's `h` opens a lane of its own and the seed in column 0 is not its.
    const { rows } = layoutGraph([commit('p', 'r'), commit('h', 'r'), commit('r')], 'p');
    const headLane = row(rows, 'h').lane;
    expect(headLane).not.toBe(0);
    // Row `p` has nothing in HEAD's lane yet, so the run may pass through it.
    expect(wipDashFor(row(rows, 'p'), 0, 1, headLane, false)).toBe('through');
    // But a row already using that lane keeps its own line: `p`'s own lane is not HEAD's to dash.
    expect(wipDashFor(row(rows, 'p'), 0, 1, row(rows, 'p').lane, false)).toBe(null);
    // HEAD's row opens its lane there, so there is no line above the node to dash.
    expect(row(rows, 'h').hasChildAbove).toBe(false);
    expect(wipDashFor(row(rows, 'h'), 1, 1, headLane, false)).toBe('toNode');
  });
});
