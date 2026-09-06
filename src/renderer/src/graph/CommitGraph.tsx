import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Cloud, Minus, Pencil, Pin, Plus, Search, Tag, TriangleAlert, X } from 'lucide-react';
import type { Commit, GitRef, RepoStatus } from '@shared/types';
import { layoutGraph, type RowLayout } from './lanes';
import { GraphCell, LANE_W, ROW_H, laneColor, type WipDash } from './GraphCell';
import { Icon } from '../ui/icons';
import { initialsOf } from '../ui/avatars';
// `matches` is taken by the search results in this file.
import { matches as isShortcut } from '../shortcuts';
import { usePrefs } from '../prefs';
import { useDragWidth } from '../ui/useDragWidth';

interface Props {
  commits: Commit[];
  refs: GitRef[];
  status: RepoStatus | null;
  headSha: string | null;
  pinnedSha: string | null; // branch pinned to column 0; HEAD's lineage takes it when null
  pinnedName: string | null; // name of that branch, for the pin marker on its chip
  selected: string | null; // sha, or WIP
  searchOpen: boolean;
  /** Bumped every time Ctrl+F or the toolbar asks for the search bar, so it refocuses. */
  searchTick: number;
  /** Owned by `App` so it survives this component unmounting behind a file view (GC-030). */
  searchQuery: string;
  onSearchQuery(query: string): void;
  onCloseSearch(): void;
  onSelect(sha: string): void;
  onCommitMenu(e: MouseEvent, commit: Commit): void;
  onWipMenu(e: MouseEvent): void;
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void;
  /** No branch is checked out: the graph marks HEAD itself, since no ref carries the check (GC-061). */
  detached: boolean;
  /** The traversal had commits behind the last one loaded, so scrolling near the end asks for more (GC-012). */
  hasMore: boolean;
  /** A page is in flight: the row at the bottom says so, and no second request is made (GC-012). */
  loadingMore: boolean;
  onLoadMore(): void;
}

export const WIP = 'WIP';
const OVERSCAN = 12;
/** How close to the end of the loaded range brings in the next page (GC-012). */
const NEAR_END = 200;

// Ref column width: dragged between MIN and MAX, double-click resets to DEFAULT. The drag itself
// is `useDragWidth`, shared with both side panels (GC-050).
const REF_COL_KEY = 'gitclient.refColW';
const REF_COL_DEFAULT = 150;
const REF_COL_MIN = 100;
const REF_COL_MAX = 400;
/**
 * The ref column shows exactly one chip at every width; everything else folds into `+N`
 * (GC-078). A second chip took its space from the first, leaving the name that identifies the
 * commit truncated to a few letters, so the column's width now decides how much of the one name
 * shows, never how many chips do.
 */
const MAX_CHIPS = 1;

/**
 * A detached HEAD is on no branch, so `for-each-ref` marks nothing as the checked-out ref and
 * the chip that carries the check simply disappears. The graph builds its own (GC-061); it is
 * never a real ref, so `getRefs` and `GitRef` are untouched and the ref menu never sees it.
 */
const HEAD_REF = 'HEAD';
const headChipFor = (sha: string): GitRef => ({ name: HEAD_REF, fullName: HEAD_REF, kind: 'head', sha, isHead: true });
/** A ref chip to draw; a local branch absorbs its upstream when both point at the same commit. */
interface Chip {
  ref: GitRef;
  upstreamHere: boolean;
}

function chipsFor(refs: GitRef[]): Chip[] {
  const absorbed = new Set<string>();
  for (const r of refs) if (r.kind === 'head' && r.upstream && refs.some((o) => o.kind === 'remote' && o.name === r.upstream)) absorbed.add(r.upstream);
  return refs.filter((r) => !(r.kind === 'remote' && absorbed.has(r.name))).map((r) => ({ ref: r, upstreamHere: r.kind === 'head' && !!r.upstream && absorbed.has(r.upstream) }));
}

/** Client-side commit match: message, author name, author email, or a sha prefix. `q` is lowercased. */
const commitMatches = (c: Commit, q: string): boolean =>
  c.sha.startsWith(q) || c.summary.toLowerCase().includes(q) || c.body.toLowerCase().includes(q) || c.authorName.toLowerCase().includes(q) || c.authorEmail.toLowerCase().includes(q);

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `dd/mm/yyyy, HH:MM` in the local zone. Built from the parts rather than `toLocaleString`, whose
 *  field order follows the machine's locale, and without the seconds a 12px cell has no room for. */
function localDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

const laneFree = (row: RowLayout, lane: number): boolean =>
  row.lane !== lane && !row.through.some((s) => s.lane === lane) && !row.incoming.some((s) => s.lane === lane) && !row.outgoing.some((s) => s.lane === lane);

export function CommitGraph({ commits, refs, status, headSha, pinnedSha, pinnedName, selected, searchOpen, searchTick, searchQuery, onSearchQuery, onCloseSearch, onSelect, onCommitMenu, onWipMenu, onRefMenu, onRefActivate, detached, hasMore, loadingMore, onLoadMore }: Props): JSX.Element {
  // The optional columns after the message; all off by default (GC-032).
  const cols = usePrefs().graphColumns;
  // A pinned branch owns column 0; with nothing pinned it stays reserved for HEAD's lineage.
  const layout = useMemo(() => layoutGraph(commits, pinnedSha ?? headSha), [commits, headSha, pinnedSha]);
  const refsBySha = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    if (detached && headSha) m.set(headSha, [headChipFor(headSha)]);
    for (const r of refs) {
      const list = m.get(r.sha) ?? [];
      list.push(r);
      m.set(r.sha, list);
    }
    // checked-out branch first, then the pinned branch, then tracking locals, other locals,
    // remotes, tags. The pin outranks a tracking local because its marker explains why column 0
    // looks the way it does, and folding it into `+N` hides that until the user hovers (GC-020).
    const rank = (r: GitRef): number =>
      r.fullName === HEAD_REF ? -1 : r.isHead ? 0 : r.kind === 'head' ? (r.name === pinnedName ? 1 : r.upstream ? 2 : 3) : r.kind === 'remote' ? 4 : 5;
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return m;
  }, [refs, pinnedName, detached, headSha]);

  const graphWidth = Math.max(3, layout.laneCount) * LANE_W + 16;
  const headRowIndex = headSha ? layout.rows.findIndex((r) => r.sha === headSha) : -1;
  const headRow = headRowIndex >= 0 ? layout.rows[headRowIndex]! : null;
  const wipLane = headRow ? { lane: headRow.lane, color: headRow.color } : { lane: 0, color: 0 };

  const counts = useMemo(() => {
    const c = { add: 0, mod: 0, del: 0, conflict: 0 };
    for (const e of status?.entries ?? []) {
      const k = e.unstaged ?? e.staged;
      if (k === 'conflicted') c.conflict++;
      else if (k === 'added' || k === 'untracked') c.add++;
      else if (k === 'deleted') c.del++;
      else if (k) c.mod++;
    }
    return c;
  }, [status]);
  const hasChanges = counts.add + counts.mod + counts.del + counts.conflict > 0;

  // ---- ref column width ---------------------------------------------------
  const { width: refColW, resizing, handle: refColHandle } = useDragWidth({ key: REF_COL_KEY, def: REF_COL_DEFAULT, min: REF_COL_MIN, max: REF_COL_MAX });

  // ---- search -------------------------------------------------------------
  const searchInput = useRef<HTMLInputElement>(null);
  const needle = searchOpen ? searchQuery.trim().toLowerCase() : '';

  const matches = useMemo(() => (needle === '' ? [] : commits.filter((c) => commitMatches(c, needle)).map((c) => c.sha)), [commits, needle]);
  const matchSet = useMemo(() => new Set(matches), [matches]);

  // The position in the result list is the selection itself, so clicking a row mid-search keeps
  // "next" meaningful; -1 means the selected row is not one of the matches.
  const at = matches.indexOf(selected ?? '');
  const step = useCallback(
    (delta: number): void => {
      if (matches.length === 0) return;
      const from = at >= 0 ? at + delta : delta > 0 ? 0 : matches.length - 1;
      onSelect(matches[((from % matches.length) + matches.length) % matches.length]!);
    },
    [at, matches, onSelect],
  );

  // A new query jumps to its first match; the scroll effect below then brings the row into view.
  // Seeded with the needle of the first render, so coming back from a file view with the same
  // query leaves the selection where the user left it (GC-030).
  const lastNeedle = useRef(needle);
  useEffect(() => {
    if (lastNeedle.current === needle) return;
    lastNeedle.current = needle;
    if (matches.length > 0) onSelect(matches[0]!);
  }, [needle, matches, onSelect]);

  // Opening (or re-triggering Ctrl+F while already open) focuses and selects the field. Clearing
  // the query on close is `App`'s job, since the query outlives this component.
  useEffect(() => {
    if (!searchOpen) return;
    searchInput.current?.focus();
    searchInput.current?.select();
  }, [searchOpen, searchTick]);

  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (isShortcut('searchClose', e)) {
      e.preventDefault();
      onCloseSearch();
    } else if (isShortcut('searchPrev', e)) {
      e.preventDefault();
      step(-1);
    } else if (isShortcut('searchNext', e)) {
      e.preventDefault();
      step(1);
    }
  };

  // ---- virtualisation -----------------------------------------------------
  const bodyRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = (): void => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasWip = !!status;
  const total = layout.rows.length + (hasWip ? 1 : 0);
  const first = Math.max(0, Math.floor(viewport.top / ROW_H) - OVERSCAN);
  const last = Math.min(total, Math.ceil((viewport.top + viewport.height) / ROW_H) + OVERSCAN);
  // The "Loading more" row sits below the last commit while a page is in flight, so the scrollable
  // height has to make room for it or it lands under the bottom edge (GC-012).
  const scrollRows = total + (loadingMore ? 1 : 0);

  // Ask for the next page once the bottom of the viewport is within NEAR_END rows of what is
  // loaded, which is well before the user can reach the end of it. The request is made from an
  // effect rather than the scroll handler so it also fires when the viewport is measured for the
  // first time, or when a page lands that is itself short of the threshold (GC-012).
  useEffect(() => {
    if (!hasMore || loadingMore) return;
    if (last >= total - NEAR_END) onLoadMore();
  }, [hasMore, loadingMore, last, total, onLoadMore]);

  // keep the selected row visible when the selection changes (keyboard navigation)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || selected === null) return;
    const index = selected === WIP ? 0 : commits.findIndex((c) => c.sha === selected) + (hasWip ? 1 : 0);
    if (index < 0) return;
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selected, commits, hasWip]);

  // ---- folded refs (+N) ---------------------------------------------------
  // The dropdown hangs below the chip inside `.graph-body`, which scrolls, so a row near the
  // bottom had its list cut off and the chips in it unreachable. The direction is decided per
  // hover against the live rects, the way `ContextMenu` clamps itself to the viewport, and is
  // held as the sha of the hovered row because the rows are virtualised (GC-022).
  const [moreUp, setMoreUp] = useState<string | null>(null);

  const onMoreEnter = (e: MouseEvent<HTMLElement>, sha: string): void => {
    const body = bodyRef.current;
    const list = e.currentTarget.querySelector<HTMLElement>('.more-list');
    if (!body || !list) {
      setMoreUp(null);
      return;
    }
    // The list is display:none until the :hover rule lands, so it is forced visible for this one
    // measurement and put back in the same task: nothing paints in between.
    const shown = list.style.display;
    list.style.display = 'flex';
    const height = list.getBoundingClientRect().height;
    list.style.display = shown;
    const chip = e.currentTarget.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const below = bodyRect.bottom - chip.bottom;
    const above = chip.top - bodyRect.top;
    // Flip only when it does not fit below *and* there is more room above, so a list taller than
    // the whole body still opens on the side that shows the most of it.
    setMoreUp(height > below && above > below ? sha : null);
  };

  const renderChip = ({ ref: r, upstreamHere }: Chip, color: string, commit?: Commit, plain?: boolean): JSX.Element => {
    const isPinned = r.kind === 'head' && r.name === pinnedName;
    // The synthetic HEAD chip is no ref: there is nothing to check out and nothing for the ref
    // menu to act on, so it opens the commit menu instead — "Create branch here…" being what a
    // detached user usually wants (GC-061).
    const synthetic = r.fullName === HEAD_REF;
    return (
    <span
      key={r.fullName}
      className={`ref-chip ${r.kind} ${r.isHead ? 'head' : ''} ${plain ? 'plain' : ''}`}
      title={synthetic ? 'Detached HEAD\nRight-click for actions on this commit' : `${r.fullName}${upstreamHere ? `\nup to date with ${r.upstream}` : ''}${isPinned ? '\npinned to the left column' : ''}\nDouble-click to checkout, right-click for actions`}
      style={plain || r.kind === 'tag' ? undefined : { background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` }}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (synthetic) {
          if (commit) onCommitMenu(e, commit);
        } else onRefMenu(e, r);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!synthetic) onRefActivate(r);
      }}
    >
      {isPinned && <Icon of={Pin} size={11} className="chip-icon pinned" />}
      {r.isHead && <Icon of={Check} size={11} className="chip-icon" />}
      {r.kind === 'tag' && <Icon of={Tag} size={11} className="chip-icon" />}
      {r.kind === 'remote' && <Icon of={Cloud} size={11} className="chip-icon" />}
      <span className="chip-name">{r.name}</span>
      {upstreamHere && <Icon of={Cloud} size={11} className="chip-icon trailing" />}
    </span>
    );
  };

  const renderRow = (index: number): JSX.Element | null => {
    const style = { top: index * ROW_H };
    if (hasWip && index === 0) {
      return (
        <div key="wip" className={`graph-row wip ${selected === WIP ? 'selected' : ''} ${needle === '' ? '' : 'unmatched'}`} style={style} onClick={() => onSelect(WIP)} onContextMenu={onWipMenu}>
          <div className="col-ref" />
          <div className="col-graph" style={{ width: graphWidth }}>
            <GraphCell row={null} width={graphWidth} wip={wipLane} />
          </div>
          <div className="col-msg">
            <input className="wip-input" placeholder="// WIP" spellCheck={false} onClick={(e) => e.stopPropagation()} />
            {hasChanges ? (
              <span className="readout">
                {counts.conflict > 0 && (
                  <span className="del">
                    <Icon of={TriangleAlert} size={11} /> {counts.conflict}
                  </span>
                )}
                {counts.add > 0 && (
                  <span className="add">
                    <Icon of={Plus} size={11} /> {counts.add}
                  </span>
                )}
                {counts.mod > 0 && (
                  <span className="mod">
                    <Icon of={Pencil} size={11} /> {counts.mod}
                  </span>
                )}
                {counts.del > 0 && (
                  <span className="del">
                    <Icon of={Minus} size={11} /> {counts.del}
                  </span>
                )}
              </span>
            ) : (
              <span className="readout dim">no changes</span>
            )}
          </div>
          {/* the WIP row has no author, date or sha of its own; the cells keep the columns aligned */}
          {cols.author && <div className="col-author" />}
          {cols.date && <div className="col-date" />}
          {cols.sha && <div className="col-sha" />}
        </div>
      );
    }
    const i = hasWip ? index - 1 : index;
    const row = layout.rows[i];
    const c = commits[i];
    if (!row || !c) return null;
    const rowRefs = refsBySha.get(c.sha) ?? [];
    const chips = chipsFor(rowRefs);
    const color = laneColor(row.color);
    let wipDash: WipDash = null;
    if (hasWip && headRow) {
      if (i < headRowIndex && laneFree(row, headRow.lane)) wipDash = 'through';
      else if (i === headRowIndex && !row.hasChildAbove) wipDash = 'toNode';
    }
    return (
      <div key={c.sha} className={`graph-row ${selected === c.sha ? 'selected' : ''} ${needle === '' ? '' : matchSet.has(c.sha) ? 'match' : 'unmatched'}`} style={style} onClick={() => onSelect(c.sha)} onContextMenu={(e) => onCommitMenu(e, c)}>
        <div className="col-ref" onMouseEnter={(e) => onMoreEnter(e, c.sha)} onMouseLeave={() => setMoreUp(null)}>
          {chips.slice(0, MAX_CHIPS).map((chip) => renderChip(chip, color, c))}
          {chips.length > MAX_CHIPS && (
            // Not a popover, and not something to go and find: hovering the refs grows them. The
            // block starts on the chip that was showing, in the same colour, and each further ref
            // is one more line of it, so the +N is only ever a resting state — it hides the moment
            // the block takes its place (asked for by Ricardo). It is a sibling of the block, not
            // its parent, so hiding it leaves the block on screen and its rect still measurable.
            <>
              <span className="ref-chip more" title="More refs on this commit">
                +{chips.length - MAX_CHIPS}
              </span>
              <span className={`more-list ${moreUp === c.sha ? 'flip-up' : ''}`} style={{ background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` }}>
                {chips.map((chip) => renderChip(chip, color, c, true))}
              </span>
            </>
          )}
          {rowRefs.length > 0 && <span className="ref-line" style={{ background: color }} />}
        </div>
        <div className="col-graph" style={{ width: graphWidth }}>
          <GraphCell
            row={row}
            width={graphWidth}
            wipDash={wipDash}
            wipDashLane={wipDash === 'through' ? headRow!.lane : undefined}
            connector={rowRefs.length > 0}
            author={{ name: c.authorName, email: c.authorEmail, initials: initialsOf(c.authorName) }}
          />
        </div>
        <div className="col-msg" title={`${c.summary}\n\n${c.body}`.trim()}>
          <span className="strip" style={{ background: color }} />
          <span className="summary">{c.summary}</span>
          {c.body && (
            // The preview lives in its own box so it can only use space the summary left over,
            // and disappears rather than shrinking to a lone ellipsis (GC-069).
            <span className="body-wrap">
              <span className="body">{c.body.split('\n')[0]}</span>
            </span>
          )}
        </div>
        {cols.author && (
          <div className="col-author" title={`${c.authorName} <${c.authorEmail}>`}>
            {c.authorName}
          </div>
        )}
        {cols.date && (
          <div className="col-date" title={c.authorDate}>
            {localDateTime(c.authorDate)}
          </div>
        )}
        {cols.sha && <div className="col-sha">{c.sha.slice(0, 7)}</div>}
      </div>
    );
  };

  const rows: JSX.Element[] = [];
  for (let i = first; i < last; i++) {
    const r = renderRow(i);
    if (r) rows.push(r);
  }

  return (
    <div className={`graph-panel ${resizing ? 'resizing' : ''}`} style={{ '--ref-col-w': `${refColW}px` } as CSSProperties}>
      {/* shared clip for the round avatars inside every row's svg */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <clipPath id="gc-node-clip" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
        </defs>
      </svg>
      {searchOpen && (
        <div className="graph-search">
          <Icon of={Search} size={13} className="search-icon" />
          <input
            ref={searchInput}
            className="search-input"
            placeholder="Find a commit by message, author or sha"
            spellCheck={false}
            value={searchQuery}
            onChange={(e) => onSearchQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <span className="search-count">{needle === '' ? `${commits.length} commits` : matches.length === 0 ? 'no matches' : at >= 0 ? `${at + 1} of ${matches.length}` : `${matches.length} matches`}</span>
          <button className="search-btn" title="Previous match (Shift+Enter)" disabled={matches.length === 0} onClick={() => step(-1)}>
            <Icon of={ChevronUp} size={14} />
          </button>
          <button className="search-btn" title="Next match (Enter)" disabled={matches.length === 0} onClick={() => step(1)}>
            <Icon of={ChevronDown} size={14} />
          </button>
          <button className="search-btn" title="Close (Escape)" onClick={onCloseSearch}>
            <Icon of={X} size={14} />
          </button>
        </div>
      )}
      <div className="graph-header">
        <div className="col-ref">Branch / Tag</div>
        {/* absolutely positioned on the column boundary so it adds no width of its own and the
            header stays aligned with every row */}
        <div
          className="col-resize"
          role="separator"
          aria-orientation="vertical"
          title="Drag to resize the branch column, double-click to reset"
          {...refColHandle}
        />
        <div className="col-graph" style={{ width: graphWidth }}>
          Graph
        </div>
        <div className="col-msg">Commit message</div>
        {cols.author && <div className="col-author">Author</div>}
        {cols.date && <div className="col-date">Date / Time</div>}
        {cols.sha && <div className="col-sha">SHA</div>}
      </div>
      <div className="graph-body" ref={bodyRef} onScroll={(e) => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <div className="graph-rows" style={{ height: scrollRows * ROW_H }}>
          {rows}
          {loadingMore && (
            <div className="graph-row more-row" style={{ top: total * ROW_H }}>
              <span className="more-label">Loading more…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
