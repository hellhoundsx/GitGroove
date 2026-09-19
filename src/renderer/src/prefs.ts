import { useSyncExternalStore } from 'react';
import type { PullMode } from '@shared/types';

// One home for every user preference. Everything lives under a single `gitclient.prefs` key so
// settings do not keep sprouting their own keys; the per-repository pin and the ref column width
// stay separate because they are remembered state, not preferences.

/** How a file's diff is laid out: one column of changes, or the two files side by side (GC-014). */
export type DiffViewMode = 'unified' | 'split';

/** The optional graph columns, drawn to the right of the commit message when enabled. */
export interface GraphColumns {
  author: boolean;
  date: boolean;
  sha: boolean;
}

export interface Prefs {
  /** Fetch Gravatar images for authors. Off means initials only and no network requests. */
  avatars: boolean;
  /** What the Pull button does when clicked. */
  pullMode: PullMode;
  /** Show the 72-character countdown on the commit summary field. */
  commitColumnGuide: boolean;
  /** Which optional columns the graph shows after the commit message. */
  graphColumns: GraphColumns;
  /** Unified or side-by-side diffs; the file view's own toggle writes it back here (GC-014). */
  diffView: DiffViewMode;
  /** Diff with `-w`, so a whitespace-only reformat shows no hunk at all (GC-052). */
  diffIgnoreWhitespace: boolean;
  /** Wrap long lines in the diff instead of scrolling the whole body sideways (GC-052). */
  diffWordWrap: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  avatars: true,
  pullMode: 'ff',
  commitColumnGuide: true,
  graphColumns: { author: false, date: false, sha: false },
  diffView: 'unified',
  diffIgnoreWhitespace: false,
  diffWordWrap: false,
};

const KEY = 'gitclient.prefs';
/** Replaced by `prefs.pullMode`; read once on first load, then removed. */
const LEGACY_PULL_MODE_KEY = 'gitclient.pullMode';

const isPullMode = (v: unknown): v is PullMode => v === 'ff' || v === 'ff-only' || v === 'rebase';
const isDiffView = (v: unknown): v is DiffViewMode => v === 'unified' || v === 'split';
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Each column falls back on its own, so a truncated or half-written object still loads (GC-032). */
function graphColumns(v: unknown): GraphColumns {
  const o = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFS.graphColumns;
  return { author: bool(o.author, d.author), date: bool(o.date, d.date), sha: bool(o.sha, d.sha) };
}

/** The only nested value in `Prefs`, so a spread of the defaults has to copy it too. */
const defaults = (): Prefs => ({ ...DEFAULT_PREFS, graphColumns: { ...DEFAULT_PREFS.graphColumns } });

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return {
        avatars: bool(o.avatars, DEFAULT_PREFS.avatars),
        pullMode: isPullMode(o.pullMode) ? o.pullMode : DEFAULT_PREFS.pullMode,
        commitColumnGuide: bool(o.commitColumnGuide, DEFAULT_PREFS.commitColumnGuide),
        graphColumns: graphColumns(o.graphColumns),
        diffView: isDiffView(o.diffView) ? o.diffView : DEFAULT_PREFS.diffView,
        diffIgnoreWhitespace: bool(o.diffIgnoreWhitespace, DEFAULT_PREFS.diffIgnoreWhitespace),
        diffWordWrap: bool(o.diffWordWrap, DEFAULT_PREFS.diffWordWrap),
      };
    }
    // Migration: the pull mode used to have its own key.
    const legacy = localStorage.getItem(LEGACY_PULL_MODE_KEY);
    if (legacy !== null) {
      const migrated: Prefs = { ...defaults(), pullMode: isPullMode(legacy) ? legacy : DEFAULT_PREFS.pullMode };
      localStorage.setItem(KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_PULL_MODE_KEY);
      return migrated;
    }
  } catch {
    /* unreadable storage falls back to the defaults */
  }
  return defaults();
}

let current: Prefs = load();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const getPrefs = (): Prefs => current;

// The theme (GC-013) and the window material (GC-212) were both settings and are neither any more
// (GC-213). There is one palette, so `resolveTheme`, `applyTheme`, the `prefers-color-scheme`
// listener and the `data-theme` stamp have nothing left to decide; and there is one material,
// decided by the main process before a renderer exists and stamped by `main.tsx` from the URL, so
// nothing here has to ask for it or wait for an answer. What is left in this file is what a
// preference actually is: a value the user picked, validated on load and persisted on write.

/** Merge a patch into the preferences, persist them and re-render every `usePrefs()` caller. */
export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  for (const fn of listeners) fn();
}

export const usePrefs = (): Prefs => useSyncExternalStore(subscribe, getPrefs, getPrefs);
