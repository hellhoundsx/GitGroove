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
   * Reopen the dialog holding the whole of a failure git wrote more than one line about (GC-169,
   * GC-202). Set whenever there is more to read than the one line this bar can hold — a rejected
   * push's four `hint:` lines as much as a credential refusal's `remote:` ones. Without it the
   * error line behaves exactly as a one-line failure always has, and clicking anywhere dismisses.
   */
  onErrorDetails?(): void;
  /**
   * Stop the running operation (GC-169). Set only while a remote command is in flight, which is
   * the only kind that can be sitting on a credential helper's window waiting for a person.
   */
  onCancelBusy?(): void;
  /**
   * A command that has left this machine is running (GC-214): the ambient third of the work
   * layer, and the only one that is not attached to a control or to a word. A push has no
   * progress to report — git writes its own to a stream nothing here reads — so what this draws
   * is an indeterminate line along the top edge of the bar, which says "still alive" to the
   * corner of the eye of someone watching the graph rather than the status text. Deferred by
   * `--dur-work` like every other mark, so a fetch that answers at once never draws one.
   */
  remote?: boolean;
}

/**
 * The patterns that pick the line saying *why*, tried one at a time over every line — priority
 * order, not the order git printed them (GC-202).
 *
 * The order is the whole point. A rejected push writes its reason first, `! [rejected] main ->
 * main (non-fast-forward)`, and then `error: failed to push some refs to '<url>'`, which names no
 * cause and no remedy and spends most of this bar's width on a path. One pattern holding every
 * alternative at once matched in document order and so drew the second: `error:` was simply
 * earlier in the file. Here the rejection is asked about first — its parenthesis is the reason —
 * then a conflict, then git's own two severities, with `failed` last as the catch-all it was.
 */
const HEADLINE_PATTERNS: RegExp[] = [/^!\s*\[[^\]]*rejected[^\]]*\]/i, /CONFLICT/, /^fatal:/i, /^error:/i, /failed/i];

/** The most useful single line of a multi-line git message; the first line when none of them fits. */
export function headline(error: string): string {
  const lines = error
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const pattern of HEADLINE_PATTERNS) {
    const hit = lines.find((l) => pattern.test(l));
    if (hit) return hit;
  }
  return lines[0] ?? error;
}

const baseName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? p;

export function StatusBar({ repoPath, commitCount, busy, generation, error, notice, onDismissError, onDismissNotice, onErrorDetails, onCancelBusy, remote }: Props): JSX.Element {
  return (
    // `data-gen` counts the snapshots and statuses the app has applied. It is the one thing on
    // screen that says a reload has finished rather than started, which is what the e2e suite waits
    // on instead of the fixed sleeps it used to pay for every git action (GC-080).
    <footer className="statusbar" data-gen={generation}>
      {/* Above everything else in the bar and outside its flow, so a line that spans the window
          costs the text beside it nothing (GC-214). */}
      {remote && <span className="busy-sweep" aria-hidden="true" />}
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
        // The `Details` mark is what says so on screen: a `title` is not an announcement, and
        // before GC-202 nothing told the reader that four `hint:` lines sat behind a click.
        <button className={`err ${onErrorDetails ? 'has-details' : ''}`} title={error} onClick={onErrorDetails ?? onDismissError}>
          {/* The headline is the only shrinkable item, so `Details` and the ✕ survive whatever the
              line is: an ellipsised affordance is one the reader cannot see (GC-192's rule, one
              surface over). */}
          <span className="line">⚠ {headline(error)}</span>
          {onErrorDetails && <span className="more">Details</span>}
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
