// Launches the BUILT app (npm run build first) with a DevTools port and waits until its page
// target answers, so a caller can drive and screenshot it over CDP.
//
// Stealth by default: Ricardo uses this machine while the scheduled routines run, often in a
// full-screen game, so an unattended launch must never steal focus or show a window. Two things
// used to grab the foreground: the console window `cmd /c start` opened for `electron.cmd`, and
// the app's own `win.show()`. This spawns `node_modules/electron/dist/electron.exe` directly
// with `windowsHide` and sets GITCLIENT_STEALTH=1, which makes src/main/index.ts render the
// window offscreen (no OS window at all). `--visible` opens the normal, focused window.
//
// Stopping is narrow too: `stopApp(child)` / `stopPort(port)` kill one process tree, never every
// electron.exe on the machine (GC-035). It is also automatic: the app a `launchApp` spawns belongs
// to the process that spawned it until `stop()` or `release()` is called, and is stopped on the way
// out however that process ends (GC-154), so a driver that throws cannot leave an Electron holding
// the port for the next run to attach to and measure a stale build.
//
// Every launch made here also gets its own Electron profile, `<os.tmpdir()>/gitclient-profiles/<port>`,
// through GITCLIENT_USER_DATA (GC-060), so nothing an unattended run stores in `localStorage` — the
// last repository, the ref column width, the preferences — reaches the profile Ricardo's own app uses.
// The profile persists between runs on that port, which keeps the gravatar cache warm; only a start
// outside this launcher (`npm run dev`, a packaged app) uses the real profile.
//
// Usage: node tools/launch-app.mjs [--port 9333] [--repo <path>] [--visible] [--keep-running]
// `--keep-running` skips the `stopPort` that normally frees the DevTools port first, so an app
// already listening on it keeps running; this launch then **attaches** to that app instead of
// spawning one of its own (GC-054), because a second Electron could never bind a port that is
// already taken while the readiness probe would be answered by the first app, so the launcher
// printed "app ready" over a leaked, unreachable process tree nobody would ever stop. With the
// port free the flag changes nothing. The header used to name it `--keep-alive` while the code
// read `--keep-running`, so the documented spelling silently stopped the process it promised to
// spare; `--keep-running` is the name that works (GC-041).
// Exits 0 once the page target is up, 1 on timeout.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The Electron profile a launch on this port uses (GC-060). One per port, so the worker (9333), the
 * e2e suite (GITCLIENT_E2E_PORT) and the backlog reviewer (9334) each keep their own `localStorage`
 * and none of them writes the one Ricardo sees. An explicit GITCLIENT_USER_DATA in the environment
 * wins, so a caller can still pin a profile of its own choosing.
 */
export function profileDir(port) {
  return process.env.GITCLIENT_USER_DATA || join(tmpdir(), 'gitclient-profiles', String(port));
}

/** The real Electron binary, never the `.cmd` shim (running that needs a console window). */
export function electronBinary(appDir = APP_DIR) {
  const dist = join(appDir, 'node_modules', 'electron', 'dist');
  const named = join(appDir, 'node_modules', 'electron', 'path.txt');
  const bin = join(dist, existsSync(named) ? readFileSync(named, 'utf8').trim() : 'electron');
  if (!existsSync(bin)) throw new Error(`Electron binary not found at ${bin}. Run npm install.`);
  return bin;
}

/**
 * Kills one process tree by pid, and nothing else. Never `taskkill /IM electron.exe`: the hourly
 * backlog reviewer runs its own build from a separate worktree, and Ricardo may have `npm run dev`
 * open; a machine-wide kill takes both down with it (GC-035).
 */
export function killTree(pid) {
  if (!pid) return false;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
    return true;
  } catch {
    // POSIX: the child may not be its own group leader, so fall back to the pid itself.
    try {
      process.kill(pid, 'SIGKILL');
      return true;
    } catch {}
    return false;
  }
}

/** Stops an app launched by `launchApp`, and only that one. */
export function stopApp(child) {
  return killTree(child?.pid);
}

