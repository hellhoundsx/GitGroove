import { type HTMLAttributes, type JSX } from 'react';
import type { GitRef } from '@shared/types';
import { Check, Cloud, Pin, Tag } from 'lucide-react';
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

interface Props extends HTMLAttributes<HTMLSpanElement> {
  chip: Chip;
  /** The lane colour the graph tints a chip with. The panel has no lanes and passes none. */
  color?: string;
  pinned?: boolean;
  /** A chip inside the expanded `+N` block, which takes the block's own background. */
  plain?: boolean;
  /** False drops the trailing upstream cloud, which is what a narrow ref column does (GC-071). */
  upstreamMark?: boolean;
  /** The HTML5 drag attributes, which only the graph and the left panel hand out (GC-015). */
  dragAttrs?: RefDragAttrs | null;
}

export function RefChip({ chip, color, pinned = false, plain = false, upstreamMark = true, dragAttrs, className = '', style, ...rest }: Props): JSX.Element {
  const r = chip.ref;
  return (
    <span
      {...(dragAttrs ?? {})}
      {...rest}
      className={`ref-chip ${r.kind} ${r.isHead ? 'head' : ''} ${plain ? 'plain' : ''} ${className}`}
      style={style ?? (plain || r.kind === 'tag' || color === undefined ? undefined : { background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` })}
    >
      {pinned && <Icon of={Pin} size={11} className="chip-icon pinned" />}
      {r.isHead && <Icon of={Check} size={11} className="chip-icon" />}
      {r.kind === 'tag' && <Icon of={Tag} size={11} className="chip-icon" />}
      {r.kind === 'remote' && <Icon of={Cloud} size={11} className="chip-icon" />}
      <span className="chip-name">{r.name}</span>
      {chip.upstreamHere && upstreamMark && <Icon of={Cloud} size={11} className="chip-icon trailing" />}
    </span>
  );
}
