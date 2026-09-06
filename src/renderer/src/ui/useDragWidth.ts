import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * One drag-to-resize implementation for every width the user can pull: the graph's ref column
 * (GC-006) and both side panels (GC-050). Clamping, persistence and the double-click reset live
 * here so a third resizable width cannot grow a fourth set of rules.
 *
 * The width is remembered *state*, not a preference: it goes on its own `localStorage` key next to
 * `gitclient.refColW`, never into the `gitclient.prefs` blob.
 */
export interface DragWidthOptions {
  /** `localStorage` key holding the width in pixels. */
  key: string;
  def: number;
  min: number;
  max: number;
  /**
   * Which way the pointer moves to make the element wider. `1` for a handle on the element's
   * right edge (the ref column, the left panel), `-1` for one on its left edge (the detail
   * panel, which grows as the pointer travels left).
   */
  dir?: 1 | -1;
  /**
   * An upper bound narrower than `max`, recomputed by the caller from the width of the window the
   * element sits in (GC-105). It bounds a **drag** only: the width restored at mount and the
   * double-click reset ignore it, so a width chosen on a wide window is still there after a spell
   * on a narrow one. `min` still wins, so a window too small for the minimum never drives one
   * below it.
   *
   * It must be derived from the width the *other* elements are being **drawn** at, not from what
   * is stored for them (GC-111): a limit taken from a stored width that the fit is currently
   * reducing comes out too small, and on a narrow enough window smaller than `min`. A drag that
   * runs past it stops on it, and stores it only if it started inside — see `reachedWidth`
   * (GC-115, GC-118).
   */
  limit?: number;
}

/**
 * The centre panel's share of the window, which nothing used to reserve (GC-105). Both side panels
 * clamp against themselves alone — 160-420 and 300-720 — and those two maxima sum to 1140 against
 * the 900px `minWidth` `src/main/index.ts` declares, so the graph was the first thing to give way
 * instead of the last: 34px of commit message on the *default* window size with both handles out,
 * and nothing at all at 900.
 *
 * 440 rather than a rounder number because it makes the app's own minimum window add up exactly —
 * `160 + 440 + 300 = 900` — and because it is what keeps the commit message column above 200px at
 * the default 150px ref column, which a narrower centre does not.
 */
export const MIN_GRAPH_W = 440;

/**
 * What the commit message column keeps while the ref column gives way (GC-110). The ref column
 * is a `useDragWidth` too, and it had exactly the defect `MIN_GRAPH_W` fixed one level out:
 * 100-400 clamped against itself, with nothing asking how wide the panel holding it is. At the
 * app's own 900px minimum window with the column dragged to 400, the message column measured 10px
 * and the summary was not drawn at all.
 *
 * 200 to match the width GC-105 chose `MIN_GRAPH_W` to preserve, so the two answers agree: the
 * centre keeps its share of the window, and inside it the message keeps its share of the centre.
 */
export const MIN_MSG_W = 200;

/**
 * The ref column width actually applied, for a graph panel this wide (GC-110). The same rule as
 * `fitPanels` one level in, and the same promise: the **stored** number is never touched, only
 * what reaches `--ref-col-w`, so widening the window or the panel brings back exactly what the
 * user dragged. `rest` is everything a row spends outside these two columns — the lanes, and any
 * optional column that is switched on.
 *
 * A `panelW` of 0 means the panel has not been measured yet (the first render, before the
 * `ResizeObserver` fires): the stored width is applied unchanged rather than snapping to the
 * minimum for one frame and back.
 */
export function fitRefCol(stored: number, panelW: number, rest: number, min: number, minMsg = MIN_MSG_W): number {
  if (panelW <= 0) return stored;
  return Math.max(min, Math.min(stored, panelW - rest - minMsg));
}

/** The optional graph columns, and the width each one takes when it is on. */
export interface OptCols {
  author: boolean;
  date: boolean;
  sha: boolean;
}

/**
 * Which of the optional columns are actually drawn, for a graph panel this wide (GC-116). They are
 * `flex: none`, so all 370px of them come straight out of the commit message; `fitRefCol` counts
 * them and makes the ref column give way first, but once that is at its own floor nothing else
 * could give and the message column measured 0 at every window from 1100 down — the summary was
 * not drawn at all.
 *
 * So the last thing to give way is the columns themselves, dropped in the order they are least
 * identifying: DATE, then AUTHOR, then SHA. Whole columns rather than narrowed ones — half a
 * timestamp identifies a commit no better than none, and it costs the message the same width.
 *
 * The set is decided against the ref column's **floor**, the width it has when it has given
 * everything it can, and is never re-examined after `fitRefCol` has run against the survivors.
 * That order is what keeps it stable: deciding it against a ref column that then grows back into
 * the space a dropped column left would drop the next column, and the next.
 */
