import { describe, expect, it } from 'vitest';
import type { Remote } from './types';
import { defaultRemote } from './remotes';

const r = (name: string): Remote => ({ name, fetchUrl: `https://example.invalid/${name}.git`, pushUrl: `https://example.invalid/${name}.git` });

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
