// Watches one repository for changes made outside the app — an editor saving a file, a commit
// typed in a terminal — and pushes `repo:changed` to the window that asked for it (GC-011).
//
// Node's `fs.watch` with `{ recursive: true }` is the whole mechanism: on Windows it is
// ReadDirectoryChangesW, which watches the entire subtree in the kernel, so one watcher on the
// working tree root covers `.git/` as well and no dependency (chokidar) is needed. A watcher that
// cannot start (a network share, a folder that just disappeared) is not an error the user needs to
// see: the app simply keeps refreshing on its own actions the way it always did.

import { watch, type FSWatcher } from 'node:fs';
import type { WebContents } from 'electron';
import type { RepoChange } from '@shared/types';

/** A burst of file-system events is collected for this long, then pushed as one change. */
const DEBOUNCE_MS = 300;

/**
 * The event path `ignored` and `scopeOf` decide on: relative to the repository root, forward
 * slashes, and empty when the platform could not name what moved (Windows hands us backslashes).
 * It is its own exported function only so a test can feed the two rules below exactly the string
 * the watcher feeds them, rather than a second copy of the normalisation (GC-063).
 */
export function toRel(filename: string | Buffer | null): string {
  return typeof filename === 'string' ? filename.replace(/\\/g, '/') : '';
}

/**
 * Paths the watcher never reacts to, matched against the event path relative to the repository
 * root with forward slashes. `git check-ignore` would be the thorough answer for the working tree,
 * but every git call lives in `git.ts` and the watcher stays pure fs, so this is a static list of
 * the paths that churn: git's object and reflog writes, the `.lock` files it drops on every
 * command, and the one directory that dwarfs the rest of a checkout.
 */
export function ignored(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.includes('node_modules')) return true;
  if (parts[0] !== '.git') return false;
  // index.lock, refs/heads/<name>.lock, packed-refs.lock — every one of them is written and
  // removed around a real change we see anyway.
  if (rel.endsWith('.lock')) return true;
  // A bare `.git` event names the directory and nothing inside it, so it carries no information a
  // more specific event does not also carry: anything that really changes inside `.git` arrives as
  // its own relative path (`.git/HEAD`, `.git/refs/heads/<name>`, `.git/index`). Dropping it is
  // what stops the refresh loop (GC-011): our own `git status` creates and deletes
  // `.git/index.lock`, Windows reports that write as a `change` on `.git` itself, the renderer
  // reloads the status, that runs `git status` again — a `repo:changed` push every 300ms forever
  // on a completely idle repository. The one-level-deeper names below already cover their own bare
  // directory events (`.git/objects` is `parts[1] === 'objects'`), so `.git` is the only gap.
  if (parts.length === 1) return true;
  const seg = parts[1];
  return seg === 'objects' || seg === 'logs' || seg === 'lfs' || seg === 'modules' || seg === 'fsmonitor--daemon' || seg === 'COMMIT_EDITMSG';
}

/**
 * `.git/refs`, `HEAD` and `packed-refs` move the graph, so the renderer reloads the whole
 * snapshot; anything else (a working tree file, `.git/index`, `MERGE_HEAD`) only moves the status.
 */
export function scopeOf(rel: string): RepoChange['scope'] {
  const parts = rel.split('/');
  if (parts[0] !== '.git') return 'tree';
  const seg = parts[1] ?? '';
  return seg === 'refs' || seg === 'HEAD' || seg === 'packed-refs' ? 'refs' : 'tree';
}

interface Watch {
  repo: string;
  watcher: FSWatcher;
  timer: NodeJS.Timeout | null;
  scope: RepoChange['scope'] | null; // strongest scope seen since the last push
}

/** One watch per window, keyed by webContents id: this ticket does not watch several repos. */
const watches = new Map<number, Watch>();

function stop(id: number): void {
  const w = watches.get(id);
  if (!w) return;
  if (w.timer) clearTimeout(w.timer);
  w.watcher.close();
  watches.delete(id);
}

/** Point a window's watcher at `repo`, or stop it when `repo` is null. */
export function watchRepo(sender: WebContents, repo: string | null): void {
  const id = sender.id;
  if (watches.get(id)?.repo === repo) return;
  stop(id);
  if (repo === null) return;

  let watcher: FSWatcher;
  try {
    watcher = watch(repo, { recursive: true });
  } catch {
    return; // no watcher: the app still refreshes after its own actions
  }
  const w: Watch = { repo, watcher, timer: null, scope: null };
  watches.set(id, w);

  watcher.on('error', () => stop(id));
  watcher.on('change', (_event, filename) => {
    // A null filename means the platform could not name what moved; assume the working tree.
    const rel = toRel(filename);
    if (rel && ignored(rel)) return;
    const scope = rel ? scopeOf(rel) : 'tree';
    // 'refs' wins while a burst is collected: the full reload it asks for covers a tree change too.
    if (w.scope !== 'refs') w.scope = scope;
    if (w.timer) clearTimeout(w.timer);
    w.timer = setTimeout(() => {
      w.timer = null;
      const pushed = w.scope ?? 'tree';
      w.scope = null;
      if (sender.isDestroyed()) {
        stop(id);
        return;
      }
      sender.send('repo:changed', { repo, scope: pushed } satisfies RepoChange);
    }, DEBOUNCE_MS);
  });

  sender.once('destroyed', () => stop(id));
}
