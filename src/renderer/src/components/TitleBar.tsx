import type { JSX, MouseEvent } from 'react';
import { ChevronDown, FolderOpen, GitBranch, Plus, X } from 'lucide-react';
import { Icon } from '../ui/icons';
import type { MenuAnchor } from '../ui/UiContext';
import type { Tab } from '../tabs';

/**
 * The folder name is the tab's label; git calls a repository the same thing (`basename(top)`). A
 * tab that has not been given a repository yet says so instead (GC-163).
 */
const label = (path: string | null): string => (path === null ? 'New Tab' : path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path);

interface Props {
  /** Every open repository, in bar order (GC-016). Empty is the state before one is ever opened. */
  tabs: Tab[];
  activeId: number | null;
  onSelectTab(id: number): void;
  onCloseTab(id: number): void;
  /** The `+` button: an empty tab, whose content is the recents page (GC-163). */
  onNewTab(): void;
  onOpenRepo(): void;
  /** Opens the recent-repositories menu, anchored where the caller says (GC-044). */
  onRepoMenu(at: MenuAnchor): void;
}

export function TitleBar({ tabs, activeId, onSelectTab, onCloseTab, onNewTab, onOpenRepo, onRepoMenu }: Props): JSX.Element {
  return (
    <header className="titlebar">
      <button className="tab-icon-btn" title="Open repository" onClick={onOpenRepo}>
        <Icon of={FolderOpen} size={15} />
      </button>
      {/* With no tabs at all the bar draws nothing. The placeholder that used to sit here read as
          a tab and was not one — it could not be selected, closed or filled — and a tab waiting
          for a repository is a real tab now, which is what `+` makes (GC-163). */}
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab ${t.id === activeId ? 'selected' : ''}`}
            title={t.path ?? 'New Tab'}
            onClick={() => onSelectTab(t.id)}
            // Middle-click closes, the way every tabbed application does. `auxclick` is the only
            // event that reports button 1 on a div, and it fires after the browser has already
            // decided not to scroll, so nothing has to be prevented.
            onAuxClick={(e: MouseEvent) => {
              if (e.button === 1) onCloseTab(t.id);
            }}
          >
            {/* The branch icon stands for a repository, so a tab that has not been given one
                carries none: its label is the whole of what it has to say (GC-163). */}
            {t.path !== null && <Icon of={GitBranch} size={12} className="tab-icon" />}
            <span>{label(t.path)}</span>
            <button
              className="tab-close"
              title="Close tab"
              // The click would otherwise select the tab on its way past, which is a visible
              // flash of the repository being closed.
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(t.id);
              }}
            >
              <Icon of={X} size={12} />
            </button>
          </div>
        ))}
      </div>
      <button className="tab-icon-btn" title="New tab" onClick={onNewTab}>
        <Icon of={Plus} size={14} />
      </button>
      {/* The recents list stays one click away from the title bar as well as the breadcrumb, now
          that `+` opens a folder dialog rather than this menu (GC-044, GC-016). */}
      <button
        className="tab-icon-btn"
        title="Recent repositories"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          // `owner` makes the button a real dropdown control: a second click closes the menu
          // rather than reopening it (GC-066).
          onRepoMenu({ clientX: r.left, clientY: r.bottom, owner: e.currentTarget });
        }}
      >
        <Icon of={ChevronDown} size={14} />
      </button>
    </header>
  );
}
