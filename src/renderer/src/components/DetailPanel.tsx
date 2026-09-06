import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import type { Commit, CommitFile, FileChangeKind, GitRef, RepoStatus, StatusEntry } from '@shared/types';
import type { CommitDraft } from '../App';
import type { FileViewSource } from '../diff/DiffView';
// The sentinel for the working-directory row: the commit view's banner selects it (GC-045).
import { WIP } from '../graph/CommitGraph';
import { chipsFor, RefChip } from '../graph/RefChip';
import { Trash2 } from 'lucide-react';
import { FileKindIcon, Icon } from '../ui/icons';
import { Avatar } from '../ui/Avatar';
import { usePrefs } from '../prefs';
import { formatDateTimeSeconds, relativeTime } from '../time';
import { matches } from '../shortcuts';
import { useUi, type ConfirmOptions } from '../ui/UiContext';
import type { DragHandleProps } from '../ui/useDragWidth';

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
  /** The left-edge resize handle (GC-050); it works with a diff open too. */
  resize: DragHandleProps;
  /** Bumped every time Ctrl+Shift+M asks for the commit summary field, so it refocuses (GC-033). */
  focusSummary: number;
  /**
   * The staging form's contents, owned by `App` (GC-148). This component unmounts behind a file
   * view and on every tab switch, so a half-written message cannot live in its own state and
   * survive; `App` parks it with the tab it belongs to.
   */
  draft: CommitDraft;
  onDraft(patch: Partial<CommitDraft>): void;
  onSelectSha(sha: string): void;
  onOpenFile(view: FileViewSource): void;
  onFileMenu(e: MouseEvent, target: FileMenuTarget): void;
  /**
   * The refs the graph is drawing, so the commit view can chip the ones on its own commit
   * (GC-087). The same list the graph gets — hidden refs are already out of it — and the same two
   * handlers, so a chip behaves identically wherever it is drawn.
   */
  refs: GitRef[];
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void;
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

const isActive = (open: FileViewSource | null, path: string, staged?: boolean): boolean =>
  !!open && open.path === path && (open.source === 'commit' || staged === undefined || open.staged === staged);

