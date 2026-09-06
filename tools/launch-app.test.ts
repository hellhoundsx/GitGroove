import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// This test covers `tools/launch-app.mjs`, so it sits next to it (GC-070): `vitest.config.ts`'s
// node project includes `tools/**/*.test.ts` and `tsconfig.node.json`, which already carries the
// node types, covers it for `npm run typecheck`.
//
// Why it exists (GC-059): GC-054 put a decision in the launcher that is exactly the kind that
// rots. With the DevTools port already answering, `--keep-running` must **attach** to the app
// that holds it and exit; spawning a second Electron leaks a process that could never bind the
// port and that nobody will ever stop, while the readiness probe — answered by the first app —
// still reports "app ready". Proving that by hand costs a build, a launch and two process-tree
// counts. A plain http server answering `/json` with one `page` target is indistinguishable from
// a running app as far as the launcher is concerned, so the same decision can be checked in
// seconds. Nothing here starts Electron: a unit test must never launch the app (the e2e suite
// stays the only thing that does).

/** Repo root: this file is at <root>/tools/. */
const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const LAUNCHER = join(ROOT, 'tools', 'launch-app.mjs');

/** The url the fake page target reports, so the CLI's own output can be matched on it. */
const FAKE_PAGE_URL = 'http://localhost/gc059-fake-page';

const scratchDirs: string[] = [];

afterAll(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/**
 * A throwaway CDP endpoint: any request answers with one `page` target, which is all the launcher
 * reads. Bound with no host so both `127.0.0.1` and `::1` reach it, because the launcher fetches
 * `http://localhost:<port>/json` and Windows resolves that name to either family.
 */
function startFakeCdp(): Promise<{ port: number; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    const body = JSON.stringify([
      {
        id: 'gc059',
        type: 'page',
        title: 'fake page target',
        url: FAKE_PAGE_URL,
        webSocketDebuggerUrl: 'ws://localhost/devtools/page/gc059',
      },
    ]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(body);
  });
  return new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      res({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A port nothing is listening on: opened, read and closed again. */
function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const probe = createSocketServer();
    probe.on('error', rej);
    probe.listen(0, () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(() => res(port));
    });
  });
}

/** Runs the launcher CLI as a child process and collects its exit code and output. */
function runLauncher(args: string[], timeoutMs = 60000) {
  return runNode([LAUNCHER, ...args], timeoutMs);
}

/** Runs node on the given arguments and collects its exit code and output. */
function runNode(args: string[], timeoutMs = 60000) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((res, rej) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    // A watchdog so a launcher that never returns cannot hang the suite. It stops this child and
    // nothing else — never an image-name kill (GC-035).
    const watchdog = setTimeout(() => child.kill(), timeoutMs);
    child.on('error', (e) => {
      clearTimeout(watchdog);
      rej(e);
    });
    child.on('close', (code) => {
      clearTimeout(watchdog);
      res({ code, stdout, stderr });
    });
  });
}

/**
 * The pids of any Electron started with `--remote-debugging-port=<port>`. Matching on the port
 * this test invented is what makes the check safe to run on a machine that has other Electrons on
 * it — Ricardo's `npm run dev`, the backlog reviewer's own build — none of which carry this port
 * (GC-035: nothing here may act on every `electron.exe`).
 */
function electronPidsForPort(port: number): number[] {
  if (process.platform !== 'win32') return [];
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*--remote-debugging-port=${port}*' } | ForEach-Object { $_.ProcessId }`,
      ],
      { encoding: 'utf8' },
    );
    return out
      .split('\n')
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

/** Stops one pid and its tree, by pid only. */
function killPid(pid: number): void {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
}

/**
 * `attachTarget` is module-private in `tools/launch-app.mjs`, and this ticket does not own that
 * file, so the function is reached through a byte-for-byte copy in a scratch directory with one
 * `export` appended (GC-059). The copy behaves identically: the module imports only node builtins,
 * touches the filesystem in no top-level statement, and its `invokedDirectly` guard stays false
 * because `process.argv[1]` under vitest is not this copy. `@vite-ignore` keeps the copy out of
 * vitest's own module graph, which would refuse a path outside the project root. If the launcher
 * ever exports `attachTarget` itself, delete this and import it directly.
 */
async function loadPrivateAttachTarget(): Promise<(port: number, timeoutMs?: number) => Promise<unknown>> {
  const dir = mkdtempSync(join(tmpdir(), 'gitclient-gc059-'));
  scratchDirs.push(dir);
  const copy = join(dir, 'launch-app.attach.mjs');
  copyFileSync(LAUNCHER, copy);
  writeFileSync(copy, `${readFileSync(copy, 'utf8')}\nexport { attachTarget };\n`);
  const mod = (await import(/* @vite-ignore */ pathToFileURL(copy).href)) as Record<string, unknown>;
  return mod.attachTarget as (port: number, timeoutMs?: number) => Promise<unknown>;
}

