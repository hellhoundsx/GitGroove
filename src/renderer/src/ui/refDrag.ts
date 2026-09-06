import { useCallback, useEffect, useRef, useState, type DragEvent as ReactDragEvent, type RefObject } from 'react';
import type { GitRef } from '@shared/types';

/**
 * Dragging one branch onto another (GC-015). Two surfaces name the same refs — the graph's chips
 * and the left panel's rows — and a drag has to work between them in either direction, so the
 * rules live here rather than twice: what may be picked up, what may be dropped on what, and the
 * handlers that say so to the browser.
 */

/**
 * The MIME type the drag carries. `dataTransfer.getData` is deliberately unreadable during
 * `dragover`, so the *type* is the only thing a target can test to tell one of our ref drags from
 * a file the user dropped in from Explorer. The value it carries is the ref's full name, which is
 * what a drop landing from outside React would be resolved from.
 */
export const REF_DRAG_TYPE = 'application/x-gitclient-ref';

/** Only branches are dragged. A tag names no line of work to merge or rebase, and a stash is not a ref the graph draws. */
export const canDragRef = (r: GitRef): boolean => r.kind === 'head' || r.kind === 'remote';

/**
 * Whether dropping `src` on `dst` offers anything at all. Merge runs on the branch being merged
 * into, so the target has to be a local branch; rebase checks the source out, so the source has to
 * be one. A pair with neither — a remote dropped on a remote — is refused outright rather than
 * opening a menu with nothing in it: no `preventDefault` on the dragover means no highlight and no
 * drop, so the gesture says "not here" the way every other drag on the platform does.
 */
export const canDropRef = (src: GitRef | null | undefined, dst: GitRef): boolean =>
  !!src && canDragRef(src) && canDragRef(dst) && src.fullName !== dst.fullName && (dst.kind === 'head' || src.kind === 'head');

/** What `App` needs to know about a drag; the ref being carried is state there, because both surfaces read it. */
export interface RefDragHandlers {
  /** The ref currently being dragged, from either surface, or null. */
  dragging: GitRef | null;
  onDragStart(r: GitRef): void;
  onDragEnd(): void;
  /** A completed drop: `App` opens the merge/rebase menu at the pointer. */
  onDrop(e: ReactDragEvent, dst: GitRef): void;
}

/** The attributes a chip or a row spreads onto itself. */
export interface RefDragAttrs {
  draggable: boolean;
  onDragStart(e: ReactDragEvent): void;
  onDragEnd(): void;
  onDragOver(e: ReactDragEvent): void;
  onDragLeave(): void;
  onDrop(e: ReactDragEvent): void;
}

export interface RefDrag {
  /** The attributes for the element standing for `r`. */
  attrs(r: GitRef): RefDragAttrs;
  /** True while `r` is the ref being dragged, so the element can dim itself. */
  isSource(r: GitRef): boolean;
  /** True while `r` is the target under the pointer, so the element can light up. */
  isOver(r: GitRef): boolean;
}

/**
 * The drag half of GC-015, for one surface. The ref being carried lives in `App` — a drag starting
 * on a chip has to be droppable on a left-panel row — but which target the pointer is over is this
 * surface's own business and stays here.
 */
