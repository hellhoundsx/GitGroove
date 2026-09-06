// End-to-end run against the built app (npm run build first, then `node tools/e2e/setup-testrepo.mjs`).
// Launches Electron with a DevTools port, drives the real UI over the Chrome DevTools Protocol and
// verifies every step against git. Exits non-zero when an assertion fails.
//
// Requires Node 22+ (global WebSocket and fetch). Frees the DevTools port a stale run may still
// hold, then launches through tools/launch-app.mjs, which keeps the run invisible (no window, no
// focus change). Both the prologue and the epilogue stop one process tree only (GC-035).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchApp, stopPort } from '../launch-app.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const root = process.env.GITCLIENT_E2E_ROOT ?? join(tmpdir(), 'gitclient-e2e');
const R = join(root, 'testrepo');
const REMOTE = join(root, 'remote.git');
const SHOTS = join(root, 'shots');
// The branch-tip snapshot setup-testrepo.mjs writes (GC-076); a file rather than refs (GC-073).
const BASELINE = join(root, '.e2e-baseline.json');
const PORT = Number(process.env.GITCLIENT_E2E_PORT ?? 9333);
const runStart = Date.now();

// Claim the root for the length of the run, so a concurrent `e2e:setup` on the same root refuses
// to wipe the repository out from under this suite instead of doing it silently (GC-064).
mkdirSync(root, { recursive: true });
writeFileSync(join(root, '.e2e-owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), what: 'e2e run.mjs' }, null, 2));

// A missing or non-git `testrepo` is the state a wipe leaves behind, so say so in one line and run
// nothing rather than failing every assertion against a repository that is not there (GC-064).
if (!existsSync(R) || !existsSync(join(R, '.git'))) {
  console.error(`No test repository at ${R}${existsSync(R) ? ' (the folder is there but is not a git repository)' : ''}. Run: node tools/e2e/setup-testrepo.mjs`);
  process.exit(2);
}

// `.git/index.lock` is the app's own watcher refreshing on its 300ms schedule against the index
// this suite is writing to. It clears on its own, so the command is retried for about a second
// before it is reported; anything else fails immediately (GC-098).
const LOCKED_RE = /index\.lock|Unable to create/i;
const LOCK_RETRIES = 5;
// execFileSync is synchronous, so the wait between attempts has to be too.
const sleepSync = (ms) => void Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Run git once, answering `{ out }` or `{ stderr }`, retrying only a lock the watcher will drop. */
const gitRun = (args, cwd) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return { out: execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() };
    } catch (e) {
      const stderr = (e.stderr || e.message).toString().trim();
      if (LOCKED_RE.test(stderr) && attempt < LOCK_RETRIES) {
        sleepSync(200);
        continue;
      }
      return { stderr };
    }
  }
};

/**
 * git against the fixture. A non-zero exit **throws**, naming the command and carrying git's
 * stderr (GC-098): almost every call site here ignores what this returns, so a failure used to be
 * a `GIT-ERROR:` string nobody read, and the broken fixture surfaced steps later as a row that
 * never appeared — fourteen downstream failures naming everything except the cause. Commands that
 * are allowed to fail go through `gitMay` instead.
 */
const git = (args, cwd = R) => {
  const r = gitRun(args, cwd);
  if (r.stderr !== undefined) throw new Error(`git ${args.join(' ')}${cwd === R ? '' : ` (in ${cwd})`} failed: ${r.stderr}`);
  return r.out;
};

/**
 * git for the commands whose failure is the normal case — deleting a branch, a tag or a remote a
 * healthy run already removed, aborting an operation that is not in progress. Keeps the old
 * swallowing behaviour, `GIT-ERROR: <stderr>` and all, because the answer is never read (GC-098).
 */
const gitMay = (args, cwd = R) => {
  const r = gitRun(args, cwd);
  return r.stderr !== undefined ? `GIT-ERROR: ${r.stderr}` : r.out;
};
const status = () => git(['status', '--short']).replace(/\n/g, ' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The branch tips setup-testrepo.mjs recorded, keyed by branch name (GC-076). The run puts the
// fixture back to them when it finishes and then asserts that it did, so a step that leaves a
// commit behind says so itself. A fixture built before that snapshot existed cannot be checked at
// all, which makes it as stale as no fixture: say so the same way and stop before the launch.
// It is a file rather than the `refs/e2e/baseline/*` namespace it started as, because `--all`
// includes every ref under `refs/` and those kept a hidden branch's commits in the graph (GC-073).
const baseline = new Map(Object.entries(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {}));
if (baseline.size === 0) {
  console.error(`The test repository at ${R} predates the fixture baseline. Run: node tools/e2e/setup-testrepo.mjs`);
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`    ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!ok) failures++;
};
const step = (n, title) => console.log(`\n### ${n} ${title}`);
const log = (...a) => console.log('   ', ...a);

// ---- launch the built app ---------------------------------------------------------------------
// Stealth by default (see tools/launch-app.mjs): no window, no taskbar entry, no focus change,
// so a run does not interrupt whoever is using the machine. Only a process still holding OUR
// DevTools port is stopped: the backlog reviewer runs its own build on another port, and a
// machine-wide kill used to take it (and any dev-mode window) down with this run (GC-035).
await stopPort(PORT);
let target;
let stopApp;
try {
  ({ target, stop: stopApp } = await launchApp({ port: PORT, appDir: APP }));
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

// A `git()` that throws must end the run where it happened, saying which command failed and what
// git said — and must not leave this run's Electron alive doing it (GC-098, GC-035). Both events
// are registered because a throw from top-level await arrives as an unhandled rejection while one
// from a callback arrives as an uncaught exception; either way the tree this run started is the
// only one stopped.
const bail = (e) => {
  console.error(`\n    FAIL ${e?.stack ?? e?.message ?? e}`);
  try {
    ws.close();
  } catch {
    /* already closed */
  }
  try {
    stopApp?.();
  } catch {
    /* already gone */
  }
  console.log(`\n1 FAILED (the run stopped here; screenshots in ${SHOTS})`);
  console.log(`total: ${((Date.now() - runStart) / 1000).toFixed(1)}s`);
  process.exit(1);
};
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

const ev = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return `JS-ERROR: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`;
  return r.result.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(SHOTS, { recursive: true }); // a missing shots/ must not end the run in an ENOENT (GC-064)
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
/** Right-click a row and wait for its menu. Waiting for the previous menu to be gone comes first:
 *  a synthetic contextmenu does not dismiss a menu that is still up, so a bare `.ctx-menu` check
 *  would be satisfied by the stale one and the click after it would land in the wrong menu (GC-053). */
const contextMenuOn = async (selector, text) => {
  await waitNoMenu();
  const opened = await ev(`(() => { const rows = [...document.querySelectorAll(${q(selector)})]; const r = ${text === null ? 'rows[0]' : `rows.find(x => x.innerText.replace(/\\s+/g, ' ').includes(${q(text)}))`}; if (!r) return 'row not found: ' + ${q(text ?? selector)}; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + 20, clientY: b.y + b.height / 2, button: 2 })); return 'contextmenu on ' + r.innerText.replace(/\\s+/g, ' ').slice(0, 50); })()`);
  await waitFor(`!!document.querySelector('.ctx-menu .ctx-item')`, `the context menu on ${text ?? selector}`);
  return opened;
};
const tool = (label) =>
  ev(`(() => { const b = [...document.querySelectorAll('.toolbar .tool-btn')].find(x => x.innerText.trim() === ${q(label)}); if (!b) return 'no tool button ' + ${q(label)}; if (b.disabled) return 'DISABLED ' + ${q(label)} + ' (' + b.title + ')'; b.click(); return 'clicked toolbar ' + ${q(label)}; })()`);
const openSection = (title) => ev(`(() => { const h = [...document.querySelectorAll('.section-head')].find(x => x.textContent.toLowerCase().includes(${q(title.toLowerCase())})); if (!h) return 'no section'; if (!h.classList.contains('open')) (h.querySelector('.section-toggle') ?? h).click(); return 'section open'; })()`);
const sectionAction = (title) =>
  ev(`(() => { const b = [...document.querySelectorAll('.left-panel .section-action')].find(x => (x.title ?? '') === ${q(title)}); if (!b) return 'no section action ' + ${q(title)}; b.click(); return 'clicked ' + ${q(title)}; })()`);
const clickBanner = (re) => ev(`(() => { const b = [...document.querySelectorAll('.banner button')].find(x => ${re}.test(x.innerText)); if (!b) return 'no banner button'; b.click(); return 'clicked ' + b.innerText; })()`);
const fetchAll = async () => {
  await ev(`document.querySelector('.toolbar .caret-btn')?.click(); 'caret'`);
  await waitFor(`!!document.querySelector('.toolbar .popover .popover-row')`, 'the Pull popover to open');
  return ev(`(() => { const b = [...document.querySelectorAll('.popover .popover-row')].find(x => x.innerText.trim() === 'Fetch all'); if (!b) return 'no Fetch all'; if (b.disabled) return 'Fetch all disabled'; b.click(); return 'clicked Fetch all'; })()`);
};
/** Type into the commit search field the way a user does (React needs the native setter + input event). */
const searchType = (text) =>
  ev(`(() => { const i = document.querySelector('.graph-search .search-input'); if (!i) return 'no search input'; i.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${q(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed ' + ${q(text)}; })()`);
const searchState = () =>
  ev(
    `(() => { const bar = document.querySelector('.graph-search'); return JSON.stringify({ open: !!bar, value: bar?.querySelector('.search-input')?.value ?? null, count: bar?.querySelector('.search-count')?.textContent ?? null, matches: document.querySelectorAll('.graph-row.match').length, dimmed: document.querySelectorAll('.graph-row.unmatched').length, sha: document.querySelector('.detail-head .sha')?.textContent ?? null }); })()`,
  );
/** The same, from a known scroll position: the rows are virtualised, so the rendered match and
 *  dim counts only compare across a remount when the graph is scrolled the same way (GC-030). */
const searchStateAtTop = async () => {
  // Every row is positioned by its index, so `top: 0px` on the first rendered one is the graph
  // having re-rendered from the top. The scroll is re-applied on every poll rather than once up
  // front: the graph remounts when a file view closes and its keep-the-selection-visible effect
  // can scroll away again just after the first attempt (GC-053).
  await waitFor(
    `(() => { const b = document.querySelector('.graph-body'); if (!b) return false; if (b.scrollTop !== 0) b.scrollTop = 0; return b.scrollTop === 0 && document.querySelector('.graph-rows')?.firstElementChild?.style.top === '0px'; })()`,
    'the graph to re-render from the top',
  );
  return searchState();
};
/** The find bar's readout ("N commits", "no matches", "i of n"): the query, the match set, the
 *  dimming and the selection all land in the same render, so a readout that has moved off the value
 *  an action started from is the signal that the search has caught up (GC-053). */
const searchCount = () => ev(`document.querySelector('.graph-search .search-count')?.textContent ?? null`);
const waitSearch = (before) =>
  waitFor(`(document.querySelector('.graph-search .search-count')?.textContent ?? null) !== ${q(before)}`, `the search readout to move off ${before}`);
/** Which UI layers are up right now (GC-039: Escape must close exactly one of them). */
const layerState = () =>
  ev(
    `(() => JSON.stringify({ menu: !!document.querySelector('.ctx-menu'), modal: !!document.querySelector('.modal'), popover: !!document.querySelector('.toolbar .popover'), search: !!document.querySelector('.graph-search'), query: document.querySelector('.graph-search .search-input')?.value ?? null }))()`,
  );
const searchBtn = (title) =>
  ev(`(() => { const b = [...document.querySelectorAll('.graph-search .search-btn')].find(x => (x.title ?? '').startsWith(${q(title)})); if (!b) return 'no search button ' + ${q(title)}; if (b.disabled) return 'DISABLED ' + ${q(title)}; b.click(); return 'clicked ' + ${q(title)}; })()`);

/** Poll a boolean expression in the renderer until it is true (or the wait runs out). Every wait on
 *  a UI state goes through here rather than a fixed sleep, so a slow moment costs the run a few more
 *  polls instead of turning into a flake no assertion explains (GC-053). */
const waitFor = async (expression, what, max = 5000) => {
  const start = Date.now();
  while (Date.now() - start < max) {
    if ((await ev(expression)) === true) return true;
    await sleep(50); // the poll interval itself: there is nothing to observe between two polls
  }
  check(`waited for ${what}`, false, `still false after ${max}ms: ${expression}`);
  return false;
};
/** Wait for a dialog. Every caller has closed the previous one and settled, so this cannot be
 *  satisfied by the dialog of the step before; the one place where two prompts follow each other
 *  back to back (step 17's Add remote) waits on the second one's own title instead (GC-053). */
const waitModal = () => waitFor(`!!document.querySelector('.modal .modal-buttons .btn')`, 'the dialog to open');
const waitNoModal = () => waitFor(`!document.querySelector('.modal')`, 'the dialog to close');
const waitNoMenu = () => waitFor(`!document.querySelector('.ctx-menu')`, 'the previous context menu to close');

/** Wait until the app reports no running operation (the status bar spinner is gone). Used where a
 *  DOM wait has already proved the reload landed and only the spinner is left to clear (GC-080). */
const waitIdle = async (max = 15000) => {
  const start = Date.now();
  while (Date.now() - start < max) {
    const busy = await ev("!!document.querySelector('.statusbar .busy')");
    if (!busy) return true;
    await sleep(150); // the poll interval itself: there is nothing to observe between two polls
  }
  check('waited for the app to go idle', false, `the status bar was still busy after ${max}ms`);
  return false;
};

/** The snapshot generation the app publishes on the status bar: a counter bumped every time a
 *  snapshot or a status is applied to state, `run()`'s reload and the watcher's alike (GC-080). */
const generation = () => ev(`document.querySelector('.statusbar')?.dataset.gen ?? null`);
/** Perform a git action and wait for the app to have finished reloading after it.
 *
 *  This is what the two sleeps it replaces were standing in for. `settle()` slept 600ms "for the
 *  window in which an action gets as far as raising the spinner" and `waitIdle()` a further 400ms
 *  because "the reload that follows the spinner is not announced anywhere in the DOM" — 39 + 12
 *  call sites, 43.8s of a ~58s run spent observing nothing. The app announces it now, so wait on
 *  it: the generation must have moved **and** the spinner must be gone. Both, because either alone
 *  is satisfiable by the wrong moment — a watcher refresh landing between the read and the click
 *  moves the generation on its own, and the spinner is absent in the instant before the click
 *  raises it. Together they cannot be: once `busy` is up, only this action's own reload clears it,
 *  and that reload bumps the generation again. */
const act = async (fn, what) => {
  const before = await generation();
  const r = await fn();
  await waitFor(
    `(() => { const s = document.querySelector('.statusbar'); return !!s && s.dataset.gen !== ${q(before)} && !s.querySelector('.busy'); })()`,
    `${what ?? String(r).slice(0, 60)} to reload the repository (generation was ${before})`,
    15000,
  );
  return r;
};
const escape = () => send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }));
/** A real Ctrl+Enter to whatever has focus (CDP `modifiers: 2` is Ctrl). The commit form binds it on
 *  the summary and the description through `matches('commit', e)`, so the key has to reach the
 *  focused field rather than a window listener the way Escape does (GC-062). */
