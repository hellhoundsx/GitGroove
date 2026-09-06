import { describe, expect, it } from 'vitest';
import { firesWhileTyping, matches, SHORTCUT_GROUPS, type KeyLike, type ShortcutId } from './shortcuts';

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, ...mods });

const all = SHORTCUT_GROUPS.flatMap((g) => g.items);

describe('the shortcut table', () => {
  it('gives every shortcut a unique id, at least one chord and a description', () => {
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of all) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it('exposes every shortcut through matches()', () => {
    for (const s of all) expect(matches(s.id, key('\u0000'))).toBe(false);
  });
});

describe('matches', () => {
  it('accepts Ctrl and Cmd for the modifier chords', () => {
    expect(matches('openSearch', key('f', { ctrlKey: true }))).toBe(true);
    expect(matches('openSearch', key('F', { metaKey: true }))).toBe(true);
    expect(matches('openSearch', key('f'))).toBe(false);
    expect(matches('commit', key('Enter', { ctrlKey: true }))).toBe(true);
    expect(matches('commit', key('Enter'))).toBe(false);
  });

  it('opens the overlay on ? and on Shift+/, but not with a modifier', () => {
    expect(matches('help', key('?'))).toBe(true);
    expect(matches('help', key('/', { shiftKey: true }))).toBe(true);
    expect(matches('help', key('/'))).toBe(false);
    expect(matches('help', key('?', { ctrlKey: true }))).toBe(false);
  });

  it('keeps the plain arrows free of modifiers so Ctrl+↓ does not move the selection', () => {
    expect(matches('selectNext', key('ArrowDown'))).toBe(true);
    expect(matches('selectPrev', key('ArrowUp'))).toBe(true);
    expect(matches('selectNext', key('ArrowDown', { ctrlKey: true }))).toBe(false);
    expect(matches('selectPrev', key('ArrowUp', { shiftKey: true }))).toBe(false);
  });

  it('separates the two directions of the find bar', () => {
    expect(matches('searchNext', key('Enter'))).toBe(true);
    expect(matches('searchPrev', key('Enter'))).toBe(false);
    expect(matches('searchPrev', key('Enter', { shiftKey: true }))).toBe(true);
    expect(matches('searchNext', key('Enter', { shiftKey: true }))).toBe(false);
    expect(matches('searchNext', key('ArrowDown'))).toBe(true);
    expect(matches('searchPrev', key('ArrowUp'))).toBe(true);
  });

  it('takes the body-scope chords whichever case the shift state puts the letter in (GC-033)', () => {
    expect(matches('newBranch', key('b', { ctrlKey: true }))).toBe(true);
    expect(matches('fetchAll', key('l', { metaKey: true }))).toBe(true);
    expect(matches('toggleLeft', key('j', { ctrlKey: true }))).toBe(true);
    expect(matches('toggleDetail', key('k', { ctrlKey: true }))).toBe(true);
    expect(matches('stageAll', key('S', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('unstageAll', key('U', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matches('focusSummary', key('M', { ctrlKey: true, shiftKey: true }))).toBe(true);
    // and the plain chord is not the Shift one, in either direction
    expect(matches('stageAll', key('s', { ctrlKey: true }))).toBe(false);
    expect(matches('newBranch', key('B', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches('newBranch', key('b'))).toBe(false);
  });

  it('separates Ctrl+Alt+F from Ctrl+F, which is the pair that would otherwise both fire', () => {
    expect(matches('focusFilter', key('f', { ctrlKey: true, altKey: true }))).toBe(true);
    expect(matches('openSearch', key('f', { ctrlKey: true, altKey: true }))).toBe(false);
    expect(matches('focusFilter', key('f', { ctrlKey: true }))).toBe(false);
    expect(matches('openSearch', key('f', { ctrlKey: true }))).toBe(true);
  });

  it('answers which bindings fire from inside a text field, which is what the handler reads (GR-002)', () => {
    expect(firesWhileTyping('openSearch')).toBe(true);
    expect(firesWhileTyping('focusSummary')).toBe(true);
    expect(firesWhileTyping('commit')).toBe(true);
    for (const id of ['newBranch', 'fetchAll', 'toggleLeft', 'toggleDetail', 'focusFilter', 'stageAll', 'unstageAll'] satisfies ShortcutId[]) {
      expect(firesWhileTyping(id)).toBe(false);
    }
  });

  it('matches Escape for every close binding', () => {
    for (const id of ['escape', 'searchClose', 'dialogCancel'] satisfies ShortcutId[]) {
      expect(matches(id, key('Escape'))).toBe(true);
    }
  });
});
