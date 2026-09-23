import { type CSSProperties, type HTMLAttributes, type JSX } from 'react';
import type { GitRef } from '@shared/types';
import { IconCheck as Check, IconCloud as Cloud, IconDeviceLaptop as Laptop, IconPin as Pin, IconTag as Tag, type TablerIcon } from '@tabler/icons-react';
import { Icon } from '../ui/icons';
import type { RefDragAttrs } from '../ui/refDrag';

/**
 * What a ref chip is, in the one place both surfaces that draw one read from (GC-087).
 *
 * The graph's ref column and the commit view's header show the same refs on the same commit, so
 * the ordering, the absorb-the-upstream rule and the markup itself live here rather than in
 * `CommitGraph.tsx` with the panel rendering git's `%D` decoration as text beside it. What each
 * surface still owns is the behaviour around the chip: the graph adds lane colour, the pin marker,
 * the drag attributes and the `+N` fold, and the panel adds none of them.
 */

/**
 * A detached HEAD is on no branch, so `for-each-ref` marks nothing as the checked-out ref and the
 * chip that carries the check simply disappears. The graph builds its own (GC-061); it is never a
 * real ref, so `getRefs` and `GitRef` are untouched and the ref menu never sees it.
 */
export const HEAD_REF = 'HEAD';
export const headChipFor = (sha: string): GitRef => ({ name: HEAD_REF, fullName: HEAD_REF, kind: 'head', sha, isHead: true });

/** A ref chip to draw; a local branch absorbs its upstream when both point at the same commit. */
export interface Chip {
  ref: GitRef;
  upstreamHere: boolean;
}

/**
 * The chips for one commit's refs, in the order they are drawn: a local branch absorbs the remote
 * of the same name when both sit here, so `main` + `origin/main` is one chip carrying the cloud.
 */
export function chipsFor(refs: GitRef[]): Chip[] {
  const absorbed = new Set<string>();
  for (const r of refs) if (r.kind === 'head' && r.upstream && refs.some((o) => o.kind === 'remote' && o.name === r.upstream)) absorbed.add(r.upstream);
  return refs.filter((r) => !(r.kind === 'remote' && absorbed.has(r.name))).map((r) => ({ ref: r, upstreamHere: r.kind === 'head' && !!r.upstream && absorbed.has(r.upstream) }));
}

/**
 * The marks that trail a chip's name: what kind of ref it is, and where else it lives (GC-146).
 *
 * The study is specific about both the vocabulary and the order — a chip is "status icon (check
 * mark = checked out), name, then small icons: laptop = local branch, cloud or remote logo =
 * remote" — so status leads and kind trails. We disagreed with ourselves about it before this: a
 * plain local branch carried no mark at all, a remote's cloud **led** the name, and the cloud a
 * local branch gained by absorbing its upstream **trailed** it, which is the same icon on two
 * sides of the same chip. A branch that has absorbed its upstream is in both places and says so
 * with both marks, in that order.
 *
 * Exported because `CommitGraph` counts them: how many there are is what decides whether they
 * fit beside the name in a narrow column (GC-071, GC-146).
 */
export function kindMarksOf(chip: Chip): TablerIcon[] {
  const r = chip.ref;
  // The synthetic HEAD chip stands for a detached HEAD and is on no branch at all (GC-061), so it
  // takes no kind mark: a laptop on it would claim a local branch that does not exist.
  if (r.fullName === HEAD_REF) return [];
  if (r.kind === 'tag') return [Tag];
  if (r.kind === 'remote') return [Cloud];
  return chip.upstreamHere ? [Laptop, Cloud] : [Laptop];
}

/**
 * A chip's lane fill. Every branch chip is a 30% blend of its lane over the panel — readable, and
 * each one clearly its lane's — and the **checked-out** branch is the bright one: its lane's
 * `--lane-N-chip`, the brightest fill that still holds white text at 4.6:1, with white text like
 * every other chip and no ring (asked for by Ricardo, pointing at GitKraken, whose active chip is
 * a vivid fill beside dark ones). Four versions came before it the same day: fading the other
 * chips made every other ref hard to read, a 50% blend with a ring and a 55%-over-black fill were
 * both too close to the others in brightness, and the whole lane colour needed dark text on most
 * lanes. Inside the open `+N` block (`plain`) a chip takes the block's own background, except the
 * checked-out one, which keeps its fill there too. A tag and a chip with no lane (the commit
 * view's header) take the stylesheet's.
 */
export function chipStyle(r: GitRef, color: string | undefined, plain: boolean): CSSProperties | undefined {
  if (color === undefined || r.kind === 'tag') return undefined;
  if (r.isHead) return { background: headFill(color) };
  return plain ? undefined : { background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` };
}

/** The checked-out chip's fill for a lane colour as `laneColor` writes it (`var(--lane-N)`). */
export function headFill(color: string): string {
  const lane = /^var\(--lane-(\d+)\)$/.exec(color);
  return lane ? `var(--lane-${lane[1]}-chip)` : `color-mix(in srgb, ${color} 55%, var(--lane-shade))`;
}

interface Props extends HTMLAttributes<HTMLSpanElement> {
  chip: Chip;
  /** The lane colour the graph tints a chip with. The panel has no lanes and passes none. */
  color?: string;
  pinned?: boolean;
  /** A chip inside the expanded `+N` block, which takes the block's own background. */
  plain?: boolean;
/**
   * False drops the trailing kind marks, which is what a narrow ref column does (GC-071, GC-146).
   * It was the upstream cloud alone when the cloud was the only trailing mark; every one of them
   * gives way now, so a chip at the column's minimum is exactly as wide as it was before the
   * laptop existed and the name is no more truncated for having gained one.
   */
  kindMarks?: boolean;
  /** The HTML5 drag attributes, which only the graph and the left panel hand out (GC-015). */
  dragAttrs?: RefDragAttrs | null;
}

export function RefChip({ chip, color, pinned = false, plain = false, kindMarks = true, dragAttrs, className = '', style, ...rest }: Props): JSX.Element {
  const r = chip.ref;
  const marks = kindMarks ? kindMarksOf(chip) : [];
  return (
    <span
      {...(dragAttrs ?? {})}
      {...rest}
      className={`ref-chip ${r.kind} ${r.isHead ? 'head' : ''} ${plain ? 'plain' : ''} ${className}`}
      style={style ?? chipStyle(r, color, plain)}
    >
      {/* Status leads: whether this is the checked-out ref, and whether it is pinned. */}
      {pinned && <Icon of={Pin} size={11} className="chip-icon pinned" />}
      {r.isHead && <Icon of={Check} size={11} className="chip-icon" />}
      <span className="chip-name">{r.name}</span>
      {/* Kind trails: what it is, and where else it lives (GC-146). */}
      {marks.map((mark, i) => (
        <Icon key={i} of={mark} size={11} className="chip-icon trailing" />
      ))}
    </span>
  );
}
