import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState, type ComponentProps, type JSX } from 'react';
import type { GitRef, Stash } from '@shared/types';
import { LeftPanel, MIN_STASH_MSG, STASH_ROW_W, buildRefTree, defaultSectionOpen, fitStashCols, folderKeys, readFolded, readSectionHeights, readSectionOpen } from './LeftPanel';
import type { RefDragHandlers } from '../ui/refDrag';

// Explicit imports rather than vitest globals is the house style, so RTL's own auto-cleanup and
// act-environment hooks never register; both are wired up by hand. No avatar is rendered here, so
// the prefs stub is still not needed — but the panel measures the column its sections share, and
// jsdom has no ResizeObserver (GC-153).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

afterEach(() => {
  cleanup();
  localStorage.clear(); // the section heights are remembered state (GC-153)
});

const head = (name: string, isHead = false): GitRef => ({
  name,
  fullName: `refs/heads/${name}`,
  kind: 'head',
  sha: name.padEnd(40, '0'),
  isHead,
});

describe('buildRefTree', () => {
  it('leaves a name without a slash at the root', () => {
    const t = buildRefTree([head('main'), head('dev')], (r) => r.name);
    expect(t.folders).toHaveLength(0);
    expect(t.leaves.map((l) => l.label)).toEqual(['main', 'dev']);
    expect(t.count).toBe(2);
  });

  it('folds a shared prefix into one folder counting its refs', () => {
    const t = buildRefTree([head('feat/a'), head('feat/b'), head('main')], (r) => r.name);
    expect(t.folders).toHaveLength(1);
    expect(t.folders[0]!.path).toBe('feat');
    expect(t.folders[0]!.count).toBe(2);
    expect(t.folders[0]!.leaves.map((l) => l.label)).toEqual(['a', 'b']);
    expect(t.leaves.map((l) => l.label)).toEqual(['main']);
  });

  it('nests deeper folders and counts refs at any depth, never sub-folders', () => {
    const t = buildRefTree([head('feat/ui/a'), head('feat/ui/b'), head('feat/c')], (r) => r.name);
    const feat = t.folders[0]!;
    expect(feat.count).toBe(3);
    expect(feat.folders.map((f) => f.path)).toEqual(['feat/ui']);
    expect(feat.folders[0]!.count).toBe(2);
    expect(feat.leaves.map((l) => l.label)).toEqual(['c']);
  });

  it('groups a remote without the remote segment, which its own row already carries', () => {
    const rem = (name: string): GitRef => ({ ...head(name), kind: 'remote', fullName: `refs/remotes/${name}` });
    const t = buildRefTree([rem('origin/feat/a'), rem('origin/main')], (r) => r.name.slice('origin'.length + 1));
    expect(t.folders.map((f) => f.path)).toEqual(['feat']);
    expect(t.leaves.map((l) => l.label)).toEqual(['main']);
  });

  it('ignores a name that is only slashes rather than drawing an empty row', () => {
    expect(buildRefTree([head('//')], (r) => r.name).count).toBe(0);
    expect(buildRefTree([head('//')], (r) => r.name).leaves).toHaveLength(0);
  });
});

const noDrag: RefDragHandlers = {
  dragging: null,
  onDragStart: () => {},
  onDragEnd: () => {},
  onDrop: () => {},
};

const noResize = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onDoubleClick: () => {},
};

/** The panel with every prop filled in, as a component: a test that rerenders needs the element. */
function Panel({ refs, ...over }: { refs: GitRef[] } & Partial<ComponentProps<typeof LeftPanel>>): JSX.Element {
  // The ref filter is `App` state now (GC-179), so the harness plays `App`: it holds the query
  // and hands it straight back down. That is what keeps `fireEvent.change` on the field changing
  // the rows, and a test wanting to drive the prop itself still overrides both through `over`.
  const [filter, setFilter] = useState('');
  return (
    <LeftPanel
      info={{ path: '/repo', name: 'repo', headSha: 'abc1234def', branch: 'main' }}
      repoPath="/repo"
      refs={refs}
      stashes={[]}
      remotes={[]}
      pinnedName={null}
      hidden={[]}
      onToggleHidden={() => {}}
      onShowAll={() => {}}
      collapsed={false}
      filter={filter}
      onFilter={setFilter}
      focusFilter={0}
      resize={noResize}
      onExpand={() => {}}
      onCollapse={() => {}}
      onRefMenu={() => {}}
      onRefActivate={() => {}}
      onRefSelect={() => {}}
      selected={null}
      refDrag={noDrag}
      onStashSelect={() => {}}
      onStashMenu={() => {}}
      onStashActivate={() => {}}
      onRemoteMenu={() => {}}
      onAddRemote={() => {}}
      {...over}
    />
  );
}

