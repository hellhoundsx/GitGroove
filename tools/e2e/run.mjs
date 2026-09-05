// End-to-end run against the built app (npm run build first, then `node tools/e2e/setup-testrepo.mjs`).
// Launches Electron with a DevTools port, drives the real UI over the Chrome DevTools Protocol and
// verifies every step against git. Exits non-zero when an assertion fails.
//
// Requires Node 22+ (global WebSocket and fetch). Kills any running electron.exe first.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = process.env.GITCLIENT_E2E_ROOT ?? join(tmpdir(), 'gitclient-e2e');
const R = join(root, 'testrepo');
const REMOTE = join(root, 'remote.git');
const SHOTS = join(root, 'shots');
const PORT = Number(process.env.GITCLIENT_E2E_PORT ?? 9333);
const isWin = process.platform === 'win32';

if (!existsSync(R)) {
  console.error(`No test repository at ${R}. Run: node tools/e2e/setup-testrepo.mjs`);
  process.exit(2);
}
mkdirSync(SHOTS, { recursive: true });

const git = (args, cwd = R) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (e) {
    return `GIT-ERROR: ${(e.stderr || e.message).toString().trim()}`;
  }
};
const status = () => git(['status', '--short']).replace(/\n/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!ok) failures++;
};
const step = (n, title) => console.log(`\n### ${n} ${title}`);
const log = (...a) => console.log('   ', ...a);

// ---- launch the built app ---------------------------------------------------------------------
const killElectron = () => {
  try {
    if (isWin) execFileSync('taskkill', ['/F', '/IM', 'electron.exe'], { stdio: 'ignore' });
    else execFileSync('pkill', ['-f', 'electron'], { stdio: 'ignore' });
  } catch {}
};
killElectron();
const electronBin = join(APP, 'node_modules', '.bin', isWin ? 'electron.cmd' : 'electron');
const child = isWin
  ? spawn('cmd', ['/c', 'start', '', electronBin, '.', `--remote-debugging-port=${PORT}`], { cwd: APP, detached: true, stdio: 'ignore', windowsHide: true })
  : spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], { cwd: APP, detached: true, stdio: 'ignore' });
child.unref();

let target;
for (let i = 0; i < 80 && !target; i++) {
  try {
    const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
    target = list.find((t) => t.type === 'page');
  } catch {}
  if (!target) await sleep(500);
}
if (!target) {
  console.error('app did not start');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return `JS-ERROR: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`;
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, 'base64'));
};

// ---- helpers that run inside the renderer ---------------------------------------------------------
const q = JSON.stringify;
const state = async () =>
  JSON.parse(
    await ev(
      `JSON.stringify({ rows: document.querySelectorAll('.graph-row').length, branch: document.querySelector('.crumb .value.plain')?.innerText.replace(/\\s+/g, ' ') ?? null, err: document.querySelector('.statusbar .err')?.innerText ?? null, banner: document.querySelector('.banner')?.innerText.replace(/\\s+/g, ' ') ?? null, detailHead: document.querySelector('.detail-head')?.innerText.replace(/\\s+/g, ' ') ?? null })`,
    ),
  );
const menuList = () => ev(`[...document.querySelectorAll('.ctx-menu .ctx-item, .ctx-menu .ctx-sep')].map(i => i.classList.contains('ctx-sep') ? '---' : (i.disabled ? '(x) ' : '') + i.querySelector('.ctx-label')?.textContent.trim()).join(' | ')`);
const menuClick = (label) =>
  ev(`(() => { const items = [...document.querySelectorAll('.ctx-menu .ctx-item')]; const it = items.find(i => (i.querySelector('.ctx-label')?.textContent.trim() ?? '').startsWith(${q(label)})); if (!it) return 'menu item not found: ' + ${q(label)}; if (it.disabled) return 'DISABLED: ' + ${q(label)}; it.click(); return 'clicked: ' + ${q(label)}; })()`);
const modal = (value, checked) =>
  ev(`(() => { const m = document.querySelector('.modal'); if (!m) return 'no modal'; const input = m.querySelector('.modal-field input'); if (input && ${q(value)} !== null) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${q(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); } const cb = m.querySelector('.modal-check input'); if (cb && ${q(checked)} !== null && cb.checked !== ${q(checked)}) cb.click(); return JSON.stringify({ title: m.querySelector('h3')?.textContent, value: input?.value, checked: cb?.checked, ok: m.querySelector('.modal-buttons .btn:last-child')?.textContent }); })()`);
