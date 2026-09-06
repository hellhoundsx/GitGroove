// The pair-wise clamp behind both side panels (GC-105). `fitPanels` is pure, so it is tested in
// the node project: the hook around it is covered where the panels are rendered.
import { describe, expect, it } from 'vitest';
import { dragWidth, fitOptCols, fitPanels, fitRefCol, MIN_GRAPH_W, MIN_MSG_W } from './useDragWidth';

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

// The drag itself (GC-111, GC-115). `dragWidth` is the arithmetic `useDragWidth` runs on every
// pointermove and once more on pointerup, pulled out of the hook so the case that shipped can be
// tested where `fitPanels` and `fitRefCol` are, rather than only through a rendered panel.
describe('dragWidth', () => {
  const PANEL_MIN = { left: 160, detail: 300 };

  it('moves the width by the distance travelled when the window has room', () => {
    expect(dragWidth(220, 50, 160, 420, 560)).toEqual({ width: 270, reached: true });
    expect(dragWidth(220, -50, 160, 420, 560)).toEqual({ width: 170, reached: true });
  });

  it('reaches its own minimum and maximum, and reports both as reached', () => {
    expect(dragWidth(220, -500, 160, 420, 560)).toEqual({ width: 160, reached: true });
    expect(dragWidth(220, 500, 160, 420, 560)).toEqual({ width: 420, reached: true });
  });

  it('does not reach a width past the limit, and answers the limit for the edge', () => {
    // The wall the window imposes: the edge stops there, but `reached` is false, so the caller
    // leaves the stored width alone instead of writing 329 over it.
    expect(dragWidth(329, 1, 300, 720, 329)).toEqual({ width: 329, reached: false });
    expect(dragWidth(329, 200, 300, 720, 329)).toEqual({ width: 329, reached: false });
  });

  it('still moves in the direction that has room while the other one is against the wall', () => {
    expect(dragWidth(329, -19, 300, 720, 329)).toEqual({ width: 310, reached: true });
  });

  it('reaches nothing at all when the limit is below the minimum', () => {
    // GC-111 as it shipped: the limit came out under `min`, so every pointer position answered
    // `min` — and pointerup persisted it. Nothing here is reached, so nothing is persisted.
    for (const delta of [-100, -1, 0, 1, 100]) {
      expect(dragWidth(160, delta, 160, 420, -160)).toEqual({ width: 160, reached: false });
    }
  });

  it('leaves the stored width alone for a one-pixel drag of the left panel at 1000px', () => {
    // GC-111's first measured case: stored 220 / 720, applied 220 / 340 by `fitPanels`, so the
    // left handle's limit is 1000 - 340 - MIN_GRAPH_W = 220 — exactly where it is drawn.
    const fit = fitPanels(220, 720, 1000, PANEL_MIN);
    expect(fit).toEqual({ left: 220, detail: 340 });
    const limit = 1000 - fit.detail - MIN_GRAPH_W;
    expect(dragWidth(fit.left, 1, 160, 420, limit)).toEqual({ width: 220, reached: false });
  });

  it('leaves the stored width alone for a one-pixel drag of the detail panel at 1000px', () => {
    // The mirror case: stored 420 / 400 applies as 231 / 329, and the detail handle's `dir` is -1,
    // so a pointer travelling one pixel left asks for one pixel more than the wall allows.
    const fit = fitPanels(420, 400, 1000, PANEL_MIN);
    expect(fit).toEqual({ left: 231, detail: 329 });
    const limit = 1000 - fit.left - MIN_GRAPH_W;
    expect(dragWidth(fit.detail, -1 * -1, 300, 720, limit)).toEqual({ width: 329, reached: false });
  });

  it('leaves the ref column’s stored width alone for a one-pixel drag at 900px', () => {
    // GC-115's measured case: 400 stored, drawn at 164 in a 440px graph body with 76px of lanes.
    const drawn = fitRefCol(400, 440, 76, 100);
    expect(drawn).toBe(164);
    expect(dragWidth(drawn, 1, 100, 400, 440 - 76 - MIN_MSG_W)).toEqual({ width: 164, reached: false });
  });

  it('never reports a reached width the limit forbids, across a drag’s whole travel', () => {
    for (const limit of [-160, 100, 164, 220, 329, 420]) {
      for (let delta = -300; delta <= 300; delta += 7) {
        const { width, reached } = dragWidth(220, delta, 160, 420, limit);
        expect(width).toBeGreaterThanOrEqual(160);
        expect(width).toBeLessThanOrEqual(Math.max(160, Math.min(420, limit)));
        if (reached) expect(width).toBeLessThanOrEqual(limit);
      }
    }
  });
});

// The last thing to give way, once the ref column is at its floor (GC-116).
describe('fitOptCols', () => {
  const W = { author: 140, date: 150, sha: 80 };
  const LANES_G = 76;
  const REF_MIN = 100;
  const all = { author: true, date: true, sha: true };
  const fit = (panel: number, want = all): { author: boolean; date: boolean; sha: boolean } => fitOptCols(want, panel, LANES_G, REF_MIN, W);
  // What the message column measures once both fits have run, the way the graph lays a row out.
  const msg = (panel: number, stored: number, want = all): number => {
    const c = fit(panel, want);
    const rest = LANES_G + (c.author ? W.author : 0) + (c.date ? W.date : 0) + (c.sha ? W.sha : 0);
    return panel - rest - fitRefCol(stored, panel, rest, REF_MIN);
  };

  it('keeps all three where the panel can afford them', () => {
    // The 1600px window from the ticket: 960 of graph body, and 364 left for the message.
    expect(fit(960)).toEqual(all);
    expect(msg(960, 150)).toBe(364);
  });

  it('drops the date first, then the author, then the sha', () => {
    expect(fit(460)).toEqual({ author: false, date: false, sha: true });
    expect(fit(440)).toEqual({ author: false, date: false, sha: false });
  });

  it('leaves the message column its minimum at every width the app allows', () => {
    // 1100 and 900 from the ticket measured 0 here, with no summary drawn at all.
    for (let panel = MIN_GRAPH_W; panel <= 1400; panel += 4) {
      for (const stored of [100, 150, 250, 400]) {
        expect(msg(panel, stored)).toBeGreaterThanOrEqual(MIN_MSG_W);
      }
    }
  });

  it('never drops a column the preference had switched off, or one that fits alone', () => {
    expect(fit(960, { author: false, date: true, sha: false })).toEqual({ author: false, date: true, sha: false });
    expect(fit(460, { author: false, date: false, sha: true })).toEqual({ author: false, date: false, sha: true });
    // and one that does not fit even alone still goes: 440 leaves 64px beside the message.
    expect(fit(440, { author: false, date: false, sha: true })).toEqual({ author: false, date: false, sha: false });
  });

  it('brings the columns back as the panel widens, in the reverse order', () => {
    const seen = [440, 460, 620, 780, 960].map((p) => fit(p));
    expect(seen).toEqual([
      { author: false, date: false, sha: false },
      { author: false, date: false, sha: true },
      { author: true, date: false, sha: true },
      { author: true, date: true, sha: true },
      { author: true, date: true, sha: true },
    ]);
  });

  it('draws what the preference asked for before the panel has been measured', () => {
    expect(fit(0)).toEqual(all);
  });
});