const ctrlEnter = () =>
  send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 }).then(() =>
    send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 2 }),
  );

// ---- helpers for the commit form and the diff's hunk actions (GC-062) -----------------------------
/** Type into a controlled input or textarea the way a user does (React needs the native setter). */
const setField = (selector, text) =>
  ev(
    `(() => { const el = document.querySelector(${q(selector)}); if (!el) return 'no field ' + ${q(selector)}; el.focus(); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${q(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'typed into ' + ${q(selector)} + ': ' + ${q(text)}; })()`,
  );
/** Select the WIP row so the detail panel shows the staging view. The rows are virtualised and an
 *  earlier step may have left a commit deep in the graph selected, so scroll back to the top first
 *  (GC-030's lesson, applied here the same way step 19 does). */
const selectWip = async () => {
  await waitFor(`(() => { const b = document.querySelector('.graph-body'); if (!b) return false; if (b.scrollTop !== 0) b.scrollTop = 0; return !!document.querySelector('.graph-row.wip'); })()`, 'the WIP row to be rendered');
  return ev(`(() => { const r = document.querySelector('.graph-row.wip'); if (!r) return 'no WIP row'; r.click(); return 'WIP row selected'; })()`);
};
/** Click the Stage button on a file row in the staging list. */
const stageRow = (file) =>
  ev(
    `(() => { const r = [...document.querySelectorAll('.detail-panel .file-row')].find(x => x.title === ${q(file)}); if (!r) return 'no file row ' + ${q(file)}; const b = r.querySelector('.actions .btn.success'); if (!b) return 'no Stage button on ' + ${q(file)}; if (b.disabled) return 'DISABLED Stage on ' + ${q(file)}; b.click(); return 'clicked Stage on ' + ${q(file)}; })()`,
  );
/** Click a file row inside one staging group. A file with a hunk staged is listed in both groups, so
 *  the group is what picks the unstaged or the staged side of the diff (GC-062). */
const clickFileRow = (group, file) =>
  ev(
    `(() => { const list = [...document.querySelectorAll('.detail-panel .file-list')].find(l => (l.querySelector('.group-head span')?.textContent ?? '').toLowerCase().startsWith(${q(group.toLowerCase())})); if (!list) return 'no group ' + ${q(group)}; const r = [...list.querySelectorAll('.file-row')].find(x => x.title === ${q(file)}); if (!r) return 'no row ' + ${q(file)} + ' under ' + ${q(group)}; r.click(); return 'clicked ' + ${q(file)} + ' under ' + ${q(group)}; })()`,
  );
/** What the open diff shows: which side, how many hunks, and every hunk action button in order. */
const diffState = () =>
  ev(
    `(() => { const v = document.querySelector('.file-view'); return JSON.stringify({ open: !!v, name: v?.querySelector('.path .name')?.textContent ?? null, chip: v?.querySelector('.file-view-sub .chip')?.textContent ?? null, hunks: document.querySelectorAll('.file-view .diff-body .hunk').length, actions: [...document.querySelectorAll('.file-view .diff-body .hunk-actions .btn')].map(b => b.textContent.trim()).join(',') }); })()`,
  );
/** Click one hunk's action button ("Stage hunk" / "Discard hunk" / "Unstage hunk") by hunk index. */
const hunkAction = (index, label) =>
  ev(
    `(() => { const h = document.querySelectorAll('.file-view .diff-body .hunk')[${index}]; if (!h) return 'no hunk ' + ${index}; const b = [...h.querySelectorAll('.hunk-actions .btn')].find(x => x.textContent.trim() === ${q(label)}); if (!b) return 'no ' + ${q(label)} + ' on hunk ' + ${index}; if (b.disabled) return 'DISABLED ' + ${q(label)} + ' on hunk ' + ${index}; b.click(); return 'clicked ' + ${q(label)} + ' on hunk ' + ${index}; })()`,
  );
/** Wait for the diff to be showing one side of a WIP file: the chip, the number of hunks **and the
 *  exact list of added lines it renders**. The content is the load-bearing half. `DiffView` starts
 *  the new load without clearing the text it already has, so between a click and the new diff
 *  resolving it still renders the previous one, while the chip and the hunk buttons come straight
 *  from `view` and flip instantly. A wait keyed on chip + hunk count alone is therefore satisfied by
 *  the stale render whenever the old side happens to have the same number of hunks — which is
 *  exactly what happens when this step switches from the 1-hunk unstaged side to the 1-hunk staged
 *  one, and `Unstage hunk` then rebuilt its patch from the wrong hunk and git rejected it into
 *  `DiffView`'s own error line. The added lines differ between the two sides, so matching them
 *  closes that window. Staging or unstaging a hunk reloads the diff through `workdirVersion`, so
 *  this is a strictly later moment than the click and there is nothing to sleep on (GC-053). */
const waitDiff = (chip, hunks, adds) =>
  waitFor(
    `(document.querySelector('.file-view .file-view-sub .chip')?.textContent ?? '') === ${q(chip)}` +
      ` && document.querySelectorAll('.file-view .diff-body .hunk').length === ${hunks}` +
      ` && [...document.querySelectorAll('.file-view .diff-body .hunk .line.add .code')].map(c => c.textContent).join('|') === ${q(adds.join('|'))}`,
    `the ${chip.toLowerCase()} diff to show ${hunks} hunk${hunks === 1 ? '' : 's'} adding ${adds.join(', ')}`,
  );

/** Flip the file view's Unified / Split layout switch (GC-014). It writes `prefs.diffView`, which
 *  step 1 clears for the next run along with the rest of the blob. */
const setLayout = (label) =>
  ev(
    `(() => { const b = [...document.querySelectorAll('.file-view .seg-btn')].find(x => x.textContent.trim() === ${q(label)}); if (!b) return 'no ' + ${q(label)} + ' layout button'; b.click(); return 'layout: ' + ${q(label)}; })()`,
  );
/** One split hunk table as rows of [old number, old text, new number, new text]; a `null` text is a
 *  padded side, where that file has no line at all (GC-014). */
const splitRows = (index) =>
  ev(
    `(() => { const t = document.querySelectorAll('.file-view .diff-body .hunk-lines.split')[${index}]; if (!t) return 'null'; return JSON.stringify([...t.querySelectorAll('tr.line')].map(tr => { const td = [...tr.querySelectorAll('td')]; const pre = (c) => c.querySelector('pre') ? c.querySelector('pre').textContent : null; return [td[0].textContent, pre(td[2]), td[3].textContent, pre(td[5])]; })); })()`,
  );
/** `waitDiff` for the split layout, which tints the cells rather than the row, so `.line.add` no
 *  longer matches anything: the added lines are read off `td.code.add` instead. The content half is
 *  load-bearing here for the same reason it is there — a wait keyed on the hunk count alone is
 *  satisfied by the previous side's render while the new load is still in flight (GC-014). */
const waitSplitDiff = (chip, hunks, adds) =>
  waitFor(
    `(document.querySelector('.file-view .file-view-sub .chip')?.textContent ?? '') === ${q(chip)}` +
      ` && document.querySelectorAll('.file-view .diff-body .hunk-lines.split').length === ${hunks}` +
      ` && [...document.querySelectorAll('.file-view .hunk-lines.split td.code.add pre')].map(p => p.textContent).join('|') === ${q(adds.join('|'))}`,
    `the split ${chip.toLowerCase()} diff to show ${hunks} hunk${hunks === 1 ? '' : 's'} adding ${adds.join(', ')}`,
  );

// ---- make the scratch repo state predictable when re-running --------------------------------------------
gitMay(['cherry-pick', '--abort']);
gitMay(['merge', '--abort']);
gitMay(['rebase', '--abort']);
git(['checkout', '-q', 'main']);
gitMay(['branch', '-D', 'conflict-branch']);
gitMay(['branch', '-D', 'test-branch']);
gitMay(['tag', '-d', 't-test']);
gitMay(['remote', 'remove', 'upstream']);
gitMay(['remote', 'remove', 'mirror']);
// step 17 pushes this scratch branch to the second remote and deletes it again (GC-031)
gitMay(['branch', '-D', 'push-target']);
gitMay(['push', '-q', 'origin', '--delete', 'push-target']);
// step 20 commits through the commit form and then amends that commit, undoing both at the end. A
// run that died in between leaves one extra commit on main, whose subject always starts with this
// mark, plus the scratch file the step staged (GC-062). The reset is --soft, never --hard: the index
// the commit consumed holds the fixture's own staged README.md change and main.txt deletion, and the
// working tree holds the unstaged edits every later step asserts against, so a hard reset would undo
// the commit by gutting the fixture. --soft puts index and tree back exactly as the commit found them.
const COMMIT_MARK = 'e2e commit form';
const COMMIT_FILE_RE = /^e2e-commit-\d+\.txt$/;
for (let i = 0; i < 3; i++) {
  if (!git(['log', '-1', '--format=%s']).startsWith(COMMIT_MARK)) break;
  git(['reset', '--soft', 'HEAD^']);
}
// whatever that reset put back in the index is the fixture's own, except the step's scratch file
for (const f of git(['diff', '--cached', '--name-only']).split('\n')) if (COMMIT_FILE_RE.test(f)) git(['reset', '-q', '--', f]);
for (const f of readdirSync(R)) if (COMMIT_FILE_RE.test(f)) rmSync(join(R, f), { force: true });
// step 15 parks the working tree in a stash, leaves a scratch file and edits a tracked one; undo
// all three if a run died there. feature.txt is safe to restore because no other step touches it.
const GUARD_FILE = 'guard-checkout.txt';
const GUARD_TRACKED = 'feature.txt';
const GUARD_STASH = 'e2e checkout guard';
rmSync(join(R, GUARD_FILE), { force: true });
git(['checkout', '-q', '--', GUARD_TRACKED]);
for (let i = 0; i < 5; i++) {
  const idx = git(['stash', 'list']).split('\n').findIndex((l) => l.includes(GUARD_STASH));
  if (idx < 0) break;
  git(['stash', 'drop', '-q', `stash@{${idx}}`]);
}
// step 5 parks the whole tree in an unnamed stash for a moment; pop it back if a run died there
for (let i = 0; i < 5; i++) {
  if (!/^WIP on /.test(git(['stash', 'list', '-1', '--format=%gs']))) break;
  log('popping the guard stash back: ' + git(['stash', 'pop', '--index']));
}
// step 12 drives the staged-index guard, which stashes the fixture's staged half, cherry-picks and
// pops it back (GC-090). A run that died between the stash and the pop left it in the list, holding
// the staged README.md edit and main.txt deletion every later step asserts against: pop it, index
// and all, for the same reason the named stash below is popped rather than dropped.
for (let i = 0; i < 3; i++) {
  if (!/Before cherry-picking /.test(git(['stash', 'list', '-1', '--format=%gs']))) break;
  git(['stash', 'pop', '--index', '-q']);
}
// step 5 creates this named stash and step 8 pops it, asserting the list is then empty; a run that
// died between the two leaves it behind. Pop rather than drop (GC-036): the stash holds the mixed
// working tree every later step asserts against, so dropping it would empty the list but gut the run.
const NAMED_STASH = 'test stash';
for (let i = 0; i < 5; i++) {
  const idx = git(['stash', 'list']).split('\n').findIndex((l) => l.includes(NAMED_STASH));
  if (idx < 0) break;
  git(['stash', 'pop', '--index', '-q', `stash@{${idx}}`]);
}
// step 27 writes .gitignore through a file row's menu and removes it again (GC-093). The fixture
// has none of its own, so whatever is there belongs to a run that died mid-step.
rmSync(join(R, '.gitignore'), { force: true });
// step 19 edits this file and stages it from its row's context menu, then unstages it and puts it
// back (GC-043). a.txt is also part of the fixture's mixed working tree, so only the state that step
// can leave behind is undone: it is the one step in the run that ever stages the file, and an
// unstaged edit here is the fixture's own.
const MENU_FILE = 'a.txt';
if (git(['diff', '--cached', '--name-only', '--', MENU_FILE]) === MENU_FILE) {
  git(['reset', '-q', '--', MENU_FILE]);
  git(['checkout', '-q', '--', MENU_FILE]);
}
// step 21 stages one hunk of this file, unstages it again and cancels a discard of the other, so a
// finished run leaves it as it found it; a run that died in the middle can leave the hunk in the
// index or (had the discard gone through) one edit missing from the working tree. Put both back: the
// index entry to HEAD's version, then the two-hunk working tree the fixture writes. This runs after
// every stash pop above, so it cannot rewrite a file a pop is about to restore (GC-062).
const HUNK_FILE = 'big.txt';
const HUNK_EDIT_1 = 'row 3 edited';
const HUNK_EDIT_2 = 'row 35 edited';
if (git(['diff', '--cached', '--name-only', '--', HUNK_FILE]) === HUNK_FILE) git(['reset', '-q', '--', HUNK_FILE]);
// the same 40 rows with the same two edits `bigRows` writes in tools/e2e/setup-testrepo.mjs
writeFileSync(join(R, HUNK_FILE), Array.from({ length: 40 }, (_, i) => (i === 2 ? HUNK_EDIT_1 : i === 34 ? HUNK_EDIT_2 : `row ${i + 1}`)).join('\n') + '\n');

