import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Commit, GitRef, Stash } from '@shared/types';
import type { RefDragHandlers } from '../ui/refDrag';
import { chipRoom, CommitGraph, rowIndexOf, stashesByParent } from './CommitGraph';
import { DEFAULT_PREFS, setPrefs } from '../prefs';

// GC-058: a guard for GC-022's folded-refs dropdown. `onMoreEnter` decides the direction from
// three live rects — the `+N` chip, the hidden `.more-list` and `.graph-body` — and jsdom reports
// every rect as zeroes, so each of the three is stubbed per case. jsdom applies no stylesheet
// either, so the assertion is on the `flip-up` class, not on a computed `top`/`bottom`.
//
// Like `Preferences.test.tsx` this file does NOT use `vi.resetModules()`: React Testing Library is
// imported statically, so re-importing a renderer module would hand the component a second React
// instance and every hook in it would throw.

// Explicit imports rather than vitest globals is the house style, which means RTL's own
// auto-cleanup and act-environment hooks never register. Both are wired up by hand here.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // `CommitGraph`'s virtualisation effect observes `.graph-body`; jsdom has no ResizeObserver.
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

beforeEach(() => {
  // Avatars are gated inside `useGravatar`, so switching them off keeps the render clear of
  // `crypto.subtle` and of any gravatar.com request (GC-058).
  setPrefs({ avatars: false });
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  // Clears `gitclient.prefs` and `gitclient.refColW`. The width no longer decides how many chips
  // fold (GC-078 pinned that at one), but it still decides the column's layout.
  localStorage.clear();
});

const commit: Commit = {
  sha: 'a'.repeat(40),
  parents: [],
  authorName: 'Ada Lovelace',
  authorEmail: 'ada@example.com',
  authorDate: '2026-01-02T03:04:05Z',
  committerName: 'Ada Lovelace',
  committerDate: '2026-01-02T03:04:05Z',
  summary: 'first',
  body: '',
  refs: [],
};

/** Six refs on the one commit: exactly one chip shows at any width (GC-078), so five fold into `+5`. */
const refs: GitRef[] = [
  { name: 'main', fullName: 'refs/heads/main', kind: 'head', sha: commit.sha, isHead: true },
  ...['v1', 'v2', 'v3', 'v4', 'v5'].map((name): GitRef => ({ name, fullName: `refs/tags/${name}`, kind: 'tag', sha: commit.sha, isHead: false })),
];

/** A drag nobody is watching: the flip cases below say nothing about GC-015. */
const noDrag: RefDragHandlers = { dragging: null, onDragStart: () => {}, onDragEnd: () => {}, onDrop: () => {} };

/** The one commit, its six refs and no handlers, with whatever the case cares about on top. */
function renderGraph(over: Partial<ComponentProps<typeof CommitGraph>> = {}): ReturnType<typeof render> {
  return render(
    <CommitGraph
      commits={[commit]}
      refs={refs}
      status={null}
      headSha={commit.sha}
      pinnedSha={null}
      pinnedName={null}
      selected={null}
      searchOpen={false}
      searchTick={0}
      searchQuery=""
      onSearchQuery={() => {}}
      onCloseSearch={() => {}}
      onSelect={() => {}}
      onCommitMenu={() => {}}
      onWipMenu={() => {}}
      onRefMenu={() => {}}
      onRefActivate={() => {}}
      stashes={[]}
      onStashMenu={() => {}}
      onStashActivate={() => {}}
      refDrag={noDrag}
      detached={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => {}}
      scrollTop={0}
      onScrollTop={() => {}}
      {...over}
    />,
  );
}

type Rect = { top: number; bottom: number; height: number };

/** jsdom returns an all-zero rect for everything, so the geometry has to be supplied by hand. */
function stubRect(el: Element, r: Rect): void {
  el.getBoundingClientRect = (): DOMRect =>
    ({ x: 0, y: r.top, top: r.top, bottom: r.bottom, left: 0, right: 0, width: 0, height: r.height, toJSON: () => ({}) }) as DOMRect;
}

/**
 * Renders the graph, gives `.graph-body` and the `+N` chip's list the geometry the case needs,
 * hovers the chip and reports whether the dropdown flipped.
 *
 * `mouseOver`, not `mouseEnter`: React synthesises `onMouseEnter` from the delegated `mouseover`,
 * so a bare non-bubbling `mouseenter` would never reach the handler.
 */
