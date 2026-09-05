import { useEffect, useMemo, useState, type JSX } from 'react';
import type { FileChangeKind } from '@shared/types';
import { buildHunkPatch, parseUnifiedDiff, type DiffHunk, type FileDiff } from './parseDiff';
import { X } from 'lucide-react';
import { FileKindIcon, Icon } from '../ui/icons';
import { useUi } from '../ui/UiContext';

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
  const ui = useUi();
  // (GC-075) What was loaded, and which view it was loaded for. The header chip and the hunk
  // buttons come straight from `view` and flip the instant it changes, so a diff kept from the
  // previous view would be on screen under a header claiming the other side of the file, and a
  // hunk button would build its patch against an index git has already moved on from. Tying the
  // result to its own view and comparing during render, rather than clearing it from the effect,
  // is what makes that impossible: an effect runs after React has committed the new `view`, which
  // leaves one painted frame with the new header over the old hunks and the buttons still live.
  const viewKey = `${repo}|${version}|${view.source}|${view.path}|${view.source === 'commit' ? view.sha : `${view.staged}|${view.kind ?? ''}`}`;
  const [loaded, setLoaded] = useState<{ key: string; text: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  /** What a Stage/Unstage/Discard click reported, as opposed to what the load did. */
  const [actionError, setActionError] = useState<string | null>(null);
  const current = loaded?.key === viewKey ? loaded : null;
  const text = current?.text ?? null;
  const error = current?.error ?? actionError;
  const loading = current === null;

  useEffect(() => {
    let cancelled = false;
    setActionError(null);
    const load =
      view.source === 'commit'
        ? window.api.getCommitFileDiff(repo, view.sha, view.path)
        : window.api.getWorkdirFileDiff(repo, { path: view.path, staged: view.staged, untracked: view.kind === 'untracked' });
    load.then(
      (t) => !cancelled && setLoaded({ key: viewKey, text: t, error: null }),
      // A failure is stored against the same key, so the file buttons come back rather than staying
      // disabled on a view that will never resolve.
      (e) => !cancelled && setLoaded({ key: viewKey, text: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [repo, view, version, viewKey]);

  const files = useMemo(() => (text === null ? [] : parseUnifiedDiff(text)), [text]);
  const file: FileDiff | undefined = files[0];
  const [dir, name] = splitPath(view.path);
  const isWip = view.source === 'wip';
  const untracked = view.kind === 'untracked';
  // Every action is aimed at what is on screen, so a load in flight disables them exactly like a
  // running one does: the header already claims the new side of the file (GC-075).
  const actionsDisabled = busy || loading;

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hunkAction = (hunk: DiffHunk): JSX.Element | null => {
    if (!isWip || !file) return null;
    const patch = buildHunkPatch(file, hunk);
    if (view.source === 'wip' && view.staged) {
      return (
        <button className="btn" disabled={actionsDisabled} onClick={() => void run(() => onApplyPatch(patch, { cached: true, reverse: true }))}>
          Unstage hunk
        </button>
      );
    }
    return (
      <>
        <button className="btn success" disabled={actionsDisabled} onClick={() => void run(() => onApplyPatch(patch, { cached: true }))}>
          Stage hunk
        </button>
        {!untracked && (
          <button
            className="btn danger"
            disabled={actionsDisabled}
            onClick={() =>
              void ui
                .confirm({ title: `Discard this hunk from ${name}?`, message: 'Discard this hunk from the working directory? This cannot be undone.', okLabel: 'Discard hunk', danger: true })
                .then((ok) => void (ok && run(() => onApplyPatch(patch, { reverse: true }))))
            }
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
            <button className="btn success" disabled={actionsDisabled} onClick={() => void run(() => onStageFile(view.path))}>
              Stage file
            </button>
            <button
              className="btn danger"
              disabled={actionsDisabled}
              onClick={() =>
                void ui
                  .confirm(
                    untracked
                      ? { title: `Delete ${name}?`, message: `Delete ${view.path}? This cannot be undone.`, okLabel: 'Delete file', danger: true }
                      : { title: `Discard changes to ${name}?`, message: `Discard all changes to ${view.path}? This cannot be undone.`, okLabel: 'Discard changes', danger: true },
                  )
                  .then((ok) => void (ok && run(() => onDiscardFile(view.path, untracked))))
              }
            >
              {untracked ? 'Delete file' : 'Discard changes'}
            </button>
          </>
        )}
        {isWip && view.source === 'wip' && view.staged && (
          <button className="btn" disabled={actionsDisabled} onClick={() => void run(() => onUnstageFile(view.path))}>
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
        {loading && !error && <div className="diff-empty">Loading diff…</div>}
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
