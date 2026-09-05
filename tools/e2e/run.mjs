// End-to-end run against the built app (npm run build first, then `node tools/e2e/setup-testrepo.mjs`).
// Launches Electron with a DevTools port, drives the real UI over the Chrome DevTools Protocol and
// verifies every step against git. Exits non-zero when an assertion fails.
//
// Requires Node 22+ (global WebSocket and fetch). Kills any running electron.exe first, then
// launches through tools/launch-app.mjs, which keeps the run invisible (no window, no focus change).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { killElectron, launchApp } from '../launch-app.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = process.env.GITCLIENT_E2E_ROOT ?? join(tmpdir(), 'gitclient-e2e');
const R = join(root, 'testrepo');
const REMOTE = join(root, 'remote.git');
const SHOTS = join(root, 'shots');
const PORT = Number(process.env.GITCLIENT_E2E_PORT ?? 9333);

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
// Stealth by default (see tools/launch-app.mjs): no window, no taskbar entry, no focus change,
// so a run does not interrupt whoever is using the machine.
killElectron();
let target;
try {
  ({ target } = await launchApp({ port: PORT, appDir: APP }));
} catch (e) {
  console.error(String(e.message ?? e));
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
const modalButtons = () => ev(`[...document.querySelectorAll('.modal .modal-buttons .btn')].map(b => b.textContent.trim()).join(' | ')`);
const modalMessage = () => ev(`document.querySelector('.modal .modal-message')?.textContent ?? 'no modal message'`);
const modalClick = (label) =>
  ev(`(() => { const b = [...document.querySelectorAll('.modal .modal-buttons .btn')].find(x => x.textContent.trim() === ${q(label)}); if (!b) return 'no modal button ' + ${q(label)}; if (b.disabled) return 'DISABLED ' + ${q(label)}; b.click(); return 'clicked ' + ${q(label)}; })()`);
const contextMenuOn = (selector, text) =>
  ev(`(() => { const rows = [...document.querySelectorAll(${q(selector)})]; const r = ${text === null ? 'rows[0]' : `rows.find(x => x.innerText.replace(/\\s+/g, ' ').includes(${q(text)}))`}; if (!r) return 'row not found: ' + ${q(text ?? selector)}; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 20, clientY: b.y + b.height / 2, button: 2 })); return 'contextmenu on ' + r.innerText.replace(/\\s+/g, ' ').slice(0, 50); })()`);
const tool = (label) =>
  ev(`(() => { const b = [...document.querySelectorAll('.toolbar .tool-btn')].find(x => x.innerText.trim() === ${q(label)}); if (!b) return 'no tool button ' + ${q(label)}; if (b.disabled) return 'DISABLED ' + ${q(label)} + ' (' + b.title + ')'; b.click(); return 'clicked toolbar ' + ${q(label)}; })()`);
const openSection = (title) => ev(`(() => { const h = [...document.querySelectorAll('.section-head')].find(x => x.textContent.toLowerCase().includes(${q(title.toLowerCase())})); if (!h) return 'no section'; if (!h.classList.contains('open')) (h.querySelector('.section-toggle') ?? h).click(); return 'section open'; })()`);
const sectionAction = (title) =>
  ev(`(() => { const b = [...document.querySelectorAll('.left-panel .section-action')].find(x => (x.title ?? '') === ${q(title)}); if (!b) return 'no section action ' + ${q(title)}; b.click(); return 'clicked ' + ${q(title)}; })()`);
const clickBanner = (re) => ev(`(() => { const b = [...document.querySelectorAll('.banner button')].find(x => ${re}.test(x.innerText)); if (!b) return 'no banner button'; b.click(); return 'clicked ' + b.innerText; })()`);
const fetchAll = async () => {
  await ev(`document.querySelector('.toolbar .caret-btn')?.click(); 'caret'`);
  await sleep(300);
  return ev(`(() => { const b = [...document.querySelectorAll('.popover .popover-row')].find(x => x.innerText.trim() === 'Fetch all'); if (!b) return 'no Fetch all'; if (b.disabled) return 'Fetch all disabled'; b.click(); return 'clicked Fetch all'; })()`);
};
/** Type into the commit search field the way a user does (React needs the native setter + input event). */
const searchType = (text) =>
  ev(`(() => { const i = document.querySelector('.graph-search .search-input'); if (!i) return 'no search input'; i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${q(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed ' + ${q(text)}; })()`);
const searchState = () =>
  ev(
    `(() => { const bar = document.querySelector('.graph-search'); return JSON.stringify({ open: !!bar, value: bar?.querySelector('.search-input')?.value ?? null, count: bar?.querySelector('.search-count')?.textContent ?? null, matches: document.querySelectorAll('.graph-row.match').length, dimmed: document.querySelectorAll('.graph-row.unmatched').length, sha: document.querySelector('.detail-head .sha')?.textContent ?? null }); })()`,
  );
const searchBtn = (title) =>
  ev(`(() => { const b = [...document.querySelectorAll('.graph-search .search-btn')].find(x => (x.title ?? '').startsWith(${q(title)})); if (!b) return 'no search button ' + ${q(title)}; if (b.disabled) return 'DISABLED ' + ${q(title)}; b.click(); return 'clicked ' + ${q(title)}; })()`);

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
git(['remote', 'remove', 'upstream']);
git(['remote', 'remove', 'mirror']);
// step 15 parks the working tree in a stash and leaves a scratch file; drop both if a run died there
const GUARD_FILE = 'guard-checkout.txt';
const GUARD_STASH = 'e2e checkout guard';
rmSync(join(R, GUARD_FILE), { force: true });
for (let i = 0; i < 5; i++) {
  const idx = git(['stash', 'list']).split('\n').findIndex((l) => l.includes(GUARD_STASH));
  if (idx < 0) break;
  git(['stash', 'drop', '-q', `stash@{${idx}}`]);
}
// step 5 parks the whole tree in an unnamed stash for a moment; pop it back if a run died there
for (let i = 0; i < 5; i++) {
  if (!/^WIP on /.test(git(['stash', 'list', '-1', '--format=%gs']))) break;
  git(['stash', 'pop', '--index', '-q']);
}
const stamp = Date.now();

// ---- scenario -----------------------------------------------------------------------------------------------
step(1, 'load test repo');
// Preferences persist in the app's localStorage, so a hand-toggled setting from an earlier
// session would silently change what the later steps see: start every run from the defaults.
await ev(`localStorage.removeItem('gitclient.prefs'); localStorage.setItem('gitclient.lastRepo', ${q(R.replace(/\\/g, '/'))}); setTimeout(() => location.reload(), 50); 'reloading'`);
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

step(3, 'left panel context menu: checkout main (dirty tree prompts first)');
log(await contextMenuOn('.left-panel .ref-row', 'main'));
await sleep(300);
log('menu:', await menuList());
log(await menuClick('Checkout main'));
await sleep(400);
const dirtyPrompt = String(await modal(null, null));
check('dirty checkout prompts', dirtyPrompt.includes('Uncommitted changes'), dirtyPrompt);
check('prompt names the branch', String(await modalMessage()).includes('Check out main anyway?'), await modalMessage());
log(await modalClick('Check out anyway'));
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

step(5, "stash via toolbar: an empty message uses git's default, then a named stash");
// GC-029: the field is labelled "Message (optional)", so OK must stay enabled while it is empty.
log(await tool('Stash'));
await sleep(400);
log(await modal('', true));
const emptyOk = String(await ev(`(() => { const b = document.querySelector('.modal .modal-buttons .btn:last-child'); return b ? (b.disabled ? 'disabled' : 'enabled') : 'no modal'; })()`));
check('Stash OK stays enabled on an empty message', emptyOk === 'enabled', emptyOk);
log(await modalOk());
await settle();
const autoMessage = git(['stash', 'list', '-1', '--format=%gs']);
check("empty message stashes under git's own WIP message", /^WIP on /.test(autoMessage) && status() === '', `${autoMessage} | ${status()}`);
// put the mixed working tree back exactly as it was so the named stash below sees the same state
git(['stash', 'pop', '--index', '-q']);
log(await tool('Refresh'));
await settle();

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

step(14, 'per-file delete confirms with the UI modal, not a native dialog');
const scratch = `scratch-${stamp}.txt`;
writeFileSync(join(R, scratch), 'scratch\n');
log(await tool('Refresh'));
await settle();
log(await ev(`(() => { const r = document.querySelector('.graph-row.wip'); if (!r) return 'no WIP row'; r.click(); return 'WIP row selected'; })()`));
await sleep(300);
log(
  await ev(
    `(() => { const rows = [...document.querySelectorAll('.detail-panel .file-row')]; const r = rows.find(x => x.title === ${q(scratch)}); if (!r) return 'file row not found: ' + ${q(scratch)}; const b = r.querySelector('.actions .btn.danger'); if (!b) return 'no discard button'; b.click(); return 'clicked discard on ' + r.title; })()`,
  ),
);
await sleep(400);
const discardModal = String(await modal(null, null));
check('confirm modal replaced the native dialog and names the file', discardModal.includes(`Delete ${scratch}?`), discardModal);
await shot('modal-discard-file.png');
log(await modalOk());
await settle();
check('untracked file deleted after confirming', !existsSync(join(R, scratch)) && !status().includes(scratch), status());

step(15, 'checkout guard: clean tree is silent, Cancel is inert, Stash and check out re-applies');
// park the working tree so the clean-tree path can be exercised, restored at the end of the step
git(['stash', 'push', '-u', '-q', '-m', GUARD_STASH]);
log(await tool('Refresh'));
await settle();
check('tree parked before the clean-tree checkout', status() === '', status());
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
await sleep(300);
log(await menuClick('Checkout wip-branch'));
await sleep(500);
const promptedWhenClean = await ev(`!!document.querySelector('.modal')`);
await waitIdle();
check('clean tree checks out with no prompt', promptedWhenClean === false && git(['branch', '--show-current']) === 'wip-branch', `modal=${promptedWhenClean} branch=${git(['branch', '--show-current'])}`);

git(['checkout', '-q', 'main']);
writeFileSync(join(R, GUARD_FILE), 'guard\n');
log(await tool('Refresh'));
await settle();
const dirtyBefore = status();
const stashesBefore = git(['stash', 'list']).split('\n').filter(Boolean).length;
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
await sleep(300);
log(await menuClick('Checkout wip-branch'));
await sleep(400);
check('prompt offers all three choices', String(await modalButtons()) === 'Cancel | Stash and check out | Check out anyway', await modalButtons());
await shot('modal-checkout-dirty.png');
log(await modalClick('Cancel'));
await sleep(400);
await waitIdle();
check('cancel leaves HEAD and the tree untouched', git(['branch', '--show-current']) === 'main' && status() === dirtyBefore, `${git(['branch', '--show-current'])} | ${status()}`);

log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
await sleep(300);
log(await menuClick('Checkout wip-branch'));
await sleep(400);
log(await modalClick('Stash and check out'));
await settle();
check(
  'stash and check out lands on the branch with the changes re-applied',
  git(['branch', '--show-current']) === 'wip-branch' && status() === dirtyBefore && git(['stash', 'list']).split('\n').filter(Boolean).length === stashesBefore,
  `${git(['branch', '--show-current'])} | ${status()} | stashes=${git(['stash', 'list']).split('\n').filter(Boolean).length}`,
);
// restore what this step parked so the run stays re-entrant
git(['checkout', '-q', 'main']);
rmSync(join(R, GUARD_FILE), { force: true });
git(['stash', 'pop', '-q']);
log(await tool('Refresh'));
await settle();

step(16, 'commit search: message, sha prefix, next match, Escape');
const mainOnlySha = git(['log', '--all', '--format=%H', '--grep=Main-only change']).split('\n')[0] ?? '';
log(await tool('Search'));
await sleep(300);
let sr = JSON.parse(await searchState());
check('search bar opens from the toolbar', sr.open === true, JSON.stringify(sr));

log(await searchType('Main-only'));
await sleep(300);
sr = JSON.parse(await searchState());
check('message search selects the matching commit', sr.sha === mainOnlySha.slice(0, 7), `selected=${sr.sha} expected=${mainOnlySha.slice(0, 7)} | ${sr.count}`);
check('matches are highlighted and the rest dimmed, nothing hidden', sr.matches >= 1 && sr.dimmed >= 1, JSON.stringify(sr));
await shot('search-message.png');

log(await searchType(mainOnlySha.slice(0, 6)));
await sleep(300);
sr = JSON.parse(await searchState());
check('a sha prefix selects that commit', sr.sha === mainOnlySha.slice(0, 7), `selected=${sr.sha} expected=${mainOnlySha.slice(0, 7)}`);
check('the sha prefix matches exactly one commit', sr.count === '1 of 1', String(sr.count));

// "feature" appears in three commit messages: the next-match button must move the selection
log(await searchType('feature'));
await sleep(300);
const first = JSON.parse(await searchState());
log(await searchBtn('Next match'));
await sleep(300);
const second = JSON.parse(await searchState());
check('several matches are counted', /of [2-9]/.test(String(first.count)), `${first.count}`);
check('next match moves the selection', second.sha !== first.sha && second.count !== first.count, `${first.sha}/${first.count} -> ${second.sha}/${second.count}`);

// clicking a row mid-search moves the position with it, so "next" continues from there
log(await ev(`(() => { const r = [...document.querySelectorAll('.graph-row.match')].pop(); if (!r) return 'no match row'; r.click(); return 'clicked the last match'; })()`));
await sleep(300);
const clicked = JSON.parse(await searchState());
check('clicking a match moves the position to it', clicked.count === '3 of 3', String(clicked.count));
log(await searchBtn('Next match'));
await sleep(300);
const wrapped = JSON.parse(await searchState());
check('next continues from the clicked row and wraps', wrapped.count === '1 of 3', `${clicked.count} -> ${wrapped.count}`);

await escape();
await sleep(300);
sr = JSON.parse(await searchState());
check('Escape closes the search bar and clears the dimming', sr.open === false && sr.dimmed === 0, JSON.stringify(sr));

step(17, 'remotes: add and fetch, rename, edit URL, remove');
const remoteUrl = REMOTE.replace(/\\/g, '/');
log(await sectionAction('Add remote'));
await sleep(400);
log(await modal('upstream', null));
log(await modalOk());
await sleep(400);
log(await modal(remoteUrl, null));
log(await modalOk());
await settle();
check('remote added and fetched', git(['remote']).split('\n').includes('upstream') && git(['for-each-ref', '--format=%(refname)', 'refs/remotes/upstream']).includes('refs/remotes/upstream/main'), git(['remote', '-v']).replace(/\n/g, ' '));
check('the new remote shows in the left panel', String(await ev(`[...document.querySelectorAll('.left-panel .ref-row.remote-group .row-name')].map(x => x.textContent).join(',')`)).includes('upstream'));
await shot('remotes-added.png');

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'upstream'));
await sleep(300);
const remoteMenu = await menuList();
check('remote menu offers manage actions', /Edit URL/.test(remoteMenu) && /Rename/.test(remoteMenu) && /Remove upstream/.test(remoteMenu), remoteMenu);
log(await menuClick('Rename'));
await sleep(400);
log(await modal('mirror', null));
log(await modalOk());
await settle();
check('remote renamed', git(['remote']).split('\n').includes('mirror') && !git(['remote']).split('\n').includes('upstream'), git(['remote']).replace(/\n/g, ' '));

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'mirror'));
await sleep(300);
log(await menuClick('Edit URL'));
await sleep(400);
log(await modal('https://example.invalid/mirror.git', null));
log(await modalOk());
await settle();
check('remote URL updated', git(['remote', 'get-url', 'mirror']) === 'https://example.invalid/mirror.git', git(['remote', 'get-url', 'mirror']));

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'mirror'));
await sleep(300);
log(await menuClick('Remove mirror'));
await sleep(400);
check('removal asks for confirmation', String(await modal(null, null)).includes('Remove remote mirror?'), await modal(null, null));
log(await modalOk());
await settle();
check(
  'remote removed with its tracking branches',
  !git(['remote']).split('\n').includes('mirror') && git(['for-each-ref', '--format=%(refname)', 'refs/remotes/mirror']) === '',
  `${git(['remote']).replace(/\n/g, ' ')} | ${git(['for-each-ref', '--format=%(refname)', 'refs/remotes/mirror'])}`,
);
check('origin survived', git(['remote']).split('\n').includes('origin'), git(['remote', '-v']).replace(/\n/g, ' '));

await shot('final.png');

ws.close();
killElectron();
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (screenshots in ${SHOTS})`);
process.exit(failures === 0 ? 0 : 1);
