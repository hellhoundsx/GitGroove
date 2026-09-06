import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from 'react';
import { Archive, Check, ChevronDown, ChevronUp, Cloud, Minus, Pencil, Pin, Plus, Search, Tag, TriangleAlert, X } from 'lucide-react';
import type { Commit, GitRef, RepoStatus, Stash } from '@shared/types';
import { continuesRange, layoutGraph, wipDashFor, type GraphLayout } from './lanes';
import { GraphCell, LANE_W, ROW_H, laneColor } from './GraphCell';
import { chipsFor, headChipFor, HEAD_REF, RefChip, type Chip } from './RefChip';
import { Icon } from '../ui/icons';
import { initialsOf } from '../ui/avatars';
// `matches` is taken by the search results in this file.
import { matches as isShortcut } from '../shortcuts';
import { usePrefs } from '../prefs';
import { formatDateTime } from '../time';
import { useUi } from '../ui/UiContext';
import { fitOptCols, fitRefCol, useDragWidth, MIN_MSG_W, type OptCols } from '../ui/useDragWidth';
import { useRefDrag, type RefDragHandlers } from '../ui/refDrag';

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
  /** Marked on the commit each was taken from, with the left panel's own menu on it (GC-140). */
  stashes: Stash[];
  onStashMenu(e: MouseEvent, stash: Stash): void;
  onStashActivate(stash: Stash): void; // double-click: apply, as the left panel's row does
  /** Dragging a chip onto another branch, here or in the left panel (GC-015). */
  refDrag: RefDragHandlers;
  /** No branch is checked out: the graph marks HEAD itself, since no ref carries the check (GC-061). */
  detached: boolean;
  /** The traversal had commits behind the last one loaded, so scrolling near the end asks for more (GC-012). */
  hasMore: boolean;
  /** A page is in flight: the row at the bottom says so, and no second request is made (GC-012). */
  loadingMore: boolean;
  onLoadMore(): void;
  /**
   * Where this repository's graph was left scrolled to, restored on mount (GC-016). Read once,
   * which is all that is needed: the component is remounted per repository and again whenever a
   * file view closes over it, and those are exactly the moments the offset has to come back.
   */
  scrollTop: number;
  /** Where it is scrolled to now, so the tab it belongs to can be parked with it (GC-016). */
  onScrollTop(top: number): void;
  /**
   * Which optional columns are actually being drawn, which is `fitOptCols`' answer and not the
   * preference (GC-116). Reported so Preferences can mark a column this window has no room for
   * instead of showing it checked and absent — from this set, never a second guess at the width,
   * so the dialog and the graph cannot disagree (GC-117).
   */
  onDrawnCols(cols: OptCols): void;
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
 * The furniture a primary chip shares `.col-ref` with, mirroring `app.css` the way `OPT_COL_W`
 * mirrors the optional columns. Every one of these is `flex: none` and the chip is `flex: 0 1
 * auto`, so the chip is the one thing that gives way and what it is drawn at is the column minus
 * all of this (GC-156).
 */
const REF_COL_PAD = 3; // `.graph-row .col-ref` padding-left
const REF_COL_GAP = 4; // `.graph-row .col-ref` gap, between every adjacent pair
const MORE_CHIP_W = 26; // `.ref-chip.more`, the `+N`
const STASH_CHIP_W = 20; // `.stash-chip`
const REF_LINE_MIN = 4; // `.ref-line` min-width; it grows, but this is all the chip may count on
/**
 * How much room a primary chip is drawn at, given the column's width and what else is on the row
 * (GC-156). GC-071 had this as the constant `width - 41` — the `+N` and the line, and nothing
 * else — which was every sibling there was until GC-140 put a stash marker in the same cell. The
 * marker is 20px plus a gap and the arithmetic never saw it, so above `CHIP_CLOUD_MIN` the cloud
 * was kept and the *name* paid for the marker instead: measured at a fitted 134px column, `main`
 * was given 27px for a 29px string and rendered as `m…`.
 *
 * Pure and exported, so the measurement lives in a test rather than only in this comment. Two
 * stashes on one commit, or any future non-ref marker, are furniture on the same terms.
 */
