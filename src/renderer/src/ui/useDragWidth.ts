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

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>): void => {
    e.preventDefault();
    drag.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>): void => {
    const d = drag.current;
    if (!d) return;
    setWidth(clampDrag(d.w + (e.clientX - d.x) * dir));
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
    const w = clampDrag(d.w + (e.clientX - d.x) * dir);
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
