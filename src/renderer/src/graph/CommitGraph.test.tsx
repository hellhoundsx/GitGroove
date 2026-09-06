import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Commit, GitRef, RepoStatus, Stash } from '@shared/types';
import type { RefDragHandlers } from '../ui/refDrag';
import { chipMarksFit, chipRoom, CommitGraph, displayRows, rowIndexOf, shouldRevealSelection, stashesByParent, stashMessageText } from './CommitGraph';
import { chipsFor, headChipFor, kindMarksOf } from './RefChip';
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
      searchAuthor={null}
      onSearchAuthor={() => {}}
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
      onDrawnCols={() => {}}
      draftSummary=""
      onDraftSummary={() => {}}
      onCommitDraft={() => {}}
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
      searchAuthor={null}
      onSearchAuthor={() => {}}
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
      onDrawnCols={() => {}}
      draftSummary=""
      onDraftSummary={() => {}}
      onCommitDraft={() => {}}
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
      searchAuthor={null}
      onSearchAuthor={() => {}}
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
      onDrawnCols={() => {}}
      draftSummary=""
      onDraftSummary={() => {}}
      onCommitDraft={() => {}}
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

// ---- GC-123: the fold has to open for a drag, which `:hover` never does ---------------------
// Chromium does not update `:hover` while an HTML5 drag is in flight, so the CSS rule that opens
// `.more-list` cannot fire during one and a folded ref was reachable by neither end of the
// gesture. jsdom applies no stylesheet, so the assertion here is on the class `CommitGraph` puts
// on the cell from `dragover` — which is exactly what the new rule is keyed to.
describe('the folded block opens for a drag (GC-123)', () => {
  /** Three branches on one commit: one chip shows, the other two fold behind `+2`. */
  const foldedRefs: GitRef[] = [
    { name: 'main', fullName: 'refs/heads/main', kind: 'head', sha: commit.sha, isHead: true },
    { name: 'feature', fullName: 'refs/heads/feature', kind: 'head', sha: commit.sha, isHead: false },
    { name: 'spike', fullName: 'refs/heads/spike', kind: 'head', sha: commit.sha, isHead: false },
  ];
  const dragging: GitRef = { name: 'other', fullName: 'refs/heads/other', kind: 'head', sha: 'd'.repeat(40), isHead: false };

  const cellOf = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('.graph-row .col-ref')!;

  /**
   * A `dragleave` carrying a `relatedTarget`. jsdom implements no `DragEvent`, so RTL falls back
   * to a bare `Event`, which ignores every `MouseEventInit` member — including the one this
   * handler is entirely about. Defining it on the event is the only way to say where the pointer
   * went.
   */
  const dragLeaveTo = (cell: HTMLElement, to: Node | null): void => {
    const ev = createEvent.dragLeave(cell);
    Object.defineProperty(ev, 'relatedTarget', { value: to });
    fireEvent(cell, ev);
  };

  function renderFolded(inFlight: GitRef | null): HTMLElement {
    const { container } = renderGraph({
      refs: foldedRefs,
      refDrag: { dragging: inFlight, onDragStart: () => {}, onDragEnd: () => {}, onDrop: () => {} },
    });
    return container as HTMLElement;
  }

  it('opens on the first dragover and closes when the pointer leaves the cell', () => {
    const c = renderFolded(dragging);
    const cell = cellOf(c);
    expect(cell.className).not.toContain('more-drag');
    fireEvent.dragOver(cell, { dataTransfer: dataTransfer(['application/x-gitclient-ref']) });
    expect(cell.className).toContain('more-drag');
    // A `dragleave` into one of the block's own chips is not a leave: that event bubbles from
    // every chip the pointer crosses, so `relatedTarget` is what decides.
    dragLeaveTo(cell, cell.querySelector('.more-list .ref-chip'));
    expect(cell.className).toContain('more-drag');
    dragLeaveTo(cell, document.body);
    expect(cell.className).not.toContain('more-drag');
  });

  it('makes a chip inside the block a drop target while it is open', () => {
    const c = renderFolded(dragging);
    fireEvent.dragOver(cellOf(c), { dataTransfer: dataTransfer(['application/x-gitclient-ref']) });
    const folded = [...c.querySelectorAll<HTMLElement>('.more-list .ref-chip')].find((x) => x.textContent === 'spike');
    expect(folded).toBeDefined();
    const dt = dataTransfer(['application/x-gitclient-ref']);
    // `preventDefault` — a false return — is the only thing that makes an element a drop target.
    expect(fireEvent.dragOver(folded!, { dataTransfer: dt })).toBe(false);
    expect(folded!.className).toContain('drop-over');
  });

  it('ignores a drag that is not one of ours, and closes when the drag ends', () => {
    const c = renderFolded(dragging);
    const cell = cellOf(c);
    // A file dragged in from Explorer carries no `REF_DRAG_TYPE` and opens nothing.
    fireEvent.dragOver(cell, { dataTransfer: dataTransfer(['Files']) });
    expect(cell.className).not.toContain('more-drag');

    fireEvent.dragOver(cell, { dataTransfer: dataTransfer(['application/x-gitclient-ref']) });
    expect(cell.className).toContain('more-drag');
    // A drag that ends on the block itself produces no `dragleave`, so the end of the drag closes
    // it: `App` clears the ref in flight and the cell follows.
    cleanup();
    const c2 = renderFolded(null);
    expect(cellOf(c2).className).not.toContain('more-drag');
  });

  it('leaves the block alone with no drag in flight', () => {
    const c = renderFolded(null);
    const cell = cellOf(c);
    fireEvent.mouseEnter(cell);
    expect(cell.className).not.toContain('more-drag');
  });
});

