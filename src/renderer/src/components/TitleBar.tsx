import type { JSX } from 'react';
import { FolderOpen, GitBranch, Plus } from 'lucide-react';
import { Icon } from '../ui/icons';

interface Props {
  repoName: string | null;
  onOpenRepo(): void;
}

export function TitleBar({ repoName, onOpenRepo }: Props): JSX.Element {
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
      <button className="tab-icon-btn" title="New tab">
        <Icon of={Plus} size={14} />
      </button>
    </header>
  );
}