export function fitOptCols(want: OptCols, panelW: number, lanes: number, refMin: number, w: Record<keyof OptCols, number>, minMsg = MIN_MSG_W): OptCols {
  if (panelW <= 0) return want; // not measured yet: draw what the preference asked for
  const room = panelW - lanes - refMin - minMsg;
  const out = { ...want };
  let total = (out.author ? w.author : 0) + (out.date ? w.date : 0) + (out.sha ? w.sha : 0);
  for (const k of ['date', 'author', 'sha'] as const) {
    if (total <= room) break;
    if (!out[k]) continue;
    out[k] = false;
    total -= w[k];
  }
  return out;
}

/**
 * Where a drag puts the width, and whether that is a width the pointer actually reached
 * (GC-111, GC-115). `start` is the width the element is being **drawn** at when the drag begins
 * and `delta` the pixels travelled since, so travel is one-for-one with the edge whatever the
 * stored width happens to be.
 *
 * `reached` is false when the request ran past `limit`: the edge is against the wall the window
 * imposes, the pointer is asking for a width that does not exist, and the caller leaves the width
 * alone rather than writing the wall's own value over it. That is the whole of both defects —
 * before this, a request beyond the limit answered the limit (or `min`, when the limit had come
 * out below it) and `onPointerUp` persisted that, so one pixel of travel on a narrow window
 * replaced the width the user chose on a wide one.
 */
export function dragWidth(start: number, delta: number, min: number, max: number, limit?: number): { width: number; reached: boolean } {
  const want = Math.min(max, Math.max(min, Math.round(start + delta)));
  const cap = limit ?? max;
  // `min` last, as in `clampDrag`: a limit narrower than the minimum leaves the element at its
  // minimum, and `reached` is false there, so nothing about that window is ever persisted.
  return { width: Math.max(min, Math.min(cap, want)), reached: want <= cap };
}

/**
 * The width a drag released here leaves the element at, or `null` when the pointer reached no
 * width at all (GC-118). `dragWidth`'s `reached` answers one position, and taking the release
 * position as the answer for the whole drag threw away every allowed width the pointer had
 * already travelled through: a drag from 170 with the wall at 260, released at 370, moved the edge
 * to 260, was watched doing it, and then persisted nothing — the same silent discard GC-115 was
 * filed for, from the other side.
 *
 * One rule said once rather than a second special case beside GC-115's: the element ends at the
 * last width the pointer reached, and never at one it did not. The travel is the whole interval
 * between `start` and the release, so no record of the drag is needed to say what that is —
 *
 * - released inside the wall: that width, as before;
 * - released past it, from a start inside it: the wall, because the pointer crossed it on the way
 *   out. Where the edge stops therefore does not depend on how fast the drag was, and so on how
 *   coarsely its `pointermove`s sampled the travel;
 * - released past it from a start already on or past it: nothing, so nothing is drawn and nothing
 *   is stored. That is GC-111's case (the wall came out below `min`) and GC-115's (the element is
 *   drawn at the wall because the fit is reducing a wider stored width), both unchanged.
 */
export function reachedWidth(start: number, delta: number, min: number, max: number, limit?: number): number | null {
  const { width, reached } = dragWidth(start, delta, min, max, limit);
  if (reached) return width;
  return start < width ? width : null; // `width` is the wall here: reached only if it is outward
}

/**
 * The heights the left panel's open sections are actually drawn at, for a column this tall
 * (GC-153). `fitPanels` and `fitRefCol` one axis over, and the same promise: what is **stored** is
 * never touched, only what is applied, so a section resized on a tall window comes back to that
 * size when the window is tall again.
 *
 * `stored[i]` is null for a section the user has never sized. Such a section asks for what its
 * rows actually measure (`natural`), and for an equal share when even that is unknown — so four
 * short sections in a tall panel are drawn at their content and the column simply ends, rather
 * than each being padded out to a quarter of it.
 *
 * What is left over is then filled level by level, the way water fills a set of vessels: every
 * section that asks for no more than an equal share of what remains gets exactly what it asked
 * for, and the ones still asking for more split the rest between them, again and again until
 * nobody is short-changed. That is what makes 52 remote branches behave: REMOTE alone gives up
 * the space, and LOCAL, TAGS and STASHES keep the rows they have. A stored height is treated as
 * an ask like any other, so a section the user made large keeps that size while there is room.
 *
 * Every section keeps `min` whatever happens, and when even the floors do not fit they all sit on
 * one and the column scrolls: a header nobody can reach is still better than a section with no
 * rows in it, which is what the ask was about.
 */
