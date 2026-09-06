import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { FileChangeKind } from '@shared/types';
import { alignHunks, buildHunkPatch, buildLinePatch, hunkWordSpans, parseUnifiedDiff, type DiffHunk, type DiffLine, type FileDiff, type WordSpan } from './parseDiff';
import { ChevronDown, ChevronUp, Pilcrow, WrapText, X } from 'lucide-react';
import { FileKindIcon, Icon } from '../ui/icons';
import { useUi } from '../ui/UiContext';
import { setPrefs, usePrefs, type DiffViewMode } from '../prefs';

const VIEW_MODES: { mode: DiffViewMode; label: string; title: string }[] = [
  { mode: 'unified', label: 'Unified', title: 'One column: removals and additions in file order' },
  { mode: 'split', label: 'Split', title: 'Side by side: the old file left, the new file right' },
];

/** Which tint a split cell takes. An empty side is padding, not an unchanged line. */
const sideClass = (line: DiffLine | null): string => (line === null ? 'pad' : line.type);

/**
 * One line's text, with the part of it that actually changed marked (GC-104). Both layouts render
 * through this, from the same map, so a line cannot be marked one way in one of them and another
 * way in the other. A line with no entry — a pure addition, a pure removal, a padded side, two
 * lines with nothing in common — is the plain text it always was.
 */
function code(line: DiffLine, spans: Map<DiffLine, WordSpan[]>): JSX.Element {
  const marked = spans.get(line);
  if (!marked) return <pre>{line.text}</pre>;
  return (
    <pre>
      {marked.map((s, i) => (s.changed ? <span className="word" key={i}>{s.text}</span> : <span key={i}>{s.text}</span>))}
    </pre>
  );
}

export type FileViewSource =
  | { source: 'commit'; sha: string; path: string; kind: FileChangeKind }
  | { source: 'wip'; path: string; staged: boolean; kind: FileChangeKind };

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
}

function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/');
  return i >= 0 ? [path.slice(0, i + 1), path.slice(i + 1)] : ['', path];
}

