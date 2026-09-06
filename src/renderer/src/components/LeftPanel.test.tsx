import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { GitRef } from '@shared/types';
import { LeftPanel, buildRefTree } from './LeftPanel';
import type { RefDragHandlers } from '../ui/refDrag';

// Explicit imports rather than vitest globals is the house style, so RTL's own auto-cleanup and
// act-environment hooks never register; both are wired up by hand. Nothing here renders an avatar
// or observes an element, so neither the prefs stub nor a ResizeObserver is needed.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(cleanup);

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

function panel(refs: GitRef[]): HTMLElement {
  const { container } = render(
    <LeftPanel
      refs={refs}
      stashes={[]}
      remotes={[]}
      pinnedName={null}
      hidden={[]}
      onToggleHidden={() => {}}
      onShowAll={() => {}}
      collapsed={false}
      focusFilter={0}
      resize={noResize}
      onExpand={() => {}}
      onCollapse={() => {}}
      onRefMenu={() => {}}
      onRefActivate={() => {}}
      refDrag={noDrag}
      onStashMenu={() => {}}
      onStashActivate={() => {}}
      onRemoteMenu={() => {}}
      onAddRemote={() => {}}
    />,
  );
  return container;
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

  it('keeps "Viewing" counting refs rather than folders', () => {
    const c = panel([head('main', true), head('feat/a'), head('feat/b')]);
    expect(c.querySelector('.viewing b')!.textContent).toBe('3');
  });
});
