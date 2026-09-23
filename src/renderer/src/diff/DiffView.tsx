import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { Commit, FileChangeKind } from '@shared/types';
import { alignHunks, buildHunkPatch, buildLinePatch, hunkWordSpans, parseUnifiedDiff, splitHunkHeader, type DiffHunk, type DiffLine, type FileDiff, type WordSpan } from './parseDiff';
import { hunkSyntax, languageFor, mergeMarks, type SynToken } from './highlight';
import { IconChevronDown as ChevronDown, IconChevronUp as ChevronUp, IconPilcrow as Pilcrow, IconTextWrap as WrapText, IconX as X } from '@tabler/icons-react';
import { formatDateTime, relativeTime } from '../time';
import { FileKindIcon, Icon } from '../ui/icons';
import { useUi } from '../ui/UiContext';
import { setPrefs, usePrefs, type DiffViewMode } from '../prefs';

const VIEW_MODES: { mode: DiffViewMode; label: string; title: string }[] = [
  { mode: 'unified', label: 'Unified', title: 'One column: removals and additions in file order' },
  { mode: 'split', label: 'Split', title: 'Side by side: the old file left, the new file right' },
];

const BODY_MODES: { mode: 'diff' | 'history'; label: string; title: string }[] = [
  { mode: 'diff', label: 'Diff', title: 'What this commit changed in the file' },
  { mode: 'history', label: 'History', title: 'Every commit that touched this file, following renames' },
];

/** Why a diff control is off while the History list is showing — GC-188's rule, said once. */
const HISTORY_OFF = 'Not available in History: this is a list of commits, not a diff';

/** Which tint a split cell takes. An empty side is padding, not an unchanged line. */
const sideClass = (line: DiffLine | null): string => (line === null ? 'pad' : line.type);

/**
 * Which parent a combined diff's line came from (GC-180). The marker columns say it exactly: a
 * line only the first parent has is `' +'`, only the second `'+ '`, and one neither has — the
 * conflict markers git wrote into the working tree, and any line the merge itself produced — is
 * `'++'`. The class is a coloured edge on the code cell, so the two sides read apart at a glance
 * while the file's own `<<<<<<<` markers still say which is which in words.
 */
const combinedClass = (line: DiffLine): string => {
  const m = line.combined;
  if (m === undefined || m.length !== 2) return '';
  if (m === ' +') return ' p1';
  if (m === '+ ') return ' p2';
  return '';
};

const combinedTitle = (line: DiffLine): string | undefined => {
  const c = combinedClass(line);
  if (c === ' p1') return 'Only in the first parent (HEAD)';
  if (c === ' p2') return 'Only in the second parent (the branch being merged)';
  return undefined;
};

/**
 * One line's text, coloured by its syntax and with the part of it that actually changed marked
 * (GC-104). Both layouts render through this, from the same two maps, so a line cannot be drawn one
 * way in one of them and another way in the other. A line with no entry in either — a meta line, a
 * file with no language, two lines with nothing in common — is the plain text it always was.
 */
function code(line: DiffLine, spans: Map<DiffLine, WordSpan[]>, syntax: Map<DiffLine, SynToken[]>): JSX.Element {
  const marked = spans.get(line);
  const tokens = syntax.get(line);
  if (!marked && !tokens) return <pre>{line.text}</pre>;
  return (
    <pre>
      {mergeMarks(line.text, tokens, marked).map((m, i) => {
        const cls = [m.kind && `syn-${m.kind}`, m.changed && 'word'].filter(Boolean).join(' ');
        return (
          <span className={cls || undefined} key={i}>
            {m.text}
          </span>
        );
      })}
    </pre>
  );
}

/** Diff, or the list of commits that touched this path (GC-166). A mode of the one file view. */
export type FileViewMode = 'diff' | 'history';

