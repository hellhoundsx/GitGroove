import { useEffect, useMemo, useState, type JSX } from 'react';
import type { FileChangeKind } from '@shared/types';
import { buildHunkPatch, parseUnifiedDiff, type DiffHunk, type FileDiff } from './parseDiff';
import { X } from 'lucide-react';
import { FileKindIcon, Icon } from '../ui/icons';

export type FileViewSource =
  | { source: 'commit'; sha: string; path: string; kind: FileChangeKind }
  | { source: 'wip'; path: string; staged: boolean; kind: FileChangeKind };

interface Props {
  repo: string;
  view: FileViewSource;
  /** Bumped by the parent whenever the working directory changed, so WIP diffs reload. */
  version: number;
  onClose(): void;
  onStageFile(path: string): Promise<void>;
  onUnstageFile(path: string): Promise<void>;
  onDiscardFile(path: string, untracked: boolean): Promise<void>;
  onApplyPatch(patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void>;
}

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/');
  return i >= 0 ? [path.slice(0, i + 1), path.slice(i + 1)] : ['', path];
}

export function DiffView({ repo, view, version, onClose, onStageFile, onUnstageFile, onDiscardFile, onApplyPatch }: Props): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const load =
      view.source === 'commit'
        ? window.api.getCommitFileDiff(repo, view.sha, view.path)
        : window.api.getWorkdirFileDiff(repo, { path: view.path, staged: view.staged, untracked: view.kind === 'untracked' });
    load.then(
      (t) => !cancelled && setText(t),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [repo, view, version]);

  const files = useMemo(() => (text === null ? [] : parseUnifiedDiff(text)), [text]);
  const file: FileDiff | undefined = files[0];
  const [dir, name] = splitPath(view.path);
  const isWip = view.source === 'wip';
  const untracked = view.kind === 'untracked';

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hunkAction = (hunk: DiffHunk): JSX.Element | null => {
    if (!isWip || !file) return null;
    const patch = buildHunkPatch(file, hunk);
    if (view.source === 'wip' && view.staged) {
      return (
        <button className="btn" disabled={busy} onClick={() => void run(() => onApplyPatch(patch, { cached: true, reverse: true }))}>
          Unstage hunk
        </button>
      );
    }
    return (
      <>
        <button className="btn success" disabled={busy} onClick={() => void run(() => onApplyPatch(patch, { cached: true }))}>
          Stage hunk
        </button>
        {!untracked && (
          <button
            className="btn danger"
            disabled={busy}
            onClick={() => {
              if (confirm('Discard this hunk from the working directory? This cannot be undone.')) void run(() => onApplyPatch(patch, { reverse: true }));
            }}
          >
            Discard hunk
          </button>
        )}
      </>
    );
  };

  return (
    <div className="file-view">
      <div className="file-view-head">
        <FileKindIcon kind={view.kind} size={14} />
        <span className="path">
          <span className="dir">{dir}</span>
          <span className="name">{name}</span>
        </span>
        {file && !file.binary && (
          <span className="stats">
            <span className="kind-added">+{file.adds}</span> <span className="kind-deleted">−{file.dels}</span>
          </span>
        )}
        <span className="spacer" />
        {isWip && view.source === 'wip' && !view.staged && (
          <>
            <button className="btn success" disabled={busy} onClick={() => void run(() => onStageFile(view.path))}>
              Stage file
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => {
                if (confirm(untracked ? `Delete ${view.path}? This cannot be undone.` : `Discard all changes to ${view.path}? This cannot be undone.`))
                  void run(() => onDiscardFile(view.path, untracked));
              }}
            >
              {untracked ? 'Delete file' : 'Discard changes'}
            </button>
          </>
        )}
        {isWip && view.source === 'wip' && view.staged && (
          <button className="btn" disabled={busy} onClick={() => void run(() => onUnstageFile(view.path))}>
            Unstage file
          </button>
        )}
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="file-view-sub">
        <span className="chip">{view.source === 'commit' ? `commit ${view.sha.slice(0, 7)}` : view.staged ? 'Staged' : 'Unstaged'}</span>
        {error && <span className="err">{error}</span>}
      </div>
      <div className="diff-body">
        {text === null && !error && <div className="diff-empty">Loading diff…</div>}
        {text !== null && !file && <div className="diff-empty">No textual changes.</div>}
        {file?.binary && <div className="diff-empty">Binary file.</div>}
        {file &&
          !file.binary &&
          file.hunks.map((h, hi) => (
            <div className="hunk" key={hi}>
              <div className="hunk-head">
                <span className="hunk-range">{h.header.replace(/ @@.*$/, ' @@')}</span>
                <span className="hunk-ctx">{h.header.replace(/^@@[^@]*@@ ?/, '')}</span>
                <span className="spacer" />
                <span className="hunk-actions">{hunkAction(h)}</span>
              </div>
              <table className="hunk-lines">
                <tbody>
                  {h.lines.map((l, li) => (
                    <tr key={li} className={`line ${l.type}`}>
                      <td className="no">{l.oldNo ?? ''}</td>
                      <td className="no">{l.newNo ?? ''}</td>
                      <td className="mark">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                      <td className="code">
                        <pre>{l.text}</pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>
    </div>
  );
}
