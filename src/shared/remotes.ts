import type { Remote } from './types';

/**
 * The remote a push lands on when the caller has not named one: `origin` if it
 * exists, otherwise the first remote git reports. `getRemotes` sorts by name, so
 * without the `origin` preference a remote called `alpha` would win (GC-031).
 * Main and renderer share this so the menu labels and the push agree.
 */
export function defaultRemote(remotes: readonly Remote[]): string | undefined {
  return remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name;
}
