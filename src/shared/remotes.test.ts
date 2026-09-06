import { describe, expect, it } from 'vitest';
import type { GitRef, Remote } from './types';
import { defaultRemote, isWebUrl, remoteCopyOf, remoteUrlToWeb } from './remotes';

const r = (name: string): Remote => ({ name, fetchUrl: `https://example.invalid/${name}.git`, pushUrl: `https://example.invalid/${name}.git` });

const local = (name: string, upstream?: string): GitRef => ({ name, fullName: `refs/heads/${name}`, kind: 'head', sha: 'a'.repeat(40), isHead: false, upstream });
const tracked = (name: string): GitRef => ({ name, fullName: `refs/remotes/${name}`, kind: 'remote', sha: 'b'.repeat(40), isHead: false });

describe('defaultRemote', () => {
  it('returns undefined when the repository has no remotes', () => {
    expect(defaultRemote([])).toBeUndefined();
  });

  it('returns the only remote whatever it is called', () => {
    expect(defaultRemote([r('upstream')])).toBe('upstream');
  });

  it('prefers origin over a remote that sorts before it', () => {
    // getRemotes reports remotes sorted by name, so without the preference the tag
    // push used to land on `alpha` while the branch push went to `origin` (GC-031).
    expect(defaultRemote([r('alpha'), r('origin')])).toBe('origin');
  });

  it('prefers origin wherever it appears in the list', () => {
    expect(defaultRemote([r('origin'), r('zeta')])).toBe('origin');
  });

  it('falls back to the first remote when there is no origin', () => {
    expect(defaultRemote([r('alpha'), r('mirror')])).toBe('alpha');
  });
});

describe('remoteCopyOf', () => {
  it('answers the upstream when the snapshot lists it', () => {
    const refs = [local('main', 'origin/main'), tracked('origin/main'), tracked('origin/other')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'main' });
  });

  it('falls through to a same-name remote ref when the upstream has been pruned', () => {
    // The branch still records `origin/main` as its upstream, but the snapshot no longer lists
    // that ref — the state a `git fetch --prune` leaves behind. The same-name copy is the answer.
    const refs = [local('main', 'origin/main'), tracked('mirror/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('mirror')])).toEqual({ remote: 'mirror', branch: 'main' });
  });

  it('answers a same-name remote ref for a branch pushed without -u', () => {
    const refs = [local('feature'), tracked('origin/feature')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'feature' });
  });

  it('answers null for a branch that is on no remote', () => {
    const refs = [local('local-only'), tracked('origin/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toBeNull();
  });

  it('splits a slashed branch name at the remote, not at the first slash', () => {
    // `feature/x` on `origin` is `origin/feature/x`; splitting on the first slash would name the
    // branch `x` and delete the wrong ref (GC-134).
    const refs = [local('feature/x', 'origin/feature/x'), tracked('origin/feature/x')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toEqual({ remote: 'origin', branch: 'feature/x' });
  });

  it('answers null when the only copy is on a remote the snapshot does not list', () => {
    // The ref is there but no remote accounts for its prefix, so nothing can be told to delete it.
    const refs = [local('main'), tracked('gone/main')];
    expect(remoteCopyOf(refs[0]!, refs, [r('origin')])).toBeNull();
  });
});

describe('remoteUrlToWeb', () => {
  it('reads the scp form, with and without the .git', () => {
    expect(remoteUrlToWeb('git@github.com:owner/repo.git')).toBe('https://github.com/owner/repo');
    expect(remoteUrlToWeb('git@github.com:owner/repo')).toBe('https://github.com/owner/repo');
  });

  it('reads ssh:// and drops the port, which is not the web one', () => {
    expect(remoteUrlToWeb('ssh://git@gitlab.com/owner/repo.git')).toBe('https://gitlab.com/owner/repo');
    expect(remoteUrlToWeb('ssh://git@gitlab.com/owner/repo')).toBe('https://gitlab.com/owner/repo');
    expect(remoteUrlToWeb('ssh://git@ssh.dev.azure.com:2222/org/proj/_git/repo.git')).toBe('https://ssh.dev.azure.com/org/proj/_git/repo');
  });

  it('keeps an https remote as it is, less the .git', () => {
    expect(remoteUrlToWeb('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
    expect(remoteUrlToWeb('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
    expect(remoteUrlToWeb('https://github.com/owner/repo.git/')).toBe('https://github.com/owner/repo');
  });

  it('keeps an http remote on http, rather than rewriting an intranet host to a scheme it may not answer', () => {
    expect(remoteUrlToWeb('http://git.internal:8080/owner/repo.git')).toBe('http://git.internal:8080/owner/repo');
  });

  it('drops a user@ in front of an http(s) host, which does not belong in a browser link', () => {
    expect(remoteUrlToWeb('https://someone@github.com/owner/repo.git')).toBe('https://github.com/owner/repo');
  });

  it('makes a browsable URL of a git:// remote, which has no browsable scheme of its own', () => {
    expect(remoteUrlToWeb('git://host.example/owner/repo.git')).toBe('https://host.example/owner/repo');
  });

  it('is null for a local bare repository, which is what the e2e fixture s origin is', () => {
    expect(remoteUrlToWeb('C:/Users/x/AppData/Local/Temp/gitclient-e2e/origin.git')).toBe(null);
    expect(remoteUrlToWeb('C:\\Users\\x\\Temp\\origin.git')).toBe(null);
    expect(remoteUrlToWeb('/srv/git/repo.git')).toBe(null);
    expect(remoteUrlToWeb('../sibling/repo.git')).toBe(null);
    expect(remoteUrlToWeb('file:///srv/git/repo.git')).toBe(null);
    // a path relative to a drive: `C` is a drive letter, not a host
    expect(remoteUrlToWeb('C:repos/repo.git')).toBe(null);
  });

  it('is null for a URL with no path to read, and for an empty one', () => {
    expect(remoteUrlToWeb('https://github.com')).toBe(null);
    expect(remoteUrlToWeb('https://github.com/')).toBe(null);
    expect(remoteUrlToWeb('git@github.com:.git')).toBe(null);
    expect(remoteUrlToWeb('')).toBe(null);
    expect(remoteUrlToWeb('   ')).toBe(null);
    expect(remoteUrlToWeb('not a url at all')).toBe(null);
  });
});

describe('isWebUrl', () => {
  it('accepts http and https and nothing else', () => {
    expect(isWebUrl('https://github.com/owner/repo')).toBe(true);
    expect(isWebUrl('http://git.internal:8080/owner/repo')).toBe(true);
    expect(isWebUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isWebUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isWebUrl('ms-settings:privacy')).toBe(false);
    expect(isWebUrl('/srv/git/repo.git')).toBe(false);
    expect(isWebUrl('')).toBe(false);
  });
});
