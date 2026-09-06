import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// This test covers `tools/scratch-worktree.mjs`, so it sits next to it (GC-070). The property it
// pins is the one that was violated on 2026-09-06 (GC-189): removing a worktree whose
// `node_modules` is a junction must remove the **link** and leave the target's contents alone. It
// runs on a temporary directory with a junction of its own, so nothing here touches this
// checkout's real `node_modules` — which is the thing the helper exists to protect, and the last
// thing a test of it should be allowed to delete. No git is run either: `addWorktree` and
// `removeWorktree`'s `git worktree` calls are the part that is not this ticket's defect, and a
// unit test that made worktrees would leave them behind on a failure.

/** Repo root: this file is at <root>/tools/. */
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');

type Helper = {
  isLink(p: string): boolean;
  removeLink(p: string): boolean;
  assertSafeToRemove(wtDir: string, rootDir?: string): void;
  countNodeModules(rootDir?: string): number;
};

const mod = (await import(/* @vite-ignore */ pathToFileURL(join(ROOT, 'tools', 'scratch-worktree.mjs')).href)) as Helper;

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A temp directory holding a real `node_modules` with a `.bin`, plus an empty worktree beside it. */
function fixture(): { root: string; wt: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gc189-'));
  scratchDirs.push(dir);
  const root = join(dir, 'checkout');
  const wt = join(dir, 'wt');
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(root, 'node_modules', '.bin', 'tsc.cmd'), 'echo tsc');
  mkdirSync(join(root, 'node_modules', 'vitest'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'vitest', 'index.js'), 'module.exports = {};');
  mkdirSync(wt, { recursive: true });
  return { root, wt };
}

/** The junction the review routine makes: `<wt>/node_modules` pointing at `<root>/node_modules`. */
function junction(root: string, wt: string): string {
  const link = join(wt, 'node_modules');
  symlinkSync(join(root, 'node_modules'), link, 'junction');
  return link;
}

describe('removeLink', () => {
  it('removes the junction and leaves every entry of its target', () => {
    const { root, wt } = fixture();
    const link = junction(root, wt);
    const before = readdirSync(join(root, 'node_modules')).sort();
    expect(before).toEqual(['.bin', 'vitest']);
    // Through the junction, the target's contents are visible — which is exactly why a recursive
    // delete of the worktree destroys them.
    expect(readdirSync(link).sort()).toEqual(before);

    expect(mod.removeLink(link)).toBe(true);

    expect(existsSync(link)).toBe(false);
    expect(mod.isLink(link)).toBe(false);
    expect(readdirSync(join(root, 'node_modules')).sort()).toEqual(before);
    expect(existsSync(join(root, 'node_modules', '.bin', 'tsc.cmd'))).toBe(true);
  });

  it('refuses a real directory, so a node_modules that is an install is never deleted', () => {
    const { root } = fixture();
    expect(() => mod.removeLink(join(root, 'node_modules'))).toThrow(/real directory/);
    expect(existsSync(join(root, 'node_modules', '.bin'))).toBe(true);
  });

  it('answers false for a path that is not there', () => {
    const { wt } = fixture();
    expect(mod.removeLink(join(wt, 'node_modules'))).toBe(false);
  });
});

describe('assertSafeToRemove', () => {
  it('refuses while the junction is still standing', () => {
    const { root, wt } = fixture();
    junction(root, wt);
    expect(() => mod.assertSafeToRemove(wt, root)).toThrow(/still there/);
  });

  it('passes once the link is gone and the real .bin survives', () => {
    const { root, wt } = fixture();
    const link = junction(root, wt);
    mod.removeLink(link);
    expect(() => mod.assertSafeToRemove(wt, root)).not.toThrow();
  });

  it('refuses when the checkout it would protect has already lost its .bin', () => {
    const { root, wt } = fixture();
    rmSync(join(root, 'node_modules', '.bin'), { recursive: true, force: true });
    expect(() => mod.assertSafeToRemove(wt, root)).toThrow(/already damaged/);
  });
});

describe('countNodeModules', () => {
  it('counts the entries a caller prints either side of a removal', () => {
    const { root } = fixture();
    expect(mod.countNodeModules(root)).toBe(2);
  });
});
