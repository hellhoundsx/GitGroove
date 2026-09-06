// The pair-wise clamp behind both side panels (GC-105). `fitPanels` is pure, so it is tested in
// the node project: the hook around it is covered where the panels are rendered.
import { describe, expect, it } from 'vitest';
import { fitPanels, MIN_GRAPH_W } from './useDragWidth';

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
