import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type MouseEvent, type ReactNode } from 'react';
import { Archive, Check, ChevronRight, Cloud, Eye, EyeOff, Folder, Laptop, PanelLeftClose, Pin, Plus, Tag, type LucideIcon } from 'lucide-react';
import type { GitRef, RepoInfo, Remote, Stash } from '@shared/types';
import { Icon } from '../ui/icons';
import { fitSections, useBoundaryDrag, type DragHandleProps } from '../ui/useDragWidth';
import { useRefDrag, type RefDragHandlers } from '../ui/refDrag';
import { formatDateTimeSeconds, relativeTime } from '../time';
// The graph row's own answer to what a stash's message reads as (GC-170), so the two surfaces
// cannot strip git's prefix differently (GC-171).
import { stashMessageText } from '../graph/CommitGraph';

interface Props {
  /** Where HEAD is, which is what the header says (GC-094). The same `info` the breadcrumb reads. */
  info: RepoInfo;
  /** The open repository, which the closed-folder set is keyed by (GC-139). */
  repoPath: string;
  refs: GitRef[];
  stashes: Stash[];
  remotes: Remote[];
  pinnedName: string | null; // local branch pinned to the graph's left column
  /** Full names of the refs kept out of the graph (GC-073). */
  hidden: string[];
  onToggleHidden(ref: GitRef): void;
  onShowAll(kind: 'head' | 'remote'): void;
  collapsed: boolean;
  /**
   * What the ref filter is narrowing by, and how it is changed. It is `App` state and part of
   * `TabState` (GC-179), for the reason the find bar's query is (GC-030, GC-137): this panel is
   * not keyed by repository, so a query typed in one tab was still in the box when another was
   * shown — filtering a repository the user never filtered, and drawing no rows under sections
   * whose headers still counted the real ones.
   */
  filter: string;
  onFilter(query: string): void;
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
  /** Single click: select the stash, the way a ref row selects its tip (GC-141, GC-150). */
  onStashSelect(stash: Stash): void;
  onStashMenu(e: MouseEvent, stash: Stash): void;
  onStashActivate(stash: Stash): void; // double-click: apply
  onRemoteMenu(e: MouseEvent, remote: Remote): void;
  onAddRemote(): void;
}

/** `.section-head` height, mirrored from `app.css`: what a closed section costs the column. */
const SECTION_HEAD_H = 30;

/**
 * What a stash row spends outside its message, mirrored from `app.css` the way `OPT_COL_W` mirrors
 * the graph's optional columns (GC-116, GC-199). `pad` is the row's own 8px each side — a stash row
 * carries no folder-tree indent, see `.ref-row.stash` — and `gap` is one `--sp-2` between siblings.
 */
export const STASH_ROW_W = { pad: 16, gap: 8, icon: 12, idx: 6, sha: 41, when: 72 };

/** What the message keeps before an item is dropped for it, the `MIN_MSG_W` of this row. */
export const MIN_STASH_MSG = 96;

/** Which of a stash row's optional items are drawn, for a panel this wide (GC-199). */
export interface StashCols {
  sha: boolean;
}

/**
 * `fitOptCols` one panel over (GC-199). At the default 220px panel the row was five items and the
 * message got **48px** of the 207 it wanted, which is the floor at which two stashes can be told
 * apart rather than a readable row: 34px of padding, 32 of gaps, 12 for the icon, 6 for the index,
 * 41 for GC-150's sha and 46 for GC-171's box left 171px of furniture in front of the one thing on
 * the row that says *which* stash this is. The age's box is 72px now, the widest phrase
 * `relativeTime` can produce (`tokens.css`): it grew because this ticket gave the row the room, and
 * "1 minut…" was an ellipsis that saved nothing.
 *
 * Two things give way, and only one of them is a fit. The folder-tree indent goes for good, in the
 * stylesheet: the STASHES section has no folders, so the 26px that aligns a leaf row's icon under a
 * folder row's was aligning it with nothing. What is left is decided here, and it is the **sha**
 * first, dropped whole rather than narrowed (GC-116's rule: half a sha identifies a commit no
 * better than none) — of the five it is the one repeated verbatim a few pixels away, on the graph
 * row GC-170 draws directly above the same stash. The age is never dropped: it is the question a
 * stash list is read for (GC-135) and it is repeated nowhere on this screen.
 *
 * `panelW` of 0 means not measured yet and draws everything, rather than dropping the sha for one
 * frame — `fitRefCol`'s own rule.
 */
