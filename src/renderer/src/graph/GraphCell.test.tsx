import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type JSX } from 'react';
import { cleanup, render } from '@testing-library/react';
import type { RowLayout } from './lanes';
import { BandGradients, DASH_PERIOD, dashTiles, GraphCell, laneX, NODE, ROW_H } from './GraphCell';

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

// GC-200: the band and the node have to meet with nothing between them, and that relationship is
// arithmetic rather than a screenshot. The band's left edge at the node's drawn radius left two
// crescents of untinted row at the corners, because a square corner meets a circle at one point.
describe('GraphCell band', () => {
  /** The band is the first element of the cell, which is what makes every line and node paint over it. */
  const bandOf = (container: HTMLElement): Element => {
    const first = container.querySelector('svg')?.firstElementChild;
    // By tag name: jsdom's global scope has no `SVGRectElement` to test against with `instanceof`.
    if (first?.tagName !== 'rect') throw new Error(`the first element of the cell is <${first?.tagName ?? 'nothing'}>, not the band`);
    return first;
  };
  const num = (el: Element, name: string): number => Number(el.getAttribute(name));

  // The third entry is the lane the node is actually in, which a stash row branches out of its
  // parent's (GC-216): the band follows the node, so that is what it has to be measured against.
  const kinds: [string, JSX.Element, number][] = [
    ['a commit row', <GraphCell key="c" row={row()} width={200} />, 0],
    ['the WIP row', <GraphCell key="w" row={null} wip={{ lane: 0, color: 0, linked: true }} width={200} />, 0],
    ['a stash row', <GraphCell key="s" row={null} stash={{ lane: 1, color: 0, parentLane: 0, through: [], incoming: [], above: true, others: [] }} width={200} />, 1],
  ];

  for (const [what, element, lane] of kinds) {
    it(`starts the band at the node's centre on ${what}, so no row shows between them`, () => {
      const { container } = render(element);
      const band = bandOf(container);
      // At the centre the band is under the node at every y the circle covers, so there is no x
      // at which the row's own background can lie between the two.
      expect(num(band, 'x')).toBe(laneX(lane));
      expect(num(band, 'width')).toBe(200 - laneX(lane));
      // GC-186's promises, unchanged: 22px, centred on the row, and drawn first.
      expect(num(band, 'height')).toBe(22);
      expect(num(band, 'y')).toBe(14 - 11);
    });
  }

  it('masks the band out of a dashed node, in the node’s own fill', () => {
    // The two dashed nodes leave the outer half of their stroke open wherever the dash has a gap,
    // and the band would read through as a tinted ring; the mask is that fill taken out to r = 10.
    // Asserted as "the same fill the node itself has" rather than against a named token, which is
    // the property that actually matters and the one the literals stopped pinning: this test held
    // `--bg-app` and `--bg-panel` and so failed when the three nodes were unified on `--node-fill`
    // (GC-213), even though a mask matching its node is exactly what it is for.
    for (const element of [kinds[1][1], kinds[2][1]]) {
      const { container } = render(element);
      const circles = [...container.querySelectorAll('circle')];
      const masks = circles.filter((c) => c.getAttribute('r') === '10');
      const node = circles.find((c) => c.getAttribute('stroke-dasharray'));
      expect(masks).toHaveLength(1);
      expect(node).toBeDefined();
      expect(masks[0].getAttribute('fill')).toBe(node?.getAttribute('fill'));
      expect(masks[0].getAttribute('stroke')).toBeNull();
      // Under the node it hides, and over the band it hides it from.
      const kids = [...(container.querySelector('svg')?.children ?? [])];
      expect(kids.indexOf(masks[0])).toBeGreaterThan(0);
      expect(kids.indexOf(masks[0])).toBeLessThan(kids.length - 1);
      cleanup();
    }
  });

  // Whatever `--node-fill` is set to, it has to be **opaque** and it has to be the same for every
  // kind of node (GC-213). Both halves were broken at once by the material: the commit node took
  // `--bg-panel-raised`, which `[data-material]` turns into an 11% white veil so an input well
  // lifts the glass, and the lane line ran straight through every circle in the graph; the other
  // two took two different dark values and read as holes beside it. A node is an occluder.
  it('draws every kind of node in one fill, so none of them lets its lane line through', () => {
    const fills = kinds.map(([, element]) => {
      const { container } = render(element);
      const node = [...container.querySelectorAll('circle')].find((c) => c.getAttribute('r') !== '10');
      const fill = node?.getAttribute('fill');
      cleanup();
      return fill;
    });
    expect(fills).toEqual(['var(--node-fill)', 'var(--node-fill)', 'var(--node-fill)']);
  });

  it('leaves the solid commit node unmasked: its stroke has no gaps to show the band through', () => {
    const { container } = render(kinds[0][1]);
    expect([...container.querySelectorAll('circle')].filter((c) => c.getAttribute('r') === '10')).toHaveLength(0);
  });
});

