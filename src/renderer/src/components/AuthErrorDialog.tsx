import { useEffect, useRef, type JSX } from 'react';

interface Props {
  /** The first line of the failure: what happened, on which remote, at which URL (GC-169). */
  summary: string;
  /** Everything git wrote, unabridged — the `remote:` lines that say what to do included. */
  detail: string;
  onClose(): void;
}

/**
 * What a credential refusal gets instead of one ellipsised line on the status bar (GC-169).
 *
 * The status bar shows `summary` and can only ever show one line of anything; the lines that say
 * how to fix an SSO refusal are the `remote:` ones underneath it, so they are what this exists to
 * put on screen. The body is selectable and scrolls, and Copy puts the whole message — summary
 * and git's own text — on the clipboard, because the next step is usually pasting it somewhere.
 *
 * The shape is the app's own modal (GC-103): `h3`, `.modal-body`, `.modal-buttons`, with only the
 * body scrolling. Escape is not handled here — `App` closes the topmost layer, and this one joins
 * `layerOpen` like every other.
 */
export function AuthErrorDialog({ summary, detail, onClose }: Props): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const copiedRef = useRef<HTMLSpanElement>(null);
  useEffect(() => closeRef.current?.focus(), []);

  const copy = (): void => {
    void navigator.clipboard.writeText(`${summary}\n${detail}`).then(() => {
      // A word rather than a toast: the app has no notification surface, and the button saying so
      // for a moment is what every other Copy in a dialog does.
      if (copiedRef.current) copiedRef.current.textContent = 'Copied';
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal auth-error" role="dialog" aria-modal="true" aria-labelledby="auth-error-title">
        <h3 id="auth-error-title">Authentication failed</h3>
        <div className="modal-body">
          <p className="modal-message">{summary}</p>
          {/* `pre`, not a paragraph: git's message is line-oriented and its `remote:` lines are
              addressed to a person. Selectable, so it can be read out of here by hand. */}
          <pre className="auth-error-text">{detail}</pre>
          <p className="modal-note">
            GitClient never sees or stores a credential: the system credential helper holds them, and this is what it and git reported.
          </p>
        </div>
        <div className="modal-buttons">
          <button className="btn" onClick={copy}>
            Copy <span ref={copiedRef} className="copied" />
          </button>
          <span className="spacer" />
          <button ref={closeRef} className="btn primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