type Owner = { stop: () => boolean; release: () => boolean };

/** The launcher's own `ownChild`, imported the ordinary way (only `attachTarget` is private). */
async function loadOwnChild(): Promise<(child: { pid: number | null }) => Owner> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(LAUNCHER).href)) as Record<string, unknown>;
  return mod.ownChild as (child: { pid: number | null }) => Owner;
}

/**
 * Runs a one-off driver script against the launcher, the way a ticket's CDP driver is written, and
 * answers its output plus the pid of the throwaway child it owned. Nothing here starts Electron
 * (GC-154): `ownChild` cares only that it was handed something with a pid, so a sleeping node
 * process stands in for the app and the guarantee under test — that the child is gone once the
 * driver's process is — is the real one.
 */
async function runDriver(body: string): Promise<{ code: number | null; stdout: string; pid: number }> {
  const dir = mkdtempSync(join(tmpdir(), 'gitclient-gc154-'));
  scratchDirs.push(dir);
  const script = join(dir, 'driver.mjs');
  writeFileSync(
    script,
    [
      `import { spawn } from 'node:child_process';`,
      `import { ownChild } from ${JSON.stringify(pathToFileURL(LAUNCHER).href)};`,
      // A child that outlives its parent unless something stops it: detached, unref'd, and doing
      // nothing but keeping its event loop alive — exactly the shape of a stealth Electron.
      `const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], { detached: true, stdio: 'ignore' });`,
      `child.unref();`,
      `console.log('PID ' + child.pid);`,
      `const owner = ownChild(child);`,
      body,
    ].join('\n'),
  );
  const { code, stdout } = await runNode([script], 30000);
  const pid = Number(/PID (\d+)/.exec(stdout)?.[1]);
  expect(Number.isInteger(pid)).toBe(true);
  return { code, stdout, pid };
}

/** Whether a pid is still running. `kill(pid, 0)` throws ESRCH once it is gone. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Polls until the pid is gone, so a taskkill that has not finished yet is not read as a leak. */
async function waitGone(pid: number, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

describe('tools/launch-app.mjs ownChild', () => {
  it('registers exit and signal handlers and takes them off again on stop and on release', async () => {
    const ownChild = await loadOwnChild();
    const before = (e: string) => process.listeners(e as 'exit').length;
    const [exit0, int0, term0] = [before('exit'), before('SIGINT'), before('SIGTERM')];
    // A pid of null: `killTree` answers false for it, so nothing on this machine is signalled by
    // a unit test (GC-035) and the registration is still the real one.
    const owner = ownChild({ pid: null });
    expect([before('exit'), before('SIGINT'), before('SIGTERM')]).toEqual([exit0 + 1, int0 + 1, term0 + 1]);
    owner.stop();
    expect([before('exit'), before('SIGINT'), before('SIGTERM')]).toEqual([exit0, int0, term0]);

    const second = ownChild({ pid: null });
    expect(before('exit')).toBe(exit0 + 1);
    expect(second.release()).toBe(true);
    // Releasing twice is not an error and does not take a handler that belongs to someone else.
    expect(second.release()).toBe(false);
    expect([before('exit'), before('SIGINT'), before('SIGTERM')]).toEqual([exit0, int0, term0]);
  });

  it('stops the child when the driver that owns it throws', async () => {
    const { code, pid } = await runDriver(`throw new Error('driver blew up');`);
    expect(code).toBe(1);
    expect(await waitGone(pid)).toBe(true);
  }, 60000);

  it('leaves the child running when the driver releases it, which is what the CLI does', async () => {
    const { code, pid } = await runDriver(`owner.release();`);
    try {
      expect(code).toBe(0);
      // The driver has exited; the child it handed over is still there, which is the whole point of
      // `node tools/launch-app.mjs --repo <p>` returning to the shell with an app left running.
      expect(alive(pid)).toBe(true);
    } finally {
      killPid(pid);
    }
  }, 60000);

  it('stops the child exactly once when the driver stops it and then exits normally', async () => {
    const { code, pid } = await runDriver(`owner.stop();\nprocess.on('exit', () => console.log('EXITED'));`);
    expect(code).toBe(0);
    expect(await waitGone(pid)).toBe(true);
  }, 60000);
});

/** The launcher's graceful-stop exports, imported the ordinary way. */
async function loadStopApi(): Promise<{
  stopGracefully: (port: number, pid?: number | null, timeoutMs?: number) => Promise<boolean>;
  stopOwned: (owner: Owner, child: { pid: number | null }, port: number, timeoutMs?: number) => Promise<boolean>;
  requestClose: (port: number) => Promise<boolean>;
}> {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(LAUNCHER).href)) as Record<string, unknown>;
  return mod as never;
}