type FileViewOf =
  | { source: 'commit'; sha: string; path: string; kind: FileChangeKind }
  /**
   * The same file at the same sha, read against the working directory rather than against the
   * commit's parent (GC-152). A **separate source** and not a flag on the one above, so it is part
   * of the view identity: the two are different content under the same path and sha, and a diff is
   * keyed to its identity precisely so one can never render under the other's header (GC-075).
   */
  | { source: 'compare'; sha: string; path: string; kind: FileChangeKind }
  | { source: 'wip'; path: string; staged: boolean; kind: FileChangeKind };

/**
 * `history` opens the view straight into the History list, so `fileMenuItems` is a way in as well
 * as the header (GC-166). It is deliberately *not* part of `identityKey` below — it says which of
 * this file's two bodies is showing, not which content is loaded — so opening History and going
 * back to the diff reloads nothing, the way `Unified | Split` does not (GC-014).
 */
export type FileViewSource = FileViewOf & { history?: boolean };

interface Props {
  repo: string;
  view: FileViewSource;
  /** Bumped by the parent whenever the working directory changed, so WIP diffs reload. */
  version: number;
  onClose(): void;
  onStageFile(path: string): Promise<void>;
  onUnstageFile(path: string): Promise<void>;
  onDiscardFile(path: string, untracked: boolean): Promise<void>;
  onApplyPatch(patch: string, opts: { cached?: boolean; reverse?: boolean }): Promise<void>;
  /** Show this file at a commit the History list supplied (GC-166): the parent re-aims the view. */
  onOpenCommit(sha: string): void;
}

/**
 * Which stop the hunk arrows go to, given every header's stop, where the body is scrolled to now,
 * and a direction (GC-138). Null when there is nowhere to go, which is a file with no hunks.
 *
 * Pure, because it is arithmetic and it got two answers wrong before it was right — both of them
 * found by a throwaway script rather than by anything that would have failed again:
 *
 * - the header at the top is the *current* hunk, not the next one. `stops` are compared against
 *   the scroll position with a pixel of tolerance, because the body has top padding and the first
 *   header therefore sits a few pixels down when nothing is scrolled at all. Read as being below
 *   the top, it made the very first Next click go nowhere.
 * - at the bottom, every remaining header shares one clamped stop, so `next` finds none strictly
 *   past it. That is what the wrap-around is for, and it is why the caller clamps the stops before
 *   handing them over: without the clamp there is always a further stop, and Next crawls through
 *   hunks that are all already on screen.
 */
export function nextHunkStop(stops: number[], at: number, dir: 'next' | 'prev'): number | null {
  if (stops.length === 0) return null;
  const i = dir === 'next' ? stops.findIndex((s) => s > at + 1) : stops.map((s) => s < at - 1).lastIndexOf(true);
  const target = i >= 0 ? i : dir === 'next' ? 0 : stops.length - 1;
  return stops[target]!;
}

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/');
  return i >= 0 ? [path.slice(0, i + 1), path.slice(i + 1)] : ['', path];
}

