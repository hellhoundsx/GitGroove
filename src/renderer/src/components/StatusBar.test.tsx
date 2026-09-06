import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { StatusBar, headline } from './StatusBar';

// House style: explicit vitest imports, so RTL's own hooks never register and are wired by hand
// (see `Preferences.test.tsx` for the reasoning).
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(cleanup);

// Real git output, copied from what reaches the renderer rather than paraphrased: the whole point
// of GC-202 is which of git's own lines gets drawn, so a made-up shape would prove nothing.
const NON_FAST_FORWARD = [
  'To C:/Users/Ricar/AppData/Local/Temp/gitclient-e2e/origin.git',
  ' ! [rejected]        main -> main (non-fast-forward)',
  "error: failed to push some refs to 'C:/Users/Ricar/AppData/Local/Temp/gitclient-e2e/origin.git'",
  "hint: Updates were rejected because the tip of your current branch is behind",
  'hint: its remote counterpart. If you want to integrate the remote changes,',
  "hint: use 'git pull' before pushing again.",
  "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
].join('\n');

const FETCH_FIRST = [
  'To https://github.com/hellhoundsx/GitClient.git',
  ' ! [rejected]        main -> main (fetch first)',
  "error: failed to push some refs to 'https://github.com/hellhoundsx/GitClient.git'",
  'hint: Updates were rejected because the remote contains work that you do',
  'hint: not have locally.',
].join('\n');

const MERGE_CONFLICT = ['Auto-merging notes.txt', 'CONFLICT (content): Merge conflict in notes.txt', 'Automatic merge failed; fix conflicts and then commit the result.'].join('\n');

const AUTH = [
  "remote: Permission to hellhoundsx/GitClient.git denied to someone.",
  'remote: Please re-authorise your token for SSO.',
  "fatal: unable to access 'https://github.com/hellhoundsx/GitClient.git/': The requested URL returned error: 403",
].join('\n');

const ONE_LINE = "error: pathspec 'nope' did not match any file(s) known to git";

describe('headline', () => {
  it('picks the rejection line, not the "failed to push some refs" line under it', () => {
    // The regression GC-202 is named for: `error:` was matched before anything looked for a
    // rejection, so the drawn line named no cause and spent its width on a path.
    expect(headline(NON_FAST_FORWARD)).toBe('! [rejected]        main -> main (non-fast-forward)');
    expect(headline(FETCH_FIRST)).toBe('! [rejected]        main -> main (fetch first)');
  });

  it('picks the conflict line over the "Automatic merge failed" line', () => {
    expect(headline(MERGE_CONFLICT)).toBe('CONFLICT (content): Merge conflict in notes.txt');
  });

  it('picks the fatal line of a credential refusal, over its remote: lines', () => {
    expect(headline(AUTH)).toContain('fatal: unable to access');
  });

  it('answers a single-line error with itself', () => {
    expect(headline(ONE_LINE)).toBe(ONE_LINE);
  });

  it('answers a message matching nothing with its first line', () => {
    expect(headline('something odd\nand more of it')).toBe('something odd');
  });
});

const bar = (props: Partial<Parameters<typeof StatusBar>[0]> = {}): void => {
  render(
    <StatusBar
      repoPath="C:/repo"
      commitCount={3}
      busy={null}
      generation={1}
      error={null}
      notice={null}
      onDismissError={() => {}}
      onDismissNotice={() => {}}
      {...props}
    />,
  );
};

describe('StatusBar', () => {
  it('draws the rejection line and offers the rest', () => {
    bar({ error: NON_FAST_FORWARD, onErrorDetails: () => {} });

    const err = document.querySelector('button.err');
    expect(err?.querySelector('.line')?.textContent).toContain('(non-fast-forward)');
    expect(err?.textContent).not.toContain('failed to push some refs');
    // The affordance is on screen, not only on a `title` (GC-202).
    expect(screen.getByText('Details')).toBeTruthy();
    expect(err?.className).toContain('has-details');
    // Everything git wrote is still on the title, as it always was.
    expect(err?.getAttribute('title')).toContain("hint: use 'git pull' before pushing again.");
  });

  it('leaves a one-line failure exactly as it was: one line, no details mark', () => {
    bar({ error: ONE_LINE });

    const err = document.querySelector('button.err');
    expect(err?.querySelector('.line')?.textContent).toContain(ONE_LINE);
    expect(document.querySelector('.err .more')).toBeNull();
    expect(err?.className).not.toContain('has-details');
  });

  it('keeps the notice its own severity and gives it no details', () => {
    bar({ notice: 'Stashed the changes; the pop is yours to make.' });

    expect(document.querySelector('button.notice')).toBeTruthy();
    expect(document.querySelector('button.err')).toBeNull();
  });
});