function flipsUp(body: Rect, chipRect: Rect, listHeight: number): boolean {
  const { container } = render(
    <CommitGraph
      commits={[commit]}
      refs={refs}
      status={null}
      headSha={commit.sha}
      pinnedSha={null}
      pinnedName={null}
      selected={null}
      searchOpen={false}
      searchTick={0}
      searchQuery=""
      onSearchQuery={() => {}}
      onCloseSearch={() => {}}
      onSelect={() => {}}
      onCommitMenu={() => {}}
      onWipMenu={() => {}}
      onRefMenu={() => {}}
      onRefActivate={() => {}}
      stashes={[]}
      onStashMenu={() => {}}
      onStashActivate={() => {}}
      refDrag={noDrag}
      detached={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => {}}
      scrollTop={0}
      onScrollTop={() => {}}
    />,
  );

  const graphBody = container.querySelector('.graph-body');
  // The block is a sibling of the `+N` chip, not its child, so hiding the chip while the block
  // is open leaves the block on screen; the hover that opens it is on the cell around both.
  const cell = container.querySelector('.graph-row .col-ref');
  const chip = container.querySelector('.ref-chip.more');
  const list = container.querySelector('.more-list');
  if (!graphBody || !cell || !chip || !list) throw new Error('the +N chip did not render');
  expect(chip.textContent?.startsWith('+5')).toBe(true);

  stubRect(graphBody, body);
  stubRect(cell, chipRect);
  stubRect(list, { top: chipRect.bottom, bottom: chipRect.bottom + listHeight, height: listHeight });

  fireEvent.mouseOver(cell);
  return list.classList.contains('flip-up');
}

const BODY: Rect = { top: 0, bottom: 400, height: 400 };

describe('CommitGraph folded-refs dropdown (GC-022)', () => {
  it('hangs below a chip with room under it', () => {
    // 280px of room below, a 120px list: it fits, so it stays put.
    expect(flipsUp(BODY, { top: 100, bottom: 120, height: 20 }, 120)).toBe(false);
  });

  it('flips up for a chip near the bottom of the scroll container', () => {
    // 20px below, 360px above: the list would be clipped by `.graph-body`, so it opens upwards.
    expect(flipsUp(BODY, { top: 360, bottom: 380, height: 20 }, 120)).toBe(true);
  });

  it('opens a list taller than the body on the side with more room', () => {
    // 500px of list against a 400px body: it is clipped either way, so the larger gap wins.
    expect(flipsUp(BODY, { top: 100, bottom: 120, height: 20 }, 500)).toBe(false); // 280 below vs 100 above
    cleanup();
    expect(flipsUp(BODY, { top: 300, bottom: 320, height: 20 }, 500)).toBe(true); // 80 below vs 300 above
  });
});

// ---- GC-015: dragging a chip onto another branch -------------------------------------------

/** Two commits, each carrying one local branch, so both chips are drag sources and drop targets. */
const dragCommits: Commit[] = [
  { ...commit, sha: 'b'.repeat(40), summary: 'tip of feature' },
  { ...commit, sha: 'c'.repeat(40), summary: 'tip of main' },
];
const dragRefs: GitRef[] = [
  { name: 'feature', fullName: 'refs/heads/feature', kind: 'head', sha: dragCommits[0]!.sha, isHead: false },
  { name: 'main', fullName: 'refs/heads/main', kind: 'head', sha: dragCommits[1]!.sha, isHead: true },
];

/**
 * `dataTransfer` does not exist in jsdom, so the drag carries a stub of the three members the
 * handlers touch: `setData` on the way out, `types` for the target's "is this one of ours" test,
 * and `dropEffect`, which the target writes.
 */
function dataTransfer(types: string[] = []): { setData(t: string, v: string): void; types: string[]; dropEffect: string; effectAllowed: string } {
  const stub = {
    types: [...types],
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(t: string): void {
      stub.types.push(t);
    },
  };
  return stub;
}