describe('a stash is a row of its own, above the commit it was taken from (GC-170)', () => {
  const stash = (index: number, parent: string, message = `On main: work ${index}`): Stash => ({
    index,
    sha: `s${index}`.padEnd(40, '0'),
    message,
    date: '2026-01-02T03:04:05Z',
    parent,
  });

  it('keys stashes by the commit they were taken from, and keeps two on one commit', () => {
    const m = stashesByParent([stash(0, 'aaa'), stash(1, 'bbb'), stash(2, 'aaa')]);
    expect([...m.keys()].sort()).toEqual(['aaa', 'bbb']);
    expect(m.get('aaa')!.map((s) => s.index)).toEqual([0, 2]);
  });

  it('a stash whose parent is not in the loaded range is simply never looked up', () => {
    const m = stashesByParent([stash(0, 'not-loaded')]);
    expect(m.get(commit.sha)).toBe(undefined);
    // A stash on an unborn HEAD has no parent at all, and draws nothing.
    expect(stashesByParent([{ ...stash(0, ''), parent: '' }]).size).toBe(0);
  });

  it('puts the stash rows above their commit, newest first, with the WIP row still on top', () => {
    const byParent = stashesByParent([stash(0, commit.sha), stash(1, commit.sha)]);
    const rows = displayRows([commit], true, byParent);
    expect(rows.map((r) => r.kind)).toEqual(['wip', 'stash', 'stash', 'commit']);
    // `git stash list` order, so stash@{0} is the topmost of the two.
    expect(rows.filter((r) => r.kind === 'stash').map((r) => (r as { stash: Stash }).stash.index)).toEqual([0, 1]);
  });

  it('adds no row for a stash whose parent is not loaded, and none at all without stashes', () => {
    expect(displayRows([commit], true, stashesByParent([stash(0, 'z'.repeat(40))])).map((r) => r.kind)).toEqual(['wip', 'commit']);
    expect(displayRows([commit], false, new Map()).map((r) => r.kind)).toEqual(['commit']);
  });

  it('draws one row per stash and no marker in the commit s ref cell', () => {
    const { container } = renderGraph({ stashes: [stash(0, commit.sha), stash(1, commit.sha)] });
    expect(container.querySelectorAll('.graph-row.stash-row')).toHaveLength(2);
    // The marker GC-140 put in the ref column is gone, and with it the width it cost the name.
    expect(container.querySelectorAll('.stash-chip')).toHaveLength(0);
    // The row's single chip slot and its `+N` are untouched: a stash was never a ref (GC-078).
    expect(container.querySelectorAll('.graph-row .col-ref > .ref-chip:not(.more)')).toHaveLength(1);
    expect(container.querySelector('.graph-row .ref-chip.more')?.textContent).toBe('+5');
  });

  it('draws nothing when the stash belongs to a commit that is not on screen', () => {
    const { container } = renderGraph({ stashes: [stash(0, 'z'.repeat(40))] });
    expect(container.querySelectorAll('.stash-row')).toHaveLength(0);
  });

  it('reads the message in the message column with git s own prefix off it', () => {
    const { container } = renderGraph({ stashes: [stash(0, commit.sha, 'On 008-page-monitor-port: est')] });
    const row = container.querySelector('.stash-row')!;
    expect(row.querySelector('.summary')?.textContent).toBe('est');
    // The whole, untouched message is still what the row says on hover.
    expect(row.querySelector('.col-msg')?.getAttribute('title')).toContain('On 008-page-monitor-port: est');
  });

  it('offers the same two gestures the left panel s stash row does, and selects on a click', () => {
    const seen = { menu: 0, applied: null as number | null, selected: null as string | null };
    const { container } = renderGraph({
      stashes: [stash(3, commit.sha)],
      onStashMenu: () => seen.menu++,
      onStashActivate: (s) => (seen.applied = s.index),
      onSelect: (sha) => (seen.selected = sha),
    });
    const row = container.querySelector('.stash-row')!;
    fireEvent.contextMenu(row);
    fireEvent.doubleClick(row);
    fireEvent.click(row);
    expect(seen).toEqual({ menu: 1, applied: 3, selected: 's3'.padEnd(40, '0') });
  });

  it('takes the same .selected treatment a commit row does', () => {
    const { container } = renderGraph({ stashes: [stash(0, commit.sha)], selected: 's0'.padEnd(40, '0') });
    expect(container.querySelector('.stash-row')?.classList.contains('selected')).toBe(true);
  });
});