// Three steps commit to main and nothing used to take those commits back: step 6's `main change`,
// the `Pickable commit` step 7 cherry-picks (which step 12 then needs to find already applied, so
// it cannot be undone where it is made) and step 10's `Commit from another clone`. The fixture grew
// by three commits and two files a run — 6 on main at setup, 9 after one run, 44 after a batch's —
// until step 16 asserted on a virtualised row that history that long had pushed out of the rendered
// window, and the flake looked like a regression in whatever ticket was in flight (GC-076).
//
// So the run puts them back itself, here and again at the end: the prologue call recovers a run
// that died mid-scenario, the epilogue call is the healthy path, and both must be a no-op on a
// fixture that has not drifted. Commits are matched by subject, the way the GC-062 block above
// matches its own mark, rather than reset to the baseline sha wholesale: a commit somebody added to
// the fixture by hand is not this run's to remove, and leaving it is what makes the closing
// assertion fail loudly instead of silently healing the drift it exists to report.
const RUN_COMMITS = [/^main change$/, /^Pickable commit \d+$/, /^Commit from another clone \d+$/];
const RUN_FILE_RE = /^(pick|remote)-\d+\.txt$/;
// what the fixture stages for itself, so the rest of the index belongs to the commits just dropped
const FIXTURE_STAGED = ['README.md', 'main.txt'];
// the unstaged a.txt edit setup-testrepo.mjs leaves behind; `main change` commits that same content,
// so dropping it needs the working tree written back rather than checked out of HEAD
const FIXTURE_A_TXT = 'line1\nline2 changed\nline3\nline4 new\n';
// `status()` over the working tree a finished run hands to the next one. It is the fixture's five
// paths, and a.txt among them is what proves the write above happened: `main change` absorbs that
// edit into a commit, so dropping the commit without writing the file back would leave a.txt clean.
// The staged half is part of it now: it used to be lost on every run at step 8, where a toolbar Pop
// handed the staged README.md edit and main.txt deletion back as working-directory changes, and
// this constant recorded that loss rather than the fixture (GC-082). With the index restored, both
// are staged again — `M ` and `D ` in the first column, against ` M` and ` D` for the unstaged half.
const EXPECTED_STATUS = 'M  README.md  M a.txt  M big.txt D  main.txt ?? new.txt';
const restoreFixture = () => {
  // --soft, never --hard, for the reason the GC-062 block gives: the index holds the fixture's own
  // staged README.md change and main.txt deletion and the tree holds the edits every step asserts
  // against, so a hard reset would undo the commits by gutting the fixture.
  for (let i = 0; i < RUN_COMMITS.length; i++) {
    if (!RUN_COMMITS.some((re) => re.test(git(['log', '-1', '--format=%s'])))) break;
    git(['reset', '--soft', 'HEAD^']);
  }
  for (const f of git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean)) {
    if (FIXTURE_STAGED.includes(f)) continue;
    git(['reset', '-q', '--', f]);
    if (RUN_FILE_RE.test(f)) rmSync(join(R, f), { force: true });
    else if (f === MENU_FILE) writeFileSync(join(R, MENU_FILE), FIXTURE_A_TXT);
  }
  // step 7 also commits to wip-branch, which is never checked out here, so its tip moves by ref
  if (/^Pickable commit \d+$/.test(git(['log', '-1', '--format=%s', 'wip-branch']))) {
    git(['update-ref', 'refs/heads/wip-branch', git(['rev-parse', 'wip-branch^'])]);
  }
  // every branch the run makes for itself, on both sides: conflict-branch (step 6), test-branch
  // (step 2) and push-target (step 17) are all deleted by their own steps on the healthy path
  for (const b of git(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads']).split('\n').filter(Boolean)) {
    if (!baseline.has(b)) git(['branch', '-D', b]);
  }
  for (const b of git(['for-each-ref', '--format=%(refname:lstrip=2)', 'refs/heads'], REMOTE).split('\n').filter(Boolean)) {
    if (!baseline.has(b)) git(['update-ref', '-d', `refs/heads/${b}`], REMOTE);
  }
  // steps 9 and 10 push main to the bare origin. Write the ref rather than force-pushing: the remote
  // is ours and a rewind is not a push any step performs.
  if (git(['rev-parse', 'refs/heads/main'], REMOTE) !== git(['rev-parse', 'main'])) {
    git(['update-ref', 'refs/heads/main', git(['rev-parse', 'main'])], REMOTE);
  }
  git(['fetch', '-q', 'origin', '--prune']);
  // the second clone step 10 makes to commit from, which it clones fresh every run
  rmSync(join(root, 'clone2'), { recursive: true, force: true });
};
restoreFixture();
// `restoreFixture` only reaches a scratch file through the index, so one that was never staged
// survived it: a run that died between step 7's write and its `git add` left `pick-<stamp>.txt`
// untracked in the fixture for every later run to trip over (GC-098). Untracked is exactly the
// case that has no other owner, so it is swept here, in the prologue, on the way in.
for (const f of readdirSync(R)) if (RUN_FILE_RE.test(f)) rmSync(join(R, f), { force: true });

const stamp = Date.now();

// ---- scenario -----------------------------------------------------------------------------------------------
step(1, 'load test repo');
// Preferences persist in the app's localStorage, so a hand-toggled setting from an earlier
// session would silently change what the later steps see: start every run from the defaults. The
// hidden-ref sets go with them (GC-073): a run that dies inside step 25 would otherwise leave
// branches hidden and the next run's row counts short by whatever it hid.
// The profile is no longer Ricardo's — `tools/launch-app.mjs` gives every launch it makes its own
// under `<os.tmpdir()>/gitclient-profiles/<port>` (GC-060) — but it does persist between runs on
// that port, so the removal still earns its place.
// The flag is what makes the wait below mean anything: the app has usually already loaded this
// same repository from `gitclient.lastRepo` by the time this runs, so a bare "rows are there and
// nothing is busy" is satisfied by the page that is *about* to be thrown away, and the reload then
// lands in the middle of step 2 or 3 with the panels empty. The flag lives on `window`, so it is
// gone the moment the new document exists (GC-080).
await ev(`window.__e2eReloading = true; localStorage.removeItem('gitclient.prefs'); Object.keys(localStorage).filter(k => k.startsWith('gitclient.hidden.')).forEach(k => localStorage.removeItem(k)); localStorage.setItem('gitclient.lastRepo', ${q(R.replace(/\\/g, '/'))}); setTimeout(() => location.reload(), 50); 'reloading'`);
// The generation starts again from zero across the reload, so `act()` has nothing to compare
// against here: wait on the new document having loaded the repository instead (GC-080).
await waitFor(
  `!window.__e2eReloading && document.querySelectorAll('.graph-row').length > 5 && !document.querySelector('.statusbar .busy')`,
  'the reloaded page to show the repository',
  20000,
);
let s = await state();
check('repo loaded with WIP row and commits', s.rows > 5 && (s.branch ?? '').startsWith('main'), JSON.stringify(s));

step(2, 'create branch via toolbar prompt');
log(await tool('Branch'));
await waitModal();
log(await modal('test-branch', true));
log(await act(() => modalOk()));
check('branch created and checked out', git(['branch', '--show-current']) === 'test-branch');

step(3, 'left panel context menu: checkout main (dirty tree prompts first)');
log(await contextMenuOn('.left-panel .ref-row', 'main'));
log('menu:', await menuList());
log(await menuClick('Checkout main'));
await waitModal();
const dirtyPrompt = String(await modal(null, null));
check('dirty checkout prompts', dirtyPrompt.includes('Uncommitted changes'), dirtyPrompt);
check('prompt names the branch', String(await modalMessage()).includes('Check out main anyway?'), await modalMessage());
log(await act(() => modalClick('Check out anyway')));
check('checked out main', git(['branch', '--show-current']) === 'main');

step(4, 'delete branch via menu + confirm');
log(await contextMenuOn('.left-panel .ref-row', 'test-branch'));
log(await menuClick('Delete test-branch'));
await waitModal();
log(await act(() => modalOk()));
check('branch deleted', !git(['branch', '--format=%(refname:short)']).includes('test-branch'));

step(5, "stash via toolbar: an empty message uses git's default, then a named stash");
// GC-029: the field is labelled "Message (optional)", so OK must stay enabled while it is empty.
log(await tool('Stash'));
await waitModal();
log(await modal('', true));
const emptyOk = String(await ev(`(() => { const b = document.querySelector('.modal .modal-buttons .btn:last-child'); return b ? (b.disabled ? 'disabled' : 'enabled') : 'no modal'; })()`));
check('Stash OK stays enabled on an empty message', emptyOk === 'enabled', emptyOk);
log(await act(() => modalOk()));
const autoMessage = git(['stash', 'list', '-1', '--format=%gs']);
check("empty message stashes under git's own WIP message", /^WIP on /.test(autoMessage) && status() === '', `${autoMessage} | ${status()}`);
// put the mixed working tree back exactly as it was so the named stash below sees the same state
git(['stash', 'pop', '--index', '-q']);
log(await act(() => tool('Refresh')));

log(await tool('Stash'));
await waitModal();
log(await modal(NAMED_STASH, true));
await shot('modal-stash.png');
log(await act(() => modalOk()));
check('stash created and tree clean', git(['stash', 'list']).includes(NAMED_STASH) && status() === '', status());

step(6, 'merge with a real conflict, then abort');
git(['checkout', '-qb', 'conflict-branch']);
writeFileSync(join(R, 'a.txt'), `line1\nline2 from branch ${stamp}\nline3\nline4 new\n`);
git(['commit', '-qam', 'branch change']);
git(['checkout', '-q', 'main']);
writeFileSync(join(R, 'a.txt'), `line1\nline2 from main ${stamp}\nline3\nline4 new\n`);
git(['commit', '-qam', 'main change']);
log(await act(() => tool('Refresh')));
log(await contextMenuOn('.left-panel .ref-row', 'conflict-branch'));
log(await act(() => menuClick('Merge conflict-branch into main')));
s = await state();
check('conflict reported by git', status().includes('UU a.txt'), status());
check('conflict banner shown', !!s.banner && /merge in progress/.test(s.banner), s.banner ?? '');
check('conflict error shown', !!s.err && /conflict/i.test(s.err), s.err ?? '');
await shot('merge-conflict.png');
log(await act(() => clickBanner('/Abort/')));
check('merge aborted', !existsSync(join(R, '.git', 'MERGE_HEAD')) && status() === '', status());

