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
// Usage: node tools/launch-app.mjs [--port 9333] [--repo <path>] [--visible] [--keep-alive]
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

export function killElectron() {
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' });
    else execFileSync('pkill', ['-f', 'electron'], { stdio: 'ignore' });
  } catch {}
}

/**
 * Spawns the built app and resolves with { child, target } once /json lists a page target.
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
  return { child, target };
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
    if (!flag('--keep-running')) killElectron();
    const { target } = await launchApp({ port, repo: value('--repo', null), visible: flag('--visible') });
    console.log(`app ready on port ${port}${flag('--visible') ? '' : ' (stealth)'}: ${target.url}`);
    process.exit(0);
  } catch (e) {
    console.error(String(e.message ?? e));
    process.exit(1);
  }
}
