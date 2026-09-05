import type { JSX } from 'react';

interface Props {
  repoPath: string | null;
  commitCount: number;
  busy: string | null; // label of the running operation
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

export function StatusBar({ repoPath, commitCount, busy, error, onDismissError }: Props): JSX.Element {
  return (
    <footer className="statusbar">
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
