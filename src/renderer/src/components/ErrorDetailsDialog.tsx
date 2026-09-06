import { useEffect, useRef, type JSX } from 'react';

interface Props {
  /** The one line the status bar drew: what happened, and for a credential refusal on which remote (GC-169). */
  summary: string;
  /** Everything git wrote, unabridged — the `hint:` and `remote:` lines that say what to do included. */
  detail: string;
  /**
   * Whether this failure was a credential refusal (GC-202). It decides the title and the note about
   * where credentials live, which is true of an SSO refusal and of nothing else; the rest of the
   * dialog is the same either way, because the job is the same — put git's own lines on screen.
   */
  auth: boolean;
  onClose(): void;
}

/**
 * What a failure git wrote more than one line about gets instead of one ellipsised line on the
 * status bar (GC-169, GC-202).
 *
 * The status bar shows `summary` and can only ever show one line of anything. GC-169 built this for
 * the `remote:` lines of an SSO refusal; GC-202 gave it every other multi-line failure, because a
 * rejected push's four `hint:` lines end in "use 'git pull' before pushing again" and were reaching
 * the renderer only to sit on a `title`. So it is named for what it does rather than for the one
 * failure it started with. The body is selectable and scrolls, and Copy puts the whole message —
 * summary and git's own text — on the clipboard, because the next step is usually pasting it
 * somewhere.
 *
 * The shape is the app's own modal (GC-103): `h3`, `.modal-body`, `.modal-buttons`, with only the
 * body scrolling. Escape is not handled here — `App` closes the topmost layer, and this one joins
 * `layerOpen` like every other.
 */
export function ErrorDetailsDialog({ summary, detail, auth, onClose }: Props): JSX.Element {
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
      <div className="modal error-details" role="dialog" aria-modal="true" aria-labelledby="error-details-title">
        <h3 id="error-details-title">{auth ? 'Authentication failed' : 'The command failed'}</h3>
        <div className="modal-body">
          <p className="modal-message">{summary}</p>
          {/* `pre`, not a paragraph: git's message is line-oriented and its `hint:` and `remote:`
              lines are addressed to a person. Selectable, so it can be read out of here by hand. */}
          <pre className="error-details-text">{detail}</pre>
          {auth && (
            <p className="modal-note">
              GitClient never sees or stores a credential: the system credential helper holds them, and this is what it and git reported.
            </p>
          )}
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