export function fitStashCols(panelW: number, minMsg = MIN_STASH_MSG, w = STASH_ROW_W): StashCols {
  if (panelW <= 0) return { sha: true };
  // Five children means four gaps and four means three, so dropping the sha gives back its own
  // width and the gap that held it.
  const room = (sha: boolean): number => panelW - w.pad - w.icon - w.idx - w.when - (sha ? w.sha : 0) - w.gap * (sha ? 4 : 3);
  return { sha: room(true) >= minMsg };
}

/** The four sections, in the order they are drawn. Also the keys their heights are stored under. */
export type SectionId = 'local' | 'remote' | 'tags' | 'stashes';
const SECTION_IDS: SectionId[] = ['local', 'remote', 'tags', 'stashes'];
/** Where the heights live: state, so its own key rather than the prefs blob (GC-153). */
const SECTION_H_KEY = 'gitclient.sectionHeights';
/**
 * The least a section may be squeezed to: its 30px header and two 26px rows (GC-153). A section
 * reduced to its header alone is present but useless, which is exactly what the ask was about —
 * STASHES has to stay *readable* at the bottom with TAGS open, not merely visible.
 */
export const MIN_SECTION_H = 82;

/** The stored heights, as read back: a section the user has never sized is absent, not zero. */
export function readSectionHeights(): Partial<Record<SectionId, number>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SECTION_H_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Record<SectionId, number>> = {};
    for (const id of SECTION_IDS) {
      const v = (raw as Record<string, unknown>)[id];
      // A hand-edited or nonsensical value falls back to the share, exactly as an absent one does.
      if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_SECTION_H) out[id] = Math.round(v);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Where the open set lives (GC-177). Global rather than per repository, like the heights beside
 * it and unlike the closed folders: these are the same four sections in every repository, and the
 * two halves of one arrangement should not survive a reload differently.
 */
const SECTION_OPEN_KEY = 'gitclient.sectionOpen';

/**
 * Which sections are open when nothing has been stored for them — GC-153's own defaults, and this
 * ticket does not change them. STASHES follows whether there are any, read once at mount the way
 * it always was.
 */
export const defaultSectionOpen = (hasStashes: boolean): Record<SectionId, boolean> => ({ local: true, remote: true, tags: false, stashes: hasStashes });

/**
 * The stored open set, as read back: only sections the user has actually toggled, so one they have
 * never touched keeps its default — which is what lets STASHES stay dynamic. Anything but a
 * boolean, and a stored object naming no section at all, reads as absent rather than as closed.
 */
export function readSectionOpen(): Partial<Record<SectionId, boolean>> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(SECTION_OPEN_KEY) ?? 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out: Partial<Record<SectionId, boolean>> = {};
    for (const id of SECTION_IDS) {
      const v = (raw as Record<string, unknown>)[id];
      if (typeof v === 'boolean') out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeSectionOpen(next: Partial<Record<SectionId, boolean>>): void {
  try {
    if (Object.keys(next).length === 0) localStorage.removeItem(SECTION_OPEN_KEY);
    else localStorage.setItem(SECTION_OPEN_KEY, JSON.stringify(next));
  } catch {
    /* private mode: the open set just does not survive the reload */
  }
}

/** Where a repository's closed folders live (GC-139): remembered state, so its own key per path. */
const foldedKey = (repoPath: string): string => `gitclient.folded.${repoPath}`;

/** The closed folders stored for a repository. Anything but an array of strings reads as none. */
export function readFolded(repoPath: string): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(foldedKey(repoPath)) ?? 'null');
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeFolded(repoPath: string, closed: ReadonlySet<string>): void {
  try {
    // Nothing closed means no key, the way the heights drop theirs: a set the user has emptied is
    // not one the app has to keep.
    if (closed.size === 0) localStorage.removeItem(foldedKey(repoPath));
    else localStorage.setItem(foldedKey(repoPath), JSON.stringify([...closed]));
  } catch {
    /* private mode: the folders just do not survive the reload */
  }
}

/**
 * Every folder key a set of refs can produce, which is what a stored set is pruned against
 * (GC-139) — a folder whose refs are all gone stops being remembered, the same reason the hidden
 * set is pruned. Built from the names directly rather than from the trees, because the trees hold
 * only what the filter matched and the whole snapshot is what decides whether a folder exists.
 */