function panel(refs: GitRef[], over: Partial<ComponentProps<typeof LeftPanel>> = {}): HTMLElement {
  return render(<Panel refs={refs} {...over} />).container;
}

const names = (c: HTMLElement, sel: string): string[] => [...c.querySelectorAll(sel)].map((e) => e.querySelector('.row-name')?.textContent ?? '');

describe('LeftPanel folders (GC-051)', () => {
  it('draws a folder row with its count and the short names beneath it', () => {
    const c = panel([head('main', true), head('feat/a'), head('feat/b')]);
    const folder = c.querySelector('.ref-row.folder')!;
    expect(folder.querySelector('.row-name')!.textContent).toBe('feat');
    expect(folder.querySelector('.count')!.textContent).toBe('2');
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['a', 'b', 'main']);
  });

  it('collapses and reopens on the folder row, taking its rows with it', () => {
    const c = panel([head('main', true), head('feat/a'), head('feat/b')]);
    const folder = c.querySelector('.ref-row.folder')!;
    expect(folder.classList.contains('open')).toBe(true);
    fireEvent.click(folder);
    expect(c.querySelector('.ref-row.folder')!.classList.contains('open')).toBe(false);
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['main']);
    fireEvent.click(c.querySelector('.ref-row.folder')!);
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['a', 'b', 'main']);
  });

  it('a filter shows only the matching rows, with their folder open even when it was closed', () => {
    const c = panel([head('main', true), head('feat/a'), head('feat/b')]);
    fireEvent.click(c.querySelector('.ref-row.folder')!); // close it first
    fireEvent.change(c.querySelector('input.filter')!, { target: { value: 'b' } });
    expect(names(c, '.ref-row.folder')).toEqual(['feat']);
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['b']);
    fireEvent.change(c.querySelector('input.filter')!, { target: { value: '' } });
    // Clearing it restores the list, and the folder is closed again: the filter forced it open,
    // it did not reopen it.
    expect(c.querySelector('.ref-row.folder')!.classList.contains('open')).toBe(false);
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['main']);
  });

  it('indents 16px per level and leaves a row outside a folder where it was', () => {
    const c = panel([head('main', true), head('feat/ui/a')]);
    const rows = [...c.querySelectorAll<HTMLElement>('.ref-row')];
    const byName = (n: string): HTMLElement => rows.find((r) => r.querySelector('.row-name')?.textContent === n)!;
    expect(byName('main').style.getPropertyValue('--row-depth')).toBe('0');
    expect(byName('feat').style.getPropertyValue('--row-depth')).toBe('0');
    expect(byName('ui').style.getPropertyValue('--row-depth')).toBe('1');
    expect(byName('a').style.getPropertyValue('--row-depth')).toBe('2');
  });

  it('keeps the section count counting refs rather than folders', () => {
    const c = panel([head('main', true), head('feat/a'), head('feat/b')]);
    // Three refs in two rows and a folder: the header of LOCAL says 3, not 5 and not 2.
    expect(c.querySelector('.section-head .count')!.textContent).toBe('3');
  });
});

