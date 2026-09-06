import { useCallback, useState, type DragEvent as ReactDragEvent } from 'react';
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