export function fitSections(stored: (number | null)[], avail: number, min: number, natural?: (number | null)[]): number[] {
  const n = stored.length;
  if (n === 0) return [];
  if (avail <= n * min) return stored.map(() => min);

  // What each section asks for: the height the user gave it, else what its rows measure, else an
  // equal share of whatever the sized ones leave — the last of which is what makes a fresh panel
  // an equal split and a double-clicked pair an equal share of what is theirs.
  const known = stored.reduce((a: number, h) => a + (h ?? 0), 0);
  const unsized = stored.filter((h) => h === null).length;
  const share = unsized > 0 ? Math.max(min, (avail - known) / unsized) : avail / n;
  const want = stored.map((h, i) => Math.max(min, h ?? natural?.[i] ?? share));
  const out: number[] = new Array<number>(n).fill(0);
  let pending = want.map((_, i) => i);
  let left = avail;
  while (pending.length > 0) {
    const fair = left / pending.length;
    const done = pending.filter((i) => want[i]! <= fair);
    if (done.length === 0) {
      // Everyone still asking wants more than an equal share, so they split what is left in
      // proportion to what they asked for: a section the user dragged large stays the large one
      // on a column too short for either, which an equal split would quietly undo.
      const asked = pending.reduce((a, i) => a + want[i]!, 0);
      for (const i of pending) out[i] = Math.max(min, (want[i]! / asked) * left);
      break;
    }
    for (const i of done) {
      out[i] = want[i]!;
      left -= want[i]!;
    }
    pending = pending.filter((i) => !done.includes(i));
  }

  // Whole pixels. When the sections wanted more than the column, they are filling it exactly and
  // the rounding remainder goes to the last of them rather than leaving a sliver undrawn; when
  // they wanted less, the column keeps what they did not ask for.
  const px = out.map((h) => Math.max(min, Math.round(h)));
  if (want.reduce((a, b) => a + b, 0) >= avail - 0.5) {
    const drift = avail - px.reduce((a, b) => a + b, 0);
    const last = px.length - 1;
    px[last] = Math.max(min, px[last]! + drift);
  }
  return px;
}

/** The widths `fitPanels` may reduce, and the floor each one has. */
export interface PanelFit {
  left: number;
  detail: number;
}

/**
 * The widths actually applied for a window this wide. The **stored** numbers are never touched:
 * only what reaches `--left-panel-w` / `--detail-panel-w` is reduced, so widening the window
 * restores exactly what the user chose (GC-105). The wider panel gives way first — down to the
 * narrower one's width — and then both give way together in proportion to what each still has
 * above its own minimum. When even the two minima do not fit, both sit at their minimum and the
 * centre takes what is left: a panel narrower than it can be drawn helps nobody.
 */
export function fitPanels(left: number, detail: number, windowW: number, min: PanelFit, minGraph = MIN_GRAPH_W): PanelFit {
  let l = left;
  let d = detail;
  let over = l + d + minGraph - windowW;
  if (over <= 0) return { left: l, detail: d };

  if (l > d) {
    const take = Math.min(over, l - Math.max(min.left, d));
    l -= take;
    over -= take;
  } else if (d > l) {
    const take = Math.min(over, d - Math.max(min.detail, l));
    d -= take;
    over -= take;
  }

  if (over > 0) {
    const spareL = l - min.left;
    const spareD = d - min.detail;
    const spare = spareL + spareD;
    const takeL = spare === 0 ? 0 : Math.min(spareL, Math.round((over * spareL) / spare));
    l -= takeL;
    d -= Math.min(spareD, over - takeL);
  }
  return { left: Math.round(l), detail: Math.round(d) };
}

/**
 * The viewport width, so the fit above is re-applied when the window is resized rather than only
 * when a handle is dragged (GC-105). Guarded on `window` for the node-environment tests that
 * import this module.
 */
