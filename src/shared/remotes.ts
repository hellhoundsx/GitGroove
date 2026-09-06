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

/**
 * Where a remote can be **read** in a browser: `git@github.com:owner/repo.git` becomes
 * `https://github.com/owner/repo`, and anything this cannot make sense of answers `null` so the
 * menu row is absent rather than offered and broken (GC-159).
 *
 * Host-agnostic on purpose: the shapes below are the same on every hosting service, and a list of
 * providers would rot. So no GitHub special-casing, and no deep links to a branch, a commit or a
 * pull request, whose paths *are* per-provider.
 *
 * An `http:`/`https:` remote keeps its own scheme, since it is already a browsable URL and
 * rewriting the scheme of an intranet host is how a working link becomes a dead one; the ssh
 * forms, which have no browsable scheme of their own, become `https:`. Two things are dropped in
 * every case: any `user@` in front of the host, which does not belong in a link handed to a
 * browser, and an ssh port, which is not the web one. Called in both processes — the menu label
 * and the URL the channel is asked to open come from this one answer, which is why it lives here
 * beside `defaultRemote` (GC-031).
 */
export function remoteUrlToWeb(fetchUrl: string): string | null {
  const url = fetchUrl.trim();
  if (url === '') return null;

  /** `<proto>://<host>/<path>` less the `.git` and any trailing slash, or null if nothing is left. */
  const build = (proto: string, host: string, path: string): string | null => {
    const trimmed = path
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    if (host === '' || trimmed === '') return null;
    return `${proto}://${host}/${trimmed}`;
  };

  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(.*)$/.exec(url);
  if (scheme) {
    const proto = scheme[1]!.toLowerCase();
    // `file:` is the one to keep out deliberately: a local bare repository is a perfectly good
    // remote and has no web address at all. Everything else unrecognised goes the same way.
    if (!['http', 'https', 'ssh', 'git'].includes(proto)) return null;
    const rest = scheme[2]!;
    const slash = rest.indexOf('/');
    if (slash < 0) return null;
    const authority = rest.slice(0, slash);
    const host = authority.slice(authority.lastIndexOf('@') + 1);
    const web = proto === 'http' || proto === 'https' ? host : host.replace(/:\d+$/, '');
    return build(proto === 'http' ? 'http' : 'https', web, rest.slice(slash + 1));
  }

  // scp syntax, `[user@]host:path`. The path may not start with a separator, which is what keeps a
  // Windows drive out: `C:/repos/x.git` and `C:\repos\x.git` are paths, not hosts. A one-character
  // host is refused for the same reason, since `C:repos/x.git` is a path relative to a drive.
  const scp = /^(?:[^@/\\]+@)?([^@:/\\]+):([^/\\].*)$/.exec(url);
  if (scp && scp[1]!.length > 1) return build('https', scp[1]!, scp[2]!);
  return null;
}

/**
 * Whether a URL is one the app may hand to the OS browser (GC-159). `shell.openExternal` will
 * follow whatever it is given, and a `file:` or `javascript:` URL is a way out of the app, so the
 * two channels that can reach it — `shell:openExternal` and `setWindowOpenHandler` — both ask
 * this. Stated once, here, because a second copy of a security check is a second chance to get it
 * wrong.
 */
export function isWebUrl(url: string): boolean {
  try {
    const proto = new URL(url).protocol;
    return proto === 'http:' || proto === 'https:';
  } catch {
    return false;
  }
}
