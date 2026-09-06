import type { JSX } from 'react';

interface Props {
  repoPath: string | null;
  commitCount: number;
  busy: string | null; // label of the running operation
  /** The snapshot generation, published as `data-gen` (GC-080). */
  generation: number;
  error: string | null;
  onDismissError(): void;
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

export function StatusBar({ repoPath, commitCount, busy, generation, error, onDismissError }: Props): JSX.Element {
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
        </span>
      )}
      {error && (
        <button className="err" title={error} onClick={onDismissError}>
          ⚠ {headline(error)} <span className="dismiss">✕</span>
        </button>
      )}
      <span className="spacer" />
      {repoPath && <span>{commitCount} commits</span>}
      <span>GitClient 0.1.0</span>
    </footer>
  );
}
