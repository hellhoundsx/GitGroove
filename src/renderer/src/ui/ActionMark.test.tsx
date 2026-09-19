import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ActionMark } from './ActionMark';

// Covers what a control says about its own work (GC-214). Half of these are about the mark
// *going away*: the tick is a CSS animation with no `forwards` fill, so what takes it out of the
// tree is its own `animationend` — and the toolbar's rule that the icon steps aside is written
// against the tick being present, which makes "it leaves" the load-bearing half. The deferral that
// keeps a fast action from flashing is CSS (`--dur-work` with `backwards` fill) and is measured on
// the running app instead: jsdom runs no animations.

// Explicit imports rather than vitest globals is the house style, so RTL's own auto-cleanup and
// act-environment hooks never register; both are wired up by hand.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(cleanup);

const spinner = (): Element | null => document.querySelector('.action-mark .spinner');
const tick = (): Element | null => document.querySelector('.action-mark .done');

/**
 * End the tick's animation, under both names.
 *
 * jsdom defines no `AnimationEvent`, and React decides at startup which native name to listen for
 * by asking whether the unprefixed event is available — so in this environment it registers
 * `webkitAnimationEnd`, and an `animationend` dispatch reaches the element (a hand-written
 * listener sees it) and never reaches the component. Firing both keeps this true whichever name
 * the environment leads React to pick; the second lands on a node that is already gone, which is
 * harmless. The same shape of problem as `mouseOver` standing in for a non-bubbling `mouseenter`.
 */
const endAnimation = (el: Element): void => {
  for (const type of ['animationend', 'webkitAnimationEnd']) fireEvent(el, new Event(type, { bubbles: true }));
};

describe('ActionMark', () => {
  it('draws nothing at all while nothing has happened', () => {
    const { container } = render(<ActionMark working={false} done={0} />);
    expect(container.querySelector('.action-mark')).toBeNull();
  });

  it('draws the spinner while the work runs, and only the spinner', () => {
    render(<ActionMark working={true} done={0} />);
    expect(spinner()).not.toBeNull();
    expect(tick()).toBeNull();
  });

  it('hands over to the tick when the work lands', () => {
    const { rerender } = render(<ActionMark working={true} done={0} />);
    rerender(<ActionMark working={false} done={1} />);
    expect(spinner()).toBeNull();
    expect(tick()).not.toBeNull();
  });

  it('takes the tick out of the tree on its own animationend', () => {
    render(<ActionMark working={false} done={1} />);
    endAnimation(tick()!);
    // Not merely invisible: the toolbar's icon is hidden by `:has(.done)`, so a mark that stayed
    // would hide that icon for good.
    expect(tick()).toBeNull();
    expect(document.querySelector('.action-mark')).toBeNull();
  });

  it('plays again for the next success on the same control', () => {
    const { rerender } = render(<ActionMark working={false} done={1} />);
    endAnimation(tick()!);
    expect(tick()).toBeNull();
    // The counter is what says "this is a new success" — a boolean would mark the first push of a
    // session and stay silent for every one after it.
    rerender(<ActionMark working={false} done={2} />);
    expect(tick()).not.toBeNull();
  });
});