describe('stashMessageText: git s prefix off the line, never off the message (GC-170)', () => {
  it('drops the branch prefix, which the lane the row sits in already says', () => {
    expect(stashMessageText('On 008-page-monitor-port: est')).toBe('est');
    expect(stashMessageText('On main: review: a stash to look at')).toBe('review: a stash to look at');
  });

  it('drops the WIP form git writes when it was given no message', () => {
    expect(stashMessageText('WIP on main: 1234567 the commit it was taken from')).toBe('1234567 the commit it was taken from');
  });

  it('leaves a message with no prefix alone', () => {
    expect(stashMessageText('a stash to look at')).toBe('a stash to look at');
    expect(stashMessageText('')).toBe('');
    // Not a prefix: a ref name cannot hold a colon, so only the first one can end one.
    expect(stashMessageText('Onwards: a message')).toBe('Onwards: a message');
  });
});

describe('rowIndexOf (GC-141, GC-170)', () => {
  const commits = [commit, { ...commit, sha: 'b'.repeat(40) }];
  const rows = (hasWip: boolean, stashes: Stash[] = []): ReturnType<typeof displayRows> => displayRows(commits, hasWip, stashesByParent(stashes));

  it('counts the rows as drawn, WIP row and stash rows included', () => {
    expect(rowIndexOf(rows(false), commit.sha)).toBe(0);
    expect(rowIndexOf(rows(true), commit.sha)).toBe(1);
    expect(rowIndexOf(rows(true), 'b'.repeat(40))).toBe(2);
    // A stash above the first commit pushes that commit down a row, and is found itself (GC-170).
    const withStash = rows(true, [{ index: 0, sha: 's'.repeat(40), message: 'On main: x', date: '2026-01-02T03:04:05Z', parent: commit.sha }]);
    expect(rowIndexOf(withStash, 's'.repeat(40))).toBe(1);
    expect(rowIndexOf(withStash, commit.sha)).toBe(2);
  });

  it('answers -1 for a sha the loaded range does not hold, with and without a WIP row', () => {
    // The case that was silently wrong: -1 + the WIP offset came to 0, so the `index < 0` guard
    // never fired and the graph scrolled to the WIP row instead of staying put. Asked of the rows
    // there is no offset left to add (GC-170).
    expect(rowIndexOf(rows(true), 'z'.repeat(40))).toBe(-1);
    expect(rowIndexOf(rows(false), 'z'.repeat(40))).toBe(-1);
  });

  it('places the WIP selection on row 0, and nowhere at all without a WIP row', () => {
    expect(rowIndexOf(rows(true), 'WIP')).toBe(0);
    expect(rowIndexOf(rows(false), 'WIP')).toBe(-1);
    expect(rowIndexOf(rows(true), null)).toBe(-1);
  });
});

