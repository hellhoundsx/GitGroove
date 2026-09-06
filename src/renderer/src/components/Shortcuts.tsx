import { type JSX } from 'react';
import { SHORTCUT_GROUPS } from '../shortcuts';

/** One chord ("Ctrl+Enter") as a row of key caps. */
function Chord({ chord }: { chord: string }): JSX.Element {
  return (
    <span className="chord">
      {chord.split('+').map((k, i) => (
        <kbd key={i}>{k}</kbd>
      ))}
    </span>
  );
}

/**
 * The keyboard shortcuts overlay, opened with `?` or the toolbar's Shortcuts button. It is
 * rendered from `shortcuts.ts`, the same table the handlers match against.
 */
export function Shortcuts({ onClose }: { onClose(): void }): JSX.Element {
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal shortcuts" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
        <h3 id="shortcuts-title">Keyboard shortcuts</h3>
        <div className="modal-body">
          <div className="shortcut-groups">
            {SHORTCUT_GROUPS.map((g) => (
              <div className="shortcut-group" key={g.title}>
                <div className="shortcut-group-title">
                  {g.title}
                  {g.hint && <span className="shortcut-group-hint">{g.hint}</span>}
                </div>
                {g.items.map((s) => (
                  <div className="shortcut-row" key={s.id}>
                    <span className="shortcut-keys">
                      {s.keys.map((chord, i) => (
                        <span key={chord}>
                          {i > 0 && <span className="shortcut-or">or</span>}
                          <Chord chord={chord} />
                        </span>
                      ))}
                    </span>
                    <span className="shortcut-desc">{s.description}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
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
