import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';

/**
 * The path validation, driven through the handlers themselves (GC-198). `repoRelAny` and `repoRel`
 * are not exported — what a channel accepts is the thing worth pinning, not the helper's name — so
 * the test registers the real handlers against a fake `ipcMain` and calls them.
 *
 * `electron` is stubbed because the package's main export is the path to the binary, not a module
 * with these names on it, and `./git` because a validation test must not spawn git: every case
 * here is refused before the call, and the one that is accepted is asserted by what the stub was
 * handed.
 */
const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), setPath: () => undefined },
  BrowserWindow: { fromWebContents: () => null },
  dialog: {},
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => handlers.set(channel, fn) },
  shell: {},
}));

const calls: { fn: string; args: unknown[] }[] = [];
const spy =
  (fn: string) =>
  (...args: unknown[]) => {
    calls.push({ fn, args });
    return Promise.resolve(null);
  };

vi.mock('./git', () => ({
  getFileLog: spy('getFileLog'),
  resolveConflict: spy('resolveConflict'),
  restoreFile: spy('restoreFile'),
  ignore: spy('ignore'),
}));

vi.mock('./watch', () => ({ watchRepo: () => undefined }));

let repo = '';

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'gitclient-ipc-'));
  writeFileSync(join(repo, 'here.txt'), 'x');
  const { registerIpc } = await import('./ipc');
  registerIpc();
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

const call = (channel: string, ...args: unknown[]): unknown => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`no handler for ${channel}`);
  return fn({}, ...args);
};

/** The three handlers GC-198 moved off a bare `str`, each with its path in the same argument slot. */
const CONTAINMENT: { channel: string; call: (path: string) => unknown }[] = [
  { channel: 'repo:fileLog', call: (p) => call('repo:fileLog', repo, p) },
  { channel: 'workdir:resolveConflict', call: (p) => call('workdir:resolveConflict', repo, p, 'ours') },
  { channel: 'workdir:restoreFile', call: (p) => call('workdir:restoreFile', repo, 'abc1234', p) },
];

// A `..`, an absolute path and another Windows drive: the three shapes GC-093's rule names.
const OUTSIDE = ['../secrets.txt', 'sub/../../secrets.txt', 'C:/Windows/System32/drivers/etc/hosts', 'D:/elsewhere.txt'];

describe('containment validation', () => {
  for (const h of CONTAINMENT) {
    it(`${h.channel} refuses a path outside the repository`, () => {
      for (const p of OUTSIDE) expect(() => h.call(p), p).toThrow(/outside the repository/);
    });

    it(`${h.channel} accepts a path inside the repository that is not on disk`, () => {
      calls.length = 0;
      expect(() => h.call('docs/deleted-long-ago.md')).not.toThrow();
      // Normalised on the way through, so what git is handed is a forward-slashed relative path.
      expect(calls[0]?.args).toContain('docs/deleted-long-ago.md');
    });
  }

  it('repoRel still refuses a path inside the repository but absent from the working tree', () => {
    // `workdir:ignore` is the caller that keeps the existence check, since a pattern is built from
    // a file the user is looking at.
    expect(() => call('workdir:ignore', repo, { path: 'gone.txt', kind: 'file' })).toThrow(/not found in the working tree/);
    expect(() => call('workdir:ignore', repo, { path: 'here.txt', kind: 'file' })).not.toThrow();
  });

  it('refuses the repository root itself, which is not a file in it', () => {
    expect(() => call('repo:fileLog', repo, '.')).toThrow(/outside the repository/);
  });
});