export function folderKeys(refs: GitRef[], remotes: Remote[]): Set<string> {
  const out = new Set<string>();
  const add = (section: string, label: string): void => {
    const segs = label.split('/').filter(Boolean);
    for (let i = 1; i < segs.length; i++) out.add(`${section}/${segs.slice(0, i).join('/')}`);
  };
  for (const r of refs) {
    if (r.kind === 'head') add('local', r.name);
    else if (r.kind === 'tag') add('tags', r.name);
    else if (r.kind === 'remote') {
      // The remote's own row is the first level, so its segment is not part of the key (GC-051).
      const rem = remotes.find((x) => r.name.startsWith(`${x.name}/`));
      if (rem) add(`remote:${rem.name}`, r.name.slice(rem.name.length + 1));
    }
  }
  return out;
}

interface SectionProps {
  title: string;
  icon: LucideIcon;
  count: number;
  open: boolean;
  onToggle(): void;
  /** The height this section is drawn at, or undefined for a closed one: its header is all of it. */
  height?: number;
  /** Reports what its rows would take unsqueezed, so the share never hands it more (GC-153). */
  onNatural(h: number): void;
  /** Optional buttons on the right of the header, e.g. "Show all" and "Add remote". */
  actions?: { icon: LucideIcon; title: string; onClick(): void }[];
  children: ReactNode;
}

/**
 * One section: a header that never scrolls away, and its rows in a box that scrolls on its own
 * (GC-153). The height is decided by the panel, which shares the column between the sections that
 * are open — with 52 remote branches this is the difference between TAGS and STASHES being
 * reachable and their headers not being on screen at all.
 */
function Section({ title, icon, count, open, onToggle, height, onNatural, actions = [], children }: SectionProps): JSX.Element {
  // What this section's rows would take if nothing squeezed them, reported up so the share can
  // stop at it: a section is never given more of the column than it has anything to put in
  // (GC-153). The observer is on the content, not on the scroll box, whose height is the answer
  // being computed.
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = content.current;
    if (!el || !open) return;
    const update = (): void => onNatural(el.getBoundingClientRect().height + SECTION_HEAD_H);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, onNatural]);

  return (
    <div className={`panel-section ${open ? 'open' : 'closed'}`} style={open && height ? ({ height } as CSSProperties) : undefined}>
      <div className={`section-head ${open ? 'open' : ''}`}>
        <button className="section-toggle" onClick={onToggle}>
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
      {open && (
        <div className="section-rows">
          <div ref={content}>{children}</div>
        </div>
      )}
    </div>
  );
}

/**
 * The 4px grab strip between two open sections (GC-153). Absent when there is nothing below to
 * take height from — a closed neighbour, or the last open section — so a handle is never offered
 * where a drag could do nothing.
 */