export function useWindowWidth(): number {
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1400 : window.innerWidth));
  useEffect(() => {
    const onResize = (): void => setW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return w;
}

/** Spread onto the 4px handle element. */
export interface DragHandleProps {
  onPointerDown(e: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(e: ReactPointerEvent<HTMLElement>): void;
  onDoubleClick(): void;
}

export interface DragWidth {
  width: number;
  /** True for the length of a drag, so the caller can hold the cursor and stop text selection. */
  resizing: boolean;
  handle: DragHandleProps;
}

/**
 * A drag that moves the boundary **between** two adjacent elements, rather than one element's own
 * edge (GC-153): the left panel's section handles, where what one section gains the one below it
 * gives up.
 *
 * It is a second hook rather than an option on `useDragWidth` because the two model different
 * things — one size against one stored key there, a pair sharing a fixed total here — but it is
 * in this module, and the rule that decides where the edge ends up is `reachedWidth`, the same
 * one: the drag starts from the size being **drawn**, a release past the wall keeps the wall it
 * crossed, and a drag that started on the wall moves nothing (GC-111, GC-115, GC-118). The wall
 * is the pair's own total less the other one's floor, so neither can be pushed under it and the
 * two always add up to what they started with.
 *
 * `axis` is `'y'` for a horizontal boundary. Nothing else here cares which axis it is on.
 */
export interface BoundaryDrag {
  resizing: boolean;
  handle(a: number, b: number, onDrag: (a: number, b: number) => void, onCommit: (a: number, b: number) => void, onReset: () => void): DragHandleProps;
}

export function useBoundaryDrag(min: number, axis: 'x' | 'y' = 'y'): BoundaryDrag {
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ at: number; a: number; b: number; onDrag: (a: number, b: number) => void; onCommit: (a: number, b: number) => void } | null>(null);
  const pos = (e: ReactPointerEvent<HTMLElement>): number => (axis === 'y' ? e.clientY : e.clientX);

  const handle = (a: number, b: number, onDrag: (a: number, b: number) => void, onCommit: (a: number, b: number) => void, onReset: () => void): DragHandleProps => ({
    onPointerDown: (e) => {
      e.preventDefault();
      drag.current = { at: pos(e), a, b, onDrag, onCommit };
      e.currentTarget.setPointerCapture(e.pointerId);
      setResizing(true);
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d) return;
      const total = d.a + d.b;
      const next = reachedWidth(d.a, pos(e) - d.at, min, total - min, total - min);
      if (next !== null) d.onDrag(next, total - next);
    },
    // The release position, not the last state React committed, for `useDragWidth`'s own reason:
    // the pointerup arrives before that commit and the closure would be one move behind (GC-050).
    onPointerUp: (e) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setResizing(false);
      const total = d.a + d.b;
      const next = reachedWidth(d.a, pos(e) - d.at, min, total - min, total - min);
      if (next === null) return; // a height the pointer never reached is neither drawn nor stored
      d.onDrag(next, total - next);
      d.onCommit(next, total - next);
    },
    onPointerCancel: (e) => {
      drag.current = null;
      e.currentTarget.releasePointerCapture(e.pointerId);
      setResizing(false);
    },
    onDoubleClick: onReset,
  });

  return { resizing, handle };
}

export function useDragWidth({ key, def, min, max, dir = 1, limit }: DragWidthOptions): DragWidth {
  const clamp = useCallback((w: number): number => Math.min(max, Math.max(min, Math.round(w))), [min, max]);
  // What a drag may reach right now: `max`, or the narrower bound the window imposes (GC-105), so
  // a handle stops rather than pushing the graph away and then persisting a width nobody saw.
  // `min` is applied last, so a limit below it leaves the panel at its minimum instead of under it.
  const clampDrag = useCallback(
    (w: number): number => Math.max(min, Math.min(limit ?? max, clamp(w))),
    [clamp, min, max, limit],
  );

  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return Number.isFinite(v) && v > 0 ? Math.min(max, Math.max(min, Math.round(v))) : def;
    } catch {
      return def;
    }
  });
  const [resizing, setResizing] = useState(false);
  const drag = useRef<{ x: number; w: number } | null>(null);

  const persist = useCallback(
    (w: number | null): void => {
      try {
        if (w === null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(w));
      } catch {
        /* private mode: the width just does not survive the reload */
      }
    },
    [key],
  );

  // The drag starts from the width being **drawn**, which is what `clampDrag` answers, not from
  // the stored number `width` holds (GC-115). On a window narrow enough for the fit to be
  // reducing this element the two differ, and starting from the stored one made the first pixel of
  // travel jump the edge by the whole difference — or, once the limit had been reached, pin it and
  // persist the wall.
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: clampDrag(width) };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    const w = reachedWidth(d.w, (e.clientX - d.x) * dir, min, max, limit);
    if (w !== null) setWidth(w); // a drag that has reached nothing moves the edge nowhere
  };
  // The released width is computed from the release position rather than read out of `width`: the
  // pointerup arrives in the same task as the last pointermove, before React has committed the
  // state that move set, so the closure's `width` is one move behind and the drag would persist a
  // width the panel is not showing (GC-050).
  const onPointerUp = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setResizing(false);
    const w = reachedWidth(d.w, (e.clientX - d.x) * dir, min, max, limit);
    if (w === null) return; // a width the pointer never reached is neither shown nor stored
    setWidth(w);
    persist(w);
  };
  // A reset drops the key rather than storing the default, so a width the user never chose is not
  // one the app has to keep honouring after the default moves.
  const onDoubleClick = (): void => {
    setWidth(def);
    persist(null);
  };

  return { width, resizing, handle: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick } };
}
