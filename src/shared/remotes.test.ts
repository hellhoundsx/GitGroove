import { describe, expect, it } from 'vitest';
import type { GitRef, Remote } from './types';
import { defaultRemote, remoteCopyOf } from './remotes';

const r = (name: string): Remote => ({ name, fetchUrl: `https://example.invalid/${name}.git`, pushUrl: `https://example.invalid/${name}.git` });

const local = (name: string, upstream?: string): GitRef => ({ name, fullName: `refs/heads/${name}`, kind: 'head', sha: 'a'.repeat(40), isHead: false, upstream });
const tracked = (name: string): GitRef => ({ name, fullName: `refs/remotes/${name}`, kind: 'remote', sha: 'b'.repeat(40), isHead: false });

describe('defaultRemote', () => {
  it('returns undefined when the repository has no remotes', () => {
    expect(defaultRemote([])).toBeUndefined();
  });

  it('returns the only remote whatever it is called', () => {
    expect(defaultRemote([r('upstream')])).toBe('upstream');
  });

  it('prefers origin over a remote that sorts before it', () => {
    // getRemotes reports remotes sorted by name, so without the preference the tag
    // push used to land on `alpha` while the branch push went to `origin` (GC-031).
    expect(defaultRemote([r('alpha'), r('origin')])).toBe('origin');
  });

  it('prefers origin wherever it appears in the list', () => {
    expect(defaultRemote([r('origin'), r('zeta')])).toBe('origin');
  });

  it('falls back to the first remote when there is no origin', () => {
    expect(defaultRemote([r('alpha'), r('mirror')])).toBe('alpha');
  });
});

describe('remoteCopyOf', () => {
  it('answers the upstream when the snapshot lists it', () => {
    const refs = [local('main', 'origin/main'), tracked('origin/main'), tracked('origin/other')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'main' });
  });

  it('falls through to a same-name remote ref when the upstream has been pruned', () => {
    // The branch still records `origin/main` as its upstream, but the snapshot no longer lists
    // that ref — the state a `git fetch --prune` leaves behind. The same-name copy is the answer.
    const refs = [local('main', 'origin/main'), tracked('mirror/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('mirror')])).toEqual({ remote: 'mirror', branch: 'main' });
  });

  it('answers a same-name remote ref for a branch pushed without -u', () => {
    const refs = [local('feature'), tracked('origin/feature')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'feature' });
  });

  it('answers null for a branch that is on no remote', () => {
    const refs = [local('local-only'), tracked('origin/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toBeNull();
  });

  it('splits a slashed branch name at the remote, not at the first slash', () => {
    // `feature/x` on `origin` is `origin/feature/x`; splitting on the first slash would name the
    // branch `x` and delete the wrong ref (GC-134).
    const refs = [local('feature/x', 'origin/feature/x'), tracked('origin/feature/x')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'feature/x' });
  });

  it('answers null when the only copy is on a remote the snapshot does not list', () => {
    // The ref is there but no remote accounts for its prefix, so nothing can be told to delete it.
    const refs = [local('main'), tracked('gone/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toBeNull();
  });
});