describe('shouldRevealSelection: when the graph is scrolled to the selection (GC-172)', () => {
  it('scrolls to a selection the graph has not answered for yet', () => {
    expect(shouldRevealSelection(undefined, commit.sha)).toBe(true);
    expect(shouldRevealSelection('b'.repeat(40), commit.sha)).toBe(true);
  });

  it('leaves the position alone when the selection is the one already answered for', () => {
    // The bug: `commits` is in the effect's dependencies for the row lookup, so a reload, a page
    // append or a tab switch's own refresh re-ran it unchanged. With WIP selected that is row 0,
    // and a graph scrolled anywhere came back at the top.
    expect(shouldRevealSelection('WIP', 'WIP')).toBe(false);
    expect(shouldRevealSelection(commit.sha, commit.sha)).toBe(false);
  });

  it('treats a restored offset as the answer for the selection it was parked with', () => {
    // What the mount writes when it puts a parked offset back (GC-016): the tab's own selection.
    expect(shouldRevealSelection('WIP', 'WIP')).toBe(false);
  });

  it('has nothing to reveal with no selection', () => {
    expect(shouldRevealSelection(undefined, null)).toBe(false);
    expect(shouldRevealSelection('WIP', null)).toBe(false);
  });
});

describe('chipRoom: what the primary chip is drawn at (GC-156, GC-170)', () => {
  // The numbers below are the stylesheet's, measured over CDP and mirrored in `CommitGraph.tsx`:
  // 3px of cell padding, a 4px gap between every adjacent pair, a 26px `+N` and the 4px the
  // `.ref-line` keeps. jsdom applies no stylesheet, so the arithmetic is asserted on the pure
  // function rather than on a rendered width.
  it('reproduces GC-071 measurement exactly when the +N and the line are all there is', () => {
    // GC-071 wrote this as the constant `width - 41`, and that case must not have moved.
    expect(chipRoom(150, true)).toBe(150 - 41);
    expect(chipRoom(120, true)).toBe(79); // the column GC-071 brought the cloud back at
    expect(chipRoom(100, true)).toBe(59); // the minimum, where `main` rendered as `ma…`
  });

  it('keeps the cloud at the width GC-156 measured it losing it at, now that the marker is gone', () => {
    // GR-018's measurement: a fitted 134px column with a stash marker beside the chip left it
    // 69px, below `CHIP_CLOUD_MIN`, so the cloud went. The marker is a row of its own now
    // (GC-170), so the same column leaves the chip 93px and the cloud is kept — which is the
    // point of moving it: the 24px it cost came out of the name at every width above 120.
    expect(chipRoom(134, true)).toBe(93);
    expect(chipRoom(134, true) >= 79).toBe(true);
  });

  it('counts only the furniture that is actually on the row', () => {
    // One ref: no `+N` at all, so the chip gets 26px plus a gap more.
    expect(chipRoom(150, false)).toBe(150 - 11);
    expect(chipRoom(150, false) - chipRoom(150, true)).toBe(30);
  });
});

