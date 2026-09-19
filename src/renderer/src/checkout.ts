/**
 * What git says when a checkout cannot carry the working tree across (GC-215).
 *
 * `git checkout` takes uncommitted changes onto the branch being checked out wherever it can —
 * that is its own behaviour and the one a user double-clicking a branch is asking for — and
 * refuses, touching nothing, only when a file it would have to rewrite has been changed. So the
 * app attempts the checkout rather than asking first, and this is what tells that one refusal
 * apart from every other failure: the *reason* a checkout did not happen decides whether the user
 * is shown a red line or a question with a way out of it.
 *
 * It reads git's message rather than an error flag from the main process for the reason the
 * flags exist at all — only an error's `name` survives Electron's serialisation — and the message
 * is what carries the paths, which is the part worth saying. `git.ts` already reads git's own
 * words in the same way where the answer is only in them (`/already exists/` on a tracked
 * checkout), and `StatusBar`'s `headline` does it over this very text.
 */
export interface CheckoutBlock {
  /**
   * Which of the two refusals it is. `tracked` is a file the user has edited that the checkout
   * would have to rewrite; `untracked` is a file not in the index at all sitting where the branch
   * being checked out has one. They are worth telling apart: the first is the user's work in
   * progress and the second is usually something left lying about, and the sentence shown to them
   * says so.
   */
  kind: 'tracked' | 'untracked';
  /** The paths git listed, in its order. Empty when git named the problem but not the files. */
  paths: string[];
}

/** The header git prints above the list, in either of its two forms. */
const HEADER = /would be overwritten by (checkout|merge)/i;

/**
 * Read a failed checkout's message, answering what is in the way — or `null` when the checkout
 * failed for any other reason, which is every failure that belongs on the status bar.
 *
 * The paths are the indented lines under the header and stop at the first line that is not one:
 * git follows the list with `Please commit your changes…` and `Aborting`, neither indented. A
 * header with no list still answers a block rather than `null` — the refusal is the header, and
 * the question to put to the user is the same whether or not its files can be named.
 */
export function checkoutBlock(message: string): CheckoutBlock | null {
  const lines = message.split('\n');
  const at = lines.findIndex((l) => HEADER.test(l));
  if (at < 0) return null;
  const paths: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (!/^\s+\S/.test(line)) break;
    paths.push(line.trim());
  }
  return { kind: /untracked/i.test(lines[at]!) ? 'untracked' : 'tracked', paths };
}

/** How many paths a sentence names before it starts counting instead. */
const NAMED = 3;

/**
 * The files in the way, as one clause of a sentence: the first few by name and the rest as a
 * count. A modal body scrolls (GC-103), so a long list would fit — but the question being asked
 * is whether to stash, and the answer does not change with the fortieth file's name.
 */
export function blockedList(paths: string[]): string {
  if (!paths.length) return '';
  const head = paths.slice(0, NAMED).join(', ');
  const rest = paths.length - NAMED;
  return rest > 0 ? `${head} and ${rest} more` : head;
}
