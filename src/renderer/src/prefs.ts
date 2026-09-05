import { useSyncExternalStore } from 'react';
import type { PullMode } from '@shared/types';

// One home for every user preference. Everything lives under a single `gitclient.prefs` key so
// settings do not keep sprouting their own keys; the per-repository pin and the ref column width
// stay separate because they are remembered state, not preferences.

export interface Prefs {
  /** Fetch Gravatar images for authors. Off means initials only and no network requests. */
  avatars: boolean;
  /** What the Pull button does when clicked. */
  pullMode: PullMode;
  /** Ask before checking out with a dirty working tree (and offer to stash). */
  confirmDirtyCheckout: boolean;
  /** Show the 72-character countdown on the commit summary field. */
  commitColumnGuide: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  avatars: true,
  pullMode: 'ff',
  confirmDirtyCheckout: true,
  commitColumnGuide: true,
};

const KEY = 'gitclient.prefs';
/** Replaced by `prefs.pullMode`; read once on first load, then removed. */
const LEGACY_PULL_MODE_KEY = 'gitclient.pullMode';

const isPullMode = (v: unknown): v is PullMode => v === 'ff' || v === 'ff-only' || v === 'rebase';
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>;
      return {
        avatars: bool(o.avatars, DEFAULT_PREFS.avatars),
        pullMode: isPullMode(o.pullMode) ? o.pullMode : DEFAULT_PREFS.pullMode,
        confirmDirtyCheckout: bool(o.confirmDirtyCheckout, DEFAULT_PREFS.confirmDirtyCheckout),
        commitColumnGuide: bool(o.commitColumnGuide, DEFAULT_PREFS.commitColumnGuide),
      };
    }
    // Migration: the pull mode used to have its own key.
    const legacy = localStorage.getItem(LEGACY_PULL_MODE_KEY);
    if (legacy !== null) {
      const migrated: Prefs = { ...DEFAULT_PREFS, pullMode: isPullMode(legacy) ? legacy : DEFAULT_PREFS.pullMode };
      localStorage.setItem(KEY, JSON.stringify(migrated));
      localStorage.removeItem(LEGACY_PULL_MODE_KEY);
      return migrated;
    }
  } catch {
    /* unreadable storage falls back to the defaults */
  }
  return { ...DEFAULT_PREFS };
}

let current: Prefs = load();
const listeners = new Set<() => void>();

const subscribe = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const getPrefs = (): Prefs => current;

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