/**
 * Makes this process the owner of a child it spawned: while the ownership stands, the child is
 * stopped on the way out however this process ends (GC-154). `stop()` stops it now, `release()`
 * hands it over to whoever comes next; both drop the handlers, so an owner that ends cleanly does
 * nothing twice.
 *
 * Why it exists: GC-040 gave `tools/e2e/run.mjs` this guarantee by hand, and nothing gave it to the
 * short CDP drivers a ticket writes, which end with `await app.stop()` — exactly the line a throw
 * skips. A driver that died on a syntax error left its Electron listening on 9333, and the next
 * three launches attached to that process and measured a build from before the change under test.
 * The signal handlers are here for the same reason `run.mjs` has them: `process.on('exit')` does
 * not fire on SIGINT or SIGTERM unless something exits explicitly.
 */
export function ownChild(child) {
  let owned = true;
  const onExit = () => {
    if (owned) stopApp(child);
  };
  const onSignal = (code) => () => process.exit(code);
  const handlers = [
    ['exit', onExit],
    ['SIGINT', onSignal(130)],
    ['SIGTERM', onSignal(143)],
  ];
  for (const [event, handler] of handlers) process.on(event, handler);
  const forget = () => {
    if (!owned) return false;
    owned = false;
    for (const [event, handler] of handlers) process.off(event, handler);
    return true;
  };
  // `stop()` stops the child whether or not the ownership still stands: stopping is what the
  // caller asked for, and a second call against a pid that is already gone is a no-op anyway.
  return { stop: () => (forget(), stopApp(child)), release: forget };
}

/** The pid listening on a TCP port, or null. Used to clear a stale DevTools port. */
export function pidOnPort(port) {
  try {
    if (process.platform === 'win32') {
      // netstat -ano rows are: proto, local address, foreign address, state, pid.
      const out = execFileSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
      for (const line of out.split('\n')) {
        const [proto, local, , state, pid] = line.trim().split(/ +/);
        if (proto !== 'TCP' || state !== 'LISTENING') continue;
        if (Number(local.slice(local.lastIndexOf(':') + 1)) === port) return Number(pid);
      }
      return null;
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim();
    return out ? Number(out.split('\n')[0]) : null;
  } catch {
    return null;
  }
}

/**
 * Frees a DevTools port a stale instance is still holding, by stopping that process tree only.
 * Returns true when something was stopped. A port nobody holds is a no-op.
 */
export async function stopPort(port, timeoutMs = 10000) {
  const pid = pidOnPort(port);
  if (!pid) return false;
  killTree(pid);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pidOnPort(port)) return true;
    await sleep(250);
  }
  return true;
}

/**
 * Spawns the built app and resolves with { child, target, stop, release } once /json lists a page
 * target. `stop()` kills that process tree and nothing else. Until it is called the app belongs to
 * this process and is stopped on the way out however it ends, so a driver that throws leaves
 * nothing behind (GC-154); `release()` gives that ownership up without stopping anything, which is
 * what a launch meant to outlive its launcher — the CLI's own — wants.
 * `visible: true` drops stealth mode and shows the usual window.
 */
export async function launchApp({ port = 9333, repo = null, visible = false, appDir = APP_DIR, timeoutMs = 40000 } = {}) {
  const env = { ...process.env };
  if (visible) delete env.GITCLIENT_STEALTH;
  else env.GITCLIENT_STEALTH = '1';
  // A `--visible` launch is still an unattended one, so it gets the per-port profile too (GC-060);
  // only a start that never goes through this launcher keeps Ricardo's own.
  env.GITCLIENT_USER_DATA = profileDir(port);
  mkdirSync(env.GITCLIENT_USER_DATA, { recursive: true });

  const child = spawn(electronBinary(appDir), ['.', `--remote-debugging-port=${port}`], {
    cwd: appDir,
    detached: true,
    stdio: 'ignore',
    // Only for stealth: on Windows this puts SW_HIDE in the child STARTUPINFO, which Chromium
    // honours for the first window it shows, so a visible launch with it set stays invisible.
    windowsHide: !visible,
    env,
  });
  child.unref();
  // Owned from the moment it exists, so the readiness probe throwing below stops it too.
  const owner = ownChild(child);

  const deadline = Date.now() + timeoutMs;
  let target;
  while (!target && Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://localhost:${port}/json`)).json();
      target = list.find((t) => t.type === 'page');
    } catch {}
    if (!target) await sleep(500);
  }
  if (!target) throw new Error(`app did not start: no page target on port ${port} after ${timeoutMs}ms`);
  if (repo) await setRepo(target, repo);
  return { child, target, stop: owner.stop, release: owner.release };
}

