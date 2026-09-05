import { useEffect, useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Commit, CommitFile, FileChangeKind, RepoStatus, StatusEntry } from '@shared/types';
import type { FileViewSource } from '../diff/DiffView';
import { Trash2 } from 'lucide-react';
import { FileKindIcon, Icon } from '../ui/icons';
import { Avatar } from '../ui/Avatar';
import { usePrefs } from '../prefs';
import { matches } from '../shortcuts';
import { useUi, type ConfirmOptions } from '../ui/UiContext';

/**
 * Which file row a context menu was opened on (GC-043). The panel knows the row; `App` owns the
 * items, the same way `commitMenuItems` and friends own every other menu in the app.
 */
export type FileMenuTarget =
  | { source: 'wip'; entry: StatusEntry; group: 'conflicted' | 'unstaged' | 'staged' }
  | { source: 'commit'; file: CommitFile };

/**
 * The one wording for throwing a single file's changes away, so the row's ✕ button and the same
 * action in its context menu cannot drift apart (GC-043).
 */
export const discardFileConfirm = (e: StatusEntry): ConfirmOptions =>
  e.unstaged === 'untracked'
    ? { title: `Delete ${e.path}?`, message: 'The untracked file will be deleted. This cannot be undone.', okLabel: 'Delete', danger: true }
    : { title: `Discard changes to ${e.path}?`, message: 'This cannot be undone.', okLabel: 'Discard', danger: true };

export interface StagingActions {
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  stageAll(): Promise<void>;
  unstageAll(): Promise<void>;
  discard(entries: StatusEntry[]): Promise<void>;
  commit(summary: string, body: string, amend: boolean): Promise<void>;
  abortOperation(): Promise<void>;
}

interface Props {
  repo: string;
  commit: Commit | null; // null when the WIP row is selected
  headCommit: Commit | null;
  status: RepoStatus | null;
  openFile: FileViewSource | null;
  actions: StagingActions;
  onSelectSha(sha: string): void;
  onOpenFile(view: FileViewSource): void;
  onFileMenu(e: MouseEvent, target: FileMenuTarget): void;
}

interface FileRowProps {
  path: string;
  origPath?: string;
  kind: FileChangeKind;
  active: boolean;
  onClick(): void;
  onContextMenu(e: MouseEvent<HTMLDivElement>): void;
  children?: ReactNode;
}