const modalOk = () => ev(`(() => { const b = document.querySelector('.modal .modal-buttons .btn:last-child'); if (!b) return 'no modal'; if (b.disabled) return 'OK disabled'; b.click(); return 'OK clicked'; })()`);
const contextMenuOn = (selector, text) =>
  ev(`(() => { const rows = [...document.querySelectorAll(${q(selector)})]; const r = ${text === null ? 'rows[0]' : `rows.find(x => x.innerText.replace(/\\s+/g, ' ').includes(${q(text)}))`}; if (!r) return 'row not found: ' + ${q(text ?? selector)}; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 20, clientY: b.y + b.height / 2, button: 2 })); return 'contextmenu on ' + r.innerText.replace(/\\s+/g, ' ').slice(0, 50); })()`);
const tool = (label) =>
  ev(`(() => { const b = [...document.querySelectorAll('.toolbar .tool-btn')].find(x => x.innerText.trim() === ${q(label)}); if (!b) return 'no tool button ' + ${q(label)}; if (b.disabled) return 'DISABLED ' + ${q(label)} + ' (' + b.title + ')'; b.click(); return 'clicked toolbar ' + ${q(label)}; })()`);
const openSection = (title) => ev(`(() => { const h = [...document.querySelectorAll('.section-head')].find(x => x.textContent.toLowerCase().includes(${q(title.toLowerCase())})); if (!h) return 'no section'; if (!h.classList.contains('open')) h.click(); return 'section open'; })()`);
const clickBanner = (re) => ev(`(() => { const b = [...document.querySelectorAll('.banner button')].find(x => ${re}.test(x.innerText)); if (!b) return 'no banner button'; b.click(); return 'clicked ' + b.innerText; })()`);
const fetchAll = async () => {
  await ev(`document.querySelector('.toolbar .caret-btn')?.click(); 'caret'`);
  await sleep(300);
  return ev(`(() => { const b = [...document.querySelectorAll('.popover .popover-row')].find(x => x.innerText.trim() === 'Fetch all'); if (!b) return 'no Fetch all'; if (b.disabled) return 'Fetch all disabled'; b.click(); return 'clicked Fetch all'; })()`);
};
/** Wait until the app reports no running operation (status bar spinner gone), then a short settle. */
const waitIdle = async (max = 15000) => {
  const start = Date.now();
  while (Date.now() - start < max) {
    const busy = await ev("!!document.querySelector('.statusbar .busy')");
    if (!busy) break;
    await sleep(150);
  }
  await sleep(400);
};
const settle = async (ms = 600) => {
  await sleep(ms);
  await waitIdle();
};
const escape = () => send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }));

// ---- make the scratch repo state predictable when re-running --------------------------------------------
git(['cherry-pick', '--abort']);
git(['merge', '--abort']);
git(['rebase', '--abort']);
git(['checkout', '-q', 'main']);
git(['branch', '-D', 'conflict-branch']);
git(['branch', '-D', 'test-branch']);
git(['tag', '-d', 't-test']);
rmSync(join(root, 'clone2'), { recursive: true, force: true });
const stamp = Date.now();

// ---- scenario -----------------------------------------------------------------------------------------------
step(1, 'load test repo');
await ev(`localStorage.setItem('gitclient.lastRepo', ${q(R.replace(/\\/g, '/'))}); setTimeout(() => location.reload(), 50); 'reloading'`);
await settle();
let s = await state();
check('repo loaded with WIP row and commits', s.rows > 5 && (s.branch ?? '').startsWith('main'), JSON.stringify(s));

step(2, 'create branch via toolbar prompt');
log(await tool('Branch'));
await sleep(400);
log(await modal('test-branch', true));
log(await modalOk());
await settle();
check('branch created and checked out', git(['branch', '--show-current']) === 'test-branch');

step(3, 'left panel context menu: checkout main');
log(await contextMenuOn('.left-panel .ref-row', 'main'));
await sleep(300);
log('menu:', await menuList());
log(await menuClick('Checkout main'));
await settle();
check('checked out main', git(['branch', '--show-current']) === 'main');

step(4, 'delete branch via menu + confirm');
log(await contextMenuOn('.left-panel .ref-row', 'test-branch'));
await sleep(300);
log(await menuClick('Delete test-branch'));
await sleep(400);
log(await modalOk());
await settle();
check('branch deleted', !git(['branch', '--format=%(refname:short)']).includes('test-branch'));

step(5, 'stash via toolbar');
log(await tool('Stash'));
await sleep(400);
log(await modal('test stash', true));
await shot('modal-stash.png');
log(await modalOk());
await settle();
check('stash created and tree clean', git(['stash', 'list']).includes('test stash') && status() === '', status());