describe('a closed folder is remembered per repository (GC-139)', () => {
  const feat = [head('main', true), head('feat/a'), head('feat/b')];
  const folderOf = (c: HTMLElement): Element => c.querySelector('.ref-row.folder')!;

  it('stores the closed folder and reads it back on the next mount', () => {
    const c = panel(feat);
    fireEvent.click(folderOf(c));
    expect(JSON.parse(localStorage.getItem('gitclient.folded./repo')!)).toEqual(['local/feat']);

    cleanup();
    expect(folderOf(panel(feat)).classList.contains('open')).toBe(false);
  });

  it('drops the key again when the folder is reopened', () => {
    const c = panel(feat);
    fireEvent.click(folderOf(c));
    fireEvent.click(folderOf(c));
    expect(localStorage.getItem('gitclient.folded./repo')).toBe(null);
  });

  it('is another repository’s business: the same folder is open there', () => {
    localStorage.setItem('gitclient.folded./repo', JSON.stringify(['local/feat']));
    expect(folderOf(panel(feat, { repoPath: '/other' })).classList.contains('open')).toBe(true);
  });

  it('follows a repository switch without a repaint of the previous one’s folders', () => {
    localStorage.setItem('gitclient.folded./other', JSON.stringify(['local/feat']));
    const { rerender, container } = render(<Panel refs={feat} repoPath="/repo" />);
    expect(folderOf(container).classList.contains('open')).toBe(true);
    rerender(<Panel refs={feat} repoPath="/other" />);
    expect(folderOf(container).classList.contains('open')).toBe(false);
  });

  it('prunes a folder whose refs have all gone, rather than accumulating', () => {
    localStorage.setItem('gitclient.folded./repo', JSON.stringify(['local/feat', 'local/release']));
    panel(feat);
    expect(JSON.parse(localStorage.getItem('gitclient.folded./repo')!)).toEqual(['local/feat']);
  });

  it('ignores a hand-edited value rather than throwing', () => {
    localStorage.setItem('gitclient.folded./repo', '{"not":"an array"}');
    expect(folderOf(panel(feat)).classList.contains('open')).toBe(true);
    expect(readFolded('/repo').size).toBe(0);
  });
});

describe('folderKeys', () => {
  it('names every level of a local and a tag name, and no leaf', () => {
    const tag = (name: string): GitRef => ({ ...head(name), kind: 'tag', fullName: `refs/tags/${name}` });
    expect([...folderKeys([head('feat/ui/a'), head('main'), tag('v1/rc')], [])].sort()).toEqual(['local/feat', 'local/feat/ui', 'tags/v1']);
  });

  it('drops the remote’s own segment, which its row already carries', () => {
    const rem = (name: string): GitRef => ({ ...head(name), kind: 'remote', fullName: `refs/remotes/${name}` });
    const remotes = [{ name: 'origin', fetchUrl: 'u', pushUrl: 'u' }];
    expect([...folderKeys([rem('origin/feat/a'), rem('origin/main')], remotes)]).toEqual(['remote:origin/feat']);
  });
});

describe('LeftPanel header (GC-094)', () => {
  it('names the checked-out branch, with no count beside it', () => {
    const c = panel([head('main', true), head('feat/a')]);
    expect(c.querySelector('.viewing .head-ref')!.textContent).toBe('main');
    // The count that used to sit here repeated the section counts below and read as a commit count
    // against the status bar's; nothing numeric belongs in this header now.
    expect(c.querySelector('.viewing b')).toBe(null);
  });

  it('says detached HEAD with the short sha when there is no branch, which is the case no row marks', () => {
    const c = panel([head('main')], { info: { path: '/repo', name: 'repo', headSha: 'abc1234def5678', branch: null } });
    expect(c.querySelector('.viewing .head-ref')!.textContent).toBe('detached HEAD');
    expect(c.querySelector('.viewing b')!.textContent).toBe('abc1234');
  });
});

describe('LeftPanel selection (GC-141)', () => {
  const tag = (name: string): GitRef => ({ name, fullName: `refs/tags/${name}`, kind: 'tag', sha: name.padEnd(40, '0'), isHead: false });
  const remote = (name: string): GitRef => ({ name, fullName: `refs/remotes/${name}`, kind: 'remote', sha: name.padEnd(40, '0'), isHead: false });

  it('a single click on a local, remote or tag row hands its tip to App', () => {
    const picked: string[] = [];
    const refs = [head('main', true), remote('origin/main'), tag('v1')];
    // Tags are behind a closed section by default, so the header is opened first.
    const c = panel(refs, { onRefSelect: (r: GitRef) => picked.push(r.fullName) });
    fireEvent.click([...c.querySelectorAll('.section-toggle')].find((b) => b.textContent?.includes('Tags'))!);
    for (const row of c.querySelectorAll('.ref-row:not(.folder):not(.remote-group):not(.dim)')) fireEvent.click(row);
    expect(picked).toEqual(['refs/heads/main', 'refs/remotes/origin/main', 'refs/tags/v1']);
  });

  it('marks every row standing at the selected commit, and no other', () => {
    const refs = [head('main', true), head('other')];
    const c = panel(refs, { selected: 'main'.padEnd(40, '0') });
    expect(names(c, '.ref-row.selected')).toEqual(['main']);
    expect(c.querySelectorAll('.ref-row.selected')).toHaveLength(1);
  });

  it('marks nothing while the working directory is what is selected', () => {
    const c = panel([head('main', true)], { selected: 'WIP' });
    expect(c.querySelectorAll('.ref-row.selected')).toHaveLength(0);
  });
});

