import type { JSX } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Copy, FileType2, Minus, Pencil, Plus, TriangleAlert } from 'lucide-react';
import type { FileChangeKind } from '@shared/types';

interface IconProps {
  of: LucideIcon;
  size?: number;
  className?: string;
  title?: string;
}

/** Lucide icon with the app's default stroke weight. */
export function Icon({ of: Component, size = 14, className, title }: IconProps): JSX.Element {
  return <Component size={size} strokeWidth={1.75} className={className} aria-hidden={title ? undefined : true} aria-label={title} />;
}

const kindIcon: Record<FileChangeKind, LucideIcon> = {
  added: Plus,
  untracked: Plus,
  modified: Pencil,
  deleted: Minus,
  renamed: ArrowRight,
  copied: Copy,
  typechange: FileType2,
  conflicted: TriangleAlert,
};

export function FileKindIcon({ kind, size = 12 }: { kind: FileChangeKind; size?: number }): JSX.Element {
  return <Icon of={kindIcon[kind]} size={size} className={`kind kind-${kind}`} title={kind} />;
}
