import type { JSX } from 'react';
import { FolderOpen, GitBranch, Plus } from 'lucide-react';
import { Icon } from '../ui/icons';

interface Props {
  repoName: string | null;
  onOpenRepo(): void;
  /** Opens the recent-repositories menu, anchored where the caller says (GC-044). */
  onRepoMenu(at: { clientX: number; clientY: number }): void;
}

export function TitleBar({ repoName, onOpenRepo, onRepoMenu }: Props): JSX.Element {
  return (
    <header className="titlebar">
      <button className="tab-icon-btn" title="Open repository" onClick={onOpenRepo}>
        <Icon of={FolderOpen} size={15} />
      </button>
      <div className="tabs">
        <div className={`tab ${repoName ? 'selected' : ''}`}>
          {repoName && <Icon of={GitBranch} size={12} className="tab-icon" />}
          <span>{repoName ?? 'New Tab'}</span>
        </div>
      </div>
      {/* Until GC-016 gives the title bar real tabs, `+` opens the recents menu rather than doing
          nothing at all — it is the one visible way to add a repository (GC-044). */}
      <button
        className="tab-icon-btn"
        title="New tab (recent repositories)"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onRepoMenu({ clientX: r.left, clientY: r.bottom });
        }}
      >
        <Icon of={Plus} size={14} />
      </button>
    </header>
  );
}
