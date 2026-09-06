import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDateTimeSeconds, relativeTime } from './time';

/**
 * The inputs here carry no zone, which ECMAScript parses as local time, so the expected strings
 * are exact on any machine in any zone — the point of the ticket is that they are also the same
 * in any *locale*, which asserting `Intl`'s answer back at itself could never show (GC-133).
 */
describe('formatDateTime', () => {
  it('writes dd/mm/yyyy, HH:MM', () => {
    expect(formatDateTime('2026-09-06T09:14:32')).toBe('06/09/2026, 09:14');
  });

  it('zero-pads every single-digit part', () => {
    expect(formatDateTime('2026-01-02T03:04:05')).toBe('02/01/2026, 03:04');
  });

  it('keeps the day first at the end of a month, where mm/dd would still parse', () => {
    expect(formatDateTime('2026-11-12T22:45:00')).toBe('12/11/2026, 22:45');
  });

  it('returns an unparseable string unchanged', () => {
    expect(formatDateTime('not a date')).toBe('not a date');
    expect(formatDateTime('')).toBe('');
  });
});

describe('formatDateTimeSeconds', () => {
  it('writes dd/mm/yyyy, HH:MM:SS', () => {
    expect(formatDateTimeSeconds('2026-09-06T09:14:32')).toBe('06/09/2026, 09:14:32');
  });

  it('zero-pads the seconds', () => {
    expect(formatDateTimeSeconds('2026-01-02T03:04:05')).toBe('02/01/2026, 03:04:05');
  });

  it('returns an unparseable string unchanged', () => {
    expect(formatDateTimeSeconds('not a date')).toBe('not a date');
  });
});

describe('the two helpers', () => {
  it('differ only in the seconds, which is the whole of GC-133', () => {
    const iso = '2026-09-06T09:14:32';
    expect(formatDateTimeSeconds(iso).startsWith(formatDateTime(iso))).toBe(true);
    expect(formatDateTimeSeconds(iso)).toBe(`${formatDateTime(iso)}:32`);
  });

  it(`agrees with the other on an offset-carrying date, whatever the machine's zone`, () => {
    // `%aI` is what git gives us; the zone shifts both helpers identically, so the prefix holds.
    const iso = '2026-09-06T09:14:32+02:00';
    expect(formatDateTimeSeconds(iso).startsWith(formatDateTime(iso))).toBe(true);
    expect(formatDateTime(iso)).toMatch(/^\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}$/);
  });
});

/**
 * `now` is injected, so every boundary below is exact rather than raced against the clock the way
 * a `Date.now()` default would be (GC-135).
 */
describe('relativeTime', () => {
  const NOW = new Date('2026-09-06T12:00:00').getTime();
  const ago = (ms: number): string => relativeTime(new Date(NOW - ms).toISOString(), NOW);

  it('says "just now" for the first minute', () => {
    expect(ago(0)).toBe('just now');
    expect(ago(59_000)).toBe('just now');
  });

  it('turns over to minutes at exactly 60 seconds', () => {
    expect(ago(60_000)).toBe('1 minute ago');
    expect(ago(119_000)).toBe('1 minute ago');
    expect(ago(120_000)).toBe('2 minutes ago');
  });

  it('counts hours up to the last minute of the day', () => {
    expect(ago(60 * 60_000)).toBe('1 hour ago');
    expect(ago(23 * 60 * 60_000)).toBe('23 hours ago');
  });

  it('turns over to days at exactly 24 hours', () => {
    expect(ago(24 * 60 * 60_000)).toBe('1 day ago');
    expect(ago(2 * 24 * 60 * 60_000)).toBe('2 days ago');
  });

  it('gives the absolute date at the threshold, and the last relative answer just under it', () => {
    expect(ago(29 * 24 * 60 * 60_000)).toBe('29 days ago');
    expect(ago(30 * 24 * 60 * 60_000)).toBe('07/08/2026');
    expect(ago(400 * 24 * 60 * 60_000)).toBe('02/08/2025');
  });

  it('reads a date in the future as "just now", never as a negative count', () => {
    // A commit made under a skewed clock is the ordinary case here (GC-135).
    expect(ago(-60_000)).toBe('just now');
    expect(ago(-5 * 24 * 60 * 60_000)).toBe('just now');
  });

  it('returns an unparseable string unchanged, like the other two', () => {
    expect(relativeTime('not a date', NOW)).toBe('not a date');
  });
});
