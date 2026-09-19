import { useEffect, useRef, type JSX } from 'react';
import { Archive, ArchiveRestore, ChevronDown, Download, GitBranch, Keyboard, Redo2, RefreshCw, Search, Settings, Undo2, Upload, type LucideIcon } from 'lucide-react';
import type { PullMode, RepoInfo } from '@shared/types';
import { ActionMark } from '../ui/ActionMark';
import { Icon } from '../ui/icons';
import type { MenuAnchor } from '../ui/UiContext';

export interface ToolbarHandlers {
  onFetch(): void;
  /** `remote` overrides the upstream; the plain button passes none (GC-057). */
  onPull(mode: PullMode, remote?: string): void;
  /**
   * The same for Push, where none means the upstream, else `pushRemote` (GC-057). `force` is the
   * popover's force push (GC-203); it always names its remote, so the confirmation `App` asks can
   * say which ref is being overwritten.
   */
  onPush(remote?: string, force?: boolean): void;
  onCreateBranch(): void;
  onStash(): void;
  onPop(): void;
  onRefresh(): void;
  onSearch(): void;
  onOpenPreferences(): void;
  onOpenShortcuts(): void;
}

interface Props extends ToolbarHandlers {
  info: RepoInfo | null;
  busy: boolean;
  /**
   * Which control's own action is running, and which one last succeeded (GC-214). `busy` is still
   * the flag that disables the row — every button is unavailable while anything runs — and these
   * two say *which* of them the work belongs to. Optional, because a toolbar that is handed
   * neither behaves exactly as it did before them.
   */
  busyAt?: string | null;
  done?: { at: string; n: number } | null;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasRemotes: boolean;
  /** The remote a push with no upstream lands on, so the button can name it (GC-031). */
  pushRemote: string | null;
  /** Every remote by name, in the order git lists them: what the two popovers offer (GC-057). */
  remotes: string[];
  hasChanges: boolean;
  stashCount: number;
  pullMode: PullMode;
  searchOpen: boolean;
  pullOpen: boolean;
  pushOpen: boolean;
  onPullModeChange(mode: PullMode): void;
  onPullOpenChange(open: boolean): void;
  onPushOpenChange(open: boolean): void;
  /** Opens the recent-repositories menu, anchored where the caller says (GC-044). */
  onRepoMenu(at: MenuAnchor): void;
  /** Opens the branch list, anchored the same way (GC-088). */
  onBranchMenu(at: MenuAnchor): void;
}

const PULL_MODES: { mode: PullMode; label: string }[] = [
  { mode: 'ff', label: 'Pull (fast-forward if possible)' },
  { mode: 'ff-only', label: 'Pull (fast-forward only)' },
  { mode: 'rebase', label: 'Pull (rebase)' },
];

/**
 * `working` and `done` are the button's own (GC-214), not the toolbar's: a row where every button
 * is disabled says only that *something* is happening, and the one that says what is the one that
 * was clicked. The icon and the mark share a single grid cell, so a spinner never moves the label
 * — and neither is drawn at all for an action that finishes inside `--dur-work`, which is most of
 * them.
 */