step(7, 'cherry-pick a fresh commit onto main');
git(['checkout', '-q', 'wip-branch']);
writeFileSync(join(R, `pick-${stamp}.txt`), 'picked\n');
git(['add', `pick-${stamp}.txt`]);
git(['commit', '-qm', `Pickable commit ${stamp}`]);
git(['checkout', '-q', 'main']);
log(await act(() => tool('Refresh')));
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Pickable commit'));
log(await act(() => menuClick('Cherry pick commit')));
check('cherry-pick applied', git(['log', '--oneline', '-1']).includes('Pickable commit') && existsSync(join(R, `pick-${stamp}.txt`)));

step(8, 'pop stash via toolbar');
log(await act(() => tool('Pop')));
check('stash popped', git(['stash', 'list']) === '' && status().includes('README.md'), status());
// GC-082: the stash step 5 made held a staged README.md edit and a staged main.txt deletion, and a
// pop without --index used to hand both back as working-directory changes, silently costing the
// user their staging. `git status --short` marks a staged path in the first column.
check(
  'the pop puts back what was staged, not just the working directory',
  git(['status', '--short', '--', 'README.md']).startsWith('M ') && git(['status', '--short', '--', 'main.txt']).startsWith('D '),
  `${git(['status', '--short', '--', 'README.md'])} | ${git(['status', '--short', '--', 'main.txt'])}`,
);
check('and the status bar reports no failure for it', (await state()).err === null, (await state()).err ?? '');

step(9, 'push');
log(await act(() => tool('Push')));
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
log(await act(() => fetchAll()));
s = await state();
check('behind after fetch', git(['rev-list', '--count', 'main..origin/main']) === '1' && /↓1/.test(s.branch ?? ''), s.branch ?? '');
log(await act(() => tool('Pull')));
check('pulled', git(['log', '--oneline', '-1']).includes('Commit from another clone') && git(['rev-list', '--count', 'main..origin/main']) === '0');

step(11, 'tag create via commit menu, delete via left panel');
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Work on wip branch'));
log('menu:', await menuList());
await shot('commit-context-menu.png');
log(await menuClick('Create tag here'));
await waitModal();
log(await modal('t-test', false));
log(await act(() => modalOk()));
check('tag created', git(['tag']).split('\n').includes('t-test'));
log(await openSection('Tags'));
await waitFor(`[...document.querySelectorAll('.left-panel .ref-row')].some(r => r.innerText.includes('t-test'))`, 'the Tags section to list t-test');
log(await contextMenuOn('.left-panel .ref-row', 't-test'));
log(await menuClick('Delete tag t-test'));
await waitModal();
log(await act(() => modalOk()));
check('tag deleted', !git(['tag']).split('\n').includes('t-test'));

step(12, 'the staged-index guard, then an already-applied cherry-pick: error kept visible, in-progress banner, abort');
// git refuses a cherry-pick outright while the index carries staged changes ("your local changes
// would be overwritten by cherry-pick"), and the fixture's staged half is back in place now that a
// pop restores the index (GC-082). This step used to park that half by hand; the app asks instead
// (GC-090), so the guard is what gets driven here — Cancel first, proving it runs nothing, then
// "Stash and continue", which is the only way to reach the in-progress state the rest asserts.
const stagedForPick = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
check('the fixture has a staged half for the guard to catch', stagedForPick.length > 0, stagedForPick.join(' ') || 'nothing staged');
const headBeforePick = git(['rev-parse', 'HEAD']);
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Pickable commit'));
log(await menuClick('Cherry pick commit'));
await waitModal();
check('the guard names the files in the way', new RegExp(`${stagedForPick.length} staged files?`).test(await modalMessage()), await modalMessage());
check('it offers Cancel and stashing, and nothing that git would only refuse', (await modalButtons()) === 'Cancel | Stash and continue', await modalButtons());
log(await modalClick('Cancel'));
await waitNoModal();
check(
  'Cancel runs nothing: HEAD, the index and the working tree are where they were',
  git(['rev-parse', 'HEAD']) === headBeforePick && git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean).join(' ') === stagedForPick.join(' ') && !existsSync(join(R, '.git', 'CHERRY_PICK_HEAD')),
  status(),
);
log(await contextMenuOn('.graph-rows .graph-row:not(.wip)', 'Pickable commit'));
log(await menuClick('Cherry pick commit'));
await waitModal();
log(await act(() => modalOk(), 'stash and cherry-pick'));
s = await state();
check('cherry-pick left in progress', existsSync(join(R, '.git', 'CHERRY_PICK_HEAD')) && /cherry-pick in progress/.test(s.banner ?? ''), s.banner ?? '');
check('git message visible', /now empty/.test(s.err ?? ''), s.err ?? '');
// The status bar shows one headline line and carries the whole message in its title (GC-091).
const errTitle = await ev(`document.querySelector('.statusbar .err')?.title ?? ''`);
check('and it says where the guard put the staged changes', /stash "Before cherry-picking/.test(errTitle), errTitle);
check('which is where they are', /Before cherry-picking /.test(git(['stash', 'list', '-1', '--format=%gs'])), git(['stash', 'list', '-1', '--format=%gs']));
log(await act(() => clickBanner('/Abort/')));
s = await state();
check('cherry-pick aborted', !existsSync(join(R, '.git', 'CHERRY_PICK_HEAD')) && s.banner === null && s.err === null);
// The guard's stash is left alone while git is mid-operation, because a pop would clear the state
// the banner is about (`git reset` takes CHERRY_PICK_HEAD with it): it is the step's to pop now.
for (let i = 0; i < 3; i++) {
  if (!/Before cherry-picking /.test(git(['stash', 'list', '-1', '--format=%gs']))) break;
  git(['stash', 'pop', '--index', '-q']);
}
log(await act(() => tool('Refresh')));
check('the staged half the guard stashed is staged again', git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean).join(' ') === stagedForPick.join(' '), status());

step(13, 'WIP row menu');
log(await contextMenuOn('.graph-row.wip', null));
const wipMenu = await menuList();
check('WIP menu lists staging actions', /Stage all changes/.test(wipMenu) && /Stash changes/.test(wipMenu), wipMenu);
await escape();