export function useRefDrag(h: RefDragHandlers): RefDrag {
  const [over, setOver] = useState<string | null>(null);
  const { dragging, onDragStart, onDragEnd, onDrop } = h;

  const attrs = useCallback(
    (r: GitRef): RefDragAttrs => {
      const droppable = canDropRef(dragging, r);
      return {
        draggable: canDragRef(r),
        onDragStart: (e) => {
          // The chips sit inside a row that is itself clickable; the row is not draggable, but
          // stopping here keeps a nested surface from ever starting a second drag of its own.
          e.stopPropagation();
          e.dataTransfer.setData(REF_DRAG_TYPE, r.fullName);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(r);
        },
        onDragEnd: () => {
          setOver(null);
          onDragEnd();
        },
        onDragOver: (e) => {
          // Without `preventDefault` the element is not a drop target at all, which is exactly
          // what a pair with no action available should be.
          if (!droppable || !e.dataTransfer.types.includes(REF_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setOver((n) => (n === r.fullName ? n : r.fullName));
        },
        onDragLeave: () => setOver((n) => (n === r.fullName ? null : n)),
        onDrop: (e) => {
          if (!droppable) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(null);
          onDrop(e, r);
        },
      };
    },
    [dragging, onDragStart, onDragEnd, onDrop],
  );

  return {
    attrs,
    isSource: (r) => dragging?.fullName === r.fullName,
    isOver: (r) => over === r.fullName,
  };
}

/**
 * How close to an edge of the scroll container starts the auto-scroll, and how fast it runs at the
 * edge itself (GC-122). A band rather than the last pixel, because a drag held against the very
 * edge is a gesture nobody can hold steadily; 900px/s is a little over 32 rows a second, which
 * crosses a screenful in about half a second and is still readable going past.
 */
export const DRAG_SCROLL_BAND = 48;
export const DRAG_SCROLL_MAX = 900;

/**
 * How fast the container should scroll with the pointer at `y`, in pixels per second: negative up,
 * positive down, zero away from both edges. Proportional to how far into the band the pointer is,
 * so the edge of the band is a standstill and the edge of the container is full speed — a step
 * function reads as the graph lurching the moment the pointer crosses an invisible line.
 *
 * Pure and exported, so the shape is a test rather than something only a hand-driven drag shows.
 */
export function dragScrollSpeed(y: number, top: number, bottom: number, band = DRAG_SCROLL_BAND, max = DRAG_SCROLL_MAX): number {
  // A container shorter than two bands would have them overlap and fight; the nearer edge wins.
  const b = Math.min(band, (bottom - top) / 2);
  if (b <= 0) return 0;
  if (y < top + b) return -max * Math.min(1, (top + b - y) / b);
  if (y > bottom - b) return max * Math.min(1, (y - (bottom - b)) / b);
  return 0;
}

/** What a scroll container spreads onto itself to scroll while a ref drag is over its edges. */
export interface DragScrollAttrs {
  onDragOver(e: ReactDragEvent): void;
  onDragLeave(e: ReactDragEvent): void;
  onDrop(): void;
  onDragEnd(): void;
}

/**
 * Scroll a container while a branch is being dragged over one of its edges (GC-122). Without it a
 * drag can only reach a chip that is already on screen: the graph's rows are virtualised inside an
 * `overflow: auto` box, and on a real repository the target branch is usually hundreds of rows
 * away, so the gesture was simply unavailable.
 *
 * The speed comes from where the pointer is and the distance from the clock, never from how often
 * `dragover` fires — the browser's rate for that varies with pointer movement, so a pointer held
 * perfectly still at the edge would otherwise crawl or stop. `dragover` only sets the speed; one
 * `requestAnimationFrame` loop does the scrolling.
 *
 * Only our own drags scroll: a file dragged in from Explorer carries no `REF_DRAG_TYPE` and leaves
 * the graph still. A `dragleave` into one of the container's own children is not a leave — that
 * event bubbles from every chip the pointer crosses — so `relatedTarget` decides.
 */
export function useDragScroll(ref: RefObject<HTMLElement | null>): DragScrollAttrs {
  const speed = useRef(0);
  const frame = useRef(0);
  const last = useRef(0);

  const stop = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = 0;
    speed.current = 0;
  }, []);

  // A drag that ends with the component gone — a repository switched under it — leaves no handler
  // to stop the loop, so unmounting does.
  useEffect(() => stop, [stop]);

  const tick = useCallback((now: number) => {
    const el = ref.current;
    if (!el || speed.current === 0) {
      frame.current = 0;
      return;
    }
    const dt = Math.min(now - last.current, 100) / 1000; // a backgrounded tab must not jump
    last.current = now;
    el.scrollTop += speed.current * dt;
    frame.current = requestAnimationFrame(tick);
  }, [ref]);

  const start = useCallback(() => {
    if (frame.current) return;
    last.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  }, [tick]);

  return {
    onDragOver: (e) => {
      const el = ref.current;
      if (!el || !e.dataTransfer.types.includes(REF_DRAG_TYPE)) return;
      const r = el.getBoundingClientRect();
      speed.current = dragScrollSpeed(e.clientY, r.top, r.bottom);
      if (speed.current === 0) stop();
      else start();
    },
    onDragLeave: (e) => {
      if (!ref.current?.contains(e.relatedTarget as Node | null)) stop();
    },
    onDrop: stop,
    onDragEnd: stop,
  };
}
