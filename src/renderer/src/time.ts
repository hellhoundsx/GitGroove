/**
 * How this app writes a timestamp, in one place (GC-133).
 *
 * Both helpers build the string from the date's own parts rather than calling `toLocaleString`,
 * whose field order follows the machine's locale: the graph had already refused that call and the
 * detail panel made it, so one commit's date read `06/09/2026` in the DATE / TIME cell and
 * `9/6/2026` in the author line for anyone whose region is not en-GB. The two differ in what they
 * show — the 12px graph cell has no room for seconds — and never in field order.
 *
 * An unparseable string comes back unchanged: the value is git's own `authorDate` and showing it
 * raw says more than "Invalid Date".
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `dd/mm/yyyy` in the local zone. */
const day = (d: Date): string => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;

/** `dd/mm/yyyy, HH:MM` in the local zone — the graph's DATE / TIME column. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${day(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `dd/mm/yyyy, HH:MM:SS` in the local zone — the commit view's author line, which has the room. */
export function formatDateTimeSeconds(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${day(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