step(14, 'per-file delete confirms with the UI modal, not a native dialog');
const scratch = `scratch-${stamp}.txt`;
writeFileSync(join(R, scratch), 'scratch\n');
log(await act(() => tool('Refresh')));
log(await ev(`(() => { const r = document.querySelector('.graph-row.wip'); if (!r) return 'no WIP row'; r.click(); return 'WIP row selected'; })()`));
// only the staging view lists this file, so it cannot be satisfied by the commit that was selected
await waitFor(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === ${q(scratch)})`, 'the staging list to show the scratch file');
log(
  await ev(
    `(() => { const rows = [...document.querySelectorAll('.detail-panel .file-row')]; const r = rows.find(x => x.title === ${q(scratch)}); if (!r) return 'file row not found: ' + ${q(scratch)}; const b = r.querySelector('.actions .btn.danger'); if (!b) return 'no discard button'; b.click(); return 'clicked discard on ' + r.title; })()`,
  ),
);
await waitModal();
const discardModal = String(await modal(null, null));
check('confirm modal replaced the native dialog and names the file', discardModal.includes(`Delete ${scratch}?`), discardModal);
await shot('modal-discard-file.png');
log(await act(() => modalOk()));
check('untracked file deleted after confirming', !existsSync(join(R, scratch)) && !status().includes(scratch), status());

step(15, 'checkout guard: clean and untracked-only trees are silent, Cancel is inert, Stash and check out re-applies');
// park the working tree so the clean-tree path can be exercised, restored at the end of the step
git(['stash', 'push', '-u', '-q', '-m', GUARD_STASH]);
log(await act(() => tool('Refresh')));
check('tree parked before the clean-tree checkout', status() === '', status());
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
log(await menuClick('Checkout wip-branch'));
// a prompt from the guard would be up before the checkout ever ran, so the new branch reaching the
// crumb is a strictly later moment than the one the old fixed wait sampled (GC-053)
await waitFor(`(document.querySelector('.crumb .value.plain')?.innerText ?? '').startsWith('wip-branch')`, 'the clean-tree checkout to land', 15000);
const promptedWhenClean = await ev(`!!document.querySelector('.modal')`);
await waitIdle();
check('clean tree checks out with no prompt', promptedWhenClean === false && git(['branch', '--show-current']) === 'wip-branch', `modal=${promptedWhenClean} branch=${git(['branch', '--show-current'])}`);

// git carries untracked files across a checkout untouched, so a tree holding nothing else must not
// raise the prompt either, and the file must still be there afterwards (GC-019)
git(['checkout', '-q', 'main']);
writeFileSync(join(R, GUARD_FILE), 'guard\n');
log(await act(() => tool('Refresh')));
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
log(await menuClick('Checkout wip-branch'));
await waitFor(`(document.querySelector('.crumb .value.plain')?.innerText ?? '').startsWith('wip-branch')`, 'the untracked-only checkout to land', 15000);
const promptedWhenUntracked = await ev(`!!document.querySelector('.modal')`);
await waitIdle();
check(
  'untracked-only tree checks out with no prompt and keeps the file',
  promptedWhenUntracked === false && git(['branch', '--show-current']) === 'wip-branch' && existsSync(join(R, GUARD_FILE)),
  `modal=${promptedWhenUntracked} branch=${git(['branch', '--show-current'])} file=${existsSync(join(R, GUARD_FILE))}`,
);

// a change to a tracked file is at risk, so this one does prompt. The untracked file stays on disk
// alongside it: the count in the message is the files at risk, so it must say one, not two (GC-019).
git(['checkout', '-q', 'main']);
writeFileSync(join(R, GUARD_TRACKED), 'feature work\nmore\nguard edit\n');
log(await act(() => tool('Refresh')));
const dirtyBefore = status();
const stashesBefore = git(['stash', 'list']).split('\n').filter(Boolean).length;
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
log(await menuClick('Checkout wip-branch'));
await waitModal();
check('prompt offers all three choices', String(await modalButtons()) === 'Cancel | Stash and check out | Check out anyway', await modalButtons());
const dirtyMessage = String(await modalMessage());
check('the prompt counts the file at risk, not the untracked ones', dirtyMessage.includes('in 1 file.'), dirtyMessage);
await shot('modal-checkout-dirty.png');
log(await modalClick('Cancel'));
// the dialog has to be gone before the next one opens, or the wait for it would pass on this one
await waitNoModal();
await waitIdle();
check('cancel leaves HEAD and the tree untouched', git(['branch', '--show-current']) === 'main' && status() === dirtyBefore, `${git(['branch', '--show-current'])} | ${status()}`);

log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
log(await menuClick('Checkout wip-branch'));
await waitModal();
log(await act(() => modalClick('Stash and check out')));
check(
  'stash and check out lands on the branch with the changes re-applied',
  git(['branch', '--show-current']) === 'wip-branch' && status() === dirtyBefore && git(['stash', 'list']).split('\n').filter(Boolean).length === stashesBefore,
  `${git(['branch', '--show-current'])} | ${status()} | stashes=${git(['stash', 'list']).split('\n').filter(Boolean).length}`,
);
// restore what this step parked so the run stays re-entrant, the tracked edit included: every later
// step compares against the mixed working tree the stash is about to put back, and nothing else
git(['checkout', '-q', 'main']);
rmSync(join(R, GUARD_FILE), { force: true });
git(['checkout', '-q', '--', GUARD_TRACKED]);
// --index, like every other recovery pop in this file: the tree it parked holds the fixture's own
// staged README.md edit and main.txt deletion, and a plain pop hands them back unstaged (GC-082)
git(['stash', 'pop', '--index', '-q']);
log(await act(() => tool('Refresh')));

step(16, 'commit search: message, sha prefix, next match, Escape');
const mainOnlySha = git(['log', '--all', '--format=%H', '--grep=Main-only change']).split('\n')[0] ?? '';
log(await tool('Search'));
await waitFor(`!!document.querySelector('.graph-search .search-input')`, 'the find bar to open');
let sr = JSON.parse(await searchState());
check('search bar opens from the toolbar', sr.open === true, JSON.stringify(sr));

let readout = await searchCount();
log(await searchType('Main-only'));
await waitSearch(readout);
sr = JSON.parse(await searchState());
check('message search selects the matching commit', sr.sha === mainOnlySha.slice(0, 7), `selected=${sr.sha} expected=${mainOnlySha.slice(0, 7)} | ${sr.count}`);
check('matches are highlighted and the rest dimmed, nothing hidden', sr.matches >= 1 && sr.dimmed >= 1, JSON.stringify(sr));
await shot('search-message.png');

log(await searchType(mainOnlySha.slice(0, 6)));
// this query lands on the same single commit as the one above, so the readout, the selection, the
// matches and the dimming all stay exactly as they were: nothing observable marks the new query
await sleep(300); // nothing changes on screen between the two queries, so there is nothing to wait on
sr = JSON.parse(await searchState());
check('a sha prefix selects that commit', sr.sha === mainOnlySha.slice(0, 7), `selected=${sr.sha} expected=${mainOnlySha.slice(0, 7)}`);
check('the sha prefix matches exactly one commit', sr.count === '1 of 1', String(sr.count));

// "feature" appears in three commit messages: the next-match button must move the selection
readout = await searchCount();
log(await searchType('feature'));
await waitSearch(readout);
const first = JSON.parse(await searchState());
log(await searchBtn('Next match'));
await waitSearch(first.count);
const second = JSON.parse(await searchState());
check('several matches are counted', /of [2-9]/.test(String(first.count)), `${first.count}`);
check('next match moves the selection', second.sha !== first.sha && second.count !== first.count, `${first.sha}/${first.count} -> ${second.sha}/${second.count}`);

// clicking a row mid-search moves the position with it, so "next" continues from there
log(await ev(`(() => { const r = [...document.querySelectorAll('.graph-row.match')].pop(); if (!r) return 'no match row'; r.click(); return 'clicked the last match'; })()`));
await waitSearch(second.count);
const clicked = JSON.parse(await searchState());
check('clicking a match moves the position to it', clicked.count === '3 of 3', String(clicked.count));
log(await searchBtn('Next match'));
await waitSearch(clicked.count);
const wrapped = JSON.parse(await searchState());
check('next continues from the clicked row and wraps', wrapped.count === '1 of 3', `${clicked.count} -> ${wrapped.count}`);

// GC-030: the query lives in App, so a file view opening over the graph must not lose it
const beforeDiff = JSON.parse(await searchStateAtTop());
await waitFor(`!!document.querySelector('.detail-panel .file-list .file-row')`, 'the selected commit to list its files');
log(await ev(`(() => { const r = document.querySelector('.detail-panel .file-list .file-row'); if (!r) return 'no file row on the selected commit'; r.click(); return 'opened ' + r.title; })()`));
await waitFor(`!!document.querySelector('.file-view')`, 'the diff to replace the graph');
const inDiff = JSON.parse(await searchState());
check('opening a diff hides the graph and its search bar', inDiff.open === false, JSON.stringify(inDiff));
await escape();
await waitFor(`!document.querySelector('.file-view') && !!document.querySelector('.graph-search')`, 'the graph and its find bar to come back');
// rows are virtualised, so compare the rendered match/dim counts from the same scroll position
const back = JSON.parse(await searchStateAtTop());
check(
  'closing the diff restores the query, the readout and the dimming',
  back.open === true && back.value === 'feature' && back.count === beforeDiff.count && back.sha === beforeDiff.sha && back.matches === beforeDiff.matches && back.dimmed === beforeDiff.dimmed,
  `before=${JSON.stringify(beforeDiff)} after=${JSON.stringify(back)}`,
);

await escape();
await waitFor(`!document.querySelector('.graph-search')`, 'the find bar to close');
sr = JSON.parse(await searchState());
check('Escape closes the search bar and clears the dimming', sr.open === false && sr.dimmed === 0, JSON.stringify(sr));

step(17, 'remotes: add and fetch, rename, edit URL, remove');
const remoteUrl = REMOTE.replace(/\\/g, '/');
log(await sectionAction('Add remote'));
await waitModal();
log(await modal('upstream', null));
log(await modalOk());
// the two prompts follow each other with no settle in between, so this waits on the second one's
// own title: `.modal` alone would still be showing the name prompt that was just answered (GC-053)
await waitFor(`document.querySelector('.modal h3')?.textContent === 'Add remote upstream'`, 'the URL prompt to replace the name prompt');
log(await modal(remoteUrl, null));
log(await act(() => modalOk()));
check('remote added and fetched', git(['remote']).split('\n').includes('upstream') && git(['for-each-ref', '--format=%(refname)', 'refs/remotes/upstream']).includes('refs/remotes/upstream/main'), git(['remote', '-v']).replace(/\n/g, ' '));
check('the new remote shows in the left panel', String(await ev(`[...document.querySelectorAll('.left-panel .ref-row.remote-group .row-name')].map(x => x.textContent).join(',')`)).includes('upstream'));
await shot('remotes-added.png');

// with two remotes the branch menu offers one push entry per remote, and each pushes there (GC-031)
git(['branch', '-f', 'push-target', 'main']);
log(await act(() => tool('Refresh')));
log(await contextMenuOn('.left-panel .ref-row', 'push-target'));
const pushMenu = await menuList();
check('branch menu lists a push entry per remote', /Push push-target to origin/.test(pushMenu) && /Push push-target to upstream/.test(pushMenu), pushMenu);
log(await act(() => menuClick('Push push-target to upstream')));
check(
  'the chosen remote received the branch',
  git(['ls-remote', 'upstream', 'push-target']).includes(git(['rev-parse', 'push-target'])),
  git(['ls-remote', 'upstream', 'push-target']) || '(nothing on upstream)',
);
gitMay(['push', '-q', 'origin', '--delete', 'push-target']);
git(['branch', '-D', 'push-target']);
log(await act(() => tool('Refresh')));

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'upstream'));
const remoteMenu = await menuList();
check('remote menu offers manage actions', /Edit URL/.test(remoteMenu) && /Rename/.test(remoteMenu) && /Remove upstream/.test(remoteMenu), remoteMenu);
log(await menuClick('Rename'));
await waitModal();
log(await modal('mirror', null));
log(await act(() => modalOk()));
check('remote renamed', git(['remote']).split('\n').includes('mirror') && !git(['remote']).split('\n').includes('upstream'), git(['remote']).replace(/\n/g, ' '));

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'mirror'));
log(await menuClick('Edit URL'));
await waitModal();
log(await modal('https://example.invalid/mirror.git', null));
log(await act(() => modalOk()));
check('remote URL updated', git(['remote', 'get-url', 'mirror']) === 'https://example.invalid/mirror.git', git(['remote', 'get-url', 'mirror']));

log(await contextMenuOn('.left-panel .ref-row.remote-group', 'mirror'));
log(await menuClick('Remove mirror'));
await waitModal();
check('removal asks for confirmation', String(await modal(null, null)).includes('Remove remote mirror?'), await modal(null, null));
log(await act(() => modalOk()));
check(
  'remote removed with its tracking branches',
  !git(['remote']).split('\n').includes('mirror') && git(['for-each-ref', '--format=%(refname)', 'refs/remotes/mirror']) === '',
  `${git(['remote']).replace(/\n/g, ' ')} | ${git(['for-each-ref', '--format=%(refname)', 'refs/remotes/mirror'])}`,
);
check('origin survived', git(['remote']).split('\n').includes('origin'), git(['remote', '-v']).replace(/\n/g, ' '));

step(18, 'Escape closes exactly one layer: a menu, a dialog and the Pull popover over the find bar');
// GC-039. Each of GC-034, GC-037 and GC-038 fixed "one Escape closed two things" and was verified
// by a throwaway script. Here the find bar is the layer underneath every time: it must survive the
// Escape that closes the layer on top of it, and only the next Escape may close it.
log(await tool('Search'));
await waitFor(`!!document.querySelector('.graph-search .search-input')`, 'the find bar to open');
readout = await searchCount();
log(await searchType('feature'));
await waitSearch(readout);
let l = JSON.parse(await layerState());
check('the find bar is open with a query under the layers below', l.search === true && l.query === 'feature', JSON.stringify(l));

// GC-037: a context menu over a commit row, with focus still in the search input
log(await contextMenuOn('.graph-row.match', null));
l = JSON.parse(await layerState());
check('a commit menu opens over the find bar', l.menu === true && l.search === true, JSON.stringify(l));
await escape();
await waitNoMenu();
l = JSON.parse(await layerState());
check('Escape closes the menu only, the find bar keeps its query', l.menu === false && l.search === true && l.query === 'feature', JSON.stringify(l));

// GC-034: a dialog on top of the find bar (a prompt from the ref menu, cancelled with Escape)
log(await contextMenuOn('.left-panel .ref-row', 'main'));
log(await menuClick('Rename main'));
await waitModal();
l = JSON.parse(await layerState());
check('the rename prompt opens over the find bar', l.modal === true && l.menu === false && l.search === true, JSON.stringify(l));
await escape();
await waitNoModal();
l = JSON.parse(await layerState());
check('Escape closes the dialog only, the find bar keeps its query', l.modal === false && l.search === true && l.query === 'feature', JSON.stringify(l));
check('the cancelled prompt renamed nothing', git(['branch', '--show-current']) === 'main', git(['branch', '--format=%(refname:short)']).replace(/\n/g, ' '));

// GC-038: the toolbar's Pull popover on top of the find bar
log(await ev("document.querySelector('.toolbar .caret-btn')?.click(); 'caret'"));
await waitFor(`!!document.querySelector('.toolbar .popover')`, 'the Pull popover to open');
l = JSON.parse(await layerState());
check('the Pull popover opens over the find bar', l.popover === true && l.search === true, JSON.stringify(l));
await escape();
await waitFor(`!document.querySelector('.toolbar .popover')`, 'the Pull popover to close');
l = JSON.parse(await layerState());
check('Escape closes the popover only, the find bar keeps its query', l.popover === false && l.search === true && l.query === 'feature', JSON.stringify(l));

// with no layer left, the next Escape closes the find bar itself
await escape();
await waitFor(`!document.querySelector('.graph-search')`, 'the find bar to close');
l = JSON.parse(await layerState());
check('the next Escape closes the find bar', l.search === false, JSON.stringify(l));
check('no layer is left open', l.menu === false && l.modal === false && l.popover === false, JSON.stringify(l));
check('the dimming is cleared with the find bar', (await ev("document.querySelectorAll('.graph-row.unmatched').length")) === 0);

step(19, 'file row context menu: stage and unstage a file from the staging list');
// GC-043. The step owns this file's working-tree state rather than leaning on the fixture's: by
// here the stash pop in step 8 has already folded the setup's edit into the history, so make the
// edit, drive both menu actions against it, and check the file back out at the end.
writeFileSync(join(R, MENU_FILE), `line1\nline2 changed\nline3\nline4 new\nfile menu step ${stamp}\n`);
log(await act(() => tool('Refresh')));
// the rows are virtualised and step 18 left a commit deep in the graph selected, so scroll the WIP
// row back into the rendered window before clicking it (GC-030's lesson, applied here)
await waitFor(`(() => { const b = document.querySelector('.graph-body'); if (!b) return false; if (b.scrollTop !== 0) b.scrollTop = 0; return !!document.querySelector('.graph-row.wip'); })()`, 'the WIP row to be rendered');
log(await ev(`(() => { const r = document.querySelector('.graph-row.wip'); if (!r) return 'no WIP row'; r.click(); return 'WIP row selected'; })()`));
// only the staging view lists an uncommitted file, so this cannot be satisfied by the commit that
// step 18 left selected
await waitFor(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === ${q(MENU_FILE)})`, `the staging list to show ${MENU_FILE}`);
/** The file's own line of `git status --short`, trimmed: "M  x" staged against "M x" unstaged. */
const shortOf = (file) => git(['status', '--short', '--', file]);
/** Wait for the row to appear under one of the staging groups ("Unstaged Files"/"Staged Files"). */
const inGroup = (group, file) =>
  waitFor(
    `[...document.querySelectorAll('.detail-panel .file-list')].some(l => (l.querySelector('.group-head span')?.textContent ?? '').toLowerCase().startsWith(${q(group.toLowerCase())}) && [...l.querySelectorAll('.file-row')].some(r => r.title === ${q(file)}))`,
    `${file} to appear under ${group}`,
  );

await inGroup('Unstaged Files', MENU_FILE);
log(await contextMenuOn('.detail-panel .file-row', MENU_FILE));
const unstagedFileMenu = await menuList();
check(
  'an unstaged row offers Stage, Discard and the shell actions, and no Unstage',
  /Stage file/.test(unstagedFileMenu) &&
    /Discard changes/.test(unstagedFileMenu) &&
    /Open file/.test(unstagedFileMenu) &&
    /Show in folder/.test(unstagedFileMenu) &&
    /Copy file path/.test(unstagedFileMenu) &&
    !/Unstage file/.test(unstagedFileMenu),
  unstagedFileMenu,
);
await shot('file-row-menu.png');
log(await menuClick('Stage file'));
await inGroup('Staged Files', MENU_FILE);
await waitIdle();
check('Stage file from the row menu stages it', shortOf(MENU_FILE) === `M  ${MENU_FILE}`, shortOf(MENU_FILE));

log(await contextMenuOn('.detail-panel .file-row', MENU_FILE));
const stagedFileMenu = await menuList();
check('a staged row offers Unstage and neither Stage nor Discard', /Unstage file/.test(stagedFileMenu) && !/Stage file/.test(stagedFileMenu) && !/Discard changes/.test(stagedFileMenu), stagedFileMenu);
log(await menuClick('Unstage file'));
await inGroup('Unstaged Files', MENU_FILE);
await waitIdle();
check('Unstage file from the row menu unstages it again', shortOf(MENU_FILE) === `M ${MENU_FILE}`, shortOf(MENU_FILE));

