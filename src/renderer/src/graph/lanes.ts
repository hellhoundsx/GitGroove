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

export interface GraphLayout {
  rows: RowLayout[];
  laneCount: number;
}

/**
 * @param pinnedSha commit whose lineage must occupy column 0 (the checked-out branch). Column 0 is
 *   reserved for it from the first row, so the WIP row and the dashed link to HEAD always sit at the left.
 */
export function layoutGraph(commits: Commit[], pinnedSha?: string | null): GraphLayout {
  // active[i] = sha that lane i is waiting for (the next commit to appear in that lane)
  const active: (string | null)[] = [];
  const laneColor: number[] = []; // colour by column index, so colours stay stable as lanes recycle
  let laneCount = 0;
  const rows: RowLayout[] = [];

  if (pinnedSha && commits.some((c) => c.sha === pinnedSha)) {
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

  return { rows, laneCount };
}
