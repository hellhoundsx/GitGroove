import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

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

export function useDragWidth({ key, def, min, max, dir = 1 }: DragWidthOptions): DragWidth {
  const clamp = useCallback((w: number): number => Math.min(max, Math.max(min, Math.round(w))), [min, max]);

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
    setWidth(clamp(d.w + (e.clientX - d.x) * dir));
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
    const w = clamp(d.w + (e.clientX - d.x) * dir);
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
