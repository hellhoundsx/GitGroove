import { describe, expect, it } from 'vitest';
import type { GitRef } from '@shared/types';
import { canDragRef, canDropRef, dragScrollSpeed, DRAG_SCROLL_BAND, DRAG_SCROLL_MAX } from './refDrag';

// GC-015: which pairs a drag may be made of. The two menu rows decide it — merge runs on the
// branch being merged into, rebase checks the source out — so the predicate is what keeps a drop
// from ever opening a menu with nothing in it, and it is pure, so it is tested here rather than
// through two components that both spread it onto their elements.

const ref = (name: string, kind: GitRef['kind'], isHead = false): GitRef => ({
  name,
  fullName: kind === 'head' ? `refs/heads/${name}` : kind === 'remote' ? `refs/remotes/${name}` : `refs/tags/${name}`,
  kind,
  sha: 'a'.repeat(40),
  isHead,
});

const main = ref('main', 'head', true);
const feature = ref('feature', 'head');
const originMain = ref('origin/main', 'remote');
const originFeature = ref('origin/feature', 'remote');
const tag = ref('v1', 'tag');

describe('canDragRef', () => {
  it('picks up local and remote branches', () => {
    expect(canDragRef(main)).toBe(true);
    expect(canDragRef(originMain)).toBe(true);
  });

  it('leaves tags alone: a tag names no line of work to merge or rebase', () => {
    expect(canDragRef(tag)).toBe(false);
  });
});

describe('canDropRef', () => {
  it('accepts a branch dropped on another local branch', () => {
    expect(canDropRef(feature, main)).toBe(true);
    expect(canDropRef(main, feature)).toBe(true);
    expect(canDropRef(originFeature, main)).toBe(true); // merge origin/feature into main
  });

  it('accepts a local branch dropped on a remote one: the rebase row still applies', () => {
    expect(canDropRef(feature, originMain)).toBe(true);
  });

  it('refuses a pair that offers neither row', () => {
    // Nothing to merge into (the target is not a local branch) and nothing to check out (the
    // source is not one either), so the dragover never makes the target droppable.
    expect(canDropRef(originFeature, originMain)).toBe(false);
  });

  it('refuses a ref dropped on itself, and anything involving a tag', () => {
    expect(canDropRef(main, main)).toBe(false);
    expect(canDropRef(tag, main)).toBe(false);
    expect(canDropRef(main, tag)).toBe(false);
  });

  it('refuses a drop with no drag in flight', () => {
    expect(canDropRef(null, main)).toBe(false);
    expect(canDropRef(undefined, main)).toBe(false);
  });
});

/**
 * GC-122: how fast the graph scrolls while a branch is held near one of its edges. The rate is the
 * only part of the auto-scroll that is a decision rather than plumbing, so it is the part with a
 * test; the rAF loop that applies it is driven by the clock and belongs to the running app.
 */
describe('dragScrollSpeed', () => {
  // A 600px-tall body, the way `.graph-body` sits in a 900px window.
  const TOP = 100;
  const BOTTOM = 700;
  const at = (y: number): number => dragScrollSpeed(y, TOP, BOTTOM);

  it('is still through the whole middle of the container', () => {
    expect(at(TOP + DRAG_SCROLL_BAND)).toBe(0);
    expect(at(400)).toBe(0);
    expect(at(BOTTOM - DRAG_SCROLL_BAND)).toBe(0);
  });

  it('scrolls up in the top band and down in the bottom one', () => {
    expect(at(TOP + 1)).toBeLessThan(0);
    expect(at(BOTTOM - 1)).toBeGreaterThan(0);
  });

  it('ramps with the distance into the band rather than switching on at full speed', () => {
    // Half way into the band is half speed, so crossing the edge of the band is not a lurch.
    expect(at(TOP + DRAG_SCROLL_BAND / 2)).toBeCloseTo(-DRAG_SCROLL_MAX / 2);
    expect(at(BOTTOM - DRAG_SCROLL_BAND / 2)).toBeCloseTo(DRAG_SCROLL_MAX / 2);
  });

  it('caps at full speed past either edge, where a fast drag leaves the container', () => {
    expect(at(TOP)).toBe(-DRAG_SCROLL_MAX);
    expect(at(TOP - 500)).toBe(-DRAG_SCROLL_MAX);
    expect(at(BOTTOM)).toBe(DRAG_SCROLL_MAX);
    expect(at(BOTTOM + 500)).toBe(DRAG_SCROLL_MAX);
  });

  it('splits a container shorter than two bands rather than letting them fight', () => {
    // 60px tall: each band is 30, so the midpoint is the one still position and neither edge wins
    // an argument with the other.
    expect(dragScrollSpeed(30, 0, 60)).toBe(0);
    expect(dragScrollSpeed(29, 0, 60)).toBeLessThan(0);
    expect(dragScrollSpeed(31, 0, 60)).toBeGreaterThan(0);
  });

  it('is still in a container with no height at all', () => {
    expect(dragScrollSpeed(0, 0, 0)).toBe(0);
  });
});