function renderDrag(dragging: GitRef | null, dropped: { src: GitRef | null; dst: GitRef | null }): HTMLElement {
  const refDrag: RefDragHandlers = {
    dragging,
    onDragStart: (r) => {
      dropped.src = r;
    },
    onDragEnd: () => {},
    onDrop: (_e, dst) => {
      dropped.dst = dst;
    },
  };
  const { container } = render(
    <CommitGraph
      commits={dragCommits}
      refs={dragRefs}
      status={null}
      headSha={dragCommits[1]!.sha}
      pinnedSha={null}
      pinnedName={null}
      selected={null}
      searchOpen={false}
      searchTick={0}
      searchQuery=""
      onSearchQuery={() => {}}
      onCloseSearch={() => {}}
      onSelect={() => {}}
      onCommitMenu={() => {}}
      onWipMenu={() => {}}
      onRefMenu={() => {}}
      onRefActivate={() => {}}
      stashes={[]}
      onStashMenu={() => {}}
      onStashActivate={() => {}}
      refDrag={refDrag}
      detached={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => {}}
      scrollTop={0}
      onScrollTop={() => {}}
    />,
  );
  return container as HTMLElement;
}

/** The chip carrying `name`, from the row itself rather than from a folded block. */
const chipFor = (c: HTMLElement, name: string): HTMLElement => {
  const el = [...c.querySelectorAll<HTMLElement>('.graph-row .col-ref > .ref-chip')].find((x) => x.textContent === name);
  if (!el) throw new Error(`no chip for ${name}`);
  return el;
};

describe('CommitGraph branch drag and drop (GC-015)', () => {
  it('makes a branch chip draggable and hands the ref to App', () => {
    const dropped = { src: null as GitRef | null, dst: null as GitRef | null };
    const c = renderDrag(null, dropped);
    const feature = chipFor(c, 'feature');
    expect(feature.getAttribute('draggable')).toBe('true');
    fireEvent.dragStart(feature, { dataTransfer: dataTransfer() });
    expect(dropped.src?.name).toBe('feature');
  });

  it('accepts a drop on another branch and reports the target', () => {
    const dropped = { src: null as GitRef | null, dst: null as GitRef | null };
    // `feature` is already in flight, which is the state App holds between dragstart and drop.
    const c = renderDrag(dragRefs[0]!, dropped);
    const main = chipFor(c, 'main');
    const dt = dataTransfer(['application/x-gitclient-ref']);
    // `fireEvent` returns false when the handler called `preventDefault`, which is the only thing
    // that makes an element a drop target at all.
    expect(fireEvent.dragOver(main, { dataTransfer: dt })).toBe(false);
    expect(main.className).toContain('drop-over');
    fireEvent.drop(main, { dataTransfer: dt });
    expect(dropped.dst?.name).toBe('main');
  });

  it('refuses a drop on the chip the drag started from', () => {
    const dropped = { src: null as GitRef | null, dst: null as GitRef | null };
    const c = renderDrag(dragRefs[0]!, dropped);
    const feature = chipFor(c, 'feature');
    expect(feature.className).toContain('drag-src');
    const dt = dataTransfer(['application/x-gitclient-ref']);
    expect(fireEvent.dragOver(feature, { dataTransfer: dt })).toBe(true); // no preventDefault: not a target
    expect(feature.className).not.toContain('drop-over');
    fireEvent.drop(feature, { dataTransfer: dt });
    expect(dropped.dst).toBe(null);
  });
});

describe('stash markers in the graph (GC-140)', () => {
  const stash = (index: number, parent: string): Stash => ({ index, sha: `s${index}`.padEnd(40, '0'), message: `WIP ${index}`, date: '2026-01-02T03:04:05Z', parent });

  it('keys stashes by the commit they were taken from, and keeps two on one commit', () => {
    const m = stashesByParent([stash(0, 'aaa'), stash(1, 'bbb'), stash(2, 'aaa')]);
    expect([...m.keys()].sort()).toEqual(['aaa', 'bbb']);
    expect(m.get('aaa')!.map((s) => s.index)).toEqual([0, 2]);
  });

  it('a stash whose parent is not in the loaded range is simply never looked up', () => {
    // The not-loaded case costs nothing and throws nothing: the map is keyed by parent sha, and
    // no row asks for a sha it does not have.
    const m = stashesByParent([stash(0, 'not-loaded')]);
    expect(m.get(commit.sha)).toBe(undefined);
    // A stash on an unborn HEAD has no parent at all, and marks nothing.
    expect(stashesByParent([{ ...stash(0, ''), parent: '' }]).size).toBe(0);
  });

  it('draws one marker per stash on its commit, outside the chip fold', () => {
    const { container } = renderGraph({ stashes: [stash(0, commit.sha), stash(1, commit.sha)] });
    expect(container.querySelectorAll('.graph-row .stash-chip')).toHaveLength(2);
    // The row's single chip slot and its `+N` are untouched: a stash is not a ref (GC-078).
    expect(container.querySelectorAll('.graph-row .col-ref > .ref-chip:not(.more)')).toHaveLength(1);
    expect(container.querySelector('.graph-row .ref-chip.more')?.textContent).toBe('+5');
    // And it is not a `.ref-chip`, so no chip rule — drag, grow-on-hover, fold — can reach it.
    expect(container.querySelector('.stash-chip')?.classList.contains('ref-chip')).toBe(false);
  });

  it('draws nothing when the stash belongs to a commit that is not on screen', () => {
    const { container } = renderGraph({ stashes: [stash(0, 'z'.repeat(40))] });
    expect(container.querySelectorAll('.stash-chip')).toHaveLength(0);
  });

  it('offers the same two gestures the left panel s stash row does', () => {
    const seen = { menu: 0, applied: null as number | null };
    const { container } = renderGraph({
      stashes: [stash(3, commit.sha)],
      onStashMenu: () => seen.menu++,
      onStashActivate: (s) => (seen.applied = s.index),
    });
    const marker = container.querySelector('.stash-chip')!;
    fireEvent.contextMenu(marker);
    fireEvent.doubleClick(marker);
    expect(seen).toEqual({ menu: 1, applied: 3 });
  });
});

