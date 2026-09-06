import type { GitRef, Remote } from './types';

/**
 * The remote a push lands on when the caller has not named one: `origin` if it
 * exists, otherwise the first remote git reports. `getRemotes` sorts by name, so
 * without the `origin` preference a remote called `alpha` would win (GC-031).
 * Main and renderer share this so the menu labels and the push agree.
 */
export function defaultRemote(remotes: readonly Remote[]): string | undefined {
  return remotes.find((r) => r.name === 'origin')?.name ?? remotes[0]?.name;
}

/**
 * Where a local branch also lives on a remote, so deleting it can offer to take that copy with it
 * (GC-112). The upstream comes first, since that is the branch git itself considers the same one;
 * a remote-tracking ref of the same name answers for a branch pushed without `-u`. Either way the
 * answer is a ref the snapshot actually lists, so a branch whose upstream has already been pruned
 * offers nothing and the checkbox is absent rather than disabled.
 *
 * The split is at the remote's name and not at the first slash, because a **branch** name may
 * carry slashes of its own — `origin` plus `feature/x` gives `origin/feature/x`, and splitting on
 * the first slash would answer `feature/x` on a remote called `origin`... which is right, but
 * `upstream/feature/x` would answer `feature/x` on `feature`. The longest match wins for the same
 * reason, though git makes the nested-*remote* case unreachable: `git remote add origin/fork` with
 * `origin` present is `fatal: remote name 'origin/fork' is a subset of existing remote 'origin'`,
 * and adding `foo` after `foo/bar` is the same fatal the other way round (GC-134, verified against
 * git 2.x both ways).
 *
 * Pure, and here rather than in `App.tsx`, so the answer between a delete confirmation and the
 * checkbox naming a remote is the one thing in that path a test can hold (GC-134).
 */
export function remoteCopyOf(branch: GitRef, refs: readonly GitRef[], remotes: readonly Remote[]): { remote: string; branch: string } | null {
  const byLength = [...remotes].sort((a, b) => b.name.length - a.name.length);
  const split = (full: string): { remote: string; branch: string } | null => {
    const rem = byLength.find((m) => full.startsWith(`${m.name}/`));
    return rem ? { remote: rem.name, branch: full.slice(rem.name.length + 1) } : null;
  };
  const tracking = refs.filter((x) => x.kind === 'remote').map((x) => x.name);
  if (branch.upstream && tracking.includes(branch.upstream)) return split(branch.upstream);
  const same = tracking.find((n) => split(n)?.branch === branch.name);
  return same ? split(same) : null;
}
