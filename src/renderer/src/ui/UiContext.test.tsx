import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type JSX } from 'react';
import { UiProvider, useUi } from './UiContext';

// Guards the dropdown toggle (GC-066), which no e2e step reaches: `run.mjs` opens every menu with
// a synthetic `contextmenu`, never with a click on a control that owns one. The whole point of the
// fix is an ordering the DOM has to reproduce for real — `ContextMenu` dismisses on a
// capture-phase mousedown, so the click that follows must still know the menu was up — and jsdom
// dispatches both events properly, so the case is testable here and only here.

// Explicit imports rather than vitest globals is the house style, which means RTL's own
// auto-cleanup and act-environment hooks never register; both are wired up by hand, exactly as
// `Preferences.test.tsx` does.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(cleanup);

/** A dropdown control shaped like the repository crumb: its own click opens its own menu. */
function Crumb({ owned = true }: { owned?: boolean }): JSX.Element {
  const ui = useUi();
  return (
    <button
      onClick={(e) => ui.openMenu({ clientX: 0, clientY: 0, owner: owned ? e.currentTarget : undefined }, [{ label: 'Open repository…' }])}
    >
      repository
    </button>
  );
}

const menu = (): HTMLElement | null => document.querySelector('.ctx-menu');

/** One real mouse gesture on `el`: the mousedown that dismisses an open menu, then the click. */
const gesture = (el: HTMLElement): void => {
  fireEvent.mouseDown(el);
  fireEvent.click(el);
};

describe('UiProvider dropdown toggle', () => {
  it('closes the menu on a second click of the control that opened it, and opens it on a third', () => {
    render(
      <UiProvider>
        <Crumb />
      </UiProvider>,
    );
    const crumb = screen.getByText('repository');

    gesture(crumb);
    expect(menu()).not.toBeNull();

    gesture(crumb);
    expect(menu()).toBeNull();

    gesture(crumb);
    expect(menu()).not.toBeNull();
  });

  it('toggles for a click that arrives without a mousedown', () => {
    render(
      <UiProvider>
        <Crumb />
      </UiProvider>,
    );
    const crumb = screen.getByText('repository');

    // `element.click()` — what a script dispatches — fires no mousedown, so nothing dismisses the
    // menu first and the second click has to see it still open.
    fireEvent.click(crumb);
    expect(menu()).not.toBeNull();

    fireEvent.click(crumb);
    expect(menu()).toBeNull();
  });

  it('reopens when the control claims no ownership, which is how a right-click menu behaves', () => {
    render(
      <UiProvider>
        <Crumb owned={false} />
      </UiProvider>,
    );
    const crumb = screen.getByText('repository');

    gesture(crumb);
    expect(menu()).not.toBeNull();

    gesture(crumb);
    expect(menu()).not.toBeNull();
  });

  it('forgets the owner once the menu closes some other way, so the next click opens', () => {
    render(
      <UiProvider>
        <Crumb />
      </UiProvider>,
    );
    const crumb = screen.getByText('repository');

    gesture(crumb);
    expect(menu()).not.toBeNull();

    // An outside click elsewhere — the same dismissal Escape and a scroll go through.
    fireEvent.mouseDown(document.body);
    expect(menu()).toBeNull();

    gesture(crumb);
    expect(menu()).not.toBeNull();
  });
});