describe('what a chip says it is (GC-146)', () => {
  const ref = (over: Partial<GitRef>): GitRef => ({ name: 'x', fullName: 'refs/heads/x', kind: 'head', sha: 'a'.repeat(40), isHead: false, ...over });
  const local = ref({ name: 'feature', fullName: 'refs/heads/feature' });
  const tracking = ref({ name: 'main', fullName: 'refs/heads/main', isHead: true, upstream: 'origin/main' });
  const remote = ref({ name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote' });
  const tag = ref({ name: 'v1.0', fullName: 'refs/tags/v1.0', kind: 'tag' });
  const names = (marks: ReturnType<typeof kindMarksOf>): string[] => marks.map((m) => m.displayName ?? m.name);

  it('marks a local branch, a remote one and a tag each as what it is', () => {
    // A plain local branch carried no mark at all before this: the one icon on `main`'s chip was
    // the cloud belonging to its remote copy, and nothing said a local branch was there.
    expect(names(kindMarksOf({ ref: local, upstreamHere: false }))).toEqual(['Laptop']);
    expect(names(kindMarksOf({ ref: remote, upstreamHere: false }))).toEqual(['Cloud']);
    expect(names(kindMarksOf({ ref: tag, upstreamHere: false }))).toEqual(['Tag']);
  });

  it('gives a chip that absorbed its upstream both marks, laptop first', () => {
    // The chip stands for two refs — `main` and `origin/main` — so it is in both places and says
    // so with both, in the study's order. `chipsFor` is what decides that it absorbed one.
    const chips = chipsFor([tracking, remote]);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.upstreamHere).toBe(true);
    expect(names(kindMarksOf(chips[0]!))).toEqual(['Laptop', 'Cloud']);
  });

  it('leaves the synthetic HEAD chip unmarked, since it is on no branch', () => {
    expect(kindMarksOf({ ref: headChipFor('b'.repeat(40)), upstreamHere: false })).toEqual([]);
  });

  it('drops the marks before the name, and needs more room for two of them than for one', () => {
    // GC-071's threshold, unchanged for the one mark it was measured with.
    expect(chipMarksFit(79, 1)).toBe(true);
    expect(chipMarksFit(78, 1)).toBe(false);
    // Two marks want one glyph and one gap more before they are worth what they cost the name.
    expect(chipMarksFit(79, 2)).toBe(false);
    expect(chipMarksFit(94, 2)).toBe(true);
    // At the ref column's minimum, with a `+N` beside it, no chip keeps a mark — which is what
    // makes the laptop free: the name has exactly the room it had before the laptop existed.
    expect(chipMarksFit(chipRoom(100, true), 1)).toBe(false);
    expect(chipMarksFit(chipRoom(100, true), 2)).toBe(false);
    // A chip with nothing to trail is never refused anything.
    expect(chipMarksFit(0, 0)).toBe(true);
  });
});

// The WIP row's message cell is the summary half of the commit draft `App` holds (GC-182). Before
// this it was an uncontrolled `<input>` with no `value` and no `onChange`, so what was typed there
// reached nothing and was lost the moment the row was virtualised out, a file view opened or a tab
// was switched. jsdom is enough for all of it: the field is controlled or it is not.
describe('the WIP row commit field (GC-182)', () => {
  const status: RepoStatus = { branch: 'main', upstream: null, ahead: 0, behind: 0, entries: [], operation: null };
  const wipInput = (c: HTMLElement): HTMLInputElement => c.querySelector<HTMLInputElement>('.wip-input')!;

  it('draws the draft summary rather than whatever the DOM node happens to hold', () => {
    const { container } = renderGraph({ status, draftSummary: 'from the staging form' });
    expect(wipInput(container).value).toBe('from the staging form');
  });

  it('reports typing rather than keeping it', () => {
    const typed: string[] = [];
    const { container } = renderGraph({ status, draftSummary: '', onDraftSummary: (s) => typed.push(s) });
    fireEvent.change(wipInput(container), { target: { value: 'a summary' } });
    expect(typed).toEqual(['a summary']);
    // Controlled: the parent did not change the value, so the node still shows the old one.
    expect(wipInput(container).value).toBe('');
  });

  it('commits on Enter, through the one handler `App` holds the rule in', () => {
    let commits = 0;
    const { container } = renderGraph({ status, draftSummary: 'ready', onCommitDraft: () => commits++ });
    fireEvent.keyDown(wipInput(container), { key: 'Enter' });
    expect(commits).toBe(1);
  });

  it('leaves Ctrl+Enter and every other key alone', () => {
    // `commitInline` is the table's plain Enter; Ctrl+Enter is `commit`, which the staging form's
    // own handler answers, and nothing here may claim both.
    let commits = 0;
    const { container } = renderGraph({ status, draftSummary: 'ready', onCommitDraft: () => commits++ });
    fireEvent.keyDown(wipInput(container), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(wipInput(container), { key: 'a' });
    fireEvent.keyDown(wipInput(container), { key: 'Escape' });
    expect(commits).toBe(0);
  });

  it('does not select the WIP row when the field is clicked', () => {
    // The row's own click selects it; typing in the field is not that gesture.
    const selected: string[] = [];
    const { container } = renderGraph({ status, onSelect: (sha) => selected.push(sha) });
    fireEvent.click(wipInput(container));
    expect(selected).toEqual([]);
  });
});

// GC-183: the third rendering of the three file states, and the one GC-143 deliberately left. It
// drew its own lucide glyphs under `add`/`mod`/`del` — classes the kind tokens are not keyed by —
// so the graph row and the detail panel eight pixels away could not share a colour rule.
describe("the WIP row's change readout (GC-183)", () => {
  const dirty: RepoStatus = {
    branch: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    operation: null,
    entries: [
      { path: 'a.txt', staged: null, unstaged: 'modified' },
      { path: 'b.txt', staged: 'added', unstaged: null },
      { path: 'c.txt', staged: null, unstaged: 'deleted' },
      { path: 'd.txt', staged: null, unstaged: 'conflicted' },
    ],
  };

  it('draws each count with the kind mark and the kind class, not a glyph of its own', () => {
    const { container } = renderGraph({ status: dirty });
    const readout = container.querySelector('.graph-row .readout');
    if (!readout) throw new Error('no readout on the WIP row');

    // The classes the kind tokens are keyed by, which is what makes one rule colour both surfaces.
    for (const kind of ['added', 'modified', 'deleted', 'conflicted']) {
      const span = readout.querySelector(`.kind-${kind}`);
      expect(span, kind).toBeTruthy();
      // `FileKindIcon`'s own mark: `kind kind-<kind>` on the lucide svg inside the count.
      expect(span?.querySelector(`svg.kind.kind-${kind}`), kind).toBeTruthy();
    }
    // And none of the old ones, which no stylesheet outside this row ever knew about.
    expect(readout.querySelector('.add, .mod, .del')).toBeNull();
    expect(readout.textContent).not.toMatch(/[+✎−→]/);
  });

  it('draws the modified mark filled, exactly as the detail panel draws it', () => {
    const { container } = renderGraph({ status: dirty });
    const pencil = container.querySelector('.graph-row .readout .kind-modified svg');
    expect(pencil?.getAttribute('fill')).toBe('currentColor');
    // The other three are the heavier outline `FileKindIcon` gives an unfilled kind.
    const plus = container.querySelector('.graph-row .readout .kind-added svg');
    expect(plus?.getAttribute('fill')).toBe('none');
    expect(plus?.getAttribute('stroke-width')).toBe('2.5');
  });
});