// put the file back so the run stays re-entrant
git(['checkout', '-q', '--', MENU_FILE]);
log(await act(() => tool('Refresh')));

step(20, 'commit form: stage a file, type a summary and a description, commit with Ctrl+Enter, then amend');
// GC-062. The two most frequent actions in a git client had no coverage: this one drives
// `commit --file=-` on stdin, through the form rather than through git. The commit takes the whole
// index with it, which here is the fixture's own staged README.md change and main.txt deletion
// beside the scratch file the step stages, so the end of the step undoes it with `git reset --soft`
// — a hard reset would take the mixed working tree every earlier step asserts against with it.
const COMMIT_FILE = `e2e-commit-${stamp}.txt`;
const COMMIT_SUMMARY = `${COMMIT_MARK} ${stamp}`;
const COMMIT_BODY = 'Second line, typed into the description field.';
const headBefore = git(['rev-parse', 'HEAD']);
const statusBefore = status();
writeFileSync(join(R, COMMIT_FILE), 'commit form\n');
log(await act(() => tool('Refresh')));
log(await selectWip());
// only the staging view lists an uncommitted file, so this cannot be satisfied by a commit view
await inGroup('Unstaged Files', COMMIT_FILE);
log(await stageRow(COMMIT_FILE));
await inGroup('Staged Files', COMMIT_FILE);
await waitIdle();
check('the row Stage button stages the file', shortOf(COMMIT_FILE) === `A  ${COMMIT_FILE}`, shortOf(COMMIT_FILE));

log(await setField('.commit-form .summary-wrap input', COMMIT_SUMMARY));
log(await setField('.commit-form textarea', COMMIT_BODY));
const counter = await ev(`document.querySelector('.commit-form .counter')?.textContent ?? null`);
check('the 72-character counter counts the summary down', counter === String(72 - COMMIT_SUMMARY.length), `${counter} for a ${COMMIT_SUMMARY.length}-character summary`);
await shot('commit-form.png');
// the description field has focus after being typed into, and Ctrl+Enter is bound on both fields;
// press it on the summary, so the check names the field the key was aimed at when it goes wrong
const focused = await ev(`(() => { const i = document.querySelector('.commit-form .summary-wrap input'); if (!i) return 'no summary field'; i.focus(); return document.activeElement === i ? 'focused' : 'focus landed on ' + document.activeElement?.tagName; })()`);
check('the summary field takes focus for the keyboard commit', focused === 'focused', String(focused));
await ctrlEnter();
// the form clears itself only after `actions.commit` resolves, and the staged group empties with the
// reload behind it, so both together are a strictly later moment than the key press (GC-053)
await waitFor(
  `[...document.querySelectorAll('.detail-panel .file-list .group-head span')].some(h => (h.textContent ?? '').toLowerCase().startsWith('staged files (0)')) && document.querySelector('.commit-form .summary-wrap input')?.value === ''`,
  'the staged group to empty and the commit form to clear',
  15000,
);
await waitIdle();
check('Ctrl+Enter commits the summary and the description', git(['log', '-1', '--format=%B']) === `${COMMIT_SUMMARY}\n\n${COMMIT_BODY}`, git(['log', '-1', '--format=%B']).replace(/\n/g, ' | '));
check('the committed file left the staging list', !status().includes(COMMIT_FILE), status());
// the prefill below only fires on an empty form, so a commit that silently did nothing would leave
// the typed summary sitting there and the amend assertion would pass for the wrong reason
const cleared = JSON.parse(await ev(`JSON.stringify({ summary: document.querySelector('.commit-form .summary-wrap input')?.value ?? null, body: document.querySelector('.commit-form textarea')?.value ?? null })`));
check('the form empties itself after committing', cleared.summary === '' && cleared.body === '', JSON.stringify(cleared));

const countAfterCommit = git(['rev-list', '--count', 'HEAD']);
log(await ev(`(() => { const cb = document.querySelector('.commit-form .check input'); if (!cb) return 'no amend checkbox'; if (cb.disabled) return 'amend checkbox disabled'; cb.click(); return 'ticked Amend previous commit'; })()`));
await waitFor(`document.querySelector('.commit-form .summary-wrap input')?.value === ${q(COMMIT_SUMMARY)}`, "the amend tick to prefill HEAD's message");
const prefilled = JSON.parse(await ev(`JSON.stringify({ summary: document.querySelector('.commit-form .summary-wrap input')?.value ?? null, body: document.querySelector('.commit-form textarea')?.value ?? null })`));
check('ticking Amend prefills the form from HEAD', prefilled.summary === COMMIT_SUMMARY && prefilled.body === COMMIT_BODY, JSON.stringify(prefilled));

const AMENDED_SUMMARY = `${COMMIT_SUMMARY} amended`;
log(await setField('.commit-form .summary-wrap input', AMENDED_SUMMARY));
log(await ev(`(() => { const b = document.querySelector('.commit-form .btn.primary.large'); if (!b) return 'no commit button'; if (b.disabled) return 'commit button disabled'; const label = b.textContent.trim(); b.click(); return 'clicked the commit button: ' + label; })()`));
// doCommit clears the fields and unticks Amend once git has answered, and nothing else in the step
// does that, so it marks the amend having landed
await waitFor(`document.querySelector('.commit-form .summary-wrap input')?.value === '' && document.querySelector('.commit-form .check input')?.checked === false`, 'the commit form to clear after the amend', 15000);
await waitIdle();
check(
  'amend rewrites the last commit instead of adding one',
  git(['log', '-1', '--format=%s']) === AMENDED_SUMMARY && git(['rev-list', '--count', 'HEAD']) === countAfterCommit,
  `${git(['log', '-1', '--format=%s'])} | count=${git(['rev-list', '--count', 'HEAD'])} was ${countAfterCommit}`,
);

// undo the step. --soft puts the index back exactly as the commit found it; the scratch file is the
// one entry in it that is not the fixture's own, so that is the only one unstaged by hand (GC-062).
git(['reset', '--soft', headBefore]);
git(['reset', '-q', '--', COMMIT_FILE]);
rmSync(join(R, COMMIT_FILE), { force: true });
log(await act(() => tool('Refresh')));
check('the commit step left the repository as it found it', git(['rev-parse', 'HEAD']) === headBefore && status() === statusBefore, `${status()} | expected ${statusBefore}`);

step(21, 'hunk staging: Stage hunk, Unstage hunk, and a Discard hunk that is cancelled');
// GC-062. `git apply --cached --recount` on a patch rebuilt by `buildHunkPatch` had no coverage
// either. big.txt is the fixture's two-hunk file: row 3 and row 35 of 40 are edited, far enough
// apart for git to report them as two hunks.
const hunkStatusBefore = status();
log(await selectWip());
await inGroup('Unstaged Files', HUNK_FILE);
log(await clickFileRow('Unstaged Files', HUNK_FILE));
await waitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
let d = JSON.parse(await diffState());
check('the unstaged file opens with both hunks and an action pair on each', d.hunks === 2 && d.actions === 'Stage hunk,Discard hunk,Stage hunk,Discard hunk', JSON.stringify(d));
await shot('diff-hunks.png');

log(await hunkAction(1, 'Stage hunk'));
await waitDiff('Unstaged', 1, [HUNK_EDIT_1]);
await waitIdle();
const cached = git(['diff', '--cached', '--', HUNK_FILE]);
check('Stage hunk puts that hunk, and only that hunk, in the index', cached.includes(`+${HUNK_EDIT_2}`) && !cached.includes(HUNK_EDIT_1), cached.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-][+-]/.test(l)).join(' | '));
check('the other hunk is still an unstaged change', git(['diff', '--', HUNK_FILE]).includes(`+${HUNK_EDIT_1}`), git(['diff', '--', HUNK_FILE]).split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-][+-]/.test(l)).join(' | '));

await inGroup('Staged Files', HUNK_FILE);
log(await clickFileRow('Staged Files', HUNK_FILE));
// the staged side's one hunk is the row 35 edit; the unstaged side left rendered behind it has one
// hunk too, so only the added line tells the two apart (see waitDiff)
await waitDiff('Staged', 1, [HUNK_EDIT_2]);
d = JSON.parse(await diffState());
// compared as the whole list rather than with /Stage hunk/, which "Unstage hunk" also matches
check('the staged side offers Unstage hunk and nothing else', d.actions === 'Unstage hunk', JSON.stringify(d));
log(await hunkAction(0, 'Unstage hunk'));
// unstaging the only staged hunk leaves big.txt with no staged side at all, and `App` drops the
// file view when the entry loses the side it was showing — so there is no empty staged diff to wait
// for, the whole view goes. The close is driven by the snapshot reload behind the patch, which puts
// it strictly after the click (GC-053).
await waitFor(`!document.querySelector('.file-view')`, `the file view to close as ${HUNK_FILE} leaves the Staged group`);
// if the patch was rejected the view is still open with git's message on it; carry it into the
// assertion below rather than leaving a bare "the index is not empty"
const unstageErr = await ev(`document.querySelector('.file-view .file-view-sub .err')?.textContent ?? ''`);
await waitIdle();
check(
  'Unstage hunk empties the index again',
  git(['diff', '--cached', '--', HUNK_FILE]) === '',
  (git(['diff', '--cached', '--name-status', '--', HUNK_FILE]).replace(/\n/g, ' ') || `(${HUNK_FILE} is not staged)`) + (unstageErr ? ` | diff error: ${unstageErr}` : ''),
);
const unstagedDiff = git(['diff', '--', HUNK_FILE]);
check('both edits are back as unstaged changes', unstagedDiff.includes(`+${HUNK_EDIT_1}`) && unstagedDiff.includes(`+${HUNK_EDIT_2}`), unstagedDiff.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-][+-]/.test(l)).join(' | '));

await inGroup('Unstaged Files', HUNK_FILE);
log(await clickFileRow('Unstaged Files', HUNK_FILE));
await waitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
log(await hunkAction(0, 'Discard hunk'));
await waitModal();
const discardHunkModal = String(await modal(null, null));
check('Discard hunk asks first, naming the file', discardHunkModal.includes(`Discard this hunk from ${HUNK_FILE}?`), discardHunkModal);
check('the discard prompt offers Cancel and Discard hunk', String(await modalButtons()) === 'Cancel | Discard hunk', await modalButtons());
log(await modalClick('Cancel'));
await waitNoModal();
await waitIdle();
check(
  'cancelling the discard leaves the working tree exactly as it was',
  git(['diff', '--', HUNK_FILE]) === unstagedDiff && status() === hunkStatusBefore,
  `${status()} | expected ${hunkStatusBefore}`,
);
await escape();
await waitFor(`!document.querySelector('.file-view')`, 'the diff to close');
log(await act(() => tool('Refresh')));

await shot('final.png');

step(22, 'a file that is not in the working tree offers no shell action that fails');
// GC-072. Both shell items go through `repoFile()`, which refuses a path that is not on disk, so
// on a row whose file is gone the only thing either of them can do is put an error in the status
// bar. `menuList()` prefixes a disabled item with "(x) ", which is what these assertions read.
const goneItems = (menu) => menu.split(' | ').filter((i) => /Open file|Show in folder/.test(i));
const DELETED_COMMIT = 'Remove obsolete file';
const DELETED_FILE = 'obsolete.txt';
await waitFor(
  `(() => { const b = document.querySelector('.graph-body'); if (!b) return false; if (b.scrollTop !== 0) b.scrollTop = 0; return [...document.querySelectorAll('.graph-row')].some(r => r.innerText.includes(${q(DELETED_COMMIT)})); })()`,
  `the ${DELETED_COMMIT} row to be rendered`,
);
log(await ev(`(() => { const r = [...document.querySelectorAll('.graph-row')].find(x => x.innerText.includes(${q(DELETED_COMMIT)})); if (!r) return 'no row ' + ${q(DELETED_COMMIT)}; r.click(); return 'selected ' + ${q(DELETED_COMMIT)}; })()`));
await waitFor(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === ${q(DELETED_FILE)})`, `the commit's file list to show ${DELETED_FILE}`);
log(await contextMenuOn('.detail-panel .file-row', DELETED_FILE));
const deletedCommitMenu = await menuList();
check(
  'a commit-file row for a deleted file disables both shell actions',
  goneItems(deletedCommitMenu).length === 2 && goneItems(deletedCommitMenu).every((i) => i.startsWith('(x) ')) && /Copy file path/.test(deletedCommitMenu),
  deletedCommitMenu,
);
await shot('file-row-menu-deleted.png');
await escape();

