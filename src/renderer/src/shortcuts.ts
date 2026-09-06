// The single table of keyboard shortcuts. Every handler in the app asks this module whether an
// event is one of them, and the overlay in `components/Shortcuts.tsx` is rendered straight from
// the same list, so a binding cannot be documented differently from the way it behaves.

/** The part of a key event the matchers need. Both DOM and React key events satisfy it. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  /** Optional so a test's key literal stays short; only Ctrl+Alt+F reads it (GC-033). */
  altKey?: boolean;
}

export type ShortcutId =
  | 'openSearch'
  | 'help'
  | 'escape'
  | 'newBranch'
  | 'fetchAll'
  | 'toggleLeft'
  | 'toggleDetail'
  | 'focusFilter'
  | 'nextTab'
  | 'prevTab'
  | 'stageAll'
  | 'unstageAll'
  | 'focusSummary'
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
/** A letter chord, whatever the shift state does to `key`: Ctrl+Shift+S arrives as `S` (GC-033). */
const letter = (e: KeyLike, c: string): boolean => e.key.toLowerCase() === c;
/** The plain modifier chord: Ctrl (or Cmd) and that letter, with neither Shift nor Alt on it. */
const ctrlOnly = (e: KeyLike, c: string): boolean => mod(e) && !e.shiftKey && !e.altKey && letter(e, c);
const ctrlShift = (e: KeyLike, c: string): boolean => mod(e) && e.shiftKey && !e.altKey && letter(e, c);

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    items: [
      {
        id: 'openSearch',
        keys: ['Ctrl+F'],
        description: 'Find a commit',
        whileTyping: true,
        // Alt is excluded because Ctrl+Alt+F is the left panel's filter (GC-033).
        match: (e) => mod(e) && !e.altKey && letter(e, 'f'),
      },
      {
        id: 'newBranch',
        keys: ['Ctrl+B'],
        description: 'Create a branch at HEAD',
        match: (e) => ctrlOnly(e, 'b'),
      },
      {
        id: 'fetchAll',
        keys: ['Ctrl+L'],
        description: 'Fetch all remotes',
        match: (e) => ctrlOnly(e, 'l'),
      },
      {
        id: 'toggleLeft',
        keys: ['Ctrl+J'],
        description: 'Show or hide the left panel',
        match: (e) => ctrlOnly(e, 'j'),
      },
      {
        id: 'toggleDetail',
        keys: ['Ctrl+K'],
        description: 'Show or hide the detail panel',
        match: (e) => ctrlOnly(e, 'k'),
      },
      {
        id: 'focusFilter',
        keys: ['Ctrl+Alt+F'],
        description: 'Filter the branches in the left panel',
        match: (e) => mod(e) && e.altKey === true && letter(e, 'f'),
      },
      {
        id: 'nextTab',
        keys: ['Ctrl+Tab'],
        description: 'Show the next repository tab',
        // Not `whileTyping`: the commit message belongs to the repository it was typed in and is
        // gone with the tab, so switching out of a half-written one must be deliberate (GC-016).
        match: (e) => mod(e) && !e.shiftKey && !e.altKey && e.key === 'Tab',
      },
      {
        id: 'prevTab',
        keys: ['Ctrl+Shift+Tab'],
        description: 'Show the previous repository tab',
        match: (e) => mod(e) && e.shiftKey && !e.altKey && e.key === 'Tab',
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
        description: 'Close the find bar, the open diff or a popover',
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
    title: 'Working directory',
    items: [
      {
        id: 'stageAll',
        keys: ['Ctrl+Shift+S'],
        description: 'Stage every change',
        match: (e) => ctrlShift(e, 's'),
      },
      {
        id: 'unstageAll',
        keys: ['Ctrl+Shift+U'],
        description: 'Unstage everything',
        match: (e) => ctrlShift(e, 'u'),
      },
      {
        id: 'focusSummary',
        keys: ['Ctrl+Shift+M'],
        description: 'Write a commit message',
        // The one of the eight that fires from a text field: it is how the user gets *to* the
        // field, so refusing it while another one has focus would make it the least reachable.
        whileTyping: true,
        match: (e) => ctrlShift(e, 'm'),
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
        description: 'Close or cancel the dialog',
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

/**
 * Whether this shortcut deliberately fires while a text field has focus (GC-033, GR-002). The flag
 * had been on the table since GC-010 and read by nothing: `App` decided the same question with an
 * `isEditable` check of its own, in one place, so a new binding either inherited that rule or grew
 * a second one. It is one rule now, and it is the one the overlay is rendered from.
 */
export function firesWhileTyping(id: ShortcutId): boolean {
  return byId.get(id)?.whileTyping === true;
}
