// GC-138: the hunk arrows' decision, which was a pure rule wearing a DOM coat until it was
// pulled out of `DiffView`. It got two answers wrong during GC-052 and a throwaway CDP script is
// what caught both; each of those is a named case below.
//
// A `.ts` test, not `.tsx`: nothing here renders. `DiffView` itself is not imported for the DOM —
// `nextHunkStop` takes numbers, which is the whole point of the extraction.
import { describe, expect, it } from 'vitest';
import { nextHunkStop } from './DiffView';

describe('nextHunkStop', () => {
  // A file with four hunks, at the stops their headers sit at once the body has been measured.
  const stops = [0, 220, 480, 700];

  it('goes to the second hunk from the top, not the first (the first answer GC-052 got wrong)', () => {
    // The body has top padding, so the first header is a few pixels below the scroll position.
    // Compared without the tolerance it read as being *below* the top, so "next" answered it and
    // the very first Next click went nowhere at all.
    expect(nextHunkStop(stops, 0, 'next')).toBe(220);
    expect(nextHunkStop(stops, 0.5, 'next')).toBe(220);
    expect(nextHunkStop(stops, 1, 'next')).toBe(220);
  });

  it('wraps at both ends (the second answer, which the clamp is what makes true)', () => {
    // At the bottom every remaining header shares the clamped stop, so there is no stop strictly
    // past it: the wrap is what is left, and it is the useful answer.
    expect(nextHunkStop(stops, 700, 'next')).toBe(0);
    expect(nextHunkStop(stops, 0, 'prev')).toBe(700);
  });

  it('steps one hunk at a time in both directions', () => {
    expect(nextHunkStop(stops, 220, 'next')).toBe(480);
    expect(nextHunkStop(stops, 480, 'prev')).toBe(220);
    expect(nextHunkStop(stops, 700, 'prev')).toBe(480);
  });

  it('treats a position between two hunks as being in the one above it', () => {
    expect(nextHunkStop(stops, 300, 'next')).toBe(480);
    expect(nextHunkStop(stops, 300, 'prev')).toBe(220);
  });

  it('handles several stops sharing the clamped bottom position', () => {
    // What the caller hands over at the end of a long file: the last three headers cannot be put
    // at the top of the body, so they clamp to the same number.
    const clamped = [0, 220, 900, 900, 900];
    expect(nextHunkStop(clamped, 220, 'next')).toBe(900);
    // Already there: nothing further, so it wraps rather than sitting still.
    expect(nextHunkStop(clamped, 900, 'next')).toBe(0);
    expect(nextHunkStop(clamped, 900, 'prev')).toBe(220);
  });

  it('answers the one stop for a single hunk, and nothing at all for none', () => {
    expect(nextHunkStop([0], 0, 'next')).toBe(0);
    expect(nextHunkStop([0], 0, 'prev')).toBe(0);
    expect(nextHunkStop([], 0, 'next')).toBe(null);
    expect(nextHunkStop([], 0, 'prev')).toBe(null);
  });
});
