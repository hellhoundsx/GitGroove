import { describe, expect, it } from 'vitest';
import type { GitRef } from '@shared/types';
import { canDragRef, canDropRef } from './refDrag';

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
