import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type MouseEvent, type ReactNode } from 'react';
import { Archive, Check, ChevronRight, Cloud, Eye, EyeOff, Folder, GitBranch, Laptop, PanelLeftClose, Pin, Plus, Tag, type LucideIcon } from 'lucide-react';
import type { GitRef, RepoInfo, Remote, Stash } from '@shared/types';
import { Icon } from '../ui/icons';
import type { DragHandleProps } from '../ui/useDragWidth';
import { useRefDrag, type RefDragHandlers } from '../ui/refDrag';

interface Props {
  /** Where HEAD is, which is what the header says (GC-094). The same `info` the breadcrumb reads. */
  info: RepoInfo;
  refs: GitRef[];
  stashes: Stash[];
  remotes: Remote[];
  pinnedName: string | null; // local branch pinned to the graph's left column
  /** Full names of the refs kept out of the graph (GC-073). */
  hidden: string[];
  onToggleHidden(ref: GitRef): void;
  onShowAll(kind: 'head' | 'remote'): void;
  collapsed: boolean;
  /** Bumped every time Ctrl+Alt+F asks for the ref filter, so it refocuses (GC-033). */
  focusFilter: number;
  /** The right-edge resize handle (GC-050). Not rendered while the panel is the icon rail. */
  resize: DragHandleProps;
  onExpand(): void;
  onCollapse(): void;
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void; // double-click: checkout
  onRefSelect(ref: GitRef): void; // single click: select the ref's tip commit (GC-141)
  /** The selected commit, so a row standing at it is marked the way the graph's row is (GC-141). */
  selected: string | null;
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

/**
 * One node of a section's ref tree (GC-051). `path` is the folder's position inside its section
 * (`feat`, then `feat/ui`), which is also what the collapsed set is keyed on; `count` is every ref
 * beneath it at any depth, which is what its row shows — a folder counts refs, never sub-folders.
 */
export interface RefFolder {
  path: string; // '' for the section root, which is never drawn as a row
  name: string; // the last segment of `path`
  folders: RefFolder[];
  leaves: { ref: GitRef; label: string }[];
  count: number;
}

/**
 * Fold a section's refs into folders on the slashes in their names (GC-051), so `feat/a` and
 * `feat/b` become a `feat` folder with two rows rather than two rows repeating the prefix.
 *
 * `label` is the name **relative to the section**, so a remote's branches group without the
 * remote's own segment: the remote row is already the first level. Order is the order the refs
 * arrive in — they are sorted before they get here — and a folder takes the position of its first
 * ref, so nothing jumps around when one is added. A ref cannot collide with a folder of the same
 * name because git itself refuses to hold `feat` and `feat/a` at once.
 */
export function buildRefTree(refs: GitRef[], label: (r: GitRef) => string): RefFolder {
  const root: RefFolder = { path: '', name: '', folders: [], leaves: [], count: 0 };
  for (const ref of refs) {
    const segs = label(ref).split('/').filter((s) => s !== '');
    if (segs.length === 0) continue; // defensive: a name that is only slashes has no row to draw
    let node = root;
    node.count++;
    for (let i = 0; i < segs.length - 1; i++) {
      const path = segs.slice(0, i + 1).join('/');
      let next = node.folders.find((fo) => fo.path === path);
      if (!next) {
        next = { path, name: segs[i]!, folders: [], leaves: [], count: 0 };
        node.folders.push(next);
      }
      node = next;
      node.count++;
    }
    node.leaves.push({ ref, label: segs[segs.length - 1]! });
  }
  return root;
}

const abText = (r: GitRef): string => {
  const parts: string[] = [];
  if (r.ahead) parts.push(`↑${r.ahead}`);
  if (r.behind) parts.push(`↓${r.behind}`);
  return parts.join(' ');
};

/** How a leaf row of one section is drawn: the ref, its name inside its folder, and its depth. */
type LeafRow = (ref: GitRef, label: string, depth: number) => JSX.Element;

export function LeftPanel(p: Props): JSX.Element {
  const [filter, setFilter] = useState('');
  // Ctrl+Alt+F focuses the filter; a tick rather than a flag, so asking twice focuses twice, and
  // the panel is already expanded by the time this runs — `App` un-collapses it first (GC-033).
  const filterInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (p.focusFilter === 0) return; // the mount value: nothing has asked for the field yet
    filterInput.current?.focus();
    filterInput.current?.select();
  }, [p.focusFilter]);
  const drag = useRefDrag(p.refDrag);
  const f = filter.trim().toLowerCase();
  const hidden = useMemo(() => new Set(p.hidden), [p.hidden]);
  // Which folders the user has closed, keyed `<section>/<folder path>` and kept for the session
  // only (GC-051). Closed rather than open, so a folder that appears later starts expanded.
  const [closedFolders, setClosedFolders] = useState<ReadonlySet<string>>(new Set());
  const toggleFolder = (key: string): void =>
    setClosedFolders((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

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

  const anyLocalHidden = local.some((r) => hidden.has(r.fullName));
  const anyRemoteHidden = [...remoteGroups.values()].flat().some((r) => hidden.has(r.fullName));

  /**
   * Whether a row stands at the selected commit (GC-141). By sha rather than by which row was
   * clicked, because the selection is a commit and both panels have to agree on it: selecting a
   * commit in the graph marks its rows here too, and every ref sitting on that commit is, in
   * fact, at the selection.
   */
  const atSelected = (r: GitRef): boolean => p.selected !== null && r.sha === p.selected;

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

  /**
   * A section's rows: its folders, each with its own rows beneath it, then the refs sitting
   * directly at this level. A filter forces every folder open — the tree only holds matches by
   * the time it is built, so a folder that is drawn at all is one holding a match.
   */
  const folderRows = (node: RefFolder, section: string, depth: number, leaf: LeafRow): ReactNode => (
    <>
      {node.folders.map((fo) => {
        const key = `${section}/${fo.path}`;
        const open = f !== '' || !closedFolders.has(key);
        return (
          <div key={key}>
            <div
              className={`ref-row folder ${open ? 'open' : ''}`}
              style={{ '--row-depth': depth } as CSSProperties}
              title={fo.path}
              onClick={() => toggleFolder(key)}
            >
              <Icon of={ChevronRight} size={12} className="chev" />
              <Icon of={Folder} size={12} className="row-icon" />
              <span className="row-name">{fo.name}</span>
              <span className="count">{fo.count}</span>
            </div>
            {open && folderRows(fo, section, depth + 1, leaf)}
          </div>
        );
      })}
      {node.leaves.map((l) => leaf(l.ref, l.label, depth))}
    </>
  );

  const localLeaf: LeafRow = (r, label, depth) => (
    <div
      key={r.fullName}
      className={`ref-row ${r.isHead ? 'head' : ''} ${atSelected(r) ? 'selected' : ''} ${hidden.has(r.fullName) ? 'ref-hidden' : ''} ${drag.isSource(r) ? 'drag-src' : ''} ${drag.isOver(r) ? 'drop-over' : ''}`}
      style={{ '--row-depth': depth } as CSSProperties}
      title={`${r.upstream ? `${r.name} tracks ${r.upstream}` : r.name}${r.name === p.pinnedName ? '\npinned to the left column' : ''}`}
      onContextMenu={(e) => p.onRefMenu(e, r)}
      onClick={() => p.onRefSelect(r)}
      onDoubleClick={() => p.onRefActivate(r)}
      {...drag.attrs(r)}
    >
      <Icon of={r.isHead ? Check : GitBranch} size={12} className="row-icon" />
      <span className="row-name">{label}</span>
      {r.name === p.pinnedName && <Icon of={Pin} size={11} className="row-pin" />}
      <span className="ab">{abText(r)}</span>
      {eye(r)}
    </div>
  );

  const remoteLeaf: LeafRow = (r, label, depth) => (
    <div
      key={r.fullName}
      className={`ref-row nested ${atSelected(r) ? 'selected' : ''} ${hidden.has(r.fullName) ? 'ref-hidden' : ''} ${drag.isSource(r) ? 'drag-src' : ''} ${drag.isOver(r) ? 'drop-over' : ''}`}
      style={{ '--row-depth': depth } as CSSProperties}
      title={r.name}
      onContextMenu={(e) => p.onRefMenu(e, r)}
      onClick={() => p.onRefSelect(r)}
      onDoubleClick={() => p.onRefActivate(r)}
      {...drag.attrs(r)}
    >
      <Icon of={GitBranch} size={12} className="row-icon" />
      <span className="row-name">{label}</span>
      {eye(r)}
    </div>
  );

  const tagLeaf: LeafRow = (r, label, depth) => (
    <div
      key={r.fullName}
      className={`ref-row ${atSelected(r) ? 'selected' : ''}`}
      style={{ '--row-depth': depth } as CSSProperties}
      title={r.name}
      onContextMenu={(e) => p.onRefMenu(e, r)}
      onClick={() => p.onRefSelect(r)}
      onDoubleClick={() => p.onRefActivate(r)}
    >
      <Icon of={Tag} size={12} className="row-icon" />
      <span className="row-name">{label}</span>
    </div>
  );

  const localTree = useMemo(() => buildRefTree(local, (r) => r.name), [local]);
  const tagTree = useMemo(() => buildRefTree(tags, (r) => r.name), [tags]);

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
          {/* Where HEAD is, in the words the breadcrumb and the staging header already use, so the
              three agree (GC-094). It replaces a ref count that repeated the section counts
              directly beneath it and, sitting one line above the status bar's "N commits", read as
              a commit count that disagreed with it. A detached HEAD names its commit as well: there
              is no branch name to give, and no row in LOCAL carries the check mark, so this is the
              only place in the panel that can say where HEAD is at all (GC-061). */}
          <span className="head-ref" title={p.info.branch ? `Checked out: ${p.info.branch}` : 'HEAD is detached'}>
            {p.info.branch ?? 'detached HEAD'}
          </span>
          {p.info.branch === null && p.info.headSha && <b>{p.info.headSha.slice(0, 7)}</b>}
        </div>
        <input ref={filterInput} className="filter" placeholder="Filter refs" value={filter} onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="sections">
        <Section
          title="Local"
          icon={Laptop}
          count={local.length}
          defaultOpen
          actions={anyLocalHidden ? [{ icon: Eye, title: 'Show all local branches in the graph', onClick: () => p.onShowAll('head') }] : []}
        >
          {folderRows(localTree, 'local', 0, localLeaf)}
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
            // The remote's own row is the first level, so its branches are folded one deeper and
            // without the remote's segment, which the row above already carries.
            const tree = buildRefTree(list, (r) => r.name.slice(remoteName.length + 1));
            return (
              <div key={remoteName}>
                <div className="ref-row remote-group" title={remote?.fetchUrl} onContextMenu={(e) => remote && p.onRemoteMenu(e, remote)}>
                  <Icon of={Cloud} size={12} className="row-icon" />
                  <span className="row-name">{remoteName}</span>
                </div>
                {folderRows(tree, `remote:${remoteName}`, 1, remoteLeaf)}
              </div>
            );
          })}
          {remoteGroups.size === 0 && <div className="ref-row dim">No remotes</div>}
        </Section>
        <Section title="Tags" icon={Tag} count={tags.length}>
          {folderRows(tagTree, 'tags', 0, tagLeaf)}
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
