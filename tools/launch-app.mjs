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
// electron.exe on the machine (GC-035).
//
// Usage: node tools/launch-app.mjs [--port 9333] [--repo <path>] [--visible] [--keep-running]
// `--keep-running` skips the `stopPort` that normally frees the DevTools port first, so an app
// already listening on it keeps running and this launch comes up alongside it. The header used to
// name it `--keep-alive` while the code read `--keep-running`, so the documented spelling silently
// stopped the process it promised to spare; `--keep-running` is the name that works (GC-041).
// Exits 0 once the page target is up, 1 on timeout.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
 * Spawns the built app and resolves with { child, target, stop } once /json lists a page target.
 * `stop()` kills that process tree and nothing else.
 * `visible: true` drops stealth mode and shows the usual window.
 */
export async function launchApp({ port = 9333, repo = null, visible = false, appDir = APP_DIR, timeoutMs = 40000 } = {}) {
  const env = { ...process.env };
  if (visible) delete env.GITCLIENT_STEALTH;
  else env.GITCLIENT_STEALTH = '1';

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
  return { child, target, stop: () => stopApp(child) };
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

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
  };
  const port = Number(value('--port', process.env.GITCLIENT_E2E_PORT ?? 9333));
  try {
    if (!flag('--keep-running')) await stopPort(port);
    const { target } = await launchApp({ port, repo: value('--repo', null), visible: flag('--visible') });
    console.log(`app ready on port ${port}${flag('--visible') ? '' : ' (stealth)'}: ${target.url}`);
    process.exit(0);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
