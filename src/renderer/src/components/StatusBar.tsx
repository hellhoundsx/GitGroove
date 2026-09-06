import type { JSX } from 'react';

interface Props {
  repoPath: string | null;
  commitCount: number;
  busy: string | null; // label of the running operation
  /** The snapshot generation, published as `data-gen` (GC-080). */
  generation: number;
  error: string | null;
  /**
   * The advisory line: an action that did most of what was asked and has something left to say
   * (GC-091). Same slot and same dismiss button as the error, one severity down — and never shown
   * beside one, because a failure is the more important of the two.
   */
  notice: string | null;
  onDismissError(): void;
  onDismissNotice(): void;
  /**
   * Reopen the dialog holding the whole of a failure git wrote more than one line about (GC-169).
   * Set only for a credential refusal; without it the error line behaves exactly as it always
   * has, and clicking anywhere on it dismisses.
   */
  onErrorDetails?(): void;
  /**
   * Stop the running operation (GC-169). Set only while a remote command is in flight, which is
   * the only kind that can be sitting on a credential helper's window waiting for a person.
   */
  onCancelBusy?(): void;
}

/** The most useful single line of a multi-line git message: a CONFLICT/error/fatal line, else the first. */
function headline(error: string): string {
  const lines = error
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.find((l) => /^(error|fatal):|CONFLICT|failed/i.test(l)) ?? lines[0] ?? error;
}

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

export function StatusBar({ repoPath, commitCount, busy, generation, error, notice, onDismissError, onDismissNotice, onErrorDetails, onCancelBusy }: Props): JSX.Element {
  return (
    // `data-gen` counts the snapshots and statuses the app has applied. It is the one thing on
    // screen that says a reload has finished rather than started, which is what the e2e suite waits
    // on instead of the fixed sleeps it used to pay for every git action (GC-080).
    <footer className="statusbar" data-gen={generation}>
      <span className="path" title={repoPath ?? undefined}>
        {repoPath ? baseName(repoPath) : 'No repository open'}
      </span>
      {busy && (
        <span className="busy">
          <span className="spinner" /> {busy}…
          {onCancelBusy && (
            <button className="cancel-busy" onClick={onCancelBusy}>
              Cancel
            </button>
          )}
        </span>
      )}
      {error ? (
        // With details to show, the line opens them and only the ✕ dismisses — the message is
        // then longer than this bar can ever be, and dismissing it would be losing it (GC-169).
        <button className={`err ${onErrorDetails ? 'has-details' : ''}`} title={error} onClick={onErrorDetails ?? onDismissError}>
          ⚠ {headline(error)}{' '}
          <span
            className="dismiss"
            onClick={(e) => {
              if (!onErrorDetails) return;
              e.stopPropagation();
              onDismissError();
            }}
          >
            ✕
          </span>
        </button>
      ) : (
        // Only when there is no error: an outright failure is the more important of the two, and
        // `run()` never sets both anyway (GC-091).
        notice && (
          <button className="notice" title={notice} onClick={onDismissNotice}>
            ⓘ {headline(notice)} <span className="dismiss">✕</span>
          </button>
        )
      )}
      <span className="spacer" />
      {repoPath && <span>{commitCount} commits</span>}
      <span>GitClient 0.1.0</span>
    </footer>
  );
}