function FileRow({ path, origPath, kind, active, onClick, onContextMenu, children }: FileRowProps): JSX.Element {
  const idx = path.lastIndexOf('/');
  const dir = idx >= 0 ? path.slice(0, idx + 1) : '';
  const name = idx >= 0 ? path.slice(idx + 1) : path;
  return (
    <div className={`file-row ${active ? 'active' : ''}`} title={origPath ? `${origPath} → ${path}` : path} onClick={onClick} onContextMenu={onContextMenu}>
      <FileKindIcon kind={kind} />
      <span className="dir">{dir}</span>
      <span className="name">{name}</span>
      {children && (
        <span className="actions" onClick={(e) => e.stopPropagation()}>
          {children}
        </span>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}

const isActive = (open: FileViewSource | null, path: string, staged?: boolean): boolean =>
  !!open && open.path === path && (open.source === 'commit' || staged === undefined || open.staged === staged);

function StagingView({ status, headCommit, openFile, actions, onOpenFile, onFileMenu }: Omit<Props, 'commit' | 'repo' | 'onSelectSha'>): JSX.Element {
  const ui = useUi();
  const prefs = usePrefs();
  const entries = status?.entries ?? [];
  const operation = status?.operation ?? null;
  const conflicted = entries.filter((e) => e.unstaged === 'conflicted' || e.staged === 'conflicted');
  const unstaged = entries.filter((e): e is StatusEntry & { unstaged: FileChangeKind } => e.unstaged !== null && e.unstaged !== 'conflicted');
  const staged = entries.filter((e): e is StatusEntry & { staged: FileChangeKind } => e.staged !== null && e.staged !== 'conflicted');

  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [amend, setAmend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const toggleAmend = (on: boolean): void => {
    setAmend(on);
    if (on && headCommit && !summary.trim() && !body.trim()) {
      setSummary(headCommit.summary);
      setBody(headCommit.body);
    }
  };

  const concludingMerge = operation === 'merge' && conflicted.length === 0;
  const canCommit = !busy && conflicted.length === 0 && (concludingMerge || ((staged.length > 0 || amend) && summary.trim().length > 0));
  const doCommit = (): void =>
    void run(async () => {
      await actions.commit(summary, body, amend);
      setSummary('');
      setBody('');
      setAmend(false);
    });

  return (
    <>
      <div className="detail-head">
        <button
          className="icon-btn danger"
          title="Discard all changes"
          disabled={entries.length === 0 || busy}
          onClick={() =>
            void ui
              .confirm({
                title: 'Discard all uncommitted changes?',
                message: 'Untracked files will be deleted. This cannot be undone.',
                okLabel: 'Discard everything',
                danger: true,
              })
              .then((ok) => void (ok && run(() => actions.discard(entries))))
          }
        >
          <Icon of={Trash2} size={14} />
        </button>
        <span>
          {entries.length} file change{entries.length === 1 ? '' : 's'} on <b>{status?.branch ?? 'detached HEAD'}</b>
        </span>
        <span />
      </div>
      <div className="detail-body">
        {operation && (
          <div className={`banner ${conflicted.length ? 'danger' : 'warn'}`}>
            <span>
              {conflicted.length > 0
                ? `${operation} in progress with ${conflicted.length} conflicted file${conflicted.length === 1 ? '' : 's'}. Resolve them, then mark as resolved.`
                : `${operation} in progress. Commit to conclude it.`}
            </span>
            <button className="btn danger" disabled={busy} onClick={() => void run(actions.abortOperation)}>
              Abort {operation}
            </button>
          </div>
        )}
        {error && <div className="err-box">{error}</div>}
        {conflicted.length > 0 && (
          <div className="file-list">
            <div className="group-head">
              <span>Conflicted Files ({conflicted.length})</span>
              <button className="btn success" disabled={busy} onClick={() => void run(() => actions.stage(conflicted.map((e) => e.path)))}>
                Mark all resolved
              </button>
            </div>
            {conflicted.map((e) => (
              <FileRow
                key={`c${e.path}`}
                path={e.path}
                kind="conflicted"
                active={isActive(openFile, e.path, false)}
                onClick={() => onOpenFile({ source: 'wip', path: e.path, staged: false, kind: 'conflicted' })}
                onContextMenu={(ev) => onFileMenu(ev, { source: 'wip', entry: e, group: 'conflicted' })}
              >
                <button className="btn success" disabled={busy} onClick={() => void run(() => actions.stage([e.path]))}>
                  Mark resolved
                </button>
              </FileRow>
            ))}
          </div>
        )}
        <div className="file-list">
          <div className="group-head">
            <span>Unstaged Files ({unstaged.length})</span>
            <button className="btn success" disabled={unstaged.length === 0 || busy} onClick={() => void run(actions.stageAll)}>
              Stage all changes
            </button>
          </div>
          {unstaged.map((e) => (
            <FileRow
              key={`u${e.path}`}
              path={e.path}
              origPath={e.origPath}
              kind={e.unstaged}
              active={isActive(openFile, e.path, false)}
              onClick={() => onOpenFile({ source: 'wip', path: e.path, staged: false, kind: e.unstaged })}
              onContextMenu={(ev) => onFileMenu(ev, { source: 'wip', entry: e, group: 'unstaged' })}
            >
              <button className="btn success" disabled={busy} onClick={() => void run(() => actions.stage([e.path]))}>
                Stage
              </button>
              <button
                className="btn danger"
                disabled={busy}
                title={e.unstaged === 'untracked' ? 'Delete file' : 'Discard changes'}
                onClick={() => void ui.confirm(discardFileConfirm(e)).then((ok) => void (ok && run(() => actions.discard([e]))))}
              >
                ✕
              </button>
            </FileRow>
          ))}
        </div>
        <div className="file-list">
          <div className="group-head">
            <span>Staged Files ({staged.length})</span>
            <button className="btn" disabled={staged.length === 0 || busy} onClick={() => void run(actions.unstageAll)}>
              Unstage all
            </button>
          </div>
          {staged.map((e) => (
            <FileRow
              key={`s${e.path}`}
              path={e.path}
              origPath={e.origPath}
              kind={e.staged}
              active={isActive(openFile, e.path, true)}
              onClick={() => onOpenFile({ source: 'wip', path: e.path, staged: true, kind: e.staged })}
              onContextMenu={(ev) => onFileMenu(ev, { source: 'wip', entry: e, group: 'staged' })}
            >
              <button className="btn" disabled={busy} onClick={() => void run(() => actions.unstage([e.path]))}>
                Unstage
              </button>
            </FileRow>
          ))}
        </div>
        <form
          className="commit-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCommit) doCommit();
          }}
        >
          <label className="check">
            <input type="checkbox" checked={amend} disabled={!headCommit} onChange={(e) => toggleAmend(e.target.checked)} /> Amend previous commit
          </label>
          <div className="summary-wrap">
            <input
              placeholder="Commit summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              onKeyDown={(e) => {
                if (matches('commit', e) && canCommit) doCommit();
              }}
              spellCheck
            />
            {prefs.commitColumnGuide && <span className={`counter ${summary.length > 72 ? 'over' : ''}`}>{72 - summary.length}</span>}
          </div>
          <textarea
            placeholder="Description"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (matches('commit', e) && canCommit) doCommit();
            }}
            spellCheck
          />
          <button type="submit" className="btn primary large" disabled={!canCommit}>
            {concludingMerge && !summary.trim()
              ? 'Commit merge'
              : amend
              ? 'Amend previous commit'
              : staged.length === 0
                ? 'Stage changes to commit'
                : summary.trim().length === 0
                  ? 'Enter a summary to commit'
                  : `Commit changes to ${staged.length} file${staged.length === 1 ? '' : 's'}`}
          </button>
        </form>
      </div>
    </>
  );
}

