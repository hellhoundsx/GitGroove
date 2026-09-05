import { useMemo, useState, type JSX, type MouseEvent, type ReactNode } from 'react';
import { Archive, Check, ChevronRight, Cloud, GitBranch, Laptop, PanelLeftClose, Pin, Plus, Tag, type LucideIcon } from 'lucide-react';
import type { GitRef, Remote, Stash } from '@shared/types';
import { Icon } from '../ui/icons';

interface Props {
  refs: GitRef[];
  stashes: Stash[];
  remotes: Remote[];
  pinnedName: string | null; // local branch pinned to the graph's left column
  collapsed: boolean;
  onExpand(): void;
  onCollapse(): void;
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void; // double-click: checkout
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
  /** Optional button on the right of the header, e.g. "Add remote". */
  action?: { icon: LucideIcon; title: string; onClick(): void };
  children: ReactNode;
}

function Section({ title, icon, count, defaultOpen = false, action, children }: SectionProps): JSX.Element {
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
        {action && (
          <button className="section-action" title={action.title} aria-label={action.title} onClick={action.onClick}>
            <Icon of={action.icon} size={12} />
          </button>
        )}
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
  const f = filter.trim().toLowerCase();

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
          <b>{local.length + remoteCount + tags.length}</b>
        </div>
        <input className="filter" placeholder="Filter refs" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="sections">
        <Section title="Local" icon={Laptop} count={local.length} defaultOpen>
          {local.map((r) => (
            <div
              key={r.fullName}
              className={`ref-row ${r.isHead ? 'head' : ''}`}
              title={`${r.upstream ? `${r.name} tracks ${r.upstream}` : r.name}${r.name === p.pinnedName ? '\npinned to the left column' : ''}`}
              onContextMenu={(e) => p.onRefMenu(e, r)}
              onDoubleClick={() => p.onRefActivate(r)}
            >
              <Icon of={r.isHead ? Check : GitBranch} size={12} className="row-icon" />
              <span className="row-name">{r.name}</span>
              {r.name === p.pinnedName && <Icon of={Pin} size={11} className="row-pin" />}
              <span className="ab">{abText(r)}</span>
            </div>
          ))}
          {local.length === 0 && <div className="ref-row dim">No local branches</div>}
        </Section>
        <Section title="Remote" icon={Cloud} count={remoteCount} defaultOpen action={{ icon: Plus, title: 'Add remote', onClick: p.onAddRemote }}>
          {[...remoteGroups.entries()].map(([remoteName, list]) => {
            const remote = p.remotes.find((r) => r.name === remoteName);
            return (
              <div key={remoteName}>
                <div className="ref-row remote-group" title={remote?.fetchUrl} onContextMenu={(e) => remote && p.onRemoteMenu(e, remote)}>
                  <Icon of={Cloud} size={12} className="row-icon" />
                  <span className="row-name">{remoteName}</span>
                </div>
                {list.map((r) => (
                  <div key={r.fullName} className="ref-row nested" onContextMenu={(e) => p.onRefMenu(e, r)} onDoubleClick={() => p.onRefActivate(r)}>
                    <Icon of={GitBranch} size={12} className="row-icon" />
                    <span className="row-name">{r.name.slice(remoteName.length + 1)}</span>
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
    </aside>
  );
}
