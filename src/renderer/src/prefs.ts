import { useSyncExternalStore } from 'react';
import type { PullMode, ResolvedTheme, Theme, WindowMaterial } from '@shared/types';

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
  /** Ask before checking out with a dirty working tree (and offer to stash). */
  confirmDirtyCheckout: boolean;
  /** Show the 72-character countdown on the commit summary field. */
  commitColumnGuide: boolean;
  /** Which optional columns the graph shows after the commit message. */
  graphColumns: GraphColumns;
  /** Dark, light, or whatever the OS is set to (GC-013). */
  theme: Theme;
  /**
   * How far the OS window material is let in (GC-212). `mica` is the quiet one and the default:
   * the desktop shows through the chrome only. `acrylic` is the loud one — a much stronger frost,
   * and the content card goes translucent with it. `none` asks the OS for nothing.
   * What is actually applied is the main process's answer, not this: see `applyMaterial`.
   */
  windowMaterial: WindowMaterial;
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
  confirmDirtyCheckout: true,
  commitColumnGuide: true,
  graphColumns: { author: false, date: false, sha: false },
  theme: 'dark',
  windowMaterial: 'mica',
  diffView: 'unified',
  diffIgnoreWhitespace: false,
  diffWordWrap: false,
};

const KEY = 'gitclient.prefs';
/** Replaced by `prefs.pullMode`; read once on first load, then removed. */
const LEGACY_PULL_MODE_KEY = 'gitclient.pullMode';

const isPullMode = (v: unknown): v is PullMode => v === 'ff' || v === 'ff-only' || v === 'rebase';
const isTheme = (v: unknown): v is Theme => v === 'dark' || v === 'light' || v === 'system';
const isDiffView = (v: unknown): v is DiffViewMode => v === 'unified' || v === 'split';
const isMaterial = (v: unknown): v is WindowMaterial => v === 'mica' || v === 'acrylic' || v === 'none';
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
        confirmDirtyCheckout: bool(o.confirmDirtyCheckout, DEFAULT_PREFS.confirmDirtyCheckout),
        commitColumnGuide: bool(o.commitColumnGuide, DEFAULT_PREFS.commitColumnGuide),
        graphColumns: graphColumns(o.graphColumns),
        theme: isTheme(o.theme) ? o.theme : DEFAULT_PREFS.theme,
        windowMaterial: isMaterial(o.windowMaterial) ? o.windowMaterial : DEFAULT_PREFS.windowMaterial,
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

// ---- theme (GC-013) ---------------------------------------------------------------------------

const SYSTEM_LIGHT = '(prefers-color-scheme: light)';

/**
 * Which theme the `theme` setting actually means right now. `system` is resolved here rather than
 * left to a media query in `tokens.css`, so there is one answer to "which theme is showing" — the
 * renderer needs it in JavaScript to tell the main process what to paint the OS window controls,
 * which are the one part of the frame CSS cannot reach.
 */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme !== 'system') return theme;
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SYSTEM_LIGHT).matches ? 'light' : 'dark';
}

/**
 * Stamp the resolved theme on the document element, which is what every token in `tokens.css`
 * keys off, and hand the same answer to the main process for the window controls. Guarded on
 * `document` because `prefs.ts` is loaded by a test that runs without a DOM.
 */
function applyTheme(): void {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(current.theme);
  document.documentElement.dataset.theme = resolved;
  // The bridge is absent, or stubbed with only the calls a case needs, in a test render; a window
  // that cannot repaint its controls is not worth an unhandled rejection over.
  void window.api?.setTheme?.(resolved)?.catch(() => undefined);
}

applyTheme();

// ---- window material (GC-212) -----------------------------------------------------------------

/**
 * Ask the main process for the material and stamp **its answer** on the document element, which is
 * what the `[data-material]` rules in `app.css` key off.
 *
 * The answer rather than the request, because whether a material can be had is not something the
 * renderer knows: a stealth launch is drawn offscreen with no OS window behind it, and Windows 10
 * and every other platform have none at all. Stamping the request would leave the stylesheet
 * translucent over a ground nothing is painting — a window rendered over a void.
 *
 * Nothing is stamped until the answer comes back, so the first frame is the opaque one. That is the
 * safe direction: opaque settling into glass is invisible, where glass collapsing to opaque is a
 * flash of the wrong window.
 */
function applyMaterial(): void {
  if (typeof document === 'undefined') return;
  const asked = current.windowMaterial;
  const api = window.api?.setMaterial;
  if (!api) return; // a test render, or a preload that predates the channel
  void api(asked)
    .then((applied) => {
      if (applied === 'none') delete document.documentElement.dataset.material;
      else document.documentElement.dataset.material = applied;
    })
    .catch(() => undefined);
}

applyMaterial();

// Following the OS means following it as it changes, not only as the app starts. The listener is
// registered once and does nothing unless the setting is `system`.
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia(SYSTEM_LIGHT).addEventListener('change', () => {
    if (current.theme === 'system') applyTheme();
  });
}

/** Merge a patch into the preferences, persist them and re-render every `usePrefs()` caller. */
export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* ignore */
  }
  applyTheme();
  applyMaterial();
  for (const fn of listeners) fn();
}

export const usePrefs = (): Prefs => useSyncExternalStore(subscribe, getPrefs, getPrefs);
