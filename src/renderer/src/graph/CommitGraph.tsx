import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronDown, ChevronUp, Cloud, Minus, Pencil, Pin, Plus, Search, Tag, TriangleAlert, X } from 'lucide-react';
import type { Commit, GitRef, RepoStatus } from '@shared/types';
import { layoutGraph, type RowLayout } from './lanes';
import { GraphCell, LANE_W, ROW_H, laneColor, type WipDash } from './GraphCell';
import { Icon } from '../ui/icons';
import { initialsOf } from '../ui/avatars';
// `matches` is taken by the search results in this file.
import { matches as isShortcut } from '../shortcuts';

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
}

export const WIP = 'WIP';
const OVERSCAN = 12;

// Ref column width: dragged between MIN and MAX, double-click resets to DEFAULT.
const REF_COL_KEY = 'gitclient.refColW';
const REF_COL_DEFAULT = 150;
const REF_COL_MIN = 100;
const REF_COL_MAX = 400;
/** Roughly one chip per 75px, so the default 150px keeps the two chips it has always shown. */
const chipBudget = (width: number): number => Math.max(1, Math.min(6, Math.floor(width / 75)));

const clampRefCol = (w: number): number => Math.min(REF_COL_MAX, Math.max(REF_COL_MIN, Math.round(w)));

function readRefColW(): number {
  try {
    const v = Number(localStorage.getItem(REF_COL_KEY));
    return Number.isFinite(v) && v > 0 ? clampRefCol(v) : REF_COL_DEFAULT;
  } catch {
    return REF_COL_DEFAULT;
  }
}

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

const laneFree = (row: RowLayout, lane: number): boolean =>
  row.lane !== lane && !row.through.some((s) => s.lane === lane) && !row.incoming.some((s) => s.lane === lane) && !row.outgoing.some((s) => s.lane === lane);

export function CommitGraph({ commits, refs, status, headSha, pinnedSha, pinnedName, selected, searchOpen, searchTick, searchQuery, onSearchQuery, onCloseSearch, onSelect, onCommitMenu, onWipMenu, onRefMenu, onRefActivate }: Props): JSX.Element {
  // A pinned branch owns column 0; with nothing pinned it stays reserved for HEAD's lineage.
  const layout = useMemo(() => layoutGraph(commits, pinnedSha ?? headSha), [commits, headSha, pinnedSha]);
  const refsBySha = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    for (const r of refs) {
      const list = m.get(r.sha) ?? [];
      list.push(r);
      m.set(r.sha, list);
    }
    // checked-out branch first, then tracking locals, other locals, remotes, tags
    const rank = (r: GitRef): number => (r.isHead ? 0 : r.kind === 'head' ? (r.upstream ? 1 : 2) : r.kind === 'remote' ? 3 : 4);
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return m;
  }, [refs]);

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
  const [refColW, setRefColW] = useState(readRefColW);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<{ x: number; w: number } | null>(null);
  const maxChips = chipBudget(refColW);

  const persistRefColW = useCallback((w: number): void => {
    try {
      localStorage.setItem(REF_COL_KEY, String(w));
    } catch {
      /* private mode: the width just does not survive the reload */
    }
  }, []);

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    dragRef.current = { x: e.clientX, w: refColW };
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(true);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current;
    if (!d) return;
    setRefColW(clampRefCol(d.w + (e.clientX - d.x)));
  };
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setResizing(false);
    persistRefColW(refColW);
  };
  const onResizeReset = (): void => {
    setRefColW(REF_COL_DEFAULT);
    persistRefColW(REF_COL_DEFAULT);
  };

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

  const renderChip = ({ ref: r, upstreamHere }: Chip, color: string): JSX.Element => {
    const isPinned = r.kind === 'head' && r.name === pinnedName;
    return (
    <span
      key={r.fullName}
      className={`ref-chip ${r.kind} ${r.isHead ? 'head' : ''}`}
      title={`${r.fullName}${upstreamHere ? `\nup to date with ${r.upstream}` : ''}${isPinned ? '\npinned to the left column' : ''}\nDouble-click to checkout, right-click for actions`}
      style={r.kind === 'tag' ? undefined : { background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` }}
      onContextMenu={(e) => {
        e.stopPropagation();
        onRefMenu(e, r);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRefActivate(r);
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
        <div className="col-ref">
          {chips.slice(0, maxChips).map((chip) => renderChip(chip, color))}
          {chips.length > maxChips && (
            <span className="ref-chip more" title="More refs on this commit">
              +{chips.length - maxChips}
              <span className="more-list">{chips.slice(maxChips).map((chip) => renderChip(chip, color))}</span>
            </span>
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
          {c.body && <span className="body">{c.body.split('\n')[0]}</span>}
        </div>
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
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          onDoubleClick={onResizeReset}
        />
        <div className="col-graph" style={{ width: graphWidth }}>
          Graph
        </div>
        <div className="col-msg">Commit message</div>
      </div>
      <div className="graph-body" ref={bodyRef} onScroll={(e) => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <div className="graph-rows" style={{ height: total * ROW_H }}>
          {rows}
        </div>
      </div>
    </div>
  );
}
