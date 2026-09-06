import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { useState, type ComponentProps, type JSX } from 'react';
import type { GitRef } from '@shared/types';
import { LeftPanel, buildRefTree, folderKeys, readFolded, readSectionHeights } from './LeftPanel';
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