export function chipRoom(refColW: number, more: boolean, stashes: number): number {
  const after: number[] = [];
  if (more) after.push(MORE_CHIP_W);
  for (let i = 0; i < stashes; i++) after.push(STASH_CHIP_W);
  after.push(REF_LINE_MIN);
  return refColW - after.reduce((a, b) => a + b, REF_COL_PAD) - REF_COL_GAP * after.length;
}
/**
 * Below this much room the primary chip drops its trailing upstream cloud, so the name wins over
 * the furniture around it (GC-071).
 *
 * Measured over CDP on the fixture's `main`, which carries five chips: with the cloud the chip
 * wants 71px — 12 padding, 11 check, 4 gap, 29 name, 4 gap, 11 cloud — and at the 100px minimum
 * column it was given 59, which is where `main` rendered as `ma…` (17px of a 29px name). Without
 * the cloud it wants 56. 79 is what GC-071's 120px column left a chip once the `+N` and the line
 * had taken their 41: a round number above the 71 the cloud itself needs, so the marker comes
 * back exactly when there is room for it *and* the whole name.
 *
 * Stated as the chip's own room rather than as the column's width, because those two stopped
 * being the same number the moment a row could carry a marker the row above it does not
 * (GC-156). A row with a stash on it now drops its cloud at a wider column than one without —
 * which is GC-071's rule applied to a corrected figure, not a change to it.
 *
 * The name is the identity of the ref; the cloud only repeats what the chip already implies by
 * absorbing its upstream, and the title still says it in words. So the cloud is what gives way.
 */
const CHIP_CLOUD_MIN = 79;
/**
 * The widths of the optional columns, mirroring `app.css` (GC-032). They are `flex: none`, so
 * whatever they take comes out of the commit message column: the ref column has to know about
 * them to leave the message its minimum (GC-110). Kept here rather than measured because they
 * are constants in the stylesheet, not something the user can drag.
 */
const OPT_COL_W = { author: 140, date: 150, sha: 80 };
/**
 * The ref column shows exactly one chip at every width; everything else folds into `+N`
 * (GC-078). A second chip took its space from the first, leaving the name that identifies the
 * commit truncated to a few letters, so the column's width now decides how much of the one name
 * shows, never how many chips do.
 */
const MAX_CHIPS = 1;

/* `HEAD_REF`, `headChipFor`, `Chip`, `chipsFor` and the chip markup itself moved to `RefChip.tsx`
   when the commit view started drawing the same chips (GC-087). */

/**
 * Which displayed row a selection sits on, or -1 for one that is not on screen (GC-141).
 *
 * The WIP row shifts every commit down by one, and adding that offset to a `findIndex` that
 * answered -1 gave row 0 — so a selection the loaded range does not hold scrolled the graph to
 * the WIP row instead of leaving it where it was. "Not found" is therefore settled before the
 * offset, not after it. Reachable today from a commit's parent link, and the ordinary case now
 * that a hidden branch's row in the left panel is clickable.
 */
export function rowIndexOf(commits: Commit[], selected: string | null, hasWip: boolean): number {
  if (selected === null) return -1;
  if (selected === WIP) return hasWip ? 0 : -1;
  const at = commits.findIndex((c) => c.sha === selected);
  return at < 0 ? -1 : at + (hasWip ? 1 : 0);
}

/**
 * The stashes to mark on each row, keyed by the commit they were taken from (GC-140). A stash is
 * a commit whose first parent is that commit, and `refs/stash` stays out of the log traversal
 * (GC-095), so the marker is the only thing that puts a stash on the graph at all.
 *
 * Nothing here filters against the loaded range: a stash whose parent is not on screen — hidden,
 * or past the last page — is simply never looked up, which is what makes the not-loaded case cost
 * nothing and throw nothing. Two stashes taken from one commit keep their order in the list.
 */
export function stashesByParent(stashes: Stash[]): Map<string, Stash[]> {
  const m = new Map<string, Stash[]>();
  for (const s of stashes) {
    if (!s.parent) continue; // a stash on an unborn HEAD has no parent to mark
    const list = m.get(s.parent);
    if (list) list.push(s);
    else m.set(s.parent, [s]);
  }
  return m;
}

/**
 * Client-side commit match: message, author name, author email, or a sha prefix. `q` is lowercased.
 *
 * With an author chip set the two author fields drop out (GC-027): the chip already says who wrote
 * it, so a term typed beside it is asking about the message — "commits by this person mentioning
 * X" is the one question the plain field could never express, because a name that also appears in
 * messages drowns it out.
 */
