// The pair-wise clamp behind both side panels (GC-105). `fitPanels` is pure, so it is tested in
// the node project: the hook around it is covered where the panels are rendered.
import { describe, expect, it } from 'vitest';
import { fitPanels, fitRefCol, MIN_GRAPH_W, MIN_MSG_W } from './useDragWidth';

const MIN = { left: 160, detail: 300 };
const graph = (w: number, fit: { left: number; detail: number }): number => w - fit.left - fit.detail;

describe('fitPanels', () => {
  it('leaves widths that already fit exactly as they are', () => {
    expect(fitPanels(220, 400, 1400, MIN)).toEqual({ left: 220, detail: 400 });
    expect(fitPanels(420, 720, 1600, MIN)).toEqual({ left: 420, detail: 720 });
  });

  it('gives the graph its minimum at the window minimum, from the defaults', () => {
    // The review measured 54px of commit message here, because nothing reserved the centre.
    const fit = fitPanels(220, 400, 900, MIN);
    expect(graph(900, fit)).toBe(MIN_GRAPH_W);
    expect(fit.left).toBeGreaterThanOrEqual(MIN.left);
    expect(fit.detail).toBeGreaterThanOrEqual(MIN.detail);
  });

  it('gives the graph its minimum with both panels at their maxima, on the default window', () => {
    // The review measured a 34px message column here, on a window nobody had resized.
    const fit = fitPanels(420, 720, 1400, MIN);
    expect(graph(1400, fit)).toBe(MIN_GRAPH_W);
  });

  it('takes from the wider panel first', () => {
    const fit = fitPanels(420, 720, 1400, MIN);
    expect(fit.left).toBe(420); // untouched: the detail panel had the room
    expect(fit.detail).toBe(540);
  });

  it('takes from both once the wider one is down to the narrower one', () => {
    const fit = fitPanels(420, 720, 900, MIN);
    expect(fit).toEqual({ left: 160, detail: 300 });
    expect(graph(900, fit)).toBe(MIN_GRAPH_W);
  });

  it('never puts a panel below its own minimum, even when nothing fits', () => {
    const fit = fitPanels(420, 720, 500, MIN);
    expect(fit).toEqual({ left: 160, detail: 300 });
    // The centre takes the shortfall rather than a panel being drawn narrower than it can be.
    expect(graph(500, fit)).toBeLessThan(MIN_GRAPH_W);
  });

  it('holds the graph at or above its minimum for every width down to the window minimum', () => {
    for (let w = 900; w <= 1600; w += 10) {
      for (const [l, d] of [
        [220, 400],
        [420, 720],
        [160, 300],
        [300, 500],
      ]) {
        const fit = fitPanels(l, d, w, MIN);
        expect(graph(w, fit)).toBeGreaterThanOrEqual(MIN_GRAPH_W);
        expect(fit.left).toBeGreaterThanOrEqual(MIN.left);
        expect(fit.detail).toBeGreaterThanOrEqual(MIN.detail);
        // Never widened: the fit only ever gives way.
        expect(fit.left).toBeLessThanOrEqual(l);
        expect(fit.detail).toBeLessThanOrEqual(d);
      }
    }
  });

  it('treats a collapsed left panel as a zero-width panel with no floor', () => {
    // What App passes while the left panel is a 44px rail: only the detail panel can give way.
    const fit = fitPanels(0, 720, 900 - 44, { left: 0, detail: 300 });
    expect(fit.left).toBe(0);
    expect(856 - fit.detail).toBeGreaterThanOrEqual(MIN_GRAPH_W);
  });
});

// The same question one level in: the ref column inside the graph panel (GC-110). `rest` is the
// lane column, 3 lanes at the fixture (3 * 20 + 16 = 76), plus any optional column.
describe('fitRefCol', () => {
  const LANES = 76;

  it('leaves a width the panel can afford exactly as it is', () => {
    expect(fitRefCol(150, 780, LANES, 100)).toBe(150);
    expect(fitRefCol(400, 780, LANES, 100)).toBe(400);
  });

  it('gives the message column its minimum at the graph panel’s own minimum', () => {
    // The ticket measured 10px of commit message and no summary at all here.
    const w = fitRefCol(400, MIN_GRAPH_W, LANES, 100);
    expect(MIN_GRAPH_W - w - LANES).toBe(MIN_MSG_W);
  });

  it('never touches the stored width: widening restores it', () => {
    expect(fitRefCol(400, MIN_GRAPH_W, LANES, 100)).toBeLessThan(400);
    expect(fitRefCol(400, 780, LANES, 100)).toBe(400);
  });

  it('counts the optional columns, which take their width from the message too', () => {
    const opt = 140 + 150 + 80;
    expect(fitRefCol(400, 1000, LANES + opt, 100)).toBe(1000 - LANES - opt - MIN_MSG_W);
  });

  it('never goes below the column’s own minimum, even when nothing fits', () => {
    expect(fitRefCol(400, 300, LANES, 100)).toBe(100);
  });

  it('applies the stored width unchanged before the panel has been measured', () => {
    expect(fitRefCol(400, 0, LANES, 100)).toBe(400);
  });

  it('holds the message column at or above its minimum across the panel’s range', () => {
    for (let panel = MIN_GRAPH_W; panel <= 1200; panel += 10) {
      for (const stored of [100, 150, 250, 400]) {
        const w = fitRefCol(stored, panel, LANES, 100);
        expect(w).toBeGreaterThanOrEqual(100);
        expect(w).toBeLessThanOrEqual(stored); // only ever gives way
        expect(panel - w - LANES).toBeGreaterThanOrEqual(MIN_MSG_W);
      }
    }
  });
});
