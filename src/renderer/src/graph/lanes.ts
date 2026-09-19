import type { Commit } from '@shared/types';

/**
 * Lane assignment for a commit graph.
 *
 * Commits must arrive in topological order (children before parents), which is
 * what `git log --topo-order` produces. Each row gets a lane for its node plus
 * the set of line segments to draw within that row's 28px band:
 *  - `through`: lanes that pass straight through this row without touching the node
 *  - `merges`: lanes entering the node from above (extra children ending here)
 *  - `forks`: lanes leaving the node downwards to parents that live in another lane
 */

export interface Segment {
  lane: number; // the other lane involved
  color: number; // lane index used for colour
}

export interface RowLayout {
  sha: string;
  lane: number;
  color: number;
  through: Segment[]; // vertical pass-through lines (lane == color)
  incoming: Segment[]; // lines from lane `x` at the top of the row into the node
  outgoing: Segment[]; // lines from the node to lane `x` at the bottom of the row
  hasParentBelow: boolean; // draw the node's own lane continuing downward
  hasChildAbove: boolean; // draw the node's own lane continuing upward
  maxLane: number; // widest lane index touched by this row (for column width)
}

/**
 * The lane bookkeeping as it stands at the end of a laid-out range, which is everything the next
 * page of commits needs to continue it (GC-012): which sha each lane is still waiting for, the
 * colour that lane carries, and how wide the graph has been so far. Passing it back into
 * `layoutGraph` lays out a later page as if it had been part of one call, so a line that is open
 * where a page ends keeps its lane and colour instead of restarting at column 0.
 */
export interface LaneState {
  active: (string | null)[];
  laneColor: number[];
  laneCount: number;
}

/**
 * Whether `next` is `prev` with more commits on the end — the only shape the `prev` parameter of
 * `layoutGraph` is valid for (GC-106). A page appends, so the range already laid out survives as a
 * prefix; everything else replaces `commits` wholesale — a reload, another repository, a change of
 * pin or of the hidden set — and must be laid out from the first row. Checking both ends of the
 * old range catches a replacement that happens to be longer: a commit removed from the middle
 * moves the sha that used to sit last, and a new commit at the top moves the first.
 */
export function continuesRange(prev: Commit[], next: Commit[]): boolean {
  return (
    prev.length > 0 &&
    next.length > prev.length &&
    next[0]!.sha === prev[0]!.sha &&
    next[prev.length - 1]!.sha === prev[prev.length - 1]!.sha
  );
}

export interface GraphLayout {
  rows: RowLayout[];
  laneCount: number;
  /** Hand this to the next `layoutGraph` call to continue these lanes into the next page (GC-012). */
  state: LaneState;
}

/** What a row draws of the dashed WIP-to-HEAD run: the whole lane, the stretch above its node, or nothing. */
export type WipDash = 'through' | 'toNode' | null;

/** Whether `lane` is untouched by this row — no node, no through line, nothing curving in or out. */
export function laneFree(row: RowLayout, lane: number): boolean {
  return row.lane !== lane && !row.through.some((s) => s.lane === lane) && !row.incoming.some((s) => s.lane === lane) && !row.outgoing.some((s) => s.lane === lane);
}

/**
 * Which part of HEAD's lane one row draws dashed (GC-144). The dash says "the node above is not a
 * commit yet", so it has to cover the whole distance from the WIP node down to HEAD's node,
 * however many rows that spans — it used to be the WIP row's own 14px stub and nothing else,
 * because the only rule here refused a lane that any line was already using, and the lane between
 * WIP and HEAD always has one: HEAD's own.
 *
 * `headOwnsLane` is what tells those two apart. Column 0 is reserved for HEAD's lineage from the
 * first row (`layoutGraph` seeds `active[0]`), so while that holds, the line in it above HEAD's
 * row *is* the run and is drawn dashed in place of the solid one. A commit reaching HEAD's tip
 * from above cannot take that lane — the seed is holding it — so it arrives as an `incoming`
 * curve and never turns a real child's line into a dash. With another branch pinned to column 0
 * the seed is that branch's, HEAD's lane is an ordinary one, and only a lane nothing else is
 * using may carry the run.
 *
 * @param index the row's index into the laid-out rows, not the display index the WIP row shifts.
 */
export function wipDashFor(row: RowLayout, index: number, headRowIndex: number, headLane: number, headOwnsLane: boolean): WipDash {
  if (headRowIndex < 0 || index > headRowIndex) return null;
  // HEAD's own row: dashed above the node, and solid below it — that segment leaves a real commit.
  if (index === headRowIndex) return headOwnsLane || !row.hasChildAbove ? 'toNode' : null;
  return headOwnsLane || laneFree(row, headLane) ? 'through' : null;
}

