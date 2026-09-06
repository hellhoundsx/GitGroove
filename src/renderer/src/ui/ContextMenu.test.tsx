import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ContextMenu, filterMenuItems, type MenuItem } from './ContextMenu';

// Covers the filter row a menu whose rows are a list rather than a set of actions can carry
// (GC-096). The narrowing rule is pure and tested as such; the component test is here for the two
// things that are not — the field taking focus when the menu opens, and Enter activating the first
// row still standing, which is the gesture that makes a filtered list quicker than the panel it
// replaces.

// Explicit imports rather than vitest globals is the house style, so RTL's own auto-cleanup and
// act-environment hooks never register; both are wired up by hand.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(cleanup);

const rows = (): string[] => [...document.querySelectorAll('.ctx-item')].map((e) => e.querySelector('.ctx-label')!.textContent ?? '');
const captions = (): string[] => [...document.querySelectorAll('.ctx-caption')].map((e) => e.textContent ?? '');
const field = (): HTMLInputElement => document.querySelector('.ctx-filter')!;

const branchMenu = (onPick: (name: string) => void): MenuItem[] => [
  { filter: true, placeholder: 'Filter branches' },
  { label: 'Local', caption: true },
  { label: '✓ main', disabled: true },
  { label: 'feature', onClick: () => onPick('feature') },
  { separator: true },
  { label: 'Remote', caption: true },
  { label: 'origin/main', onClick: () => onPick('origin/main') },
];

describe('filterMenuItems (GC-096)', () => {
  const items = branchMenu(() => {});

  it('changes nothing while the query is empty', () => {
    expect(filterMenuItems(items, '   ')).toBe(items);
  });

  it('keeps the rows holding the term, case-insensitively', () => {
    // The two undefined labels are the filter row itself and the separator, which both groups
    // still have rows to be divided by.
    expect(filterMenuItems(items, 'MAIN').map((i) => i.label)).toEqual([undefined, 'Local', '✓ main', undefined, 'Remote', 'origin/main']);
  });

  it('drops a caption whose group emptied, and the separator left dividing nothing', () => {
    // Only a local matches, so REMOTE goes and the rule that used to separate the two with it.
    expect(filterMenuItems(items, 'feature').map((i) => i.label)).toEqual([undefined, 'Local', 'feature']);
  });

  it('says so in a row when nothing matches, rather than collapsing to a bare input', () => {
    const out = filterMenuItems(items, 'zzz');
    expect(out.map((i) => i.label)).toEqual([undefined, 'No matches']);
    expect(out[1]!.disabled).toBe(true);
  });
});

describe('ContextMenu filter row (GC-096)', () => {
  const open = (onPick: (name: string) => void = () => {}): void => {
    render(<ContextMenu menu={{ x: 0, y: 0, items: branchMenu(onPick) }} onClose={() => {}} />);
  };

  it('focuses the field when the menu opens and narrows the rows as it is typed', () => {
    open();
    expect(document.activeElement).toBe(field());
    expect(rows()).toEqual(['✓ main', 'feature', 'origin/main']);
    fireEvent.change(field(), { target: { value: 'feat' } });
    expect(rows()).toEqual(['feature']);
    expect(captions()).toEqual(['Local']);
  });

  it('checks the first row still standing out on Enter, skipping the disabled checked-out one', () => {
    const picked: string[] = [];
    open((n) => picked.push(n));
    fireEvent.change(field(), { target: { value: 'main' } });
    // `✓ main` is first and disabled — it is where HEAD already is — so Enter takes the next.
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(picked).toEqual(['origin/main']);
  });

  it('does nothing on Enter when the query matches no row', () => {
    const picked: string[] = [];
    open((n) => picked.push(n));
    fireEvent.change(field(), { target: { value: 'zzz' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(picked).toEqual([]);
    expect(rows()).toEqual(['No matches']);
  });
});
