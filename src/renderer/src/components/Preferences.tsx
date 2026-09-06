import { type JSX, type ReactNode } from 'react';
import type { PullMode, Theme } from '@shared/types';
import { setPrefs, usePrefs, type DiffViewMode, type GraphColumns, type Prefs } from '../prefs';
import { matches } from '../shortcuts';

const THEMES: { theme: Theme; label: string }[] = [
  { theme: 'dark', label: 'Dark' },
  { theme: 'light', label: 'Light' },
  { theme: 'system', label: 'Match the system' },
];

const DIFF_VIEWS: { mode: DiffViewMode; label: string }[] = [
  { mode: 'unified', label: 'Unified' },
  { mode: 'split', label: 'Split (side by side)' },
];

const PULL_MODES: { mode: PullMode; label: string }[] = [
  { mode: 'ff', label: 'Merge (fast-forward if possible)' },
  { mode: 'ff-only', label: 'Fast-forward only' },
  { mode: 'rebase', label: 'Rebase' },
];

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): JSX.Element {
  return (
    <div className="pref-row">
      <div className="pref-label">
        <span>{label}</span>
        {hint && <span className="pref-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ of, label, hint }: { of: 'avatars' | 'confirmDirtyCheckout' | 'commitColumnGuide'; label: string; hint?: string }): JSX.Element {
  const prefs = usePrefs();
  return (
    <Row label={label} hint={hint}>
      <label className="pref-check">
        <input type="checkbox" checked={prefs[of]} onChange={(e) => setPrefs({ [of]: e.target.checked } as Partial<Prefs>)} />
      </label>
    </Row>
  );
}

/** One of the optional graph columns; nested in `prefs.graphColumns`, so it patches the whole object. */
function ColumnToggle({ of, label, hint }: { of: keyof GraphColumns; label: string; hint?: string }): JSX.Element {
  const prefs = usePrefs();
  return (
    <Row label={label} hint={hint}>
      <label className="pref-check">
        <input type="checkbox" checked={prefs.graphColumns[of]} onChange={(e) => setPrefs({ graphColumns: { ...prefs.graphColumns, [of]: e.target.checked } })} />
      </label>
    </Row>
  );
}

/** The Preferences dialog, opened from the toolbar gear. Every change applies immediately. */
export function Preferences({ onClose }: { onClose(): void }): JSX.Element {
  const prefs = usePrefs();
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      // Escape is `App`'s job, so it closes this dialog and nothing behind it.
      onKeyDown={(e) => {
        if (matches('dialogConfirm', e)) onClose();
      }}
    >
      <div className="modal prefs" role="dialog" aria-modal="true" aria-labelledby="prefs-title">
        <h3 id="prefs-title">Preferences</h3>
        <div className="pref-group">
          <div className="pref-group-title">Appearance</div>
          <Row label="Theme" hint="Applies immediately, window controls included.">
            <select className="pref-select" value={prefs.theme} onChange={(e) => setPrefs({ theme: e.target.value as Theme })}>
              {THEMES.map((t) => (
                <option key={t.theme} value={t.theme}>
                  {t.label}
                </option>
              ))}
            </select>
          </Row>
          <Toggle of="avatars" label="Author avatars" hint="Fetches Gravatar images. Off means initials only, and no network requests." />
          <Toggle of="commitColumnGuide" label="72-character commit summary counter" hint="Counts down the characters left on the summary line." />
        </div>
        <div className="pref-group">
          <div className="pref-group-title">Graph</div>
          <ColumnToggle of="author" label="Author column" hint="The commit author's name, after the message." />
          <ColumnToggle of="date" label="Date / time column" hint="The author date, dd/mm/yyyy and the local time." />
          <ColumnToggle of="sha" label="SHA column" hint="The commit's abbreviated hash." />
        </div>
        <div className="pref-group">
          <div className="pref-group-title">Diff</div>
          <Row label="Diff layout" hint="The file view's own toggle writes back here, so the last layout used is the one it opens with.">
            <select className="pref-select" value={prefs.diffView} onChange={(e) => setPrefs({ diffView: e.target.value as DiffViewMode })}>
              {DIFF_VIEWS.map((v) => (
                <option key={v.mode} value={v.mode}>
                  {v.label}
                </option>
              ))}
            </select>
          </Row>
        </div>
        <div className="pref-group">
          <div className="pref-group-title">Behaviour</div>
          <Row label="Default pull action" hint="What the Pull button does when clicked.">
            <select className="pref-select" value={prefs.pullMode} onChange={(e) => setPrefs({ pullMode: e.target.value as PullMode })}>
              {PULL_MODES.map((m) => (
                <option key={m.mode} value={m.mode}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          <Toggle of="confirmDirtyCheckout" label="Confirm checkout with uncommitted changes" hint="Asks before checking out, and offers to stash the changes." />
        </div>
        <div className="modal-buttons">
          <button className="btn primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