describe('rowIndexOf (GC-141)', () => {
  const commits = [commit, { ...commit, sha: 'b'.repeat(40) }];

  it('offsets by the WIP row when there is one', () => {
    expect(rowIndexOf(commits, commit.sha, false)).toBe(0);
    expect(rowIndexOf(commits, commit.sha, true)).toBe(1);
    expect(rowIndexOf(commits, 'b'.repeat(40), true)).toBe(2);
  });

  it('answers -1 for a sha the loaded range does not hold, with and without a WIP row', () => {
    // The case that was silently wrong: -1 + the WIP offset came to 0, so the `index < 0` guard
    // never fired and the graph scrolled to the WIP row instead of staying put.
    expect(rowIndexOf(commits, 'z'.repeat(40), true)).toBe(-1);
    expect(rowIndexOf(commits, 'z'.repeat(40), false)).toBe(-1);
  });

  it('places the WIP selection on row 0, and nowhere at all without a WIP row', () => {
    expect(rowIndexOf(commits, 'WIP', true)).toBe(0);
    expect(rowIndexOf(commits, 'WIP', false)).toBe(-1);
    expect(rowIndexOf(commits, null, true)).toBe(-1);
  });
});

describe('chipRoom: what the primary chip is drawn at (GC-156)', () => {
  // The numbers below are the stylesheet's, measured over CDP and mirrored in `CommitGraph.tsx`:
  // 3px of cell padding, a 4px gap between every adjacent pair, a 26px `+N`, a 20px stash marker
  // and the 4px the `.ref-line` keeps. jsdom applies no stylesheet, so the arithmetic is asserted
  // on the pure function rather than on a rendered width.
  it('reproduces GC-071 measurement exactly when the +N and the line are all there is', () => {
    // GC-071 wrote this as the constant `width - 41`, and that case must not have moved.
    expect(chipRoom(150, true, 0)).toBe(150 - 41);
    expect(chipRoom(120, true, 0)).toBe(79); // the column GC-071 brought the cloud back at
    expect(chipRoom(100, true, 0)).toBe(59); // the minimum, where `main` rendered as `ma…`
  });

  it('charges a stash marker to the furniture, not to the name', () => {
    // The measurement GR-018 took: a fitted 134px column with one stash left the chip 69px, and
    // 69 is below `CHIP_CLOUD_MIN`, so it is now the cloud that goes rather than the name.
    expect(chipRoom(134, true, 1)).toBe(69);
    // 20px for the marker plus the 4px gap it brings with it, per stash.
    expect(chipRoom(150, true, 0) - chipRoom(150, true, 1)).toBe(24);
    expect(chipRoom(150, true, 1) - chipRoom(150, true, 2)).toBe(24);
  });

  it('counts only the furniture that is actually on the row', () => {
    // One ref and no stash: no `+N` at all, so the chip gets 26px plus a gap more.
    expect(chipRoom(150, false, 0)).toBe(150 - 11);
    expect(chipRoom(150, false, 0) - chipRoom(150, true, 0)).toBe(30);
  });
});