describe('the sections share the column (GC-153)', () => {
  // jsdom lays nothing out, so `.sections` measures 0 and no height is applied — which is exactly
  // the "not measured yet" case. The share itself is `fitSections`, tested in `useDragWidth.test.ts`;
  // what is asserted here is the structure that makes it possible, and the state around it.
  it('gives every section a header outside its own scroll box', () => {
    const c = panel([head('main', true)]);
    expect(c.querySelectorAll('.panel-section')).toHaveLength(4);
    // The two open by default; a closed one draws no row box at all.
    expect(c.querySelectorAll('.panel-section.open')).toHaveLength(2);
    expect(c.querySelectorAll('.panel-section.open > .section-rows')).toHaveLength(2);
    // Every header is a child of the column, not of a scrolling box inside it.
    expect(c.querySelectorAll('.sections > .panel-section > .section-head')).toHaveLength(4);
  });

  it('puts a handle between two open sections and nowhere else', () => {
    const c = panel([head('main', true)]);
    // LOCAL and REMOTE are open, TAGS and STASHES are not: one boundary between open sections.
    expect(c.querySelectorAll('.section-resize')).toHaveLength(1);
    fireEvent.click([...c.querySelectorAll('.section-toggle')].find((b) => b.textContent?.includes('Tags'))!);
    expect(c.querySelectorAll('.section-resize')).toHaveLength(2);
    // Closing the last open section above it takes its handle with it, so no handle is ever drawn
    // where a drag could move nothing.
    fireEvent.click([...c.querySelectorAll('.section-toggle')].find((b) => b.textContent?.includes('Remote'))!);
    expect(c.querySelectorAll('.section-resize')).toHaveLength(1);
  });

  it('reads a stored height back, and ignores one that is not a usable number', () => {
    localStorage.setItem('gitclient.sectionHeights', JSON.stringify({ local: 300, remote: 12, tags: 'tall' }));
    expect(readSectionHeights()).toEqual({ local: 300 });
    localStorage.setItem('gitclient.sectionHeights', 'not json at all');
    expect(readSectionHeights()).toEqual({});
    localStorage.removeItem('gitclient.sectionHeights');
    expect(readSectionHeights()).toEqual({});
  });
});

describe('which sections are open is remembered (GC-177)', () => {
  const open = (c: HTMLElement): string[] => [...c.querySelectorAll('.panel-section.open .section-toggle')].map((b) => b.textContent ?? '');

  it('comes back open after a remount, with only the toggled section stored', () => {
    const c = panel([head('main', true)]);
    expect(open(c).some((t) => t.includes('Tags'))).toBe(false);
    fireEvent.click([...c.querySelectorAll('.section-toggle')].find((b) => b.textContent?.includes('Tags'))!);
    expect(open(c).some((t) => t.includes('Tags'))).toBe(true);
    // Only what was toggled is written: the other three are still whatever the default says.
    expect(readSectionOpen()).toEqual({ tags: true });
    cleanup();
    // The reload: a second mount reading the same key back.
    expect(open(panel([head('main', true)])).some((t) => t.includes('Tags'))).toBe(true);
  });

  it('falls back to the defaults for an absent, hand-edited or empty value', () => {
    expect(readSectionOpen()).toEqual({});
    localStorage.setItem('gitclient.sectionOpen', 'not json at all');
    expect(readSectionOpen()).toEqual({});
    // A stored object naming no section is absent, not "everything closed".
    localStorage.setItem('gitclient.sectionOpen', JSON.stringify({ nonsense: true, remote: 'yes' }));
    expect(readSectionOpen()).toEqual({});
    const c = panel([head('main', true)]);
    expect(open(c)).toHaveLength(2);
    expect(defaultSectionOpen(false)).toEqual({ local: true, remote: true, tags: false, stashes: false });
    expect(defaultSectionOpen(true).stashes).toBe(true);
  });
});

