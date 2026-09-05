// `tsconfig.web.json` is the renderer's project and does not pull in the node types, so this
// file asks for them itself rather than changing that config for one test.
/// <reference types="node" />
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This test checks the *repository*, not the renderer. It lives here only because
// `vitest.config.ts` includes `src/**/*.test.ts` and `tsconfig.web.json` includes
// `src/renderer/src/**/*`, so it is picked up by `npm test` and `npm run typecheck`
// with no configuration change. Move it and both of those need editing.
//
// Why it exists (GC-047): GC-042 found a literal U+0000 that a session had typed straight into
// `shortcuts.test.ts`. vitest, `tsc` and the build all read the file happily, so it survived a
// whole ticket cycle; git, though, classified the file as binary, which silently drops it out of
// `git diff`, `git blame`, review and the `.gitattributes` LF normalisation. A byte-level scan
// catches it in milliseconds. Control characters belong in source as escapes, never as bytes.

/** Repo root: this file is at <root>/src/renderer/src/. */
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

/** Trees walked in full. */
const TREES = ['src', 'tools'];

/** Individual files at the root that are worth the same guarantee. */
const ROOT_FILES = ['TICKETS.md', 'CLAUDE.md', 'README.md'];

/** Never descend into these: not ours, and huge. */
const SKIP_DIRS = new Set(['node_modules', 'out', 'dist', '.git']);

/** Genuinely binary payloads, where control bytes are the point. */
const SKIP_EXTENSIONS = ['.png', '.woff2', '.ico'];

/** TAB and LF are the only C0 controls a text file in this repo may contain. */
const ALLOWED = new Set([0x09, 0x0a]);

function isBinaryName(name: string): boolean {
  return SKIP_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), out);
    } else if (entry.isFile() && !isBinaryName(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Every file the check covers, as repository-relative paths with forward slashes. */
function scannedFiles(): string[] {
  const files: string[] = [];
  for (const tree of TREES) walk(join(ROOT, tree), files);
  for (const name of ROOT_FILES) {
    const path = join(ROOT, name);
    try {
      if (statSync(path).isFile()) files.push(path);
    } catch {
      // A root file that does not exist is not this test's problem.
    }
  }
  return files.map((path) => relative(ROOT, path).split('\\').join('/'));
}

/** `<path>: <name> (0xNN) at byte offset N` for the first offending byte in the file, or null. */
function firstControlByte(relPath: string): string | null {
  const bytes = readFileSync(join(ROOT, relPath));
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    if (byte < 0x20 && !ALLOWED.has(byte)) {
      const hex = byte.toString(16).padStart(2, '0');
      const name = byte === 0x0d ? 'CR' : 'control character';
      return `${relPath}: ${name} (0x${hex}) at byte offset ${i}`;
    }
  }
  return null;
}

describe('repository hygiene', () => {
  it('walks the source trees without descending into build or dependency output', () => {
    const files = scannedFiles();
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => /(^|\/)(node_modules|out|dist)\//.test(f))).toEqual([]);
    // The root markdown files and both trees are actually reached.
    expect(files).toContain('CLAUDE.md');
    expect(files.some((f) => f.startsWith('src/'))).toBe(true);
    expect(files.some((f) => f.startsWith('tools/'))).toBe(true);
  });

  it('has no raw C0 control byte other than TAB and LF in any tracked source file', () => {
    const offenders = scannedFiles()
      .map(firstControlByte)
      .filter((hit): hit is string => hit !== null);
    // On failure vitest prints this array, so the file and the offset are in the output alone.
    expect(offenders).toEqual([]);
  });
});