// the fixture's own staged deletion, and then an unstaged one made with rm: the WIP half of the
// same hole, where nothing in the menu told the two apart from a file that is still on disk
const STAGED_DELETION = 'main.txt';
const UNSTAGED_DELETION = GUARD_TRACKED;
rmSync(join(R, UNSTAGED_DELETION), { force: true });
log(await act(() => tool('Refresh')));
log(await selectWip());
for (const [file, what] of [
  [STAGED_DELETION, 'staged'],
  [UNSTAGED_DELETION, 'unstaged'],
]) {
  await waitFor(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === ${q(file)})`, `the staging list to show ${file}`);
  log(await contextMenuOn('.detail-panel .file-row', file));
  const menu = await menuList();
  check(`a ${what} deletion (${file}) disables both shell actions`, goneItems(menu).length === 2 && goneItems(menu).every((i) => i.startsWith('(x) ')), menu);
  await escape();
}
// a file that is still on disk keeps them, so the guard is the deletion and not the menu. big.txt
// rather than a.txt: step 19 checks a.txt back out, so by here it is clean and has no row at all.
await waitFor(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === ${q(HUNK_FILE)})`, `the staging list to show ${HUNK_FILE}`);
log(await contextMenuOn('.detail-panel .file-row', HUNK_FILE));
const presentMenu = await menuList();
check('a file that is still on disk keeps both shell actions', goneItems(presentMenu).length === 2 && goneItems(presentMenu).every((i) => !i.startsWith('(x) ')), presentMenu);
await escape();
git(['checkout', '-q', '--', UNSTAGED_DELETION]);
log(await act(() => tool('Refresh')));

step(23, 'branch menu: the tip-commit group, and a mixed Reset onto another branch tip');
// GC-049. The reset actions used to exist only on the commit row, so resetting onto a branch tip
// meant finding that exact row in the graph — impossible once it has scrolled out. The branch
// menu now composes the same items, and this step drives the one that changes a ref.
const RESET_BRANCH = 'wip-branch';
const resetTarget = git(['rev-parse', RESET_BRANCH]);
const mainBefore = git(['rev-parse', 'HEAD']);
// a mixed reset is exactly the thing that empties the index, so remember the fixture's staged half
// and put it back with the ref below — it survives the run now that a pop restores it (GC-082)
const stagedBeforeReset = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
const currentBefore = git(['branch', '--show-current']);
log(await contextMenuOn('.left-panel .ref-row', RESET_BRANCH));
const branchMenu = await menuList();
log(branchMenu);
check(
  'the branch menu carries the tip-commit group',
  ['Cherry pick commit', 'Revert commit', 'Create tag here', 'Copy commit sha'].every((l) => branchMenu.includes(l)) &&
    ['soft', 'mixed', 'hard'].every((m) => branchMenu.includes(`Reset ${currentBefore} to ${resetTarget.slice(0, 7)}: ${m}`)),
  branchMenu,
);
log(await act(() => menuClick(`Reset ${currentBefore} to ${resetTarget.slice(0, 7)}: mixed`)));
check(
  'the mixed reset moved the checked-out branch onto the other branch tip',
  git(['rev-parse', 'HEAD']) === resetTarget && git(['branch', '--show-current']) === currentBefore,
  `${git(['rev-parse', 'HEAD']).slice(0, 7)} | expected ${resetTarget.slice(0, 7)} on ${currentBefore}`,
);
// put the ref and the index back; the working tree was never touched by a mixed reset, and the
// fixture assertions in the next step are what prove it
git(['reset', '--mixed', '-q', mainBefore]);
if (stagedBeforeReset.length) git(['add', '-A', '--', ...stagedBeforeReset]);
log(await act(() => tool('Refresh')));

step(24, 'a detached HEAD is marked in the graph, and Push says why it is disabled');
// GC-061. `for-each-ref` marks `isHead` only on a branch, so detaching used to leave no row
// saying which commit is checked out. The detach is at HEAD, not HEAD~1: the fixture carries
// edits to tracked files every earlier step asserts against, and moving to another commit would
// either refuse or rewrite them. Nothing about the marker depends on which commit it is.
git(['checkout', '-q', '--detach', 'HEAD']);
log(await tool('Refresh'));
await waitFor(`(document.querySelector('.crumb .value.plain')?.innerText ?? '') === 'detached HEAD'`, 'the detached state to reach the crumb');
await waitIdle();
const detachedRow = await ev(
  `(() => { const r = [...document.querySelectorAll('.graph-row')].find(x => [...x.querySelectorAll('.col-ref > .ref-chip')].some(c => c.textContent.trim() === 'HEAD'));
     if (!r) return JSON.stringify({ found: false });
     return JSON.stringify({ found: true, first: r.querySelector('.col-ref > .ref-chip').textContent.trim(), msg: r.querySelector('.summary')?.textContent ?? null }); })()`,
);
check('the checked-out commit carries a HEAD chip, first in its row', JSON.parse(detachedRow).found === true && JSON.parse(detachedRow).first === 'HEAD', detachedRow);
check(
  'the row it marks is the commit git says HEAD is on',
  JSON.parse(detachedRow).msg === git(['log', '-1', '--format=%s']),
  `${JSON.parse(detachedRow).msg} | git: ${git(['log', '-1', '--format=%s'])}`,
);
const pushBtn = await ev(`(() => { const b = [...document.querySelectorAll('.toolbar .tool-btn')].find(x => x.innerText.trim() === 'Push'); return JSON.stringify({ title: b?.title ?? null, disabled: !!b?.disabled }); })()`);
check('the Push button names the detached state instead of promising an upstream', JSON.parse(pushBtn).disabled === true && JSON.parse(pushBtn).title === 'Cannot push from a detached HEAD', pushBtn);
// re-attach; the prologue runs the same command, so a run that dies here recovers by itself
git(['checkout', '-q', 'main']);
log(await tool('Refresh'));
await waitFor(`(document.querySelector('.crumb .value.plain')?.innerText ?? '').startsWith('main')`, 'the branch to come back to the crumb');
await waitIdle();
const reattached = await ev(`(() => JSON.stringify({ head: [...document.querySelectorAll('.graph-row .col-ref > .ref-chip')].filter(c => c.textContent.trim() === 'HEAD').length, mainChecked: [...document.querySelectorAll('.graph-row .col-ref > .ref-chip')].some(c => c.textContent.trim() === 'main' && c.classList.contains('head')) }))()`);
check('checking the branch back out removes the HEAD chip and gives main the check mark', JSON.parse(reattached).head === 0 && JSON.parse(reattached).mainChecked === true, reattached);

step(25, 'hide and solo branches: the graph, the Viewing count and Show all');
// GC-073. Hiding is one `--exclude=<fullName>` per ref ahead of `--all`, so a commit reachable
// from a ref that is still shown keeps its row: hiding the local `wip-branch` alone removes
// nothing, because `origin/wip-branch` still reaches the same commit. That is why this hides both
// halves before asserting a row is gone, and it is the whole reason one action hides exactly one
// ref rather than quietly taking the upstream with it.
// `load()` writes the canonical path git reported to both keys, so the remembered repository names
// the hidden set's key exactly, without this step having to guess how git spells the path.
const hiddenKeyName = `gitclient.hidden.${await ev(`localStorage.getItem('gitclient.lastRepo')`)}`;
const viewingCount = () => ev(`Number(document.querySelector('.left-panel .viewing b')?.textContent ?? -1)`);
const graphRows = () => ev(`document.querySelectorAll('.graph-row').length`);
// The WIP row is a .graph-row too, and it is not a commit: the git comparison needs the rest.
const commitRows = () => ev(`document.querySelectorAll('.graph-row:not(.wip)').length`);
const chipNames = () => ev(`[...document.querySelectorAll('.graph-row .col-ref .ref-chip')].map(c => c.textContent.trim()).join(' | ')`);
const hasWipCommit = () => ev(`[...document.querySelectorAll('.graph-row .summary')].some(x => x.textContent.trim() === 'Work on wip branch')`);

const rowsBefore = await graphRows();
const viewingBefore = await viewingCount();
// GC-095: the fixture carries a git note, whose own commit `git log --all` draws as a row with no
// chip and no left-panel row to explain it — and, before this, one an exclude could never remove.
check(
  'no row comes from a ref outside heads, remotes and tags',
  (await ev(`[...document.querySelectorAll('.graph-row .summary')].some(x => /Notes added by/.test(x.textContent))`)) === false,
  `the fixture's note is ${git(['rev-parse', 'refs/notes/commits'])}`,
);
log(await contextMenuOn('.left-panel .ref-row', 'wip-branch'));
const hideMenu = await menuList();
check('the branch menu offers Hide and Solo next to Pin to Left', hideMenu.includes('Pin to Left') && hideMenu.includes('Hide in graph') && hideMenu.includes('Solo in graph'), hideMenu);
log(await act(() => menuClick('Hide in graph'), 'hide wip-branch'));
check('hiding the local branch alone removes no row: origin/wip-branch still reaches its commits', (await hasWipCommit()) === true, `rows ${await graphRows()}`);

log(await contextMenuOn('.left-panel .ref-row.nested', 'wip-branch'));
log(await act(() => menuClick('Hide in graph'), 'hide origin/wip-branch'));
const rowsHidden = await graphRows();
const viewingHidden = await viewingCount();
check('with both halves hidden the wip commit leaves the graph', (await hasWipCommit()) === false, `rows ${rowsBefore} -> ${rowsHidden}`);
// How many rows go is git's answer, not a constant: earlier steps leave commits of their own on
// the branch, so what the two excludes take is whatever is reachable only through them. The
// traversal is the app's, not `--all` (GC-095): heads, remotes and tags plus HEAD, with the
// excludes repeated ahead of every glob because each traversal option consumes the ones before it.
const GRAPH_GLOBS = ['refs/heads/*', 'refs/remotes/*', 'refs/tags/*'];
const graphRevs = (...excludes) => [...GRAPH_GLOBS.flatMap((g) => [...excludes.map((r) => `--exclude=${r}`), `--glob=${g}`]), '--ignore-missing', 'HEAD'];
const allCount = ['rev-list', '--count', ...graphRevs()];
const wipExcludes = ['rev-list', '--count', ...graphRevs('refs/heads/wip-branch', 'refs/remotes/origin/wip-branch')];
const drawn = await commitRows();
check(
  'the rows that went are exactly the ones only those two refs reached',
  rowsBefore - rowsHidden === Number(git(allCount)) - Number(git(wipExcludes)),
  `${rowsBefore} -> ${rowsHidden} | git ${git(allCount)} -> ${git(wipExcludes)}`,
);
check('the commit rows match what git draws with the same two excludes', drawn === Number(git(wipExcludes)), `${drawn} commit rows | git: ${git(wipExcludes)}`);
check('Viewing counts only what the graph draws', viewingBefore - viewingHidden === 2, `${viewingBefore} -> ${viewingHidden}`);
const stored = JSON.parse((await ev(`localStorage.getItem(${q(hiddenKeyName)})`)) ?? 'null');
check(
  'the hidden set is persisted per repository, by full ref name',
  Array.isArray(stored) && stored.length === 2 && stored.includes('refs/heads/wip-branch') && stored.includes('refs/remotes/origin/wip-branch'),
  JSON.stringify(stored),
);
await shot('12-hidden-branches.png');

// Show all, one section at a time: each head clears only its own kind.
log(await act(() => sectionAction('Show all local branches in the graph'), 'show all local'));
log(await act(() => sectionAction('Show all remote branches in the graph'), 'show all remote'));
check('Show all restores every row and the Viewing count', (await graphRows()) === rowsBefore && (await viewingCount()) === viewingBefore, `rows ${await graphRows()}/${rowsBefore}, viewing ${await viewingCount()}/${viewingBefore}`);

// Solo keeps the soloed branch and the checked-out one, and hides every other branch and remote.
log(await contextMenuOn('.left-panel .ref-row', 'feature'));
log(await act(() => menuClick('Solo in graph'), 'solo feature'));
const soloChips = await chipNames();
check('solo keeps the checked-out branch and the soloed one', soloChips.includes('main') && soloChips.includes('feature'), soloChips);
check('no wip-branch chip survives a solo, local or remote', !soloChips.includes('wip-branch'), soloChips);
check('the wip commit leaves the graph with them', (await hasWipCommit()) === false, soloChips);
await shot('13-solo-branch.png');
log(await act(() => sectionAction('Show all local branches in the graph'), 'show all local'));
log(await act(() => sectionAction('Show all remote branches in the graph'), 'show all remote'));
check('the graph comes back after a solo is cleared', (await graphRows()) === rowsBefore, `${await graphRows()} / ${rowsBefore}`);
check('nothing is left hidden in localStorage', (await ev(`localStorage.getItem(${q(hiddenKeyName)})`)) === null, String(await ev(`localStorage.getItem(${q(hiddenKeyName)})`)));

step(26, 'the branch crumb is a dropdown: local and remote branches, the owner toggle, and the checkout guard behind it');
// GC-088. The crumb was drawn like the repository crumb beside it since GC-044 and did nothing;
// it opens the branch list now. Both crumbs are `.crumb`, so the branch one is the second.
const branchCrumb = () =>
  ev(`(() => { const c = [...document.querySelectorAll('.breadcrumb .crumb')][1]; if (!c) return 'no branch crumb'; if (c.tagName !== 'BUTTON') return 'the branch crumb is not a button'; c.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); c.click(); return 'clicked the branch crumb'; })()`);
