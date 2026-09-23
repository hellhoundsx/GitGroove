import type { JSX } from 'react';
import { IconArrowRight as ArrowRight, IconCopy as Copy, IconFileSymlink as FileType2, IconMinus as Minus, IconPencil as Pencil, IconPlus as Plus, IconAlertTriangle as TriangleAlert, type TablerIcon } from '@tabler/icons-react';
import type { FileChangeKind } from '@shared/types';

interface IconProps {
  of: TablerIcon;
  size?: number;
  className?: string;
  title?: string;
  /**
   * A stroke weight of this icon's own, for a glyph drawn small enough that 1.75 is a hairline
   * (GC-143). It is a prop here rather than a second icon component on purpose: there is one place
   * the app's stroke weight is decided and this keeps it that way.
   */
  weight?: number;
  /** Paint the glyph rather than outline it — `fill: currentColor`, never a second asset (rule 1). */
  filled?: boolean;
}

/** A Tabler icon with the app's default stroke weight (Tabler calls the weight `stroke`). */
export function Icon({ of: Component, size = 14, className, title, weight = 1.75, filled }: IconProps): JSX.Element {
  return <Component size={size} stroke={weight} fill={filled ? 'currentColor' : 'none'} className={className} aria-hidden={title ? undefined : true} aria-label={title} />;
}

const kindIcon: Record<FileChangeKind, TablerIcon> = {
  added: Plus,
  untracked: Plus,
  modified: Pencil,
  deleted: Minus,
  renamed: ArrowRight,
  copied: Copy,
  typechange: FileType2,
  conflicted: TriangleAlert,
};

/**
 * What a kind mark is drawn with at the 12px these actually use (GC-143). Measured on a staged
 * row before this: `lucide-plus kind kind-added`, `width 12`, `stroke-width 1.75`, `fill none` —
 * a hairline at the one size the app draws them. So they carry a weight of their own.
 *
 * The pencil is the exception, and gets filled instead: its meaning is the silhouette, and a
 * heavier outline of the same shape only makes a fatter outline. Filled is `fill: currentColor`
 * on the Tabler glyph, so @tabler/icons-react stays the only icon source.
 */
const KIND_WEIGHT = 2.5;
const FILLED_KINDS: readonly FileChangeKind[] = ['modified'];

export function FileKindIcon({ kind, size = 12 }: { kind: FileChangeKind; size?: number }): JSX.Element {
  const filled = FILLED_KINDS.includes(kind);
  return <Icon of={kindIcon[kind]} size={size} weight={filled ? 1.75 : KIND_WEIGHT} filled={filled} className={`kind kind-${kind}`} title={kind} />;
}
