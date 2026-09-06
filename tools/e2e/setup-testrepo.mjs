// Creates a disposable git repository plus a bare "origin" for the end-to-end run.
// Location: $GITCLIENT_E2E_ROOT or <tmp>/gitclient-e2e. Existing contents are removed, unless a
// run is holding the root (see the marker below); --force wipes it anyway.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.GITCLIENT_E2E_ROOT ?? join(tmpdir(), 'gitclient-e2e');
const R = join(root, 'testrepo');
const REMOTE = join(root, 'remote.git');

// Two routines share this machine and only one of them passes GITCLIENT_E2E_ROOT, so a run that
// reaches for the default root used to delete the repository, the bare origin and the shots
// directory out from under a suite that was mid-flight — silently, and the failure that followed
// named nothing (GC-064). tools/e2e/run.mjs writes this marker while it works; the wipe below
// refuses while it belongs to a process that is still alive.
const MARKER = join(root, '.e2e-owner.json');
// The branch-tip snapshot run.mjs restores the fixture to (GC-076), out of refs/ so `--all` does
// not keep a hidden branch's commits in the graph (GC-073).
const BASELINE = join(root, '.e2e-baseline.json');
// An e2e run takes about a minute, so a marker this old is left over from one that died however
// alive its pid looks: pids are reused, and an unattended routine must not be blocked for ever by
// one that happens to have come round again.
const MARKER_MAX_AGE_MS = 30 * 60 * 1000;
const markerHolder = () => {
  let m;
  try {
    m = JSON.parse(readFileSync(MARKER, 'utf8'));
  } catch {
    return null; // no marker, or one we cannot read: nothing is claiming the root
  }
  if (!Number.isInteger(m?.pid) || m.pid === process.pid) return null;
  if (!(Date.now() - Date.parse(m.started ?? '') < MARKER_MAX_AGE_MS)) return null;
  try {
    process.kill(m.pid, 0); // signal 0 only probes: alive, or EPERM for one we may not signal
  } catch (e) {
    if (e.code !== 'EPERM') return null;
  }
  return m;
};

const held = process.argv.includes('--force') ? null : markerHolder();
if (held) {
  console.error(`${root} is in use by pid ${held.pid} (${held.what ?? 'unknown'}, started ${held.started}).`);
  console.error('Refusing to wipe it. Use a root of your own with GITCLIENT_E2E_ROOT, or pass --force.');
  process.exit(2);
}

rmSync(root, { recursive: true, force: true });
mkdirSync(R, { recursive: true });

const git = (args, cwd = R) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const write = (name, content) => writeFileSync(join(R, name), content);
const bigRows = (edits = {}) =>
  Array.from({ length: 40 }, (_, i) => edits[i + 1] ?? `row ${i + 1}`).join('\n') + '\n';

git(['init', '-q', '-b', 'main']);
git(['config', 'user.email', 'test@example.com']);
git(['config', 'user.name', 'Test User']);
git(['config', 'commit.gpgsign', 'false']);
git(['config', 'core.autocrlf', 'false']);

write('a.txt', 'line1\nline2\nline3\n');
write('README.md', '# Test repo\n');
write('big.txt', bigRows());
// deleted again by 'Remove obsolete file' below, so the fixture carries a commit whose file list
// has a row for a file that is not in the working tree (GC-072)
write('obsolete.txt', 'this file is deleted in a later commit\n');
git(['add', '-A']);
git(['commit', '-qm', 'Initial commit']);

write('a.txt', 'line1\nline2 changed\nline3\n');
git(['commit', '-qam', 'Change line 2 of a.txt']);

git(['checkout', '-qb', 'feature']);
write('feature.txt', 'feature work\n');
git(['add', 'feature.txt']);
git(['commit', '-qm', 'Add feature file']);
write('feature.txt', 'feature work\nmore\n');
git(['commit', '-qam', 'Extend feature', '-m', 'Second paragraph of the body.']);

git(['checkout', '-q', 'main']);
write('main.txt', 'main work\n');
git(['add', 'main.txt']);
git(['commit', '-qm', 'Main-only change']);
git(['merge', '-q', '--no-ff', '-m', 'Merge feature into main', 'feature']);
git(['tag', 'v0.1.0']);

// The deleting commit. GC-072's case needs a commit whose file list holds a file the working tree
// no longer has, and the fixture had none: the state had to be built by hand to be seen at all.
git(['rm', '-q', 'obsolete.txt']);
git(['commit', '-qm', 'Remove obsolete file']);

git(['checkout', '-qb', 'wip-branch']);
write('wip.txt', 'wip\n');
git(['add', 'wip.txt']);
git(['commit', '-qm', 'Work on wip branch']);
git(['checkout', '-q', 'main']);

// bare remote with every branch pushed and main tracking origin/main
git(['init', '-q', '--bare', REMOTE], root);
git(['symbolic-ref', 'HEAD', 'refs/heads/main'], REMOTE);
git(['remote', 'add', 'origin', REMOTE]);
git(['push', '-q', '-u', 'origin', 'main']);
git(['push', '-q', 'origin', 'feature', 'wip-branch']);

// mixed working-directory state: unstaged edits, an untracked file, a staged edit, a staged deletion
write('a.txt', 'line1\nline2 changed\nline3\nline4 new\n');
write('new.txt', 'untracked file\n');
write('README.md', '# Test repo\nstaged change\n');
git(['add', 'README.md']);
git(['rm', '-q', 'main.txt']);
write('big.txt', bigRows({ 3: 'row 3 edited', 35: 'row 35 edited' }));

// A snapshot of every branch tip. tools/e2e/run.mjs puts the fixture back to it when a run
// finishes and asserts that it matches, so a step that leaves a commit behind names itself instead
// of surfacing later as an unrelated step's flake (GC-076).
//
// It is a **file**, not a ref namespace (GC-073). It used to be `refs/e2e/baseline/*`, on the
// grounds that `getRefs()` reads only heads, remotes and tags — but `git log --all` means every
// ref under `refs/`, so those three kept their commits in the graph no matter what else was
// excluded, and a step that hides `wip-branch` and `origin/wip-branch` saw the row stay put
// because a baseline ref nobody could see still reached it. Any stale namespace from an older
// fixture is removed, since this repository is rebuilt from scratch anyway.
for (const r of git(['for-each-ref', '--format=%(refname)', 'refs/e2e']).split(String.fromCharCode(10)).filter(Boolean)) git(['update-ref', '-d', r]);
writeFileSync(
  BASELINE,
  JSON.stringify(Object.fromEntries(['main', 'feature', 'wip-branch'].map((b) => [b, git(['rev-parse', b])])), null, 2),
);

// Claim the root for as long as this process lives. It exits immediately after, so the marker is
// stale by the time anyone reads it — which is the point: it is `run.mjs`'s claim that matters,
// and this one only records who built the fixture (GC-064).
writeFileSync(MARKER, JSON.stringify({ pid: process.pid, started: new Date().toISOString(), what: 'setup-testrepo.mjs' }, null, 2));

console.log(`test repository ready at ${R}`);
console.log(git(['log', '--oneline', '--graph', '--all']));
console.log(git(['status', '--short']));