export function DiffView({ repo, view, version, onClose, onStageFile, onUnstageFile, onDiscardFile, onApplyPatch }: Props): JSX.Element {
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
  const identityKey = `${repo}|${view.source}|${view.path}|${view.source === 'commit' ? view.sha : `${view.staged}|${view.kind ?? ''}`}`;
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

  const files = useMemo(() => (text === null ? [] : parseUnifiedDiff(text)), [text]);
  const file: FileDiff | undefined = files[0];
  // Computed once per parsed file rather than per row, and keyed by the line object both layouts
  // hold, so switching layout re-renders the same marks without re-diffing anything (GC-104).
  const wordSpans = useMemo(() => {
    const all = new Map<DiffLine, WordSpan[]>();
    for (const h of file?.hunks ?? []) for (const [line, spans] of hunkWordSpans(h)) all.set(line, spans);
    return all;
  }, [file]);
  const hunkCount = file?.binary ? 0 : (file?.hunks.length ?? 0);
  const [dir, name] = splitPath(view.path);
  const isWip = view.source === 'wip';
  const untracked = view.kind === 'untracked';
  // Every action is aimed at what is on screen, so a load in flight disables them exactly like a
  // running one does: the header already claims the new side of the file (GC-075), and a stale
  // body is content the newest load has not confirmed yet (GC-086).
  const actionsDisabled = busy || loading || stale;

  // A `-w` diff is not a patch git can apply: the lines it left out are still in the file, so
  // `git apply` rejects it. Every button built from `hunk.raw` is therefore off while the
  // toggle is on, and says why; the file-level actions do not go through a patch and stay live.
  const hunksDisabled = actionsDisabled || ignoreWs;
  const hunkTitle = ignoreWs ? 'Not available while whitespace is ignored: the patch would not apply' : undefined;

  // Lines are picked on the unstaged side only: unstaging a line is the reverse patch and its own
  // ticket (GC-121, out of scope), and a commit's diff stages nothing at all.
  const canSelect = isWip && view.source === 'wip' && !view.staged && !ignoreWs;
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
   * Each header's *stop* — the scrollTop that puts it at the top of the content box — is what is
   * compared, not its offset from the body's border box: the body has top padding, so the first
   * header sits a few pixels down when nothing is scrolled at all and would otherwise read as
   * being below the top, which made the very first Next click go nowhere.
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
    const at = body.scrollTop;
    // 1px of tolerance: the header already at the top is the current one, not the next.
    const i = where === 'next' ? stops.findIndex((s) => s > at + 1) : stops.map((s) => s < at - 1).lastIndexOf(true);
    const target = i >= 0 ? i : where === 'next' ? 0 : heads.length - 1;
    // The browser clamps a stop past the end, which is the right answer for the last hunks.
    body.scrollTop = stops[target]!;
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
          <span className="dir">{dir}</span>
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
        <button className="icon-btn" title="Previous change" aria-label="Previous change" disabled={hunkCount < 2} onClick={() => gotoHunk('prev')}>
          <Icon of={ChevronUp} size={14} />
        </button>
        <button className="icon-btn" title="Next change" aria-label="Next change" disabled={hunkCount < 2} onClick={() => gotoHunk('next')}>
          <Icon of={ChevronDown} size={14} />
        </button>
        <button
          className={`seg-btn toggle${ignoreWs ? ' on' : ''}`}
          title="Ignore whitespace: diff with -w, so a reindent shows no change"
          aria-label="Ignore whitespace"
          aria-pressed={ignoreWs}
          onClick={() => setPrefs({ diffIgnoreWhitespace: !ignoreWs })}
        >
          <Icon of={Pilcrow} size={13} />
        </button>
        <button
          className={`seg-btn toggle${wrap ? ' on' : ''}`}
          title="Wrap long lines instead of scrolling sideways"
          aria-label="Wrap"
          aria-pressed={wrap}
          onClick={() => setPrefs({ diffWordWrap: !wrap })}
        >
          <Icon of={WrapText} size={13} />
        </button>
        {/* The layout of what is already loaded, so flipping it costs no reload and never disables
            an action: `hunk.raw` is what a Stage/Discard patch is built from, and alignment does not
            touch it (GC-014). */}
        <div className="seg" role="group" aria-label="Diff layout">
          {VIEW_MODES.map((m) => (
            <button
              key={m.mode}
              className={`seg-btn${split === (m.mode === 'split') ? ' on' : ''}`}
              title={m.title}
              aria-pressed={split === (m.mode === 'split')}
              onClick={() => setPrefs({ diffView: m.mode })}
            >
              {m.label}
            </button>
          ))}
        </div>
        {isWip && view.source === 'wip' && !view.staged && (
          <>
            <button className="btn success" disabled={actionsDisabled} onClick={() => void run(() => onStageFile(view.path))}>
              Stage file
            </button>
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
        <span className="chip">{view.source === 'commit' ? `commit ${view.sha.slice(0, 7)}` : view.staged ? 'Staged' : 'Unstaged'}</span>
        {error && <span className="err">{error}</span>}
      </div>
      <div ref={bodyRef} className={`diff-body${stale ? ' stale' : ''}${wrap ? ' wrap' : ''}`}>
        {loading && !error && <div className="diff-empty">Loading diff…</div>}
        {loadError !== null && <div className="diff-empty">{loadError}</div>}
        {text !== null && !file && <div className="diff-empty">No textual changes.</div>}
        {file?.binary && <div className="diff-empty">Binary file.</div>}
        {file &&
          !file.binary &&
          file.hunks.map((h, hi) => (
            <div className="hunk" key={hi}>
              <div className="hunk-head">
                <span className="hunk-range">{h.header.replace(/ @@.*$/, ' @@')}</span>
                <span className="hunk-ctx">{h.header.replace(/^@@[^@]*@@ ?/, '')}</span>
                <span className="spacer" />
                <span className="hunk-actions">{hunkAction(h, hi)}</span>
              </div>
              {split ? (
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
                          {r.left && code(r.left, wordSpans)}
                        </td>
                        <td className={`no ${sideClass(r.right)}${selClass(hi, r.right)}`}>{r.right?.newNo ?? ''}</td>
                        <td className={`mark ${sideClass(r.right)}${selClass(hi, r.right)}`}>{r.right?.type === 'add' ? '+' : ''}</td>
                        <td className={`code ${sideClass(r.right)}${selClass(hi, r.right)}${pickable(r.right)}`} {...lineProps(hi, h, r.right)}>
                          {r.right && code(r.right, wordSpans)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="hunk-lines">
                  <tbody>
                    {h.lines.map((l, li) => (
                      <tr key={li} className={`line ${l.type}${selClass(hi, l)}${pickable(l)}`} {...lineProps(hi, h, l)}>
                        <td className="no">{l.oldNo ?? ''}</td>
                        <td className="no">{l.newNo ?? ''}</td>
                        <td className="mark">{l.type === 'add' ? '+' : l.type === 'del' ? '−' : ''}</td>
                        <td className="code">{code(l, wordSpans)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