function CommitView({ repo, commit, openFile, onSelectSha, onOpenFile, onFileMenu }: Pick<Props, 'repo' | 'openFile' | 'onSelectSha' | 'onOpenFile' | 'onFileMenu'> & { commit: Commit }): JSX.Element {
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);
    window.api.getCommitFiles(repo, commit.sha).then(
      (f) => !cancelled && setFiles(f),
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [repo, commit.sha]);

  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  for (const f of files ?? []) {
    if (f.kind === 'added') counts.added++;
    else if (f.kind === 'deleted') counts.deleted++;
    else if (f.kind === 'renamed' || f.kind === 'copied') counts.renamed++;
    else counts.modified++;
  }

  return (
    <>
      <div className="detail-head">
        <span>
          commit:{' '}
          <span className="sha" title="Copy full sha" onClick={() => void navigator.clipboard.writeText(commit.sha)}>
            {commit.sha.slice(0, 7)}
          </span>
        </span>
        <span className="refs" title={commit.refs.join(', ')}>
          {commit.refs.join(', ')}
        </span>
      </div>
      <div className="detail-body">
        <div className="message-box">
          <h2>{commit.summary}</h2>
          {commit.body && <pre>{commit.body}</pre>}
        </div>
        <div className="author">
          <Avatar name={commit.authorName} email={commit.authorEmail} size={40} />
          <div>
            <div className="name">{commit.authorName}</div>
            <div style={{ color: 'var(--text-muted)' }}>authored {formatDate(commit.authorDate)}</div>
          </div>
          <div className="parents">
            {commit.parents.length > 0 ? 'parent' + (commit.parents.length > 1 ? 's' : '') + ': ' : 'root commit'}
            {commit.parents.map((p, i) => (
              <span key={p}>
                {i > 0 && ', '}
                <b onClick={() => onSelectSha(p)}>{p.slice(0, 7)}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="readout">
          {counts.added > 0 && <span className="kind-added">+ {counts.added} added</span>}
          {counts.modified > 0 && <span className="kind-modified">✎ {counts.modified} modified</span>}
          {counts.deleted > 0 && <span className="kind-deleted">− {counts.deleted} deleted</span>}
          {counts.renamed > 0 && <span className="kind-renamed">→ {counts.renamed} renamed</span>}
          {files && files.length === 0 && <span style={{ color: 'var(--text-dim)' }}>No file changes</span>}
        </div>
        {error && <div className="err-box">{error}</div>}
        <div className="file-list">
          {files === null && !error && <div style={{ color: 'var(--text-dim)', fontSize: 'var(--fs-sm)' }}>Loading files…</div>}
          {files?.map((f) => (
            <FileRow
              key={f.path}
              path={f.path}
              origPath={f.origPath}
              kind={f.kind}
              active={isActive(openFile, f.path)}
              onClick={() => onOpenFile({ source: 'commit', sha: commit.sha, path: f.path, kind: f.kind })}
              onContextMenu={(ev) => onFileMenu(ev, { source: 'commit', file: f })}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function DetailPanel(props: Props): JSX.Element {
  const { commit, ...rest } = props;
  return (
    <aside className="detail-panel">
      {commit ? <CommitView {...rest} commit={commit} /> : <StagingView {...rest} />}
    </aside>
  );
}