const menuCaptions = () => ev(`[...document.querySelectorAll('.ctx-menu .ctx-caption')].map(c => c.textContent.trim()).join(' | ')`);
await waitNoMenu();
log(await branchCrumb());
await waitFor(`!!document.querySelector('.ctx-menu .ctx-item')`, 'the branch menu');
const crumbMenu = await menuList();
check('the two groups are captioned Local and Remote', (await menuCaptions()) === 'Local | Remote', await menuCaptions());
check('every local branch is a row, the checked-out one marked and disabled', /\(x\) ✓ main/.test(crumbMenu) && crumbMenu.includes('feature') && crumbMenu.includes('wip-branch'), crumbMenu);
check('every remote branch is a row too', crumbMenu.includes('origin/feature') && crumbMenu.includes('origin/main') && crumbMenu.includes('origin/wip-branch'), crumbMenu);
await shot('13-branch-crumb-menu.png');
// A second click closes it rather than reopening it: the crumb owns its menu (GC-066).
log(await branchCrumb());
await waitNoMenu();
check('a second click on the crumb closes the menu', (await ev(`!document.querySelector('.ctx-menu')`)) === true);
// Escape closes exactly it: it is a ContextMenu, so `layerOpen` already covers it (GC-034/GC-037).
log(await branchCrumb());
await waitFor(`!!document.querySelector('.ctx-menu .ctx-item')`, 'the branch menu again');
await escape();
await waitNoMenu();
const afterEscape = JSON.parse(await layerState());
check('Escape closes the menu and nothing behind it', afterEscape.menu === false && afterEscape.modal === false && afterEscape.popover === false && afterEscape.search === false, JSON.stringify(afterEscape));
// Choosing another branch goes through `runCheckout`, so the dirty-tree guard applies unchanged.
log(await branchCrumb());
await waitFor(`!!document.querySelector('.ctx-menu .ctx-item')`, 'the branch menu once more');
log(await menuClick('feature'));
await waitModal();
const atRisk = git(['status', '--porcelain']).split('\n').filter((l) => l && !l.startsWith('??')).length;
check('the checkout guard names the files actually at risk', new RegExp(`${atRisk} files?`).test(await modalMessage()), await modalMessage());
log(await modalClick('Cancel'));
await waitNoModal();
check('Cancel leaves the checkout undone', git(['rev-parse', '--abbrev-ref', 'HEAD']) === 'main', git(['rev-parse', '--abbrev-ref', 'HEAD']));

step(27, 'a file row can write .gitignore, and only an untracked one offers it');
// GC-093. `new.txt` is the fixture's untracked file; README.md is tracked and staged, where a
// .gitignore pattern would do nothing at all, so the entries are absent rather than disabled.
const GITIGNORE = join(R, '.gitignore');
// Earlier steps leave the working tree in a state of their own (step 23's mixed reset takes the
// a.txt edit back into the index), so what this step must restore is the status it found, not the
// constant the last step compares against.
const statusBeforeIgnore = status();
// A tracked file is in the index, where a .gitignore pattern has no say, so the entries are absent
// rather than offered and quietly doing nothing.
log(await contextMenuOn('.detail-panel .file-row', 'README.md'));
check('a tracked row offers none of the ignore entries', !(await menuList()).includes('Ignore'), await menuList());
await escape(); // a synthetic contextmenu fires no mousedown, so the open menu has to be dismissed
await waitNoMenu();
log(await contextMenuOn('.detail-panel .file-row', 'new.txt'));
const ignoreMenu = await menuList();
check('an untracked row offers the three ignore entries', ignoreMenu.includes('Ignore file') && ignoreMenu.includes('Ignore all *.txt files') && !ignoreMenu.includes('Ignore this folder'), ignoreMenu);
check('a root-level file offers no folder entry', !ignoreMenu.includes('Ignore this folder'), ignoreMenu);
await shot('14-ignore-menu.png');
log(await act(() => menuClick('Ignore file'), 'ignore new.txt'));
check('the pattern is rooted at the repository', readFileSync(GITIGNORE, 'utf8') === '/new.txt\n', JSON.stringify(readFileSync(GITIGNORE, 'utf8')));
check('git agrees the file is ignored', gitMay(['check-ignore', '-v', 'new.txt']).includes('/new.txt'), gitMay(['check-ignore', '-v', 'new.txt']));
check('the row leaves Unstaged and .gitignore takes its place', status() === statusBeforeIgnore.replace('?? new.txt', '?? .gitignore'), `${status()} | before ${statusBeforeIgnore}`);
check('the ignored row is gone from the staging list', (await ev(`[...document.querySelectorAll('.detail-panel .file-row')].some(r => r.title === 'new.txt')`)) === false);
// A .gitignore of its own is untracked too, so it offers the entries in turn.
log(await contextMenuOn('.detail-panel .file-row', '.gitignore'));
check('the entries are offered on any untracked row', (await menuList()).includes('Ignore file'), await menuList());
await escape();
await waitNoMenu();
// A file that does not end in a newline gains one before the pattern, rather than joining the last
// line, and an exact repeat writes nothing at all. Both are one call away from the UI, so they are
// driven through the bridge directly: nothing on screen distinguishes the two.
writeFileSync(GITIGNORE, '/new.txt\n*.tmp');
const callIgnore = (kind) => ev(`window.api.ignore(localStorage.getItem('gitclient.lastRepo'), { path: 'new.txt', kind: ${q(kind)} }).then(() => 'ok', (e) => 'FAILED: ' + e.message)`);
log(await callIgnore('extension'));
check('a file with no trailing newline gains one before the new pattern', readFileSync(GITIGNORE, 'utf8') === '/new.txt\n*.tmp\n*.txt\n', JSON.stringify(readFileSync(GITIGNORE, 'utf8')));
log(await callIgnore('file'));
check('an exact repeat adds no second line', readFileSync(GITIGNORE, 'utf8') === '/new.txt\n*.tmp\n*.txt\n', JSON.stringify(readFileSync(GITIGNORE, 'utf8')));
rmSync(GITIGNORE, { force: true });
log(await act(() => tool('Refresh'), "drop the step's .gitignore"));
check('the step puts the fixture back as it found it', status() === statusBeforeIgnore, `${status()} | expected ${statusBeforeIgnore}`);

step(28, 'the split diff: rows are aligned, and a hunk staged from it is the same patch as unified');
// GC-014. The alignment itself is unit tested in parseDiff.test.ts; what only the running app shows
// is that the header switch reaches the rendered table, and that a hunk button in the split layout
// still builds its patch from `hunk.raw` rather than from what is on screen. The proof of the second
// is byte equality: the same hunk staged from either layout has to leave `git diff --cached`
// identical, because it is literally the same patch text either way.
log(await selectWip());
await inGroup('Unstaged Files', HUNK_FILE);
log(await clickFileRow('Unstaged Files', HUNK_FILE));
await waitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
check('the file view opens in the unified layout, with no split table', (await ev(`document.querySelectorAll('.file-view .hunk-lines.split').length`)) === 0, await ev(`document.querySelectorAll('.file-view .hunk-lines.split').length`));

log(await setLayout('Split'));
await waitSplitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
await shot('diff-split.png');
const rows = JSON.parse(await splitRows(0));
// big.txt changes one line in place, so this hunk is context either side of a single paired change:
// every row carries both sides, the numbering runs in step because no line was added or removed,
// and the one row whose halves differ is `row 3` becoming `row 3 edited`.
const changed = rows.filter(([, l, , r]) => l !== r);
check('every row of the split hunk carries a line from each file, none padded', rows.every(([, l, , r]) => l !== null && r !== null), JSON.stringify(rows));
check('the two sides number in step, so the rows line up', rows.every(([ln, , rn]) => ln === rn), rows.map(([ln, , rn]) => `${ln}/${rn}`).join(' '));
check('exactly one row differs, pairing the old line with the edited one', changed.length === 1 && changed[0][1] === 'row 3' && changed[0][3] === HUNK_EDIT_1, JSON.stringify(changed));

log(await hunkAction(1, 'Stage hunk'));
await waitSplitDiff('Unstaged', 1, [HUNK_EDIT_1]);
await waitIdle();
const splitCached = git(['diff', '--cached', '--', HUNK_FILE]);
check('Stage hunk from the split layout stages that hunk, and only that hunk', splitCached.includes(`+${HUNK_EDIT_2}`) && !splitCached.includes(HUNK_EDIT_1), splitCached.split('\n').filter((l) => /^[+-]/.test(l) && !/^[+-][+-]/.test(l)).join(' | '));

// Put it back through the app rather than with a `git reset` behind the app's back, then stage the
// very same hunk from the unified layout and compare the two patches git recorded.
await inGroup('Staged Files', HUNK_FILE);
log(await clickFileRow('Staged Files', HUNK_FILE));
await waitSplitDiff('Staged', 1, [HUNK_EDIT_2]);
log(await hunkAction(0, 'Unstage hunk'));
await waitFor(`!document.querySelector('.file-view')`, `the file view to close as ${HUNK_FILE} leaves the Staged group`);
await waitIdle();
check('unstaging from the split layout empties the index again', git(['diff', '--cached', '--', HUNK_FILE]) === '', git(['diff', '--cached', '--name-status', '--', HUNK_FILE]).replace(/\n/g, ' ') || `(${HUNK_FILE} is not staged)`);

await inGroup('Unstaged Files', HUNK_FILE);
log(await clickFileRow('Unstaged Files', HUNK_FILE));
// The layout is remembered, so the view comes back split: the toggle is what puts it back.
await waitSplitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
check('the layout is remembered, so the next file view opens the way the last was left', (await ev(`document.querySelectorAll('.file-view .hunk-lines.split').length`)) === 2, await ev(`document.querySelectorAll('.file-view .hunk-lines').length`));
log(await setLayout('Unified'));
await waitDiff('Unstaged', 2, [HUNK_EDIT_1, HUNK_EDIT_2]);
log(await hunkAction(1, 'Stage hunk'));
await waitDiff('Unstaged', 1, [HUNK_EDIT_1]);
await waitIdle();
check('the same hunk staged from either layout records the same patch', git(['diff', '--cached', '--', HUNK_FILE]) === splitCached && splitCached !== '', `unified: ${git(['diff', '--cached', '--', HUNK_FILE]).length} bytes | split: ${splitCached.length} bytes`);

await inGroup('Staged Files', HUNK_FILE);
log(await clickFileRow('Staged Files', HUNK_FILE));
await waitDiff('Staged', 1, [HUNK_EDIT_2]);
log(await hunkAction(0, 'Unstage hunk'));
await waitFor(`!document.querySelector('.file-view')`, `the file view to close as ${HUNK_FILE} leaves the Staged group`);
await waitIdle();
check('the step leaves both edits unstaged, the way it found them', git(['diff', '--cached', '--', HUNK_FILE]) === '' && shortOf(HUNK_FILE) === `M ${HUNK_FILE}`, `${shortOf(HUNK_FILE)} | staged: ${git(['diff', '--cached', '--name-status', '--', HUNK_FILE]).replace(/\n/g, ' ') || 'none'}`);
log(await act(() => tool('Refresh')));

step(29, 'the run leaves the fixture exactly as it found it');
// The same call the prologue makes, on the healthy path this time, and then the invariant: a run
// that adds a commit to the fixture and does not take it back fails here, naming itself, instead of
// growing the history until some later run's virtualised-row assertion flakes for it (GC-076).
restoreFixture();
const drift = [...baseline].filter(([b, sha]) => gitMay(['rev-parse', b]) !== sha).map(([b]) => b);
const remoteDrift = [...baseline].filter(([b, sha]) => gitMay(['rev-parse', `refs/heads/${b}`], REMOTE) !== sha).map(([b]) => b);
check(
  'main carries the commits the fixture was built with and no more',
  git(['rev-list', '--count', 'HEAD']) === git(['rev-list', '--count', baseline.get('main')]),
  `${git(['rev-list', '--count', 'HEAD'])} commits, the fixture has ${git(['rev-list', '--count', baseline.get('main')])}` +
    ` | run: npm run e2e:setup${drift.length ? ' | drifted: ' + git(['log', '--oneline', `${baseline.get('main')}..HEAD`]).replace(/\n/g, ' ') : ''}`,
);
check('every branch is back on its baseline tip, here and on the bare origin', drift.length === 0 && remoteDrift.length === 0, `local: ${drift.join(', ') || 'none'} | origin: ${remoteDrift.join(', ') || 'none'}`);
check('the working tree is the one the next run expects', status() === EXPECTED_STATUS, `${status()} | expected ${EXPECTED_STATUS}`);

ws.close();
stopApp();
console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILED'} (screenshots in ${SHOTS})`);
// The run's own clock, so a speed change is measured in a ticket's log rather than estimated from
// screenshot timestamps the way GC-080's ~55-60s baseline had to be (GC-080).
console.log(`total: ${((Date.now() - runStart) / 1000).toFixed(1)}s`);
process.exit(failures === 0 ? 0 : 1);
