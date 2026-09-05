// Creates a disposable git repository plus a bare "origin" for the end-to-end run.
// Location: $GITCLIENT_E2E_ROOT or <tmp>/gitclient-e2e. Existing contents are removed.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.env.GITCLIENT_E2E_ROOT ?? join(tmpdir(), 'gitclient-e2e');
const R = join(root, 'testrepo');
const REMOTE = join(root, 'remote.git');

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

console.log(`test repository ready at ${R}`);
console.log(git(['log', '--oneline', '--graph', '--all']));
console.log(git(['status', '--short']));