/** Points the running app at a repository through localStorage and reloads it. */
export async function setRepo(target, repo) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('could not attach to the page target')));
  });
  const expression = `localStorage.setItem('gitclient.lastRepo', ${JSON.stringify(resolve(repo).split(String.fromCharCode(92)).join('/'))}); setTimeout(() => location.reload(), 50); 'ok'`;
  await new Promise((res) => {
    ws.addEventListener('message', (e) => {
      if (JSON.parse(e.data).id === 1) res();
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  ws.close();
  // Give the reload time to land before the caller attaches.
  await sleep(1500);
}

/**
 * A PNG of the app's page over CDP (GC-174). `scale` is where the two routines differ: the
 * reviewer reads its own screenshots and takes them at 0.5 — a quarter of the image tokens, and
 * plenty to judge a layout by — while `docs/screenshots/`, which Ricardo compares against
 * GitKraken, stays at 1. Resolves with the bytes, and writes them to `path` when one is given.
 */
export async function screenshot(target, { scale = 1, path = null } = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', () => rej(new Error('could not attach to the page target')));
  });
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const settle = pending.get(msg.id);
    if (!settle) return;
    pending.delete(msg.id);
    settle(msg);
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = ++nextId;
      pending.set(id, (msg) => (msg.error ? rej(new Error(`${method}: ${msg.error.message}`)) : res(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    const { cssLayoutViewport: v } = await send('Page.getLayoutMetrics');
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: v.clientWidth, height: v.clientHeight, scale },
    });
    const bytes = Buffer.from(shot.data, 'base64');
    if (path) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    return bytes;
  } finally {
    ws.close();
  }
}

/**
 * The page target of an app already listening on the DevTools port, or null when nothing answers

 * there. CLI-only, for `--keep-running` (GC-054): a booting app answers /json before it lists a
 * page, so once the port has replied at all this waits for the page rather than reporting the port
 * free and spawning a second Electron that could never bind it.
 */
async function attachTarget(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let answered = false;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://localhost:${port}/json`)).json();
      answered = true;
      const target = list.find((t) => t.type === 'page');
      if (target) return target;
    } catch {
      // Nothing on the port yet: this launch is the first one, so spawn as usual.
      if (!answered) return null;
    }
    await sleep(500);
  }
  throw new Error(`port ${port} is in use but lists no page target; stop that app or pass another --port`);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const port = Number(value('--port', process.env.GITCLIENT_E2E_PORT ?? 9333));
  const repo = value('--repo', null);
  try {
    if (flag('--keep-running')) {
      // Attach to the app that already holds the port instead of leaking a second one (GC-054).
      // `--visible` has nothing to act on here; the running app is whatever it was launched as.
      const running = await attachTarget(port);
      if (running) {
        const pid = pidOnPort(port);
        if (repo) await setRepo(running, repo);
        // The pid is a convenience, not a requirement: a lookup that fails must not fail the run.
        console.log(`attached to the app already on port ${port} (pid ${pid ?? 'unknown'}): ${running.url}`);
        process.exit(0);
      }
    } else {
      await stopPort(port);
    }
    const { target, release } = await launchApp({ port, repo, visible: flag('--visible') });
    // The CLI exists to leave an app running for whatever drives it next, so it hands the child
    // over before exiting — without this the exit handler ownChild registered would stop the app
    // this command was asked to start (GC-154).
    release();
    console.log(`app ready on port ${port}${flag('--visible') ? '' : ' (stealth)'}: ${target.url}`);
    process.exit(0);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
