import { useMemo, useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import { Archive, Check, ChevronRight, Cloud, Eye, EyeOff, GitBranch, Laptop, PanelLeftClose, Pin, Plus, Tag, type LucideIcon } from 'lucide-react';
import type { GitRef, Remote, Stash } from '@shared/types';
import { Icon } from '../ui/icons';
import type { DragHandleProps } from '../ui/useDragWidth';
import { useRefDrag, type RefDragHandlers } from '../ui/refDrag';

interface Props {
  refs: GitRef[];
  stashes: Stash[];
  remotes: Remote[];
  pinnedName: string | null; // local branch pinned to the graph's left column
  /** Full names of the refs kept out of the graph (GC-073). */
  hidden: string[];
  onToggleHidden(ref: GitRef): void;
  onShowAll(kind: 'head' | 'remote'): void;
  collapsed: boolean;
  /** The right-edge resize handle (GC-050). Not rendered while the panel is the icon rail. */
  resize: DragHandleProps;
  onExpand(): void;
  onCollapse(): void;
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void; // double-click: checkout
  /** Dragging a branch row onto another branch, in this panel or in the graph (GC-015). */
  refDrag: RefDragHandlers;
  onStashMenu(e: MouseEvent, stash: Stash): void;
  onStashActivate(stash: Stash): void; // double-click: apply
  onRemoteMenu(e: MouseEvent, remote: Remote): void;
  onAddRemote(): void;
}

interface SectionProps {
  title: string;
  icon: LucideIcon;
  count: number;
  defaultOpen?: boolean;
  /** Optional buttons on the right of the header, e.g. "Show all" and "Add remote". */
  actions?: { icon: LucideIcon; title: string; onClick(): void }[];
  children: ReactNode;
}

function Section({ title, icon, count, defaultOpen = false, actions = [], children }: SectionProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className={`section-head ${open ? 'open' : ''}`}>
        <button className="section-toggle" onClick={() => setOpen((o) => !o)}>
          <Icon of={ChevronRight} size={12} className="chev" />
          <Icon of={icon} size={13} className="section-icon" />
          <span>{title}</span>
          <span className="count">{count}</span>
        </button>
        {actions.map((a) => (
          <button key={a.title} className="section-action" title={a.title} aria-label={a.title} onClick={a.onClick}>
            <Icon of={a.icon} size={12} />
          </button>
        ))}
      </div>
      {open && children}
    </>
  );
}

const abText = (r: GitRef): string => {
  const parts: string[] = [];
  if (r.ahead) parts.push(`↑${r.ahead}`);
  if (r.behind) parts.push(`↓${r.behind}`);
  return parts.join(' ');
};