function SectionHandle({ handle }: { handle: DragHandleProps | null }): JSX.Element | null {
  if (!handle) return null;
  return <div className="section-resize" role="separator" aria-orientation="horizontal" title="Drag to share the height, double-click to reset" {...handle} />;
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
  const filter = p.filter;
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
  // Which folders the user has closed, keyed `<section>/<folder path>` and remembered per
  // repository (GC-051, GC-139). Closed rather than open, so a folder that appears later starts
  // expanded. The path it was read for is held beside it because this component is not keyed by
  // repository: a switch is noticed during render, the way `DiffView` derives rather than clears
  // from an effect, so no frame is painted with the previous repository's folders.
  const [folded, setFolded] = useState<{ path: string; set: ReadonlySet<string> }>(() => ({ path: p.repoPath, set: readFolded(p.repoPath) }));
  if (folded.path !== p.repoPath) setFolded({ path: p.repoPath, set: readFolded(p.repoPath) });
  const closedFolders = folded.set;

  // Pruned against the refs actually present, so a folder that no longer exists stops being
  // remembered (GC-139). Only ever shrinks, so it settles in one pass.
  useEffect(() => {
    const keys = folderKeys(p.refs, p.remotes);
    const kept = [...folded.set].filter((k) => keys.has(k));
    if (kept.length === folded.set.size) return;
    const next = new Set(kept);
    writeFolded(p.repoPath, next);
    setFolded({ path: p.repoPath, set: next });
  }, [p.refs, p.remotes, p.repoPath, folded]);

  // ---- the four sections share the column (GC-153) -------------------------------------------
  // Which are open is the panel's business now rather than each section's own state, because the
  // height is shared: closing one has to give its space to the others, and opening it take it back.
  // And it is remembered (GC-177), because with the height shared it is the arrangement and not a
  // disclosure triangle: opening TAGS on a repository with 283 of them used to last until the next
  // reload, while the heights the same user dragged came back. Two pieces of state rather than
  // one: `openStored` is only what the user has actually toggled, so a section they have never
  // touched still takes its default — which is how STASHES keeps following whether there are any.
  const [defaultOpen] = useState<Record<SectionId, boolean>>(() => defaultSectionOpen(p.stashes.length > 0));
  const [openStored, setOpenStored] = useState<Partial<Record<SectionId, boolean>>>(readSectionOpen);
  const openSections = useMemo<Record<SectionId, boolean>>(() => ({ ...defaultOpen, ...openStored }), [defaultOpen, openStored]);
  const [heights, setHeights] = useState<Partial<Record<SectionId, number>>>(readSectionHeights);
  // What each open section's rows measure, reported by the sections themselves (GC-153). Written
  // through a ref and mirrored into state only when a number actually changes, so a section
  // re-rendering at the same height re-renders nothing else.
  const naturalRef = useRef<Partial<Record<SectionId, number>>>({});
  const [natural, setNatural] = useState<Partial<Record<SectionId, number>>>({});
  const reportNatural = useCallback((id: SectionId, h: number): void => {
    const rounded = Math.round(h);
    if (naturalRef.current[id] === rounded) return;
    naturalRef.current = { ...naturalRef.current, [id]: rounded };
    setNatural(naturalRef.current);
  }, []);
  const onNatural = useMemo(
    () => Object.fromEntries(SECTION_IDS.map((id) => [id, (h: number) => reportNatural(id, h)])) as Record<SectionId, (h: number) => void>,
    [reportNatural],
  );
  const persistHeights = (next: Partial<Record<SectionId, number>>): void => {
    try {
      // Nothing sized at all means no key: a set of heights the user never chose is not one the
      // app has to keep honouring, exactly as a double-clicked panel handle drops its own key.
      if (Object.keys(next).length === 0) localStorage.removeItem(SECTION_H_KEY);
      else localStorage.setItem(SECTION_H_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the heights just do not survive the reload */
    }
  };
  // The column the sections share, measured rather than assumed — the same `ResizeObserver` answer
  // the graph uses for its own fit (GC-110). 0 until the first measurement, which `fitSections`
  // never sees: nothing is drawn with a height before then.
  const sectionsRef = useRef<HTMLDivElement>(null);
  const [columnH, setColumnH] = useState(0);
  // The same observer answers the width, which is what a stash row's fit is decided against
  // (GC-199). `clientWidth` is the box the rows are laid out in, so the scrollbar is out of it by
  // construction — the graph's own reason for measuring rather than assuming (GC-110).
  const [columnW, setColumnW] = useState(0);
  useEffect(() => {
    const el = sectionsRef.current;
    if (!el) return;
    const update = (): void => {
      setColumnH(el.clientHeight);
      setColumnW(el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stashCols = fitStashCols(columnW);

  const openIds = SECTION_IDS.filter((id) => openSections[id]);
  // A closed section is its 30px header and takes no part in the share, the way `fitPanels` is
  // handed a collapsed left rail as a zero-width panel (GC-105).
  const avail = Math.max(0, columnH - (SECTION_IDS.length - openIds.length) * SECTION_HEAD_H);
  const applied = fitSections(
    openIds.map((id) => heights[id] ?? null),
    avail,
    MIN_SECTION_H,
    openIds.map((id) => natural[id] ?? null),
  );
  const heightOf = (id: SectionId): number | undefined => {
    const at = openIds.indexOf(id);
    return at < 0 || columnH === 0 ? undefined : applied[at];
  };
  const boundary = useBoundaryDrag(MIN_SECTION_H);
  /**
   * The handle between an open section and the next one down. It writes both heights — what one
   * gains the other gives up — so the stored numbers keep adding up to the column and no other
   * section is touched.
   */
  const handleAfter = (id: SectionId): DragHandleProps | null => {
    const at = openIds.indexOf(id);
    const below = openIds[at + 1];
    if (at < 0 || !below) return null;
    const a = applied[at] ?? MIN_SECTION_H;
    const b = applied[at + 1] ?? MIN_SECTION_H;
    return boundary.handle(
      a,
      b,
      (na, nb) => setHeights((prev) => ({ ...prev, [id]: na, [below]: nb })),
      (na, nb) => {
        const next = { ...heights, [id]: na, [below]: nb };
        setHeights(next);
        persistHeights(next);
      },
      () => {
        // A reset drops both keys, and the two then share what the sized sections leave — which
        // is an equal share, without that having to be a case of its own (GC-153).
        const next = { ...heights };
        delete next[id];
        delete next[below];
        setHeights(next);
        persistHeights(next);
      },
    );
  };
  const toggleSection = (id: SectionId): void =>
    setOpenStored((prev) => {
      const next = { ...prev, [id]: !openSections[id] };
      writeSectionOpen(next);
      return next;
    });
  const toggleFolder = (key: string): void => {
    const next = new Set(closedFolders);
    if (!next.delete(key)) next.add(key);
    writeFolded(p.repoPath, next);
    setFolded({ path: p.repoPath, set: next });
  };

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
      {/* The same vocabulary the chip uses one panel over (GC-146): a laptop is a local branch,
          and the check still says which one is checked out. One branch icon marked local and remote
          rows alike, which is the gap the chips had, one level down. */}
      <Icon of={r.isHead ? Check : Laptop} size={12} className="row-icon" />
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
      <Icon of={Cloud} size={12} className="row-icon" />
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
        <input ref={filterInput} className="filter" placeholder="Filter refs" value={filter} onChange={(e) => p.onFilter(e.target.value)} spellCheck={false} />
      </div>
      <div className="sections" ref={sectionsRef}>
        <Section
          title="Local"
          icon={Laptop}
          count={local.length}
          open={openSections.local}
          onToggle={() => toggleSection('local')}
          height={heightOf('local')} onNatural={onNatural.local}
          actions={anyLocalHidden ? [{ icon: Eye, title: 'Show all local branches in the graph', onClick: () => p.onShowAll('head') }] : []}
        >
          {folderRows(localTree, 'local', 0, localLeaf)}
          {local.length === 0 && <div className="ref-row dim">No local branches</div>}
        </Section>
        <SectionHandle handle={handleAfter('local')} />
        <Section
          title="Remote"
          icon={Cloud}
          count={remoteCount}
          open={openSections.remote}
          onToggle={() => toggleSection('remote')}
          height={heightOf('remote')} onNatural={onNatural.remote}
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
        <SectionHandle handle={handleAfter('remote')} />
        <Section title="Tags" icon={Tag} count={tags.length} open={openSections.tags} onToggle={() => toggleSection('tags')} height={heightOf('tags')} onNatural={onNatural.tags}>
          {folderRows(tagTree, 'tags', 0, tagLeaf)}
        </Section>
        <SectionHandle handle={handleAfter('tags')} />
        <Section title="Stashes" icon={Archive} count={stashes.length} open={openSections.stashes} onToggle={() => toggleSection('stashes')} height={heightOf('stashes')} onNatural={onNatural.stashes}>
          {stashes.map((s) => (
            // `Stash.date` has been on every snapshot since the stash list existed and was drawn
            // nowhere; "how old is this" is the question a stash list is read for (GC-135). The
            // relative form is on the row and the absolute joins the message on its title, so the
            // exact instant is a hover away rather than gone.
            // A single click selects it, which is the gesture every other row in this panel
            // answers (GC-141, GC-150); double-click still applies it. The row is marked when
            // either the stash or the commit it was taken from is the selection, so the panel and
            // the graph agree however the user got there — the graph draws the stash on a row of
            // its own directly above that commit (GC-170).
            <div
              key={s.sha}
              className={`ref-row stash ${p.selected === s.sha || p.selected === s.parent ? 'selected' : ''}`}
              title={`${s.message}\n${formatDateTimeSeconds(s.date)}\ntaken from ${s.parent.slice(0, 7)}`}
              onClick={() => p.onStashSelect(s)}
              onContextMenu={(e) => p.onStashMenu(e, s)}
              onDoubleClick={() => p.onStashActivate(s)}
            >
              <Icon of={Archive} size={12} className="row-icon" />
              <span className="stash-idx">{s.index}</span>
              {/* git's `On <branch>: ` prefix comes off the drawn line and nowhere else (GC-171).
                  Every stash git makes carries it, so the nine characters that survived a 77px
                  column were the ones identical across every stash on the branch: two stashes on
                  `main` rendered as the same row. GitKraken drops it too. `stashMessageText` is the
                  graph row's own answer (GC-170) and the two must agree — never in the `title`
                  above, and never in what `stashRename` stores. */}
              <span className="row-name">{stashMessageText(s.message)}</span>
              {/* Which commit it was taken from, in the graph's own vocabulary — a short sha —
                  so the two surfaces say the same thing without a hover (GC-140, GC-150). It is
                  the first thing to go on a narrow panel (GC-199): the graph draws the same seven
                  characters on the stash's own row, and the message is the only thing here that
                  says which stash this is. The `title` still carries it at every width. */}
              {stashCols.sha && <span className="row-sha">{s.parent.slice(0, 7)}</span>}
              <span className="row-when">{relativeTime(s.date)}</span>
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