/**
 * A fake app: the same `/json` a real one answers, plus a `/json/close/<id>` that stops `pid` — the
 * DevTools endpoint the graceful stop uses, and the app's own quit standing in for Electron's
 * (GC-162). Records whether the close was actually asked for, which is what separates the two
 * paths: a stop that killed without asking is what this ticket exists to have fixed.
 */
function startClosableCdp(pid: number): Promise<{ port: number; closed: () => boolean; close: () => Promise<void> }> {
  let asked = false;
  const server: Server = createServer((req, res) => {
    if (req.url?.startsWith('/json/close/')) {
      asked = true;
      killPid(pid);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Target is closing');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ id: 'gc162', type: 'page', title: 'fake', url: FAKE_PAGE_URL, webSocketDebuggerUrl: 'ws://localhost/devtools/page/gc162' }]));
  });
  return new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, () => {
      res({
        port: (server.address() as AddressInfo).port,
        closed: () => asked,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A detached, unref'd sleeper: the shape of a stealth Electron, and never one (GC-154). */
function startSleeper(): { pid: number } {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 3600000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid as number };
}

describe('tools/launch-app.mjs graceful stop (GC-162)', () => {
  it('asks the app to close and answers true once the process has gone', async () => {
    const { stopGracefully } = await loadStopApi();
    const sleeper = startSleeper();
    const cdp = await startClosableCdp(sleeper.pid);
    try {
      expect(await stopGracefully(cdp.port, sleeper.pid, 10000)).toBe(true);
      expect(cdp.closed()).toBe(true);
      expect(alive(sleeper.pid)).toBe(false);
    } finally {
      killPid(sleeper.pid);
      await cdp.close();
    }
  }, 60000);

  it('still stops an app that ignores the request, which is what keeps GC-154 true', async () => {
    const { stopOwned } = await loadStopApi();
    const ownChild = await loadOwnChild();
    const sleeper = startSleeper();
    // Nothing answers on this port, so the ask fails immediately and only the fallback can be what
    // stops the process — the case a hung or unreachable app takes.
    const port = await freePort();
    const owner = ownChild({ pid: sleeper.pid });
    try {
      const started = Date.now();
      expect(await stopOwned(owner, { pid: sleeper.pid }, port, 2000)).toBe(true);
      expect(await waitGone(sleeper.pid)).toBe(true);
      // Bounded: a port nobody holds must not cost the caller the whole graceful timeout.
      expect(Date.now() - started).toBeLessThan(10000);
    } finally {
      killPid(sleeper.pid);
    }
  }, 60000);

  it('reports no ask when nothing is listening, rather than throwing', async () => {
    const { requestClose } = await loadStopApi();
    expect(await requestClose(await freePort())).toBe(false);
  }, 30000);
});

describe('tools/launch-app.mjs --keep-running', () => {
  it('attaches to the app already on the DevTools port instead of spawning a second Electron', async () => {
    const cdp = await startFakeCdp();
    let strays: number[] = [];
    try {
      const { code, stdout, stderr } = await runLauncher(['--keep-running', '--port', String(cdp.port)]);
      strays = electronPidsForPort(cdp.port);
      expect(code).toBe(0);
      expect(stdout).toContain(`attached to the app already on port ${cdp.port}`);
      expect(stdout).toContain(FAKE_PAGE_URL);
      // The launch path prints this instead, so it is the line that fails when the attach branch
      // goes away and the CLI leaks an Electron over an occupied port (GC-054).
      expect(stdout).not.toContain('app ready');
      expect(strays).toEqual([]);
      // Last, because the launcher says nothing on stderr when it succeeds: a message here is a
      // diagnostic, not the behaviour under test.
      expect(stderr).toBe('');
    } finally {
      for (const pid of strays) killPid(pid);
      await cdp.close();
    }
  }, 90000);

  it('reports no target when nothing answers on the port, so a first launch still spawns', async () => {
    const attachTarget = await loadPrivateAttachTarget();
    // Nothing is listening, so the very first fetch fails and the answer is null immediately: a
    // free port must not make the launcher wait out its timeout, and must not throw the
    // "port is in use but lists no page target" error.
    const started = Date.now();
    await expect(attachTarget(await freePort(), 3000)).resolves.toBe(null);
    expect(Date.now() - started).toBeLessThan(3000);
  }, 30000);
});