step(6, 'merge with a real conflict, then abort');
git(['checkout', '-qb', 'conflict-branch']);
writeFileSync(join(R, 'a.txt'), `line1\nline2 from branch ${stamp}\nline3\nline4 new\n`);
git(['commit', '-qam', 'branch change']);
git(['checkout', '-q', 'main']);
writeFileSync(join(R, 'a.txt'), `line1\nline2 from main ${stamp}\nline3\nline4 new\n`);
git(['commit', '-qam', 'main change']);
log(await tool('Refresh'));
await settle();
log(await contextMenuOn('.left-panel .ref-row', 'conflict-branch'));
await sleep(300);
log(await menuClick('Merge conflict-branch into main'));
await settle();
s = await state();
check('conflict reported by git', status().includes('UU a.txt'), status());
check('conflict banner shown', !!s.banner && /merge in progress/.test(s.banner), s.banner ?? '');
check('conflict error shown', !!s.err && /conflict/i.test(s.err), s.err ?? '');
await shot('merge-conflict.png');
log(await clickBanner('/Abort/'));
await settle();
check('merge aborted', !existsSync(join(R, '.git', 'MERGE_HEAD')) && status() === '', status());

step(7, 'cherry-pick a fresh commit onto main');
git(['checkout', '-q', 'wip-branch']);
writeFileSync(join(R, `pick-${stamp}.txt`), 'picked\n');
git(['add', `pick-${stamp}.txt`]);
git(['commit', '-qm', `Pickable commit ${stamp}`]);
git(['checkout', '-q', 'main']);
log(await tool('Refresh'));
await settle();
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Pickable commit'));
await sleep(300);
log(await menuClick('Cherry pick commit'));
await settle();
check('cherry-pick applied', git(['log', '--oneline', '-1']).includes('Pickable commit') && existsSync(join(R, `pick-${stamp}.txt`)));

step(8, 'pop stash via toolbar');
log(await tool('Pop'));
await settle();
check('stash popped', git(['stash', 'list']) === '' && status().includes('README.md'), status());

step(9, 'push');
log(await tool('Push'));
await settle();
check('origin/main updated', git(['rev-parse', 'origin/main']) === git(['rev-parse', 'main']));

step(10, 'fetch and pull after a commit from another clone');
const clone2 = join(root, 'clone2');
git(['clone', '-q', '-b', 'main', REMOTE, clone2], root);
git(['config', 'user.email', 't@e.com'], clone2);
git(['config', 'user.name', 'Other'], clone2);
writeFileSync(join(clone2, `remote-${stamp}.txt`), 'remote side\n');
git(['add', `remote-${stamp}.txt`], clone2);
git(['commit', '-qm', `Commit from another clone ${stamp}`], clone2);
log(git(['push', '-q', 'origin', 'main'], clone2));
log(await fetchAll());
await settle();
s = await state();
check('behind after fetch', git(['rev-list', '--count', 'main..origin/main']) === '1' && /↓1/.test(s.branch ?? ''), s.branch ?? '');
log(await tool('Pull'));
await settle();
check('pulled', git(['log', '--oneline', '-1']).includes('Commit from another clone') && git(['rev-list', '--count', 'main..origin/main']) === '0');

step(11, 'tag create via commit menu, delete via left panel');
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Work on wip branch'));
await sleep(300);
log('menu:', await menuList());
await shot('commit-context-menu.png');
log(await menuClick('Create tag here'));
await sleep(400);
log(await modal('t-test', false));
log(await modalOk());
await settle();
check('tag created', git(['tag']).split('\n').includes('t-test'));
log(await openSection('Tags'));
await sleep(300);
log(await contextMenuOn('.left-panel .ref-row', 't-test'));
await sleep(300);
log(await menuClick('Delete tag t-test'));
await sleep(400);
log(await modalOk());
await settle();
check('tag deleted', !git(['tag']).split('\n').includes('t-test'));

step(12, 'already-applied cherry-pick: error kept visible, in-progress banner, abort');
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Pickable commit'));
await sleep(300);
log(await menuClick('Cherry pick commit'));
await settle();
s = await state();
check('cherry-pick left in progress', existsSync(join(R, '.git', 'CHERRY_PICK_HEAD')) && /cherry-pick in progress/.test(s.banner ?? ''), s.banner ?? '');
check('git message visible', /now empty/.test(s.err ?? ''), s.err ?? '');
log(await clickBanner('/Abort/'));
await settle();
s = await state();
check('cherry-pick aborted', !existsSync(join(R, '.git', 'CHERRY_PICK_HEAD')) && s.banner === null && s.err === null);

step(13, 'WIP row menu');
log(await contextMenuOn('.graph-row.wip', null));
await sleep(300);
const wipMenu = await menuList();
check('WIP menu lists staging actions', /Stage all changes/.test(wipMenu) && /Stash changes/.test(wipMenu), wipMenu);
await escape();
await shot('final.png');

ws.close();
killElectron();
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (screenshots in ${SHOTS})`);
process.exit(failures === 0 ? 0 : 1);
