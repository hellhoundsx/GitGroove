import { useEffect, useRef, useState, type JSX } from 'react';
import { Archive, ArchiveRestore, ChevronDown, Download, GitBranch, Redo2, RefreshCw, Search, Settings, Undo2, Upload, type LucideIcon } from 'lucide-react';
import type { PullMode, RepoInfo } from '@shared/types';
import { Icon } from '../ui/icons';

export interface ToolbarHandlers {
  onFetch(): void;
  onPull(mode: PullMode): void;
  onPush(): void;
  onCreateBranch(): void;
  onStash(): void;
  onPop(): void;
  onRefresh(): void;
  onOpenPreferences(): void;
}

interface Props extends ToolbarHandlers {
  info: RepoInfo | null;
  busy: boolean;
  ahead: number;
  behind: number;
  hasUpstream: boolean;
  hasRemotes: boolean;
  hasChanges: boolean;
  stashCount: number;
  pullMode: PullMode;
  onPullModeChange(mode: PullMode): void;
}

const PULL_MODES: { mode: PullMode; label: string }[] = [
  { mode: 'ff', label: 'Pull (fast-forward if possible)' },
  { mode: 'ff-only', label: 'Pull (fast-forward only)' },
  { mode: 'rebase', label: 'Pull (rebase)' },
];

function ToolButton({ label, icon, title, disabled, onClick }: { label: string; icon: LucideIcon; title?: string; disabled?: boolean; onClick?: () => void }): JSX.Element {
  return (
    <button className="tool-btn" title={title ?? label} disabled={disabled} onClick={onClick}>
      <Icon of={icon} size={18} />
      <span>{label}</span>
    </button>
  );
}

export function Toolbar(p: Props): JSX.Element {
  const noRepo = !p.info;
  const [pullOpen, setPullOpen] = useState(false);
  const pullRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!pullOpen) return;
    const onDown = (e: MouseEvent): void => {
      if (pullRef.current && e.target instanceof Node && pullRef.current.contains(e.target)) return;
      setPullOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPullOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [pullOpen]);

  const pullLabel = PULL_MODES.find((m) => m.mode === p.pullMode)?.label ?? 'Pull';
  const remoteHint = !p.hasRemotes ? 'No remotes configured' : !p.hasUpstream ? 'Current branch has no upstream' : undefined;

  return (
    <div className="toolbar">
      <div className="breadcrumb">
        <div className="crumb">
          <span className="caption">repository</span>
          <span className="value">{p.info?.name ?? '—'}</span>
        </div>
        {p.info && (
          <div className="crumb">
            <span className="caption">branch</span>
            <span className="value plain">
              {p.info.branch ?? 'detached HEAD'}
              {(p.ahead > 0 || p.behind > 0) && (
                <span className="ab-badge" title={`${p.ahead} ahead, ${p.behind} behind the upstream`}>
                  {p.ahead > 0 && `↑${p.ahead}`} {p.behind > 0 && `↓${p.behind}`}
                </span>
              )}
            </span>
          </div>
        )}
      </div>
      <div className="actions">
        <ToolButton label="Undo" icon={Undo2} disabled />
        <ToolButton label="Redo" icon={Redo2} disabled />
        <span className="tool-sep" />
        <div className="split-btn" ref={pullRef}>
          <ToolButton label="Pull" icon={Download} title={remoteHint ?? pullLabel} disabled={noRepo || p.busy || !p.hasRemotes} onClick={() => p.onPull(p.pullMode)} />
          <button className="caret-btn" title="Pull options" disabled={noRepo || p.busy} onClick={() => setPullOpen((o) => !o)}>
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
        <ToolButton label="Push" icon={Upload} title={remoteHint ? (p.hasRemotes ? 'Push and set upstream' : remoteHint) : 'Push'} disabled={noRepo || p.busy || !p.hasRemotes || !p.info?.branch} onClick={p.onPush} />
        <ToolButton label="Branch" icon={GitBranch} title="Create a branch at HEAD" disabled={noRepo || p.busy} onClick={p.onCreateBranch} />
        <ToolButton label="Stash" icon={Archive} title={p.hasChanges ? 'Stash working changes' : 'No changes to stash'} disabled={noRepo || p.busy || !p.hasChanges} onClick={p.onStash} />
        <ToolButton label="Pop" icon={ArchiveRestore} title={p.stashCount ? `Pop the latest of ${p.stashCount} stash${p.stashCount === 1 ? '' : 'es'}` : 'No stashes'} disabled={noRepo || p.busy || p.stashCount === 0} onClick={p.onPop} />
        <span className="tool-sep" />
        <ToolButton label="Refresh" icon={RefreshCw} disabled={noRepo || p.busy} onClick={p.onRefresh} />
      </div>
      <div className="actions right">
        <ToolButton label="Search" icon={Search} disabled />
        <ToolButton label="Preferences" icon={Settings} title="Preferences" onClick={p.onOpenPreferences} />
      </div>
    </div>
  );
}
