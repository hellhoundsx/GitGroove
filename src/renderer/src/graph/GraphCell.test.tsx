import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { RowLayout } from './lanes';
import { GraphCell, laneX } from './GraphCell';

// GC-077: the guard for the join shape. A line entering or leaving a node in another lane must
// run in its own lane, turn through one quarter arc and finish along the node's centre line —
// never cut across the row on a diagonal, which is what the single cubic Bezier used to draw.
// The assertion is on the path's `d` because jsdom applies no stylesheet and renders nothing.

// Explicit imports rather than vitest globals is the house style, which means RTL's own
// auto-cleanup and act-environment hooks never register. Both are wired up by hand here.
// `GraphCell` observes nothing, so no `ResizeObserver` stub is needed.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
});

function row(over: Partial<RowLayout> = {}): RowLayout {
  return {
    sha: 'a'.repeat(40),
    lane: 0,
    color: 0,
    through: [],
    incoming: [],
    outgoing: [],
    hasParentBelow: true,
    hasChildAbove: true,
    maxLane: 1,
    ...over,
  };
}

/** The two joins are the only `path` elements the cell draws; everything else is a `line`. */
function paths(container: HTMLElement): string[] {
  return [...container.querySelectorAll('path')].map((p) => p.getAttribute('d') ?? '');
}

describe('GraphCell joins', () => {
  it('draws an incoming join as lane, corner, centre line', () => {
    const { container } = render(
      <GraphCell row={row({ incoming: [{ lane: 1, color: 1 }] })} width={200} />,
    );
    const [d] = paths(container);
    expect(d).toMatch(new RegExp(`^M ${laneX(1)} 0 V `));
    expect(d.match(/ A /g)).toHaveLength(1);
    expect(d).toMatch(new RegExp(`H ${laneX(0)}$`));
  });

  it('draws an outgoing join as centre line, corner, lane', () => {
    const { container } = render(
      <GraphCell row={row({ outgoing: [{ lane: 1, color: 1 }] })} width={200} />,
    );
    const [d] = paths(container);
    expect(d).toMatch(new RegExp(`^M ${laneX(0)} 14 H `));
    expect(d.match(/ A /g)).toHaveLength(1);
    expect(d).toMatch(/V 28$/);
  });

  it('leaves a straight vertical piece above the corner and a horizontal one beside the node', () => {
    const { container } = render(
      <GraphCell row={row({ incoming: [{ lane: 1, color: 1 }], outgoing: [{ lane: 2, color: 2 }] })} width={200} />,
    );
    const [into, out] = paths(container);
    // Vertical from the top of the row down to `mid - r`: a visible piece in a 28px row.
    const vertical = Number(/^M \d+ 0 V (\d+)/.exec(into)?.[1]);
    expect(vertical).toBeGreaterThan(0);
    expect(vertical).toBeLessThan(14);
    // Horizontal along the centre line: the corner lands short of the node's own lane.
    const corner = Number(/ ([\d.]+) 14 H /.exec(into)?.[1]);
    expect(corner).not.toBe(laneX(0));
    // And the same for the outgoing side, whose corner lands short of the target lane.
    const outCorner = Number(/ H ([\d.]+) A /.exec(out)?.[1]);
    expect(outCorner).not.toBe(laneX(2));
  });
});