describe('the ref filter belongs to the tab (GC-179)', () => {
  const refs = [head('main', true), head('release/1'), head('release/2')];

  it('draws what the query it is given matches, and everything again when it is taken away', () => {
    // The tab switch, at this level: the panel is handed another repository's empty query and has
    // to draw an unfiltered list. It kept its own `filter` state before, so the query stayed and
    // the new repository's rows were all filtered out with nothing saying why.
    const r = render(<Panel refs={refs} filter="release" onFilter={() => {}} />);
    expect(names(r.container, '.ref-row:not(.folder):not(.dim)')).toEqual(['1', '2']);
    r.rerender(<Panel refs={refs} filter="" onFilter={() => {}} />);
    expect(names(r.container, '.ref-row:not(.folder):not(.dim)')).toEqual(['1', '2', 'main']);
  });

  it('reports typing rather than narrowing on its own, so the query has one home', () => {
    const seen: string[] = [];
    const c = panel(refs, { filter: '', onFilter: (q) => seen.push(q) });
    const field = c.querySelector<HTMLInputElement>('input.filter')!;
    fireEvent.change(field, { target: { value: 'release' } });
    expect(seen).toEqual(['release']);
    // Controlled: with the prop unchanged the field and the rows are unchanged too. That is what
    // makes `App` the only place the query lives, and what parks it with the tab.
    expect(field.value).toBe('');
    expect(names(c, '.ref-row:not(.folder):not(.dim)')).toEqual(['1', '2', 'main']);
  });
});

// A stash row was the one row kind in this panel a single click did nothing on (GC-150). GC-141
// fenced them off because nothing on a `Stash` said which commit to select; GC-140 put
// `Stash.parent` there and GC-170 gave the stash a graph row of its own, so both are reachable.
describe('LeftPanel stash rows (GC-150)', () => {
  const stash = (index: number, sha: string, parent: string): Stash => ({
    index,
    sha,
    message: `WIP on main: ${index}`,
    date: '2026-09-01T10:00:00+02:00',
    parent,
  });
  const stashes = [stash(0, 's'.repeat(40), 'p'.repeat(40))];
  const row = (c: HTMLElement): HTMLElement => c.querySelectorAll<HTMLElement>('.ref-row')[c.querySelectorAll('.ref-row').length - 1]!;

  it('reports the stash on a single click, the way a ref row reports its tip', () => {
    const picked: Stash[] = [];
    const c = panel([head('main', true)], { stashes, onStashSelect: (s) => picked.push(s) });
    fireEvent.click(row(c));
    expect(picked).toEqual(stashes);
  });

  it('still applies on a double click', () => {
    const applied: Stash[] = [];
    const c = panel([head('main', true)], { stashes, onStashActivate: (s) => applied.push(s) });
    fireEvent.doubleClick(row(c));
    expect(applied).toEqual(stashes);
  });

  it('says which commit it was taken from, as a short sha', () => {
    const c = panel([head('main', true)], { stashes });
    expect(row(c).querySelector('.row-sha')!.textContent).toBe('ppppppp');
    expect(row(c).getAttribute('title')).toContain('taken from ppppppp');
  });

  it('is marked selected by the stash and by the commit it came from, and by nothing else', () => {
    // Either is how the user got here: the graph's stash row carries the stash's own sha, and the
    // commit beneath it is what the stash was taken from (GC-170).
    const bySelf = panel([head('main', true)], { stashes, selected: 's'.repeat(40) });
    expect(row(bySelf).classList.contains('selected')).toBe(true);
    const byParent = panel([head('main', true)], { stashes, selected: 'p'.repeat(40) });
    expect(row(byParent).classList.contains('selected')).toBe(true);
    const neither = panel([head('main', true)], { stashes, selected: 'z'.repeat(40) });
    expect(row(neither).classList.contains('selected')).toBe(false);
  });

  // What the row spends its width on (GC-171). The message is the identity of a stash and it was
  // getting 77px of the 192 it wanted, of which the first nine characters were git's own prefix —
  // so two stashes taken on `main` with different messages drew the same row.
  it('draws the message with git\'s own prefix off it, and keeps the whole message on the title', () => {
    const long: Stash[] = [
      { index: 0, sha: 'a'.repeat(40), message: 'On main: rewrite the lane layout for paged history', date: '2026-09-01T10:00:00+02:00', parent: 'p'.repeat(40) },
    ];
    const c = panel([head('main', true)], { stashes: long });
    expect(row(c).querySelector('.row-name')!.textContent).toBe('rewrite the lane layout for paged history');
    // Never in the title, and never in what `stashRename` stores (GC-170).
    expect(row(c).getAttribute('title')).toContain('On main: rewrite the lane layout for paged history');
  });

  it('tells two stashes on the same branch apart, which the shared prefix is what prevented', () => {
    const two: Stash[] = [
      { index: 0, sha: 'a'.repeat(40), message: 'On main: review the graph', date: '2026-09-01T10:00:00+02:00', parent: 'p'.repeat(40) },
      { index: 1, sha: 'b'.repeat(40), message: 'On main: the diff header', date: '2026-09-01T10:00:00+02:00', parent: 'p'.repeat(40) },
    ];
    const c = panel([head('main', true)], { stashes: two });
    const names = [...c.querySelectorAll<HTMLElement>('.ref-row .row-name')].slice(-2).map((n) => n.textContent);
    expect(names).toEqual(['review the graph', 'the diff header']);
  });

  it('reports a stash whose parent is not loaded exactly like any other', () => {
    // Nothing here knows what the graph has loaded; `rowIndexOf` answers -1 for an unloaded sha
    // and the graph then stays where it is (GC-141), so this row has no special case to carry.
    const picked: Stash[] = [];
    const orphan = [stash(0, 'a'.repeat(40), 'f'.repeat(40))];
    const c = panel([head('main', true)], { stashes: orphan, onStashSelect: (s) => picked.push(s) });
    fireEvent.click(row(c));
    expect(picked.map((s) => s.parent)).toEqual(['f'.repeat(40)]);
  });
});