export function LeftPanel(p: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  const drag = useRefDrag(p.refDrag);
  const f = filter.trim().toLowerCase();
  const hidden = useMemo(() => new Set(p.hidden), [p.hidden]);

  const { local, tags, remoteGroups, remoteCount } = useMemo(() => {
    const match = (name: string): boolean => !f || name.toLowerCase().includes(f);
    const local = p.refs.filter((r) => r.kind === 'head' && match(r.name));
    const tags = p.refs.filter((r) => r.kind === 'tag' && match(r.name));
    const remoteGroups = new Map<string, GitRef[]>();
    for (const rem of p.remotes) remoteGroups.set(rem.name, []);
    for (const r of p.refs) {
      if (r.kind !== 'remote' || !match(r.name)) continue;
      const remote = r.name.split('/')[0]!;
      const list = remoteGroups.get(remote) ?? [];
      list.push(r);
      remoteGroups.set(remote, list);
    }
    const remoteCount = [...remoteGroups.values()].reduce((n, l) => n + l.length, 0);
    return { local, tags, remoteGroups, remoteCount };
  }, [p.refs, p.remotes, f]);

  // "Viewing" counts what the graph is actually drawing, so a hidden branch leaves it (GC-073).
  const viewing = local.filter((r) => !hidden.has(r.fullName)).length + [...remoteGroups.values()].flat().filter((r) => !hidden.has(r.fullName)).length + tags.length;
  const anyLocalHidden = local.some((r) => hidden.has(r.fullName));
  const anyRemoteHidden = [...remoteGroups.values()].flat().some((r) => hidden.has(r.fullName));

  /** The eye that hides a branch from the graph. The checked-out branch has none: it can never be hidden. */
  const eye = (r: GitRef): JSX.Element | null =>
    r.isHead ? null : (
      <button
        className="row-action"
        title={hidden.has(r.fullName) ? `Show ${r.name} in the graph` : `Hide ${r.name} from the graph`}
        aria-label={hidden.has(r.fullName) ? 'Show in graph' : 'Hide in graph'}
        onClick={(e) => {
          e.stopPropagation();
          p.onToggleHidden(r);
        }}
      >
        <Icon of={hidden.has(r.fullName) ? EyeOff : Eye} size={12} />
      </button>
    );

  const stashes = useMemo(() => p.stashes.filter((s) => !f || s.message.toLowerCase().includes(f)), [p.stashes, f]);

  if (p.collapsed) {
    const rail: { icon: LucideIcon; count: number; title: string }[] = [
      { icon: Laptop, count: local.length, title: 'Local branches' },
      { icon: Cloud, count: remoteCount, title: 'Remote branches' },
      { icon: Tag, count: tags.length, title: 'Tags' },
      { icon: Archive, count: stashes.length, title: 'Stashes' },
    ];
    return (
      <aside className="left-panel collapsed" onClick={p.onExpand} title="Expand panel">
        {rail.map((r) => (
          <div key={r.title} className="rail-item" title={r.title}>
            <Icon of={r.icon} size={16} />
            <b>{r.count}</b>
          </div>
        ))}
      </aside>
    );
  }

  return (
    <aside className="left-panel">
      <div className="panel-head">
        <div className="viewing">
          <button className="icon-btn" title="Collapse panel" onClick={p.onCollapse}>
            <Icon of={PanelLeftClose} size={14} />
          </button>
          <span>Viewing</span>
          <b>{viewing}</b>
        </div>
        <input className="filter" placeholder="Filter refs" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="sections">
        <Section
          title="Local"
          icon={Laptop}
          count={local.length}
          defaultOpen
          actions={anyLocalHidden ? [{ icon: Eye, title: 'Show all local branches in the graph', onClick: () => p.onShowAll('head') }] : []}
        >
          {local.map((r) => (
            <div
              key={r.fullName}
              className={`ref-row ${r.isHead ? 'head' : ''} ${hidden.has(r.fullName) ? 'ref-hidden' : ''} ${drag.isSource(r) ? 'drag-src' : ''} ${drag.isOver(r) ? 'drop-over' : ''}`}
              title={`${r.upstream ? `${r.name} tracks ${r.upstream}` : r.name}${r.name === p.pinnedName ? '\npinned to the left column' : ''}`}
              onContextMenu={(e) => p.onRefMenu(e, r)}
              onDoubleClick={() => p.onRefActivate(r)}
              {...drag.attrs(r)}
            >
              <Icon of={r.isHead ? Check : GitBranch} size={12} className="row-icon" />
              <span className="row-name">{r.name}</span>
              {r.name === p.pinnedName && <Icon of={Pin} size={11} className="row-pin" />}
              <span className="ab">{abText(r)}</span>
              {eye(r)}
            </div>
          ))}
          {local.length === 0 && <div className="ref-row dim">No local branches</div>}
        </Section>
        <Section
          title="Remote"
          icon={Cloud}
          count={remoteCount}
          defaultOpen
          actions={[
            ...(anyRemoteHidden ? [{ icon: Eye, title: 'Show all remote branches in the graph', onClick: () => p.onShowAll('remote') }] : []),
            { icon: Plus, title: 'Add remote', onClick: p.onAddRemote },
          ]}
        >
          {[...remoteGroups.entries()].map(([remoteName, list]) => {
            const remote = p.remotes.find((r) => r.name === remoteName);
            return (
              <div key={remoteName}>
                <div className="ref-row remote-group" title={remote?.fetchUrl} onContextMenu={(e) => remote && p.onRemoteMenu(e, remote)}>
                  <Icon of={Cloud} size={12} className="row-icon" />
                  <span className="row-name">{remoteName}</span>
                </div>
                {list.map((r) => (
                  <div
                    key={r.fullName}
                    className={`ref-row nested ${hidden.has(r.fullName) ? 'ref-hidden' : ''} ${drag.isSource(r) ? 'drag-src' : ''} ${drag.isOver(r) ? 'drop-over' : ''}`}
                    onContextMenu={(e) => p.onRefMenu(e, r)}
                    onDoubleClick={() => p.onRefActivate(r)}
                    {...drag.attrs(r)}
                  >
                    <Icon of={GitBranch} size={12} className="row-icon" />
                    <span className="row-name">{r.name.slice(remoteName.length + 1)}</span>
                    {eye(r)}
                  </div>
                ))}
              </div>
            );
          })}
          {remoteGroups.size === 0 && <div className="ref-row dim">No remotes</div>}
        </Section>
        <Section title="Tags" icon={Tag} count={tags.length}>
          {tags.map((r) => (
            <div key={r.fullName} className="ref-row" onContextMenu={(e) => p.onRefMenu(e, r)} onDoubleClick={() => p.onRefActivate(r)}>
              <Icon of={Tag} size={12} className="row-icon" />
              <span className="row-name">{r.name}</span>
            </div>
          ))}
        </Section>
        <Section title="Stashes" icon={Archive} count={stashes.length} defaultOpen={stashes.length > 0}>
          {stashes.map((s) => (
            <div key={s.sha} className="ref-row" title={s.message} onContextMenu={(e) => p.onStashMenu(e, s)} onDoubleClick={() => p.onStashActivate(s)}>
              <Icon of={Archive} size={12} className="row-icon" />
              <span className="stash-idx">{s.index}</span>
              <span className="row-name">{s.message}</span>
            </div>
          ))}
        </Section>
      </div>
      {/* Absolutely positioned on the panel's right edge, so it takes no width of its own. */}
      <div
        className="panel-resize right"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize the panel, double-click to reset"
        {...p.resize}
      />
    </aside>
  );
}