describe('the band is lit from the lane rather than printed on the row (GC-201)', () => {
  const band = (c: HTMLElement): Element => c.querySelector('svg')!.firstElementChild!;

  it('paints every cell kind from a gradient, with the lane variable as the fallback', () => {
    for (const element of [
      <GraphCell key="c" row={row({ lane: 2, color: 2 })} width={200} />,
      <GraphCell key="w" row={null} wip={{ lane: 2, color: 2, linked: true }} width={200} />,
      <GraphCell key="s" row={null} stash={{ lane: 3, color: 2, parentLane: 2, through: [], incoming: [], above: true, others: [] }} width={200} />,
    ]) {
      const { container } = render(element);
      // The reference and the flat fallback the SVG `fill` syntax allows, so a band is drawn
      // either way; both halves are the lane's own variable and no literal colour appears.
      expect(band(container).getAttribute('fill')).toBe('url(#graph-band-var-lane-2) var(--lane-2)');
      expect(band(container).getAttribute('fill')).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
      cleanup();
    }
  });

  it('defines one gradient per lane colour, falling away from the node', () => {
    const { container } = render(<BandGradients />);
    const grads = [...container.querySelectorAll('linearGradient')];
    expect(grads).toHaveLength(10);
    expect(grads.map((g) => g.id)).toContain('graph-band-var-lane-9');
    for (const g of grads) {
      const stops = [...g.querySelectorAll('stop')];
      // Two stops of the same lane colour: the paint varies across the band's width by opacity
      // alone, so the colour is still the one variable and the theme comes with it.
      expect(stops).toHaveLength(2);
      expect(new Set(stops.map((s) => s.getAttribute('stop-color'))).size).toBe(1);
      const [near, far] = stops.map((s) => Number(s.getAttribute('stop-opacity')));
      expect(near).toBeGreaterThan(far);
      expect(far).toBeGreaterThan(0);
      // Left to right in the rect's own box, which starts at the node's centre on every row.
      expect([g.getAttribute('x1'), g.getAttribute('x2'), g.getAttribute('y1'), g.getAttribute('y2')]).toEqual(['0', '1', '0', '0']);
    }
  });
});

describe('the dash tiles across row boundaries (GC-218)', () => {
  it('has a period that divides the row height, so the pattern never restarts mid-run', () => {
    // A row is its own `<svg>` and every dashed line starts its pattern at y = 0, so this is the
    // only thing that makes a run spanning many rows look like one line.
    expect(dashTiles(ROW_H, DASH_PERIOD)).toBe(true);
    expect(ROW_H % DASH_PERIOD).toBe(0);
  });

  it('is what the old 2/3 pattern failed: 28 is not a multiple of 5', () => {
    // Left here as the thing the rule is written against — the phase walked 0, 3, 1, 4, 2 and drew
    // a short gap or a doubled dash once per row, all the way down.
    expect(dashTiles(28, 5)).toBe(false);
    expect(dashTiles(28, 7)).toBe(true);
    expect(dashTiles(28, 0)).toBe(false);
  });

  it('draws every dashed mark from that one pattern', () => {
    // The WIP node, a stash node and a stash's line are all "not a commit yet", so one vocabulary.
    const dashes = (element: JSX.Element): string[] => {
      const { container } = render(element);
      const out = [...container.querySelectorAll('[stroke-dasharray]')].map((e) => e.getAttribute('stroke-dasharray') ?? '');
      cleanup();
      return out;
    };
    const wip = dashes(<GraphCell key="w" row={null} wip={{ lane: 0, color: 0, linked: true }} width={200} />);
    const stash = dashes(<GraphCell key="s" row={null} stash={{ lane: 1, color: 0, parentLane: 0, through: [], incoming: [], above: true, others: [] }} width={200} />);
    const joined = dashes(<GraphCell key="c" row={row()} stashIn={[1]} width={200} />);
    expect(wip.length).toBeGreaterThan(0);
    expect(stash.length).toBeGreaterThan(0);
    expect(joined.length).toBeGreaterThan(0);
    for (const d of [...wip, ...stash, ...joined]) expect(d.split(' ').reduce((a, b) => a + Number(b), 0)).toBe(DASH_PERIOD);
  });
});