/**
 * The lanes a commit's stash rows branch out into (GC-216).
 *
 * GC-170 drew a stash in its parent's own lane, so the row read as one more commit on that
 * branch — a straight line with a dashed circle somewhere in it. A stash *is* a child of that
 * commit (its first parent is the tip it was taken from), so it is drawn the way every other
 * child is: in a lane of its own, joining the parent's node from the side. That is the whole
 * change — the node, the line down its lane and the curve into the parent at the row below.
 *
 * `lanes.ts` still never sees a `Stash`: this takes the parent's laid-out row and a count, so
 * `layoutGraph`'s own lanes are untouched and the split-and-rejoin property holds. The lanes are
 * the free ones to the **right** of the parent, `laneFree` answering which — a lane carrying a
 * through line, a curve into the node or the node itself would be crossed by the stash's own
 * line. `dashLane` is out for the same reason and is not `laneFree`'s to know: the WIP-to-HEAD
 * run is drawn in place of a line rather than over one (GC-144), so nothing in the layout marks
 * the lane it travels in as taken.
 *
 * Reversed on the way out, so the returned order is the order the rows are drawn in — topmost
 * first (`displayRows` puts `stash@{0}` furthest from its parent) — and the stash **nearest** the
 * parent takes the innermost lane. The alternative nests them the other way round, crossing every
 * stash's line over the ones below it.
 */
export function stashLanes(row: RowLayout, count: number, dashLane?: number): number[] {
  const lanes: number[] = [];
  for (let lane = row.lane + 1; lanes.length < count; lane++) {
    if (laneFree(row, lane) && lane !== dashLane) lanes.push(lane);
  }
  return lanes.reverse();
}

/**
 * @param pinnedSha commit whose lineage must occupy column 0 (the checked-out branch). Column 0 is
 *   reserved for it from the first row, so the WIP row and the dashed link to HEAD always sit at the left.
 * @param prev the `state` of the layout this range continues (GC-012). When given, the lanes it
 *   describes are carried in and `pinnedSha` is not re-seeded: column 0 was reserved by the first
 *   page and is still held by whatever that page left in it.
 */
export function layoutGraph(commits: Commit[], pinnedSha?: string | null, prev?: LaneState | null): GraphLayout {
  // active[i] = sha that lane i is waiting for (the next commit to appear in that lane)
  const active: (string | null)[] = prev ? [...prev.active] : [];
  const laneColor: number[] = prev ? [...prev.laneColor] : []; // colour by column index, so colours stay stable as lanes recycle
  let laneCount = prev ? prev.laneCount : 0;
  const rows: RowLayout[] = [];

  if (!prev && pinnedSha && commits.some((c) => c.sha === pinnedSha)) {
    active.push(pinnedSha);
    laneColor[0] = 0;
    laneCount = 1;
  }

  const openLane = (sha: string): number => {
    let i = active.indexOf(null);
    if (i === -1) {
      i = active.length;
      active.push(null);
    }
    active[i] = sha;
    laneColor[i] = i % 10;
    laneCount = Math.max(laneCount, i + 1);
    return i;
  };

  for (const c of commits) {
    // Every lane currently expecting this commit: the first becomes the node's lane,
    // the others are children merging into it.
    const waiting: number[] = [];
    active.forEach((s, i) => {
      if (s === c.sha) waiting.push(i);
    });

    let lane: number;
    let hasChildAbove = true;
    if (waiting.length === 0) {
      lane = openLane(c.sha);
      hasChildAbove = false;
    } else {
      lane = waiting[0];
    }
    const color = laneColor[lane];

    const incoming: Segment[] = [];
    for (const w of waiting.slice(1)) {
      incoming.push({ lane: w, color: laneColor[w] });
      active[w] = null; // that lane ends here
    }

    // Pass-through lanes: active lanes not involved with this node.
    const through: Segment[] = [];
    active.forEach((s, i) => {
      if (s !== null && i !== lane) through.push({ lane: i, color: laneColor[i] });
    });

    // Parents: first parent continues in this lane, others fork out.
    const outgoing: Segment[] = [];
    const [first, ...rest] = c.parents;
    if (first) {
      active[lane] = first;
    } else {
      active[lane] = null; // root commit
    }
    for (const p of rest) {
      const existing = active.indexOf(p);
      if (existing !== -1 && existing !== lane) {
        outgoing.push({ lane: existing, color: laneColor[existing] });
      } else {
        const l = openLane(p);
        outgoing.push({ lane: l, color: laneColor[l] });
      }
    }

    // When another lane already awaits the same first parent, both lines keep their own lane
    // until the parent's row; there the lowest lane takes the node and the others curve into it.
    // Forking early would hand the checked-out branch's straight line over to a side branch.

    const hasParentBelow = active[lane] !== null;
    const maxLane = Math.max(lane, ...through.map((s) => s.lane), ...incoming.map((s) => s.lane), ...outgoing.map((s) => s.lane));

    rows.push({ sha: c.sha, lane, color, through, incoming, outgoing, hasParentBelow, hasChildAbove, maxLane });

    // Trim trailing free lanes so the graph stays compact.
    while (active.length && active[active.length - 1] === null) active.pop();
  }

  return { rows, laneCount, state: { active, laneColor, laneCount } };
}