export function DiffView({ repo, view, version, onClose, onStageFile, onUnstageFile, onDiscardFile, onApplyPatch, onOpenCommit }: Props): JSX.Element {
  const ui = useUi();
  const prefs = usePrefs();
  const split = prefs.diffView === 'split';
  // The two header toggles (GC-052). Wrap is a class on the body and costs no reload; ignoring
  // whitespace is `-w` on the diff itself, so it goes into the load key below.
  const wrap = prefs.diffWordWrap;
  const ignoreWs = prefs.diffIgnoreWhitespace;
  const bodyRef = useRef<HTMLDivElement>(null);
  // (GC-075) What was loaded, and which view it was loaded for. The header chip and the hunk
  // buttons come straight from `view` and flip the instant it changes, so a diff kept from the
  // previous view would be on screen under a header claiming the other side of the file, and a
  // hunk button would build its patch against an index git has already moved on from. Tying the
  // result to its own view and comparing during render, rather than clearing it from the effect,
  // is what makes that impossible: an effect runs after React has committed the new `view`, which
  // leaves one painted frame with the new header over the old hunks and the buttons still live.
  //
  // (GC-086) The key is in two parts. The *identity* is the view itself; the full key adds
  // `version`, which every status reload bumps. Content is kept while the identity holds, because a
  // reload of the same file on the same side is a refresh of what is already on screen — keying the
  // body on the version too made a Stage hunk click blank the diff to "Loading diff…" twice, once
  // for the action's own reload and once for the watcher's echo of the index write. What GC-075
  // needs is that no button is live over content whose load is not the newest, and `stale` says
  // exactly that: a pending reload disables every action without emptying the body.
  const identityKey = `${repo}|${view.source}|${view.path}|${view.source === 'wip' ? `${view.staged}|${view.kind ?? ''}` : view.sha}`;
  // `ignoreWs` belongs to the key and not to the identity (GC-052): it is the same file on the
  // same side, so the hunks on screen stay and dim while the reload runs, exactly as a watcher
  // echo does, rather than the body blanking to "Loading diff…" (GC-086).
  const viewKey = `${identityKey}|${version}|${ignoreWs}`;
  const [loaded, setLoaded] = useState<{ key: string; identity: string; text: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  /** What a Stage/Unstage/Discard click reported, as opposed to what the load did. */
  const [actionError, setActionError] = useState<string | null>(null);
  // (GC-121) The lines picked out of one hunk. It carries the `viewKey` it was made against and is
  // compared during render like everything else here, rather than being cleared from an effect: a
  // selection holds `DiffLine` objects from one parse, so the moment the identity or the version
  // moves those objects are gone and the count beside them would be describing nothing. One hunk
  // at a time, because a patch is built from one hunk's header.
  const [sel, setSel] = useState<{ key: string; hunk: number; lines: Set<DiffLine>; anchor: DiffLine } | null>(null);
  const current = loaded?.identity === identityKey ? loaded : null;
  const text = current?.text ?? null;
  const error = current?.error ?? actionError;
  const loading = current === null;
  // A load that rejected: the body has nothing to render and none of the three branches below
  // match, so without this the panel is simply blank (GC-083). An action error is not this —
  // it leaves the diff on screen and only the sub-header reports it.
  const loadError = current !== null && current.text === null ? current.error : null;
  /** Content for this view is on screen, but a newer load of it has not landed yet. */
  const stale = current !== null && current.key !== viewKey;

  useEffect(() => {
    let cancelled = false;
    setActionError(null);
    const load =
      view.source === 'commit'
        ? window.api.getCommitFileDiff(repo, view.sha, view.path, { ignoreWhitespace: ignoreWs })
        : view.source === 'compare'
          ? window.api.getCompareFileDiff(repo, view.sha, view.path, { ignoreWhitespace: ignoreWs })
          : window.api.getWorkdirFileDiff(repo, { path: view.path, staged: view.staged, untracked: view.kind === 'untracked', ignoreWhitespace: ignoreWs });
    load.then(
      (t) => !cancelled && setLoaded({ key: viewKey, identity: identityKey, text: t, error: null }),
      // A failure is stored against the same key, so the file buttons come back rather than staying
      // disabled on a view that will never resolve.
      (e) => !cancelled && setLoaded({ key: viewKey, identity: identityKey, text: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [repo, view, version, viewKey, identityKey, ignoreWs]);

  // (GC-166) Which body is showing. Carried with the identity it was chosen for and compared
  // during render, the way `sel` and `loaded` are: opening another file is a different question,
  // so it goes back to the diff unless the caller asked for History outright. The diff's own load
  // is untouched by it — that is what makes switching back cost nothing.
  const [nav, setNav] = useState<{ identity: string; mode: FileViewMode } | null>(null);
  const mode: FileViewMode = (nav?.identity === identityKey ? nav.mode : undefined) ?? (view.history ? 'history' : 'diff');
  const inHistory = mode === 'history';
  // The history is the file's, not the view's: it is keyed by path alone, so picking a commit from
  // the list and coming back finds the same list rather than fetching it again.
  const historyKey = `${repo}|${view.path}`;
  const [hist, setHist] = useState<{ key: string; commits: Commit[] | null; error: string | null } | null>(null);
  const history = hist?.key === historyKey ? hist : null;

  useEffect(() => {
    if (!inHistory || history !== null) return;
    let cancelled = false;
    window.api.getFileLog(repo, view.path).then(
      (cs) => !cancelled && setHist({ key: historyKey, commits: cs, error: null }),
      (e) => !cancelled && setHist({ key: historyKey, commits: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      cancelled = true;
    };
  }, [inHistory, history, historyKey, repo, view.path]);

  const files = useMemo(() => (text === null ? [] : parseUnifiedDiff(text)), [text]);
  const file: FileDiff | undefined = files[0];
  // Computed once per parsed file rather than per row, and keyed by the line object both layouts
  // hold, so switching layout re-renders the same marks without re-diffing anything (GC-104).
  const wordSpans = useMemo(() => {
    const all = new Map<DiffLine, WordSpan[]>();
    for (const h of file?.hunks ?? []) for (const [line, spans] of hunkWordSpans(h)) all.set(line, spans);
    return all;
  }, [file]);
  // Syntax colour, from the path's language, once per parsed file and keyed the same way. A
  // combined diff is a report about a merge with one marker column per parent, so it stays plain.
  const syntax = useMemo(() => {
    const all = new Map<DiffLine, SynToken[]>();
    const lang = languageFor(view.path);
    if (!lang || !file || file.combined) return all;
    for (const h of file.hunks) for (const [line, tokens] of hunkSyntax(h, lang)) all.set(line, tokens);
    return all;
  }, [file, view.path]);
  const hunkCount = file?.binary ? 0 : (file?.hunks.length ?? 0);
  const [dir, name] = splitPath(view.path);
  const isWip = view.source === 'wip';
  const untracked = view.kind === 'untracked';
  const conflicted = view.kind === 'conflicted';
  // A payload nothing here understands parses to a file with no hunks, and `file.hunks.map` then
  // draws a void under a header that still claims a file (GC-180). It takes the same `.diff-empty`
  // treatment as no file at all: this is the guard, not the fix.
  const empty = file !== undefined && !file.binary && file.hunks.length === 0;
  // Every action is aimed at what is on screen, so a load in flight disables them exactly like a
  // running one does: the header already claims the new side of the file (GC-075), and a stale
  // body is content the newest load has not confirmed yet (GC-086).
  const actionsDisabled = busy || loading || stale;

  // A `-w` diff is not a patch git can apply: the lines it left out are still in the file, so
  // `git apply` rejects it. Every button built from `hunk.raw` is therefore off while the
  // toggle is on, and says why; the file-level actions do not go through a patch and stay live.
  // A combined diff is off for the same reason (GC-180): its lines carry one column per parent,
  // which is a report about a merge rather than anything `git apply` will take.
  const isCombined = file?.combined === true;
  // A comparison against the working directory is the third (GC-152): `git diff <sha>` describes a
  // distance the index has no part in, so it is not a patch git will take against it in either
  // direction, and nothing about a commit's contents can be staged or discarded anyway.
  const isCompare = view.source === 'compare';
  // What the body is actually drawn as, which on a combined diff is not what the preference asks
  // for: a split row is one line of each file and a combined line belongs to neither side, so a
  // combined diff is one column whatever `prefs.diffView` says (GC-180). The switch below reads
  // this rather than the preference — GC-117's rule, that a control never shows a setting which is
  // not what is on screen, one component over (GC-188). The preference itself is untouched, so the
  // next ordinary file opens in the layout the user chose.
  const drawSplit = split && !isCombined;
  const hunksDisabled = actionsDisabled || ignoreWs || isCombined || isCompare;
  const hunkTitle = ignoreWs
    ? 'Not available while whitespace is ignored: the patch would not apply'
    : isCombined
      ? 'Not available on a conflicted file: a combined diff is not a patch git can apply'
      : isCompare
        ? 'Not available in a comparison: this is a commit against your working directory, not a patch'
        : undefined;

  // Lines are picked on the unstaged side only: unstaging a line is the reverse patch and its own
  // ticket (GC-121, out of scope), and a commit's diff stages nothing at all.
  const canSelect = isWip && view.source === 'wip' && !view.staged && !ignoreWs && !isCombined;
  const selection = sel !== null && sel.key === viewKey ? sel : null;
  const pickedIn = (hi: number): Set<DiffLine> | null => (selection && selection.hunk === hi && selection.lines.size > 0 ? selection.lines : null);

  /**
   * Click a changed line to take it, click it again to drop it, shift-click to take the run from
   * the anchor (GC-121). The run is over the hunk's *changed* lines, so extending across a context
   * line picks the changed ones either side of it and not the context itself, which no patch of
   * this kind can carry. Clicking into another hunk starts a new selection there.
   */
  const clickLine = (hi: number, hunk: DiffHunk, line: DiffLine, shift: boolean): void => {
    if (!canSelect || (line.type !== 'add' && line.type !== 'del')) return;
    const fresh = { key: viewKey, hunk: hi, lines: new Set([line]), anchor: line };
    setSel((prev) => {
      const cur = prev !== null && prev.key === viewKey && prev.hunk === hi ? prev : null;
      if (!cur) return fresh;
      if (shift) {
        const changed = hunk.lines.filter((l) => l.type === 'add' || l.type === 'del');
        const from = changed.indexOf(cur.anchor);
        const to = changed.indexOf(line);
        if (from < 0 || to < 0) return fresh;
        const [lo, hi2] = from <= to ? [from, to] : [to, from];
        return { key: viewKey, hunk: hi, lines: new Set(changed.slice(lo, hi2 + 1)), anchor: cur.anchor };
      }
      const lines = new Set(cur.lines);
      if (lines.has(line)) lines.delete(line);
      else lines.add(line);
      // An empty selection is no selection: the buttons go back to the whole-hunk wording.
      return lines.size === 0 ? null : { key: viewKey, hunk: hi, lines, anchor: line };
    });
  };

  /** The click props a selectable line carries, and nothing at all when selection is off. */
  const lineProps = (hi: number, hunk: DiffHunk, line: DiffLine | null): { onClick?: (e: { shiftKey: boolean }) => void } => {
    if (!canSelect || !line || (line.type !== 'add' && line.type !== 'del')) return {};
    return { onClick: (e) => clickLine(hi, hunk, line, e.shiftKey) };
  };
  const selClass = (hi: number, line: DiffLine | null): string => (line && pickedIn(hi)?.has(line) ? ' sel' : '');
  const pickable = (line: DiffLine | null): string => (canSelect && line && (line.type === 'add' || line.type === 'del') ? ' pickable' : '');

  /**
   * Scroll to the hunk before or after the one at the top of the body, wrapping at either end.
   * The position is read off the live rects rather than kept in state: the body scrolls freely
   * with the wheel between two clicks, and a remembered index would then jump somewhere else.
   *
   * This is the measuring only — the rects, the padding and the clamp. Which stop to go to is
   * `nextHunkStop` (GC-138).
   */
  const gotoHunk = (where: 'next' | 'prev'): void => {
    const body = bodyRef.current;
    if (!body) return;
    const heads = [...body.querySelectorAll<HTMLElement>('.hunk-head')];
    if (heads.length === 0) return;
    const contentTop = body.getBoundingClientRect().top + parseFloat(getComputedStyle(body).paddingTop || '0');
    // Clamped to what the body can actually scroll to: the last hunks all share the bottom
    // position, so at the bottom there is no next one to reach and the wrap-around is what is left.
    const maxScroll = body.scrollHeight - body.clientHeight;
    const stops = heads.map((h) => Math.min(body.scrollTop + h.getBoundingClientRect().top - contentTop, maxScroll));
    const to = nextHunkStop(stops, body.scrollTop, where);
    // The browser clamps a stop past the end, which is the right answer for the last hunks.
    if (to !== null) body.scrollTop = to;
  };

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const hunkAction = (hunk: DiffHunk, hi: number): JSX.Element | null => {
    if (!isWip || !file) return null;
    if (view.source === 'wip' && view.staged) {
      const patch = buildHunkPatch(file, hunk);
      return (
        <button className="btn" disabled={hunksDisabled} title={hunkTitle} onClick={() => void run(() => onApplyPatch(patch, { cached: true, reverse: true }))}>
          Unstage hunk
        </button>
      );
    }
    // With lines picked out of this hunk the buttons act on exactly those and say so; with none
    // they are the whole-hunk buttons they have always been (GC-121).
    const picked = pickedIn(hi);
    // Two patches, not one: staging goes to the index and discarding is reversed onto the working
    // tree, and the unselected lines have to be written for whichever file the patch must fit
    // (GC-121). With nothing picked both are the whole hunk, exactly as they were.
    const patch = picked ? buildLinePatch(file, hunk, picked) : buildHunkPatch(file, hunk);
    const undoPatch = picked ? buildLinePatch(file, hunk, picked, { reverse: true }) : patch;
    const what = picked ? `${picked.size} line${picked.size === 1 ? '' : 's'}` : 'hunk';
    return (
      <>
        <button className="btn success" disabled={hunksDisabled} title={hunkTitle} onClick={() => void run(() => onApplyPatch(patch, { cached: true }))}>
          Stage {what}
        </button>
        {!untracked && (
          <button
            className="btn danger"
            disabled={hunksDisabled}
            title={hunkTitle}
            onClick={() =>
              void ui
                .confirm({
                  title: picked ? `Discard ${what} from ${name}?` : `Discard this hunk from ${name}?`,
                  message: `Discard ${picked ? `${what} of this hunk` : 'this hunk'} from the working directory? This cannot be undone.`,
                  okLabel: `Discard ${what}`,
                  danger: true,
                })
                .then((ok) => void (ok && run(() => onApplyPatch(undoPatch, { reverse: true }))))
            }
          >
            Discard {what}
          </button>
        )}
      </>
    );
  };

  return (
    <div className="file-view">
      <div className="file-view-head">
        <FileKindIcon kind={view.kind} size={14} />
        <span className="path">
          <span className="dir">
            <span>{dir}</span>
          </span>
          <span className="name">{name}</span>
        </span>
        {file && !file.binary && (
          <span className="stats">
            <span className="kind-added">+{file.adds}</span> <span className="kind-deleted">−{file.dels}</span>
          </span>
        )}
        <span className="spacer" />
        {/* Previous / next change, then the two toggles (GC-052). The arrows are disabled with
            one hunk or none, where there is nothing to move between. */}
        <button className="icon-btn hunk-nav" title={inHistory ? HISTORY_OFF : 'Previous change'} aria-label="Previous change" disabled={inHistory || hunkCount < 2} onClick={() => gotoHunk('prev')}>
          <Icon of={ChevronUp} size={14} />
        </button>
        <button className="icon-btn hunk-nav" title={inHistory ? HISTORY_OFF : 'Next change'} aria-label="Next change" disabled={inHistory || hunkCount < 2} onClick={() => gotoHunk('next')}>
          <Icon of={ChevronDown} size={14} />
        </button>
        <button
          className={`seg-btn toggle${ignoreWs ? ' on' : ''}`}
          title={inHistory ? HISTORY_OFF : 'Ignore whitespace: diff with -w, so a reindent shows no change'}
          aria-label="Ignore whitespace"
          aria-pressed={ignoreWs}
          disabled={inHistory}
          onClick={() => setPrefs({ diffIgnoreWhitespace: !ignoreWs })}
        >
          <Icon of={Pilcrow} size={13} />
        </button>
        <button
          className={`seg-btn toggle${wrap ? ' on' : ''}`}
          title={inHistory ? HISTORY_OFF : 'Wrap long lines instead of scrolling sideways'}
          aria-label="Wrap"
          aria-pressed={wrap}
          disabled={inHistory}
          onClick={() => setPrefs({ diffWordWrap: !wrap })}
        >
          <Icon of={WrapText} size={13} />
        </button>
        {/* The layout of what is already loaded, so flipping it costs no reload and never disables
            an action: `hunk.raw` is what a Stage/Discard patch is built from, and alignment does not
            touch it (GC-014). */}
        {/* Where `04-panels.md` puts it: the file view's own header, beside the layout switch, so
            History costs no new window, no new layer and no new Escape case (GC-166). */}
        <div className="seg" role="group" aria-label="File view mode">
          {BODY_MODES.map((m) => (
            <button
              key={m.mode}
              className={`seg-btn${mode === m.mode ? ' on' : ''}`}
              title={m.title}
              aria-pressed={mode === m.mode}
              onClick={() => setNav({ identity: identityKey, mode: m.mode })}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="seg diff-layout" role="group" aria-label="Diff layout">
          {VIEW_MODES.map((m) => {
            const isSplit = m.mode === 'split';
            // Disabled rather than absent, and with the reason on it: the layout it cannot express
            // is a property of this file, not of the app (GC-188).
            const unavailable = isCombined && isSplit;
            return (
              <button
                key={m.mode}
                className={`seg-btn${drawSplit === isSplit ? ' on' : ''}`}
                title={inHistory ? HISTORY_OFF : unavailable ? 'Not available on a conflicted file: a combined diff has a column per parent, which no side-by-side layout can show' : m.title}
                aria-pressed={drawSplit === isSplit}
                disabled={inHistory || unavailable}
                onClick={() => setPrefs({ diffView: m.mode })}
              >
                {m.label}
              </button>
            );
          })}
        </div>
        {isWip && view.source === 'wip' && !view.staged && (
          <>
            {/* The header follows the rule the row's own menu already applies to a conflicted file
                (GC-180): staging one is marking it resolved, and discarding is not offered at all,
                because git refuses `checkout --` on an unmerged path. */}
            <button className="btn success" disabled={actionsDisabled} onClick={() => void run(() => onStageFile(view.path))}>
              {conflicted ? 'Mark resolved' : 'Stage file'}
            </button>
            {!conflicted && (
            <button
              className="btn danger"
              disabled={actionsDisabled}
              onClick={() =>
                void ui
                  .confirm(
                    untracked
                      ? { title: `Delete ${name}?`, message: `Delete ${view.path}? This cannot be undone.`, okLabel: 'Delete file', danger: true }
                      : { title: `Discard changes to ${name}?`, message: `Discard all changes to ${view.path}? This cannot be undone.`, okLabel: 'Discard changes', danger: true },
                  )
                  .then((ok) => void (ok && run(() => onDiscardFile(view.path, untracked))))
              }
            >
              {untracked ? 'Delete file' : 'Discard changes'}
            </button>
            )}
          </>
        )}
        {isWip && view.source === 'wip' && view.staged && (
          <button className="btn" disabled={actionsDisabled} onClick={() => void run(() => onUnstageFile(view.path))}>
            Unstage file
          </button>
        )}
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon of={X} size={14} />
        </button>
      </div>
      <div className="file-view-sub">
        <span className="chip">
          {view.source === 'commit' ? `commit ${view.sha.slice(0, 7)}` : view.source === 'compare' ? `${view.sha.slice(0, 7)} ↔ working directory` : view.staged ? 'Staged' : 'Unstaged'}
        </span>
        {/* Why nothing here can be staged (GC-152). Said in the sub-header rather than as a
            disabled button's title, because in this view there is no button to hover. */}
        {inHistory && <span className="note">Every commit that touched this file, newest first</span>}
        {isCompare && !inHistory && <span className="note">Read-only: a comparison is not a patch git can apply</span>}
        {error && <span className="err">{error}</span>}
      </div>
      {inHistory ? (
        <div className="diff-body file-history">
          {history === null && <div className="diff-empty">Loading history…</div>}
          {history?.error !== undefined && history?.error !== null && <div className="diff-empty">{history.error}</div>}
          {history?.commits?.length === 0 && <div className="diff-empty">No commits touch this file.</div>}
          {history?.commits?.map((c) => (
            <button
              key={c.sha}
              className={`history-row${view.source === 'commit' && view.sha === c.sha ? ' selected' : ''}`}
              title={`${c.summary}\n${c.authorName} <${c.authorEmail}>\n${formatDateTime(c.authorDate)}`}
              onClick={() => onOpenCommit(c.sha)}
            >
              <span className="history-summary">{c.summary}</span>
              <span className="history-author">{c.authorName}</span>
              {/* `time.ts` is the one answer to how a timestamp is written (GC-133, GC-135), so this
                  list cannot invent a fourth format. */}
              <span className="history-when">{relativeTime(c.authorDate)}</span>
              <span className="history-sha">{c.sha.slice(0, 7)}</span>
            </button>
          ))}
        </div>
      ) : (
      <div ref={bodyRef} className={`diff-body${stale ? ' stale' : ''}${wrap ? ' wrap' : ''}`}>
        {loading && !error && <div className="diff-empty">Loading diff…</div>}
        {loadError !== null && <div className="diff-empty">{loadError}</div>}
        {text !== null && !file && <div className="diff-empty">No textual changes.</div>}
        {file?.binary && <div className="diff-empty">Binary file.</div>}
        {empty && <div className="diff-empty">No changes this view can show.</div>}
        {file &&
          !file.binary &&
          file.hunks.map((h, hi) => (
            <div className="hunk" key={hi}>
              <div className="hunk-head">
                <span className="hunk-range">{splitHunkHeader(h.header)[0]}</span>
                <span className="hunk-ctx">{splitHunkHeader(h.header)[1]}</span>
                <span className="spacer" />
                <span className="hunk-actions">{hunkAction(h, hi)}</span>
              </div>
              {drawSplit ? (
                // Six columns, so both halves keep the gutter the unified table has. The tint is on
                // the cells rather than the row: a split row is one line of each file and the two
                // sides are rarely the same kind (GC-014).
                <table className="hunk-lines split">
                  <tbody>
                    {alignHunks(h).map((r, ri) => (
                      // The selection is per cell here, for the same reason the tint is: a split
                      // row is one line of each file, and only one of them is the line clicked.
                      <tr key={ri} className="line">
                        <td className={`no ${sideClass(r.left)}${selClass(hi, r.left)}`}>{r.left?.oldNo ?? ''}</td>
                        <td className={`mark ${sideClass(r.left)}${selClass(hi, r.left)}`}>{r.left?.type === 'del' ? '−' : ''}</td>
                        <td className={`code ${sideClass(r.left)}${selClass(hi, r.left)}${pickable(r.left)}`} {...lineProps(hi, h, r.left)}>
                          {r.left && code(r.left, wordSpans, syntax)}
                        </td>
                        <td className={`no ${sideClass(r.right)}${selClass(hi, r.right)}`}>{r.right?.newNo ?? ''}</td>
                        <td className={`mark ${sideClass(r.right)}${selClass(hi, r.right)}`}>{r.right?.type === 'add' ? '+' : ''}</td>
                        <td className={`code ${sideClass(r.right)}${selClass(hi, r.right)}${pickable(r.right)}`} {...lineProps(hi, h, r.right)}>
                          {r.right && code(r.right, wordSpans, syntax)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="hunk-lines">
                  <tbody>
                    {h.lines.map((l, li) => (
                      <tr
                        key={li}
                        className={`line ${l.type}${combinedClass(l)}${selClass(hi, l)}${pickable(l)}`}
                        title={combinedTitle(l)}
                        {...lineProps(hi, h, l)}
                      >
                        <td className="no">{l.oldNo ?? ''}</td>
                        <td className="no">{l.newNo ?? ''}</td>
                        <td className="mark">{l.combined ?? (l.type === 'add' ? '+' : l.type === 'del' ? '−' : '')}</td>
                        <td className="code">{code(l, wordSpans, syntax)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
      </div>
      )}
    </div>
  );
}