describe('a stash row gives way to its message on a narrow panel (GC-199)', () => {
  // The arithmetic on its own. At the default 220px panel the row was five items and the message
  // got 48px of the 207 it wanted; what is dropped for it is the sha, which the graph draws again
  // on the stash's own row a few pixels away (GC-170).
  it('drops the sha below the width the message needs and brings it back above it', () => {
    expect(fitStashCols(220).sha).toBe(false);
    expect(fitStashCols(300).sha).toBe(true);
    // The exact boundary, so a change to any of the mirrored widths shows up here rather than in
    // the running app: with the sha the message wants MIN_STASH_MSG on top of the furniture.
    const w = STASH_ROW_W;
    const edge = MIN_STASH_MSG + w.pad + w.icon + w.idx + w.when + w.sha + w.gap * 4;
    expect(fitStashCols(edge).sha).toBe(true);
    expect(fitStashCols(edge - 1).sha).toBe(false);
  });

  it('draws everything until the panel has been measured', () => {
    // `fitRefCol`'s own rule: 0 is "not measured yet", not "as narrow as possible", or the sha
    // would blink out for the first frame of every open.
    expect(fitStashCols(0).sha).toBe(true);
  });

  it('leaves the sha out of the row at 220px and puts it back at 300px, with the age at both', () => {
    const stashes: Stash[] = [{ index: 0, sha: 'a'.repeat(40), message: 'On main: the diff header', date: '2026-09-01T10:00:00+02:00', parent: 'p'.repeat(40) }];
    const width = (px: number): HTMLElement => {
      const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px });
      try {
        return panel([head('main', true)], { stashes });
      } finally {
        if (desc) Object.defineProperty(HTMLElement.prototype, 'clientWidth', desc);
      }
    };
    const narrow = width(220);
    const stashRow = (c: HTMLElement): HTMLElement => c.querySelector<HTMLElement>('.ref-row.stash')!;
    expect(stashRow(narrow).querySelector('.row-sha')).toBeNull();
    // Nothing is drawn half: the age keeps its own box at both widths, and the sha the row no
    // longer draws is still on the title.
    expect(stashRow(narrow).querySelector('.row-when')).not.toBeNull();
    expect(stashRow(narrow).getAttribute('title')).toContain('taken from ppppppp');
    cleanup();
    const wide = width(300);
    expect(stashRow(wide).querySelector('.row-sha')!.textContent).toBe('ppppppp');
    expect(stashRow(wide).querySelector('.row-when')).not.toBeNull();
  });

  it('marks a stash row as one, so the folder-tree indent can come off it', () => {
    // The 26px `.ref-row` indent aligns a leaf row's icon under a folder row's; the STASHES
    // section has no folders, so `.ref-row.stash` in `app.css` takes it back for the message.
    const stashes: Stash[] = [{ index: 0, sha: 'a'.repeat(40), message: 'On main: x', date: '2026-09-01T10:00:00+02:00', parent: 'p'.repeat(40) }];
    const c = panel([head('main', true)], { stashes });
    expect(c.querySelectorAll('.ref-row.stash')).toHaveLength(1);
    // And nothing else in the panel takes it: a branch row is still a leaf of the folder tree.
    expect(c.querySelectorAll('.ref-row.folder.stash')).toHaveLength(0);
  });
});
