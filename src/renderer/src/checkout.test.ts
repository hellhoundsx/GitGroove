import { describe, expect, it } from 'vitest';
import { blockedList, checkoutBlock } from './checkout';

/** git's two refusals, verbatim down to the tab it indents each path with. */
const TRACKED = [
  'error: Your local changes to the following files would be overwritten by checkout:',
  '\tsrc/a.ts',
  '\tsrc/b.ts',
  'Please commit your changes or stash them before you switch branches.',
  'Aborting',
].join('\n');

const UNTRACKED = [
  'error: The following untracked working tree files would be overwritten by checkout:',
  '\tnotes.txt',
  'Please move or remove them before you switch branches.',
  'Aborting',
].join('\n');

describe('checkoutBlock: telling the one refusal worth a dialog from every other failure (GC-215)', () => {
  it('reads the files out of the tracked form, and stops at the line that is not one', () => {
    expect(checkoutBlock(TRACKED)).toEqual({ kind: 'tracked', paths: ['src/a.ts', 'src/b.ts'] });
  });

  it('tells the untracked form apart, since what is in the way is not the user s work', () => {
    expect(checkoutBlock(UNTRACKED)).toEqual({ kind: 'untracked', paths: ['notes.txt'] });
  });

  it('answers null for every other failure, which is what leaves it on the status bar', () => {
    expect(checkoutBlock("error: pathspec 'nope' did not match any file(s) known to git")).toBeNull();
    expect(checkoutBlock('fatal: not a git repository')).toBeNull();
    expect(checkoutBlock('')).toBeNull();
    // A conflicted merge is not this: the checkout happened, and it reports the ordinary way.
    expect(checkoutBlock('CONFLICT (content): Merge conflict in src/a.ts')).toBeNull();
  });

  it('answers a block for a header with no list rather than null', () => {
    // The refusal *is* the header, and the question to put to the user does not change with
    // whether git chose to name the files under it.
    expect(checkoutBlock('error: Your local changes to the following files would be overwritten by checkout:')).toEqual({ kind: 'tracked', paths: [] });
  });

  it('reads the same message with git s own name still on the front of it', () => {
    // `msg()` strips the class name, but a leading blank line or a prefixed first line must not
    // move the answer: the header is found by search, not by position.
    expect(checkoutBlock(`GitError: ${TRACKED}`)?.paths).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('blockedList: the files named in the sentence, and the rest counted (GC-215)', () => {
  it('names up to three', () => {
    expect(blockedList(['a'])).toBe('a');
    expect(blockedList(['a', 'b', 'c'])).toBe('a, b, c');
  });

  it('counts the rest, so the sentence stays a sentence', () => {
    expect(blockedList(['a', 'b', 'c', 'd'])).toBe('a, b, c and 1 more');
    expect(blockedList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
  });

  it('is empty when git named none, so the clause is left out entirely', () => {
    expect(blockedList([])).toBe('');
  });
});