// GC-221: a merge is the one structural thing about a commit, and the graph said it only in the
// lines — legible while both parents are on screen, invisible when the second is far below.
describe('a merge commit says so on its node (GC-221)', () => {
  /** The merge dot: small, filled, and the only node in the graph drawn with no stroke at all. */
  const mergeDot = (c: HTMLElement): Element | undefined => [...c.querySelectorAll('circle')].find((e) => e.getAttribute('stroke') === null);

  it('draws a small filled dot in place of the node and its avatar', () => {
    const { container } = render(<GraphCell row={row({ lane: 2, color: 2 })} merge width={200} author={{ name: 'Ada', email: 'a@e.com', initials: 'A' }} />);
    const dot = mergeDot(container);
    expect(dot).toBeDefined();
    // Smaller than a commit node, which is the whole point: a merge carries no work of its own.
    expect(Number(dot?.getAttribute('r'))).toBeLessThan(NODE / 2 - 1);
    expect(dot?.getAttribute('fill')).toBe('var(--lane-2)');
    // The avatar's initials are what it replaces, so they must not also be there.
    expect(container.textContent).not.toContain('A');
  });

  it('leaves an ordinary commit exactly as it was', () => {
    const { container } = render(<GraphCell row={row()} width={200} author={{ name: 'Ada', email: 'a@e.com', initials: 'A' }} />);
    expect(mergeDot(container)).toBeUndefined();
    expect(container.textContent).toContain('A');
  });

  it('does not interrupt its lane line, so it reads as a point on the branch', () => {
    // Every other node is an occluder with `--node-fill` behind it; this one is not drawn over
    // the line at all, which is what makes it a marker rather than a stop.
    const { container } = render(<GraphCell row={row()} merge width={200} />);
    const fills = [...container.querySelectorAll('circle')].map((c) => c.getAttribute('fill'));
    expect(fills).not.toContain('var(--node-fill)');
  });

  it('meets its chip line: the connector runs under the dot rather than stopping at a full node s edge', () => {
    const { container } = render(<GraphCell row={row({ lane: 2, color: 2 })} merge connector width={200} />);
    const connector = [...container.querySelectorAll('line')].find((l) => l.getAttribute('x1') === '0');
    const dot = mergeDot(container)!;
    expect(Number(connector?.getAttribute('x2'))).toBeGreaterThanOrEqual(laneX(2) - Number(dot.getAttribute('r')));
  });

  it('draws the chip connector at 1px and under the graph, so every lane and join crossing it wins', () => {
    const { container } = render(
      <GraphCell row={row({ lane: 2, color: 2, through: [{ lane: 0, color: 0 }], outgoing: [{ lane: 1, color: 1 }] })} connector width={200} />,
    );
    const marks = [...container.querySelectorAll('line, path, circle')];
    const connector = marks.findIndex((m) => m.tagName === 'line' && m.getAttribute('x1') === '0');
    expect(connector).toBeGreaterThanOrEqual(0);
    expect(marks[connector]!.getAttribute('stroke-width')).toBe('1');
    // Nothing the graph draws comes before it.
    expect(marks.slice(0, connector).length).toBe(0);
  });
});

describe('only the checked-out branch s connector is drawn in full', () => {
  const connectorOf = (c: HTMLElement): Element | undefined => [...c.querySelectorAll('line')].find((l) => l.getAttribute('x1') === '0');

  it('fades every other row s line and keeps it at 1px', () => {
    const { container } = render(<GraphCell row={row()} connector width={200} />);
    const line = connectorOf(container)!;
    expect(line.getAttribute('stroke-width')).toBe('1');
    expect(line.getAttribute('stroke-opacity')).toBe('0.3');
    expect(line.getAttribute('y1')).toBe(String(ROW_H / 2 + 0.5)); // row y 14..15
  });

  it('draws the checked-out branch s line solid at 2px, centred on the node', () => {
    const { container } = render(<GraphCell row={row()} connector connectorHead width={200} />);
    const line = connectorOf(container)!;
    expect(line.getAttribute('stroke-width')).toBe('2');
    expect(line.getAttribute('stroke-opacity')).toBeNull();
    expect(line.getAttribute('y1')).toBe(String(ROW_H / 2)); // row y 13..15
  });
});

describe('the WIP-to-HEAD run ends where a merge forks into HEAD s lane', () => {
  // The merge sits in lane 1 and forks into HEAD's lane 0, which it also passes through above the
  // node: that upper stretch is the run, the curve below it is real.
  const fork = row({ lane: 1, color: 1, through: [{ lane: 0, color: 0 }], outgoing: [{ lane: 0, color: 0 }] });
  const solidIn = (c: HTMLElement, lane: number): Element[] =>
    [...c.querySelectorAll('line')].filter((l) => l.getAttribute('x1') === String(laneX(lane)) && !l.getAttribute('stroke-dasharray'));

  it('drops the solid line in HEAD s lane on the fork row, and keeps the fork s curve', () => {
    const { container } = render(<GraphCell row={fork} wipDash="aboveFork" wipDashLane={0} runDrawn={false} width={200} />);
    expect(solidIn(container, 0)).toHaveLength(0);
    expect(paths(container).some((d) => d.endsWith(`${laneX(0)} ${ROW_H / 2 + 8} V ${ROW_H}`))).toBe(true);
  });

  it('dashes only down to the fork when there is a WIP node to run from', () => {
    const { container } = render(<GraphCell row={fork} wipDash="aboveFork" wipDashLane={0} width={200} />);
    const dash = [...container.querySelectorAll('line')].find((l) => l.getAttribute('stroke-dasharray') && l.getAttribute('x1') === String(laneX(0)));
    expect(dash?.getAttribute('y2')).toBe(String(ROW_H / 2));
  });
});