function StagingView({ status, headCommit, openFile, actions, focusSummary, draft, onDraft, onOpenFile, onFileMenu }: Omit<Props, 'commit' | 'repo' | 'onSelectSha' | 'resize'>): JSX.Element {
  const ui = useUi();
  const prefs = usePrefs();
  const entries = status?.entries ?? [];
  const operation = status?.operation ?? null;
  const conflicted = entries.filter((e) => e.unstaged === 'conflicted' || e.staged === 'conflicted');
  const unstaged = entries.filter((e): e is StatusEntry & { unstaged: FileChangeKind } => e.unstaged !== null && e.unstaged !== 'conflicted');
  const staged = entries.filter((e): e is StatusEntry & { staged: FileChangeKind } => e.staged !== null && e.staged !== 'conflicted');

  const { summary, body, amend } = draft;
  // Ctrl+Shift+M focuses the summary; the tick is what makes asking twice focus twice (GC-033).
  const summaryInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusSummary === 0) return; // the mount value: nothing has asked for the field yet
    summaryInput.current?.focus();
    summaryInput.current?.select();
  }, [focusSummary]);
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

  // The pre-fill rule is exactly as it was: turning Amend on over an empty form borrows HEAD's
  // message, and one patch carries both so no render sees the flag on with the fields still empty.
  const toggleAmend = (on: boolean): void =>
    onDraft(on && headCommit && !summary.trim() && !body.trim() ? { amend: on, summary: headCommit.summary, body: headCommit.body } : { amend: on });

  const concludingMerge = operation === 'merge' && conflicted.length === 0;
  const canCommit = !busy && conflicted.length === 0 && (concludingMerge || ((staged.length > 0 || amend) && summary.trim().length > 0));
  const doCommit = (): void =>
    void run(async () => {
      await actions.commit(summary, body, amend);
      onDraft({ summary: '', body: '', amend: false });
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
              ref={summaryInput}
              placeholder="Commit summary"
              value={summary}
              onChange={(e) => onDraft({ summary: e.target.value })}
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
            onChange={(e) => onDraft({ body: e.target.value })}
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

function CommitView({
  repo,
  commit,
  status,
  openFile,
  refs,
  onSelectSha,
  onOpenFile,
  onFileMenu,
  onRefMenu,
  onRefActivate,
}: Pick<Props, 'repo' | 'status' | 'openFile' | 'refs' | 'onSelectSha' | 'onOpenFile' | 'onFileMenu' | 'onRefMenu' | 'onRefActivate'> & { commit: Commit }): JSX.Element {
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

  // Only the refs sitting on this commit, run through the graph's own absorb rule so `main` + `origin/main` here is one chip carrying the cloud, exactly as the row shows it.
  const chips = useMemo(() => chipsFor(refs.filter((r) => r.sha === commit.sha)), [refs, commit.sha]);

  const pending = status?.entries.length ?? 0;
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
        <span className="commit-id">
          commit:{' '}
          <span className="sha" title="Copy full sha" onClick={() => void navigator.clipboard.writeText(commit.sha)}>
            {commit.sha.slice(0, 7)}
          </span>
        </span>
        {/* The refs on this commit as the chips the graph draws, not git's `%D` decoration as text
            (GC-087). That string carried git's own syntax — `HEAD -> `, `tag: ` — and ellipsised at
            its end, so the remote was the ref that disappeared; the panel is also the one place
            refs were shown as words while every other surface shows them as chips. Same source as
            the graph's, so the ordering and the absorb-the-upstream rule cannot drift, and the same
            two gestures on each: right-click for the ref menu, double-click to check out. */}
        {chips.length > 0 && (
          <span className="ref-chips">
            {chips.map((chip) => (
              <RefChip
                key={chip.ref.fullName}
                chip={chip}
                title={`${chip.ref.fullName}${chip.upstreamHere ? `\nup to date with ${chip.ref.upstream}` : ''}\nDouble-click to checkout, right-click for actions`}
                onContextMenu={(e) => {
                  e.stopPropagation();
                  onRefMenu(e, chip.ref);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  onRefActivate(chip.ref);
                }}
              />
            ))}
          </span>
        )}
      </div>
      <div className="detail-body">
        {/* What is waiting in the working directory, in the one panel that otherwise drops it
            (GC-045). The count is the staging header's own, conflicted entries included, and the
            button goes back to the row that owns them rather than making the user find row 0. */}
        {pending > 0 && (
          <div className="banner info">
            <span>
              {pending} file change{pending === 1 ? '' : 's'} in the working directory
            </span>
            <button className="btn" onClick={() => onSelectSha(WIP)}>
              View changes
            </button>
          </div>
        )}
        <div className="message-box">
          <h2>{commit.summary}</h2>
          {commit.body && <pre>{commit.body}</pre>}
        </div>
        <div className="author">
          <Avatar name={commit.authorName} email={commit.authorEmail} size={40} />
          <div>
            <div className="name">{commit.authorName}</div>
            {/* A history is read for the distance, not the instant, so the relative form is on the
                row and the absolute one is its title (GC-135). This is also what takes the pressure
                off the middle column of the `.author` grid at a narrow panel — the absolute form
                wanted 172px of a track that can resolve to 165px (GC-157). */}
            <div className="when" title={formatDateTimeSeconds(commit.authorDate)}>
              authored {relativeTime(commit.authorDate)}
            </div>
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
          {/* The same header the staging view's groups carry, so a file list is one thing in both
              views rather than a labelled group in one and bare rows in the other (GC-142). */}
          {files !== null && (
            <div className="group-head">
              <span>
                {files.length} file{files.length === 1 ? '' : 's'} changed
              </span>
            </div>
          )}
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
  const { commit, resize, ...rest } = props;
  return (
    <aside className="detail-panel">
      {/* Absolutely positioned on the panel's left edge, so it takes no width of its own. */}
      <div className="panel-resize left" role="separator" aria-orientation="vertical" title="Drag to resize the panel, double-click to reset" {...resize} />
      {commit ? <CommitView {...rest} commit={commit} /> : <StagingView {...rest} />}
    </aside>
  );
}