const commitMatches = (c: Commit, q: string, byAuthor = false): boolean =>
  c.sha.startsWith(q) ||
  c.summary.toLowerCase().includes(q) ||
  c.body.toLowerCase().includes(q) ||
  (!byAuthor && (c.authorName.toLowerCase().includes(q) || c.authorEmail.toLowerCase().includes(q)));

/** One entry of the author chip's list: who they are, and how many of the loaded commits are theirs. */
interface AuthorEntry {
  email: string; // lowercased; the identity the chip filters on
  name: string;
  count: number;
}

/** The authors of the loaded commits, deduplicated on the lowercased email, most commits first. */
function authorsOf(commits: Commit[]): AuthorEntry[] {
  const by = new Map<string, AuthorEntry>();
  for (const c of commits) {
    const email = c.authorEmail.toLowerCase();
    const seen = by.get(email);
    if (seen) seen.count++;
    else by.set(email, { email, name: c.authorName, count: 1 });
  }
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * The rows for the loaded range, laid out one page at a time rather than from scratch on every
 * append (GC-106). `layoutGraph` has taken a `LaneState` since GC-012, so a later page continues
 * the lanes the previous range left open; calling it that way here is what makes that true of the
 * app and not only of `lanes.test.ts`, which is where the mechanism `CLAUDE.md` describes had been
 * living. Only a strict **extension** of the range already laid out takes that path: a reload,
 * another repository, a change of pin or of the hidden set all replace `commits` wholesale, and
 * each of those falls back to laying out the whole array.
 *
 * The cache is a ref written during render, which is safe because the answer for a given
 * `(commits, pinnedSha)` is the same whichever render asks for it — StrictMode's second render
 * finds the identity it just stored and returns it untouched.
 */
function useLaneLayout(commits: Commit[], pinnedSha: string | null | undefined): GraphLayout {
  const cache = useRef<{ commits: Commit[]; pinned: string | null; layout: GraphLayout } | null>(null);
  const pin = pinnedSha ?? null;
  const prev = cache.current;
  if (prev && prev.commits === commits && prev.pinned === pin) return prev.layout;

  // The pin seeds column 0 on the first page only, so a change of pin has to start again.
  const base = prev && prev.pinned === pin ? prev.commits : null;

  let layout: GraphLayout;
  if (base !== null && continuesRange(base, commits)) {
    const page = layoutGraph(commits.slice(base!.length), pin, prev!.layout.state);
    // `page.laneCount` is carried in from the state it continues, so it is already the running
    // maximum. The old rows are reused as they are: only the array holding them is new.
    layout = { rows: prev!.layout.rows.concat(page.rows), laneCount: page.laneCount, state: page.state };
  } else {
    layout = layoutGraph(commits, pin);
  }
  cache.current = { commits, pinned: pin, layout };
  return layout;
}

export function CommitGraph({ commits, refs, status, headSha, pinnedSha, pinnedName, selected, searchOpen, searchTick, searchQuery, onSearchQuery, onCloseSearch, onSelect, onCommitMenu, onWipMenu, onRefMenu, onRefActivate, stashes, onStashMenu, onStashActivate, refDrag, detached, hasMore, loadingMore, onLoadMore, scrollTop, onScrollTop, onDrawnCols }: Props): JSX.Element {
  // The optional columns after the message; all off by default (GC-032). What the preference asks
  // for is not always what fits: `fitOptCols` below drops them once the panel is too narrow to
  // draw them and a commit message both (GC-116).
  const wantCols = usePrefs().graphColumns;
  const drag = useRefDrag(refDrag);
  // A pinned branch owns column 0; with nothing pinned it stays reserved for HEAD's lineage.
  const layout = useLaneLayout(commits, pinnedSha ?? headSha);
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

  const stashesOn = useMemo(() => stashesByParent(stashes), [stashes]);

  const graphWidth = Math.max(3, layout.laneCount) * LANE_W + 16;
  const headRowIndex = headSha ? layout.rows.findIndex((r) => r.sha === headSha) : -1;
  const headRow = headRowIndex >= 0 ? layout.rows[headRowIndex]! : null;
  const wipLane = headRow ? { lane: headRow.lane, color: headRow.color, linked: true } : { lane: 0, color: 0, linked: false };
  // Whether the lane the WIP-to-HEAD run travels in belongs to HEAD's lineage the whole way down,
  // which is what lets the run be drawn in place of the line already there (GC-144). It does when
  // nothing else is pinned: `layoutGraph` then reserves column 0 for HEAD from the first row.
  const headOwnsLane = headRow !== null && headRow.lane === 0 && (pinnedSha === null || pinnedSha === headSha);

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

  // ---- the scroll container, measured --------------------------------------
  // One observer answers two questions: how tall the viewport is, which is what virtualises the
  // rows, and how wide it is, which is what the ref column below is clamped against (GC-110).
  // `.graph-body` rather than `.graph-panel` because it is the box the rows are actually laid
  // out in — its client width already excludes the scrollbar they do not get.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const [bodyW, setBodyW] = useState(0);
  // The offset to come back to, taken once. A ref rather than the prop itself so this effect can
  // stay a mount effect: the number changes under it as the graph is scrolled, and re-running on
  // that would put the graph back where it started every time (GC-016).
  const initialTop = useRef(scrollTop);
  // Set by the restore below and read by the "keep the selected row visible" effect further down,
  // which runs in the same commit and would otherwise pull a restored position back to the
  // selected row — a tab left scrolled away from its selection came back at the selection.
  const restored = useRef(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Before the first measurement, so the rows are virtualised at the restored position rather
    // than at the top of the history and no frame is painted at the wrong one (GC-016).
    if (initialTop.current > 0) {
      el.scrollTop = initialTop.current;
      restored.current = true;
    }
    const update = (): void => {
      setViewport({ top: el.scrollTop, height: el.clientHeight });
      setBodyW(el.clientWidth);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- ref column width ---------------------------------------------------
  // Everything a row spends outside the ref and message columns: the lanes, plus any optional
  // column that is on. What is left over after `MIN_MSG_W` is as far as the column may be
  // dragged; `fitRefCol` is what a window or panel narrowing under a width already stored does,
  // and it leaves that stored width alone so widening brings it straight back.
  // Which optional columns fit is decided first, against the ref column's floor, and the ref
  // column is then fitted against the ones that survived (GC-116).
  const cols = useMemo(() => fitOptCols(wantCols, bodyW, graphWidth, REF_COL_MIN, OPT_COL_W), [wantCols, bodyW, graphWidth]);
  // The one set every render site here reads, handed up so Preferences marks from it too (GC-117).
  useEffect(() => onDrawnCols(cols), [cols, onDrawnCols]);
  const restW = graphWidth + (cols.author ? OPT_COL_W.author : 0) + (cols.date ? OPT_COL_W.date : 0) + (cols.sha ? OPT_COL_W.sha : 0);
  const { width: refColW, resizing, handle: refColHandle } = useDragWidth({
    key: REF_COL_KEY,
    def: REF_COL_DEFAULT,
    min: REF_COL_MIN,
    max: REF_COL_MAX,
    limit: bodyW > 0 ? bodyW - restW - MIN_MSG_W : undefined,
  });
  const refColApplied = fitRefCol(refColW, bodyW, restW, REF_COL_MIN);

  // ---- search -------------------------------------------------------------
  const searchInput = useRef<HTMLInputElement>(null);
  const needle = searchOpen ? searchQuery.trim().toLowerCase() : '';

  // The author chip (GC-027). It is this component's own state rather than `App`'s, unlike the
  // query: a file view unmounts the graph and takes the chip with it, which is the same reset a
  // closed search bar gives the query and is what the study's chips do on close.
  const [author, setAuthor] = useState<string | null>(null);
  const authors = useMemo(() => authorsOf(commits), [commits]);
  const authorName = author === null ? null : (authors.find((a) => a.email === author)?.name ?? author);
  // Both halves must hold: the chip narrows to one author, the term then matches message and sha
  // within that. With neither set nothing is filtered and the readout goes back to "N commits".
  const filtering = needle !== '' || author !== null;
  const matches = useMemo(
    () =>
      !filtering
        ? []
        : commits.filter((c) => (author === null || c.authorEmail.toLowerCase() === author) && (needle === '' || commitMatches(c, needle, author !== null))).map((c) => c.sha),
    [commits, needle, author, filtering],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const ui = useUi();
  const openAuthors = useCallback(
    (e: MouseEvent): void => {
      const r = e.currentTarget.getBoundingClientRect();
      ui.openMenu({ clientX: r.left, clientY: r.bottom, owner: e.currentTarget }, [
        { label: 'Any author', onClick: () => setAuthor(null), disabled: author === null },
        { separator: true },
        ...authors.map((a) => ({ label: a.name, hint: `${a.count}`, onClick: () => setAuthor(a.email), disabled: a.email === author })),
      ]);
    },
    [ui, authors, author],
  );

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
  // query leaves the selection where the user left it (GC-030). The author chip is part of the
  // query for this purpose: choosing one is a new search, not a narrowing of the old position.
  const lastNeedle = useRef(`${author ?? ''} ${needle}`);
  useEffect(() => {
    const key = `${author ?? ''} ${needle}`;
    if (lastNeedle.current === key) return;
    lastNeedle.current = key;
    if (matches.length > 0) onSelect(matches[0]!);
  }, [needle, author, matches, onSelect]);

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
    // A restored position is the one being asked for, so it survives this pass: the selection was
    // made before the tab was left and is not what moved (GC-016).
    if (restored.current) {
      restored.current = false;
      return;
    }
    const index = rowIndexOf(commits, selected, hasWip);
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

  const renderChip = ({ ref: r, upstreamHere }: Chip, color: string, room: number, commit?: Commit, plain?: boolean): JSX.Element => {
    const isPinned = r.kind === 'head' && r.name === pinnedName;
    // The synthetic HEAD chip is no ref: there is nothing to check out and nothing for the ref
    // menu to act on, so it opens the commit menu instead — "Create branch here…" being what a
    // detached user usually wants (GC-061).
    const synthetic = r.fullName === HEAD_REF;
    // The synthetic chip stands for no ref, so it is neither a drag source nor a drop target: the
    // whole gesture is defined on the branch `GitRef` behind a chip (GC-015).
    const dragAttrs = synthetic ? null : drag.attrs(r);
    return (
      <RefChip
        key={r.fullName}
        chip={{ ref: r, upstreamHere }}
        color={color}
        pinned={isPinned}
        plain={plain}
        // With little room the name wins over the marker (GC-071), and how much room there is
        // depends on what else is on this row, not on the column alone (GC-156). The expanded
        // `+N` block is not bound by the column's width, so a chip in it keeps the cloud whatever
        // the column is.
        upstreamMark={plain === true || room >= CHIP_CLOUD_MIN}
        dragAttrs={dragAttrs}
        className={`${!synthetic && drag.isSource(r) ? 'drag-src' : ''} ${!synthetic && drag.isOver(r) ? 'drop-over' : ''}`}
        title={synthetic ? 'Detached HEAD\nRight-click for actions on this commit' : `${r.fullName}${upstreamHere ? `\nup to date with ${r.upstream}` : ''}${isPinned ? '\npinned to the left column' : ''}\nDouble-click to checkout, right-click for actions${dragAttrs?.draggable ? '\nDrag onto another branch to merge or rebase' : ''}`}
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
      />
    );
  };

  /**
   * A stash on the commit it was taken from (GC-140). Deliberately not a `.ref-chip`: it stands
   * for no `GitRef`, so none of the chip rules — the drag attributes, the grow-to-full-name
   * hover, the fold — may reach it, and it is `flex: none` so it keeps its place while the chip
   * beside it gives way. Same two gestures as the left panel's stash row, from the same menu.
   */
  const renderStash = (s: Stash): JSX.Element => (
    <span
      key={s.sha}
      className="stash-chip"
      title={`stash@{${s.index}}: ${s.message}\nDouble-click to apply, right-click for actions`}
      onContextMenu={(e) => {
        e.stopPropagation();
        onStashMenu(e, s);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStashActivate(s);
      }}
    >
      <Icon of={Archive} size={11} />
    </span>
  );

  const renderRow = (index: number): JSX.Element | null => {
    const style = { top: index * ROW_H };
    if (hasWip && index === 0) {
      return (
        <div key="wip" className={`graph-row wip ${selected === WIP ? 'selected' : ''} ${filtering ? 'unmatched' : ''}`} style={style} onClick={() => onSelect(WIP)} onContextMenu={onWipMenu}>
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
    const rowStashes = stashesOn.get(c.sha) ?? [];
    // What the one chip in the row is actually drawn at: the column less every sibling beside it,
    // the stash markers included (GC-156).
    const room = chipRoom(refColApplied, chips.length > MAX_CHIPS, rowStashes.length);
    // The line out of the ref column and the connector into the node are the same join, so a row
    // carrying only a stash marker gets both rather than a marker floating on its own (GC-140).
    const joined = rowRefs.length > 0 || rowStashes.length > 0;
    const color = laneColor(row.color);
    const wipDash = hasWip && headRow ? wipDashFor(row, i, headRowIndex, headRow.lane, headOwnsLane) : null;
    return (
      <div key={c.sha} className={`graph-row ${selected === c.sha ? 'selected' : ''} ${!filtering ? '' : matchSet.has(c.sha) ? 'match' : 'unmatched'}`} style={style} onClick={() => onSelect(c.sha)} onContextMenu={(e) => onCommitMenu(e, c)}>
        <div className="col-ref" onMouseEnter={(e) => onMoreEnter(e, c.sha)} onMouseLeave={() => setMoreUp(null)}>
          {chips.slice(0, MAX_CHIPS).map((chip) => renderChip(chip, color, room, c))}
          {chips.length > MAX_CHIPS && (
            // Not a popover, and not something to go and find: hovering the refs grows them. The
            // block starts on the chip that was showing, in the same colour, and each further ref
            // is one more line of it, so the +N is only ever a resting state — it hides the moment
            // the block takes its place (asked for by Ricardo). It is a sibling of the block, not
            // its parent, so hiding it leaves the block on screen and its rect still measurable.
            <>
              {/* no title: the chip is `visibility: hidden` from the moment the cell is hovered, which
                  is the moment a tooltip would begin its delay, so it could never be shown (GC-085).
                  The block that replaces it names every folded ref outright, which is more than a
                  tooltip would have said. */}
              <span className="ref-chip more">
                +{chips.length - MAX_CHIPS}
              </span>
              <span className={`more-list ${moreUp === c.sha ? 'flip-up' : ''}`} style={{ background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` }}>
                {chips.map((chip) => renderChip(chip, color, room, c, true))}
              </span>
            </>
          )}
          {/* after the chips and outside the fold: a stash is not a ref, so it never spends the
              row's one chip slot and never changes the `+N` count (GC-140) */}
          {rowStashes.map(renderStash)}
          {joined && <span className="ref-line" style={{ background: color }} />}
        </div>
        <div className="col-graph" style={{ width: graphWidth }}>
          <GraphCell
            row={row}
            width={graphWidth}
            wipDash={wipDash}
            wipDashLane={wipDash === 'through' ? headRow!.lane : undefined}
            connector={joined}
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
            {formatDateTime(c.authorDate)}
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
    <div className={`graph-panel ${resizing ? 'resizing' : ''}`} style={{ '--ref-col-w': `${refColApplied}px` } as CSSProperties}>
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
          {/* the author filter chip (GC-027): a dropdown while empty, a name with an x once set */}
          <div className={`search-author ${author === null ? '' : 'set'}`}>
            <button className="author-btn" title="Filter by author" onClick={openAuthors}>
              <span className="author-name">{authorName ?? 'Author'}</span>
              <Icon of={ChevronDown} size={12} />
            </button>
            {author !== null && (
              <button className="author-clear" title="Clear the author filter" onClick={() => setAuthor(null)}>
                <Icon of={X} size={12} />
              </button>
            )}
          </div>
          <span className="search-count">{!filtering ? `${commits.length} commits` : matches.length === 0 ? 'no matches' : at >= 0 ? `${at + 1} of ${matches.length}` : `${matches.length} matches`}</span>
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
      <div
        className="graph-body"
        ref={bodyRef}
        onScroll={(e) => {
          const top = e.currentTarget.scrollTop;
          setViewport({ top, height: e.currentTarget.clientHeight });
          // Programmatic scrolling raises this event too, so the keyboard's own "keep the selected
          // row visible" moves are reported as well as the wheel (GC-016).
          onScrollTop(top);
        }}
      >
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