function ToolButton({
  label,
  icon,
  title,
  disabled,
  active,
  working,
  done,
  onClick,
}: {
  label: string;
  icon: LucideIcon;
  title?: string;
  disabled?: boolean;
  active?: boolean;
  working?: boolean;
  done?: number;
  onClick?: () => void;
}): JSX.Element {
  return (
    <button className={`tool-btn ${active ? 'active' : ''} ${working ? 'working' : ''}`} title={title ?? label} disabled={disabled} onClick={onClick}>
      <span className="tool-icon">
        <Icon of={icon} size={18} />
        <ActionMark working={!!working} done={done ?? 0} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function Toolbar(p: Props): JSX.Element {
  const noRepo = !p.info;
  const pullRef = useRef<HTMLDivElement>(null);
  const pushRef = useRef<HTMLDivElement>(null);
  // Each popover is a layer, so its flag lives in App with the other layers' and Escape is
  // handled there and nowhere else (GC-038, and GC-057 for the second one). Only the outside
  // click, which is nobody else's business, stays here.
  const { pullOpen, onPullOpenChange: setPullOpen, pushOpen, onPushOpenChange: setPushOpen } = p;

  useEffect(() => {
    if (!pullOpen && !pushOpen) return;
    const onDown = (e: MouseEvent): void => {
      const outside = (r: typeof pullRef): boolean => !(r.current && e.target instanceof Node && r.current.contains(e.target));
      // Only the outside click, which no keyboard activation produces: which of the two is open is
      // one piece of state in `App`, so opening either already closes the other however the button
      // was activated, and closing one that is not open does nothing (GC-119).
      if (outside(pullRef)) setPullOpen(false);
      if (outside(pushRef)) setPushOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [pullOpen, setPullOpen, pushOpen, setPushOpen]);

  // Which button a piece of work belongs to, asked once per button (GC-214). The ids are the
  // toolbar's own vocabulary and `App` passes them to `run`; a button nothing is happening to
  // gets { false, 0 } and draws nothing at all.
  const mark = (id: string): { working: boolean; done: number } => ({ working: p.busyAt === id, done: p.done?.at === id ? p.done.n : 0 });

  const pullLabel = PULL_MODES.find((m) => m.mode === p.pullMode)?.label ?? 'Pull';
  // One remote gains nothing from being asked which, so Pull's popover keeps only the mode rows it
  // has always had (GC-057). Push's caret is no longer that question, though: since GC-203 its
  // popover also carries the force push, which is an option of every push however many remotes
  // there are, so the caret is there with one remote too and `several` gates only the plain rows.
  const several = p.remotes.length > 1;
  const remoteHint = !p.hasRemotes ? 'No remotes configured' : !p.hasUpstream ? 'Current branch has no upstream' : undefined;
  const pushTitle = !p.hasRemotes
    ? 'No remotes configured'
    : // the button is disabled here either way, so the title must not promise the click it refuses (GC-061)
      !p.info?.branch
      ? 'Cannot push from a detached HEAD'
      : p.hasUpstream
      ? 'Push'
      : `Push to ${p.pushRemote ?? 'the default remote'} and set upstream`;

  return (
    <div className="toolbar">
      <div className="breadcrumb">
        {/* The dropdown hangs off the crumb's bottom-left corner, not off the pointer, so it
            behaves like the breadcrumb menu it looks like (GC-044). */}
        <button
          className="crumb as-button"
          title="Recent repositories"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            // `owner` makes the crumb a real dropdown control: a second click closes the menu
            // rather than reopening it (GC-066).
            p.onRepoMenu({ clientX: r.left, clientY: r.bottom, owner: e.currentTarget });
          }}
        >
          {/* The caption/value stack and, beside it, the one thing that said this opens something
              (GC-194). The chevron is inside the button, so it takes the crumb's own hover and is
              never a second click target, and it sits outside the stack so the anchor the menu
              hangs off — the crumb's bottom-left corner — is unmoved. */}
          <span className="stack">
            <span className="caption">repository</span>
            {/* The name is its own span so it is the half of the value that may shrink (GC-223):
                a crumb's track is bounded now, and what gives way inside it is the text, never
                the marks beside it. */}
            <span className="value">
              <span className="name">{p.info?.name ?? '—'}</span>
            </span>
          </span>
          <Icon of={ChevronDown} size={14} />
        </button>
        {p.info && (
          // Drawn like the repository crumb since GC-044 and inert until GC-088: the same anchor,
          // the same owner toggle, and the branch list hanging off its bottom-left corner.
          <button
            className="crumb as-button"
            title="Switch branch"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              p.onBranchMenu({ clientX: r.left, clientY: r.bottom, owner: e.currentTarget });
            }}
          >
            {/* The ahead/behind badge stays inside the value, so the row ends with the badge and
                then the chevron rather than with two marks competing for the same place (GC-194). */}
            <span className="stack">
              <span className="caption">branch</span>
              <span className="value plain">
                <span className="name">{p.info.branch ?? 'detached HEAD'}</span>
                {(p.ahead > 0 || p.behind > 0) && (
                  <span className="ab-badge" title={`${p.ahead} ahead, ${p.behind} behind the upstream`}>
                    {p.ahead > 0 && `↑${p.ahead}`} {p.behind > 0 && `↓${p.behind}`}
                  </span>
                )}
              </span>
            </span>
            <Icon of={ChevronDown} size={14} />
          </button>
        )}
      </div>
      <div className="actions">
        <ToolButton label="Undo" icon={Undo2} disabled />
        <ToolButton label="Redo" icon={Redo2} disabled />
        <span className="tool-sep" />
        <div className="split-btn pull" ref={pullRef}>
          <ToolButton label="Pull" icon={Download} title={remoteHint ?? pullLabel} disabled={noRepo || p.busy || !p.hasRemotes} {...mark('pull')} onClick={() => p.onPull(p.pullMode)} />
          <button className="caret-btn" title="Pull options" disabled={noRepo || p.busy} onClick={() => setPullOpen(!pullOpen)}>
            <Icon of={ChevronDown} size={11} />
          </button>
          {pullOpen && (
            <div className="popover">
              <div className="popover-caption">Default action when clicking Pull</div>
              {PULL_MODES.map((m) => (
                <label key={m.mode} className="popover-row">
                  <input
                    type="radio"
                    name="pullmode"
                    checked={p.pullMode === m.mode}
                    onChange={() => {
                      p.onPullModeChange(m.mode);
                      setPullOpen(false);
                    }}
                  />
                  {m.label}
                </label>
              ))}
              {several && (
                <>
                  <div className="popover-sep" />
                  {p.remotes.map((r) => (
                    <button
                      key={r}
                      className="popover-row as-button"
                      onClick={() => {
                        setPullOpen(false);
                        p.onPull(p.pullMode, r);
                      }}
                    >
                      Pull from {r}
                    </button>
                  ))}
                </>
              )}
              <div className="popover-sep" />
              <button
                className="popover-row as-button"
                disabled={!p.hasRemotes}
                onClick={() => {
                  setPullOpen(false);
                  p.onFetch();
                }}
              >
                Fetch all
              </button>
            </div>
          )}
        </div>
        {/* The caret is the push's options, not only "which remote" (GC-057, GC-203), so it is
            there whenever the button beside it can push at all. */}
        <div className="split-btn push" ref={pushRef}>
          <ToolButton label="Push" icon={Upload} title={pushTitle} disabled={noRepo || p.busy || !p.hasRemotes || !p.info?.branch} {...mark('push')} onClick={() => p.onPush()} />
          <button className="caret-btn" title="Push options" disabled={noRepo || p.busy || !p.hasRemotes || !p.info?.branch} onClick={() => setPushOpen(!pushOpen)}>
            <Icon of={ChevronDown} size={11} />
          </button>
          {pushOpen && (
            <div className="popover">
              {several && (
                <>
                  <div className="popover-caption">Push {p.info?.branch} to</div>
                  {p.remotes.map((r) => (
                    <button
                      key={r}
                      className="popover-row as-button"
                      onClick={() => {
                        setPushOpen(false);
                        p.onPush(r);
                      }}
                    >
                      Push to {r}
                    </button>
                  ))}
                  <div className="popover-sep" />
                </>
              )}
              {/* One row per remote even with one remote, because the row has to name what it
                  overwrites — the push writes `<remote>/<branch>`, never an upstream ref (GC-114).
                  `App` asks before any of them runs; nothing here is destructive on its own. */}
              <div className="popover-caption">Force push {p.info?.branch} to</div>
              {p.remotes.map((r) => (
                <button
                  key={r}
                  className="popover-row as-button danger"
                  onClick={() => {
                    setPushOpen(false);
                    p.onPush(r, true);
                  }}
                >
                  Force push to {r}
                </button>
              ))}
            </div>
          )}
        </div>
        <ToolButton label="Branch" icon={GitBranch} title="Create a branch at HEAD" disabled={noRepo || p.busy} {...mark('branch')} onClick={p.onCreateBranch} />
        <ToolButton label="Stash" icon={Archive} title={p.hasChanges ? 'Stash working changes' : 'No changes to stash'} disabled={noRepo || p.busy || !p.hasChanges} {...mark('stash')} onClick={p.onStash} />
        <ToolButton label="Pop" icon={ArchiveRestore} title={p.stashCount ? `Pop the latest of ${p.stashCount} stash${p.stashCount === 1 ? '' : 'es'}` : 'No stashes'} disabled={noRepo || p.busy || p.stashCount === 0} {...mark('pop')} onClick={p.onPop} />
        <span className="tool-sep" />
        <ToolButton label="Refresh" icon={RefreshCw} disabled={noRepo || p.busy} {...mark('refresh')} onClick={p.onRefresh} />
      </div>
      <div className="actions right">
        <ToolButton label="Search" icon={Search} title="Find a commit (Ctrl+F)" active={p.searchOpen} disabled={noRepo} onClick={p.onSearch} />
        <ToolButton label="Shortcuts" icon={Keyboard} title="Keyboard shortcuts (?)" onClick={p.onOpenShortcuts} />
        <ToolButton label="Preferences" icon={Settings} title="Preferences" onClick={p.onOpenPreferences} />
      </div>
    </div>
  );
}
