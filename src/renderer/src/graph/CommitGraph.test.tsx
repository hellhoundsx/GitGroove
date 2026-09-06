import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Commit, GitRef } from '@shared/types';
import { CommitGraph } from './CommitGraph';
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
      detached={false}
      hasMore={false}
      loadingMore={false}
      onLoadMore={() => {}}
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
