// The single table of keyboard shortcuts. Every handler in the app asks this module whether an
// event is one of them, and the overlay in `components/Shortcuts.tsx` is rendered straight from
// the same list, so a binding cannot be documented differently from the way it behaves.

/** The part of a key event the matchers need. Both DOM and React key events satisfy it. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type ShortcutId =
  | 'openSearch'
  | 'help'
  | 'escape'
  | 'selectNext'
  | 'selectPrev'
  | 'searchNext'
  | 'searchPrev'
  | 'searchClose'
  | 'commit'
  | 'dialogConfirm'
  | 'dialogCancel';

export interface Shortcut {
  id: ShortcutId;
  /** Alternative chords, each `+`-separated, shown as separate key caps in the overlay. */
  keys: string[];
  description: string;
  /** True when the shortcut deliberately also fires while a text field has focus. */
  whileTyping?: boolean;
  match(e: KeyLike): boolean;
}

export interface ShortcutGroup {
  title: string;
  /** Shown under the group title when the group only applies somewhere specific. */
  hint?: string;
  items: Shortcut[];
}

/** Ctrl on Windows and Linux, Cmd on macOS; the app accepts either. */
const mod = (e: KeyLike): boolean => e.ctrlKey || e.metaKey;
const plain = (e: KeyLike): boolean => !e.ctrlKey && !e.metaKey && !e.shiftKey;

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      {
        id: 'openSearch',
        keys: ['Ctrl+F'],
        description: 'Find a commit',
        whileTyping: true,
        match: (e) => mod(e) && (e.key === 'f' || e.key === 'F'),
      },
      {
        id: 'help',
        keys: ['?'],
        description: 'Show this list of shortcuts',
        match: (e) => !mod(e) && (e.key === '?' || (e.key === '/' && e.shiftKey)),
      },
      {
        id: 'escape',
        keys: ['Esc'],
        description: 'Close this list, the find bar, the open diff or a popover',
        match: (e) => e.key === 'Escape',
      },
    ],
  },
  {
    title: 'Commit graph',
    items: [
      {
        id: 'selectNext',
        keys: ['↓'],
        description: 'Select the next commit',
        match: (e) => plain(e) && e.key === 'ArrowDown',
      },
      {
        id: 'selectPrev',
        keys: ['↑'],
        description: 'Select the previous commit',
        match: (e) => plain(e) && e.key === 'ArrowUp',
      },
    ],
  },
  {
    title: 'Find a commit',
    hint: 'While the find bar has focus',
    items: [
      {
        id: 'searchNext',
        keys: ['Enter', '↓'],
        description: 'Go to the next match',
        whileTyping: true,
        match: (e) => !mod(e) && ((e.key === 'Enter' && !e.shiftKey) || e.key === 'ArrowDown'),
      },
      {
        id: 'searchPrev',
        keys: ['Shift+Enter', '↑'],
        description: 'Go to the previous match',
        whileTyping: true,
        match: (e) => !mod(e) && ((e.key === 'Enter' && e.shiftKey) || e.key === 'ArrowUp'),
      },
      {
        id: 'searchClose',
        keys: ['Esc'],
        description: 'Close the find bar',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
      },
    ],
  },
  {
    title: 'Commit message',
    hint: 'While the summary or description has focus',
    items: [
      {
        id: 'commit',
        keys: ['Ctrl+Enter'],
        description: 'Commit the staged changes',
        whileTyping: true,
        match: (e) => mod(e) && e.key === 'Enter',
      },
    ],
  },
  {
    title: 'Dialogs',
    items: [
      {
        id: 'dialogConfirm',
        keys: ['Enter'],
        description: 'Confirm the dialog',
        whileTyping: true,
        match: (e) => !mod(e) && e.key === 'Enter',
      },
      {
        id: 'dialogCancel',
        keys: ['Esc'],
        description: 'Cancel the dialog',
        whileTyping: true,
        match: (e) => e.key === 'Escape',
      },
    ],
  },
];

const byId = new Map<ShortcutId, Shortcut>(SHORTCUT_GROUPS.flatMap((g) => g.items.map((s) => [s.id, s])));

/** True when `e` is the shortcut `id`. The only place a key name is compared outside this file. */
export function matches(id: ShortcutId, e: KeyLike): boolean {
  const s = byId.get(id);
  return s !== undefined && s.match(e);
}
