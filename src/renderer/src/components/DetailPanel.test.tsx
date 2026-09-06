import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DetailPanel } from './DetailPanel';
import { UiProvider } from '../ui/UiContext';
import { WIP } from '../graph/CommitGraph';
import { DEFAULT_PREFS, setPrefs } from '../prefs';
import type { Commit, CommitFile, RepoStatus, StatusEntry } from '@shared/types';

// The commit view's working-directory banner (GC-045). The e2e suite drives the dirty case
// end to end; what it cannot reach is the clean one — the fixture always has changes waiting, and
// `App` closes a file view as soon as its path leaves the status list, so there is no moment in a
// run where a commit is selected over an empty working tree.

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  cleanup();
  setPrefs({ ...DEFAULT_PREFS });
  localStorage.clear();
});

/** The one call `CommitView` makes; `prefs.ts` reaches for `setTheme` on every write. */
const stubApi = (files: CommitFile[] = []): void => {
  (window as unknown as { api: Record<string, unknown> }).api = {
    getCommitFiles: () => Promise.resolve(files),
    setTheme: () => Promise.resolve(),
  };
};

const COMMIT: Commit = {
  sha: 'b4220d4b4220d4b4220d4b4220d4b4220d4b4220',
  parents: [],
  refs: [],
  summary: 'A commit to read',
  body: '',
  authorName: 'Test User',
  authorEmail: 'test@example.com',
  authorDate: '2026-09-01T10:00:00Z',
  committerName: 'Test User',
  committerDate: '2026-09-01T10:00:00Z',
};

const entry = (path: string): StatusEntry => ({ path, staged: null, unstaged: 'modified' });
const statusWith = (...paths: string[]): RepoStatus => ({
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0,
  operation: null,
  entries: paths.map(entry),
});

const noop = (): void => undefined;

function renderPanel(status: RepoStatus, onSelectSha: (sha: string) => void = noop, files: CommitFile[] = []): void {
  stubApi(files);
  setPrefs({ avatars: false }); // no gravatar and no crypto.subtle in the render
  render(
    <UiProvider>
      <DetailPanel
        repo="C:/repo"
        commit={COMMIT}
        stash={null}
        headCommit={COMMIT}
        status={status}
        openFile={null}
        refs={[]}
        onRefMenu={noop}
        onRefActivate={noop}
        actions={
          {
            stage: noop,
            unstage: noop,
            discard: noop,
            stageAll: noop,
            unstageAll: noop,
            commit: noop,
            abort: noop,
            ignore: noop,
          } as never
        }
        resize={{} as never}
        focusSummary={0}
        draft={{ summary: '', body: '', amend: false }}
        onDraft={noop}
        onSelectSha={onSelectSha}
        onOpenFile={noop}
        onFileMenu={noop}
      />
    </UiProvider>,
  );
}

describe('the commit view banner', () => {
  it('counts what is waiting in the working directory and gets back to it', () => {
    let selected: string | null = null;
    renderPanel(statusWith('a.txt', 'b.txt'), (sha) => (selected = sha));

    expect(screen.getByText('2 file changes in the working directory')).toBeTruthy();
    fireEvent.click(screen.getByText('View changes'));
    expect(selected).toBe(WIP);
  });

  it('says "file change" for one, so the banner never reads as a count of zero-or-many', () => {
    renderPanel(statusWith('a.txt'));
    expect(screen.getByText('1 file change in the working directory')).toBeTruthy();
  });

  it('shows nothing at all when the tree is clean', () => {
    renderPanel(statusWith());
    expect(document.querySelector('.banner')).toBeNull();
  });
});

describe("the commit view's change readout (GC-143)", () => {
  const files: CommitFile[] = [
    { path: 'a.txt', kind: 'added' },
    { path: 'b.txt', kind: 'modified' },
    { path: 'c.txt', kind: 'deleted' },
    { path: 'd.txt', kind: 'renamed', origPath: 'was.txt' },
  ];

  it('draws each count with the mark the file rows draw, not a text glyph', async () => {
    renderPanel(statusWith(), noop, files);
    const readout = await screen.findByText(/1 added/).then((el) => el.closest('.readout')!);
    // The four states the readout can report, each an icon and a number. Before this they were the
    // characters `+`, `✎`, `−` and `→` — a second, unrelated rendering of the three states the
    // rows below draw with lucide, which is the half of GC-143 that weight alone could not fix.
    expect(readout.querySelectorAll('svg.kind')).toHaveLength(4);
    expect(readout.textContent).not.toMatch(/[✎−→]/);
    // Same mark for the same kind in both places: the class is what carries the colour token and
    // the kind, and it is `FileKindIcon` that puts it on either surface.
    for (const kind of ['added', 'modified', 'deleted', 'renamed']) {
      expect(readout.querySelector(`svg.kind-${kind}`)).toBeTruthy();
    }
  });

  it('draws the modified pencil filled and the rest heavier than the app default', async () => {
    renderPanel(statusWith(), noop, files);
    const readout = await screen.findByText(/1 added/).then((el) => el.closest('.readout')!);
    const pencil = readout.querySelector('svg.kind-modified')!;
    // The pencil's meaning is its silhouette, so it is painted rather than outlined; `fill` is on
    // the lucide glyph itself, which is what keeps lucide-react the only icon source (rule 1).
    expect(pencil.getAttribute('fill')).toBe('currentColor');
    const plus = readout.querySelector('svg.kind-added')!;
    expect(plus.getAttribute('fill')).toBe('none');
    // 1.75 at 12px is the hairline this ticket measured.
    expect(Number(plus.getAttribute('stroke-width'))).toBeGreaterThan(1.75);
  });
});
