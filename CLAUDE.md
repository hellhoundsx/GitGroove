# GitClient: handover for Claude sessions

Everything a fresh session needs in order to act: what the app is now, and the rules that must not
be broken. *How* each rule came about is in the log of the ticket that made it, in `TICKETS.md`.
Keep this file current when a convention, a command or an invariant changes — and keep it short
(GC-089): a ticket's narrative belongs in that ticket, not here.

## What this project is

A desktop Git client built from scratch whose UX is modelled on GitKraken Desktop 11.10.0.
Owner: Ricardo Gomes (`ricardo.gomes@catenamedia.com`), Windows 11, 3440x1440. Started 2026-09-05.
A git repository on branch `main`, remote `https://github.com/hellhoundsx/GitClient.git`.

### The rules that override everything else

1. **Study GitKraken, never copy it.** `docs/reference/gitkraken/` holds observations gathered by
   inspecting the running app over CDP. Nothing from GitKraken's bundle, CSS, icons or strings may
   be copied into `src/`. Our tokens are our own values, calibrated against measurements.
2. **Never run write operations against Ricardo's real repositories** (`catena-feed`,
   `kyushu-route` under `C:/Users/Ricar/Documents/apps/`). Read-only loading for screenshots is
   fine. Anything that stages, commits, checks out, stashes, pushes or resets runs against the
   disposable e2e repository only.
3. **Never steal focus and never show a window.** Ricardo uses this machine while unattended runs
   happen, often in a full-screen game. Launch the app only through `tools/launch-app.mjs`, and
   never run `tools/gk-recon/*.ps1` (`focus`, `rclick`, `shot`, `cursor`, `esc`) or any other
   OS-level input or screenshot — those are for a hands-on GitKraken session only.
4. **Never `taskkill //F //IM electron.exe`.** It kills every Electron on the machine, the hourly
   reviewer's build and any `npm run dev` Ricardo has open included. Stop only what you started.
5. **Do not commit unasked**, never rewrite published history, never force-push.
6. **Write a control character as an escape, never as the byte itself.** A literal one makes git
   treat the file as binary, and `git diff`, `git blame` and review then silently skip it. A Node
   script generating such a file must build the escape (`String.fromCharCode(92) + 'u0000'`) —
   typing it emits the byte instead.

`.gitattributes` pins the working copy to LF (`* text=auto eol=lf`); the system Git config has
`core.autocrlf=true`.

## Stack and version constraints

| Piece | Version | Notes |
| --- | --- | --- |
| Electron | 44 | frameless window with `titleBarOverlay`, renderer draws its own tabs bar |
| electron-vite | 5 | main + preload built as CJS, renderer as a Vite client bundle |
| Vite | 7 | **must stay on 7**: electron-vite 5 supports Vite 5 to 7 only |
| @vitejs/plugin-react | 5 | **must stay on 5**: 6.x requires Vite 8 |
| React | 19 | no global `JSX` namespace, components `import { type JSX } from 'react'` |
| TypeScript | 7 | no `baseUrl`, tsconfig `paths` are relative; `tsc --noEmit` per target |
| lucide-react | 1.x | the only icon source; wrap with `Icon` from `ui/icons.tsx` |
| @fontsource/open-sans | 5 | UI font, imported in `main.tsx` (400/600/700) |
| vitest | 5 | two projects (node + jsdom) |
| jsdom | 30 | the `dom` project's environment |
| @testing-library/react | 16 | needs `@testing-library/dom` 10 alongside it |
| git | system `git` on PATH | all repository access shells out, no libgit2 |

Node 25 and npm 11; no pnpm, no Rust (Tauri was ruled out for that reason). `npm install` prints
`EBADENGINE` for vitest 5 and jsdom 30 on Node 25: warnings, the suite runs, and downgrading Node
is not the fix.

## Commands

```bash
npm run dev            # electron-vite dev with HMR
npm run build          # bundles to out/ (main, preload, renderer)
npm run typecheck      # tsc for the node target then the web target
npm test               # vitest run: the unit tests, once
npm run test:watch     # vitest in watch mode
npm run e2e:setup      # (re)creates the scratch repo under %TEMP%/gitclient-e2e (or $GITCLIENT_E2E_ROOT)
npm run e2e            # drives the BUILT app through the UI, asserts against git, exits 1 on failure
npx vitest run --project node   # or --project dom, to run one vitest project
```

Launch the built app for driving and screenshotting **only** through the launcher:

```bash
npm run build && node tools/launch-app.mjs --repo "$TEMP/gitclient-e2e/testrepo"
```

`--port <n>` DevTools port (default 9333), `--repo <p>` sets `gitclient.lastRepo` over CDP and
reloads, `--visible` shows a normal focused window, `--keep-running` attaches to the app already on
the port instead of freeing it first.

It is **stealthy by default**: it spawns `node_modules/electron/dist/electron.exe` directly (never
`electron.cmd`, never `cmd /c start`, both of which pop a console window) and sets
`GITCLIENT_STEALTH=1`, which builds the window with `webPreferences.offscreen: true` plus
`skipTaskbar`, `focusable: false` and 10fps — no OS window exists at all, and
`Page.captureScreenshot` still returns a real render. `--visible` drops that variable **and**
`windowsHide`, which on Windows puts `SW_HIDE` in the child's `STARTUPINFO` and would keep a
"visible" launch invisible.

Every launcher launch runs on **its own Electron profile** — `GITCLIENT_USER_DATA` =
`<os.tmpdir()>/gitclient-profiles/<port>` (`profileDir(port)`), applied by `app.setPath`. The
worker (9333), the e2e suite (`GITCLIENT_E2E_PORT`) and the reviewer (9334) each keep a
`localStorage` that persists between runs on that port and never reaches the one Ricardo sees. An
explicit `GITCLIENT_USER_DATA` wins; only a start outside the launcher uses the real profile.

**Stopping the app**: `launchApp` resolves with `stop()`, `stopApp(child)` does the same from a
child handle, and `stopPort(port)` stops the one process listening on a DevTools port. By hand:
`netstat -ano -p tcp | grep 9333`, then `taskkill //F //T //PID <pid>`.
`tools/e2e/foreground.ps1` proves a launch was invisible by printing the foreground window handle
and every top-level window an `electron` process owns — `Get-Process electron | MainWindowTitle` is
useless, a frameless window reports an empty title even on screen.

## Architecture

`src/main/` is `index.ts` (the window), `git.ts`, `ipc.ts` and `watch.ts`; `src/preload/` is the
contextBridge; `src/shared/` holds `types.ts` and `remotes.ts`; `src/renderer/src/` holds
`App.tsx`, `components/`, `graph/`, `diff/`, `ui/`, `prefs.ts`, `shortcuts.ts` and `styles/`
(`tokens.css` plus `app.css`, one file for every component). Outside `src/`: `docs/screenshots/`
for screenshots of our app, `docs/reference/gitkraken/` for the study, and `tools/`
(`launch-app.mjs`, `gk-recon/`, `e2e/`). Each is described below or under Testing.

### Main process

**`git.ts`** — `runGit(cwd, args, { input?, okCodes? })` spawns git with `--no-pager -c
core.quotepath=off -c color.ui=never` and `GIT_TERMINAL_PROMPT=0` (credentials come from the system
helper). It rejects **before** spawning when `cwd` does not exist, because Node reports the same
`spawn git ENOENT` for a missing binary and a missing cwd, and maps a spawn `ENOENT` to
`GIT_MISSING_MESSAGE`. `checkGit()` runs one `git --version` **in the home directory**, never in the
last repository, whose path may be stale. Non-zero exit rejects with `GitError` carrying stderr, or
the last six stdout lines when stderr is empty — conflicts report on stdout. Invariants:

- **The log is `--date-order`, deliberately**: it reproduces GitKraken's row order, where
  topo-order groups branches into blocks and was wrong. The renderer asks for 2000 commits
  (`MAX_COMMITS`) and then pages: `getLog(cwd, max, exclude, skip)` behind `repo:log` answers the
  next 1000 (`PAGE_COMMITS`) of the same traversal, so a page must be asked for with the hidden set
  its range was loaded with or `skip` counts through a different one (GC-012).
- **The graph traverses the namespaces the UI lists, never `--all`** (GC-095): `--glob=refs/heads/*`,
  `--glob=refs/remotes/*`, `--glob=refs/tags/*` and the revision `HEAD`, with `--ignore-missing` so
  an unborn HEAD is skipped rather than fatal. `--all` means every ref under `refs/`, which drew
  rows no chip and no left-panel row could account for — notes, `refs/pull/*`, a tool's private
  namespace — and kept a hidden branch's commits on screen with nothing saying why. `refs/stash` is
  out by construction now, not by name.
- `getLog(cwd, max, exclude)` repeats one `--exclude=<fullName>` per hidden ref **ahead of every
  glob** (GC-073, GC-095): the accumulated excludes are consumed by the next traversal option, and
  `--glob` is what matches them against the *full* ref name — `--branches`/`--tags` match relative
  to their own namespace and would exclude nothing. A commit reachable from an included ref keeps
  its row; HEAD is a revision, so it is never excluded.
- **`fastForward(cwd, branch, upstream)` picks its command by whether the branch is HEAD** (GC-100):
  `git fetch . <upstream>:<branch>` for one that is not, because a local fetch refuses anything but
  a fast-forward and touches neither index nor working tree, and `git merge --ff-only` for the one
  that is, since git will not fetch into the ref HEAD points at. `setUpstream(cwd, branch, upstream
  | null)` is `--set-upstream-to` or `--unset-upstream`.
- **`stashApply` and `stashPop` pass `--index`**, or what was staged when the stash was made comes
  back unstaged and is gone. `--index` fails two ways that need opposite handling (GC-092), so
  `restoreStashWith` reads `git status --porcelain` either side of the attempt rather than trusting
  a message: an unmerged entry or any change to the status means it **applied** — the ordinary
  conflicting pop — and git's own error propagates untouched; only an unchanged status means it
  refused before touching anything, and then the plain form is retried and the result **rejected**,
  because the working directory came back and the staging did not.
- **`pull(cwd, mode, remote?)` names the branch whenever it names a remote** (GC-057): `git pull
  <remote>` with no refspec still merges `branch.<name>.merge`, which is the upstream the caller
  asked to bypass, so a named remote becomes `git pull <flag> <remote> <branch>`.
- **A push with no remote named uses `defaultRemote(remotes)`** (`origin`, else the first remote).
  Every menu row that offers one therefore **names the remote, never an upstream ref** (GC-114):
  the push writes `<remote>/<branch>`, so a row naming `r.upstream` promised a different ref the
  moment the upstream's branch name was not the local name.
  `src/shared/` is the only place code is shared both ways, so a menu label cannot promise a
  different remote from the one the push uses.

- **A local branch's delete can take its remote copy with it** (GC-112). `remoteCopyOf` in
  `App.tsx` answers where else the branch lives — its upstream first, then a remote-tracking ref of
  the same name, and only ever one the snapshot lists — and the confirmation carries a checkbox for
  it. The local delete runs first and the remote one only if it succeeded; the remote half goes
  through a plain `run()`, so its failure reports on the status bar and leaves the local delete
  standing. `deleteRemoteTag` is the tag equivalent and is `git push <remote> --delete
  refs/tags/<name>`, **fully qualified**: a bare name is ambiguous when a branch and a tag share it,
  and git refuses rather than guessing.

**`watch.ts`** — one `fs.watch(repo, { recursive: true })` per window, keyed by `webContents` id,
**not** chokidar: on Windows that is ReadDirectoryChangesW, so one watcher on the working-tree root
covers `.git/` too. Events are filtered, scoped, debounced 300ms with the strongest scope winning,
then pushed as `repo:changed`. Ignored: `node_modules`, `.git/objects`, `.git/logs`, `.git/lfs`,
`.git/modules`, `.git/fsmonitor--daemon`, `.git/COMMIT_EDITMSG`, every `.git/**.lock`, **and a bare
`.git` path** — that last is load-bearing: our own `git status` writes `.git/index.lock`, Windows
reports it as a change on `.git` itself, a directory event has no second path segment for the
ignore list to match, and the refresh it triggered ran `git status` again, forever. `.git/refs`,
`HEAD` and `packed-refs` scope to `refs` (full reload); everything else to `tree` (status only).
`git check-ignore` is deliberately not used: every git call lives in `git.ts`, so the watcher stays
pure fs.

**IPC and preload** — channels grouped by prefix: `repo:*`, `commit:*`, `workdir:*`, `ref:*`,
`remote:*`, `stash:*`, `shell:*`, `window:*`. `ipc.ts` validates every argument (`str`, `strs`,
`int`, `oneOf`); `repo:checkGit` is the only handler taking none. `window:theme` is the other
handler that never touches git: it repaints the OS window controls for the theme the renderer
resolved, and `TITLE_BAR_OVERLAY` with it lives in `ipc.ts` rather than `index.ts` because
`index.ts` already imports `registerIpc` and the other direction would be a cycle (GC-013). Adding an API means: type in
`shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in `preload/index.ts`.
`shell:*` is the group that never touches git: its two handlers live in `ipc.ts` itself, go through
`repoFile()` — which resolves a repository-relative path against the repository and **refuses one
landing outside it** (a `..`, an absolute path, another drive) or missing from the working tree —
and are exposed as their own `window.shell` bridge, not as more of `window.api`. `repoRel()` is the
same check answering the relative path, which is what `workdir:ignore` builds its `.gitignore`
pattern from (GC-093), so a pattern can never be made out of a path outside the repository. `repo:changed` is
the **one main → renderer push**, subscribed by a hand-written preload entry returning an
unsubscribe.

### App state (`App.tsx`)

`App` holds every piece of state: `snapshot` (info, commits, refs, status, stashes, remotes),
`selected` (a sha or the `WIP` sentinel), `fileView`, `leftCollapsed`, the panel widths, `hidden`,
`workdirVersion`, `busy`, `error`, `gitError`, `pinned`.

- **`run(label, fn, opts)` is the only way git actions execute.** It sets busy, runs, reloads the
  snapshot (or only the status for staging actions), and **re-applies the error after the reload**,
  because git often exits non-zero while leaving a state the panels must show.
  It also takes a **busy token** on entry and clears `busy` — and applies its error — only while it
  still owns it (GC-084), so of two overlapping actions the one that finishes first no longer takes
  the status bar away from the one still running. A `rethrow` caller gets its exception either way.
  **`takeBusy(label)` is where that token is taken, and every writer of `busy` goes through it**
  (GC-108) — `run()`, the mount effect and `openPath()`, the last two of which used to set and clear
  the bar with no token at all, so an action running when a repository was opened cleared the open's
  spinner. Whichever started last owns the bar; only the owner takes it down.
- **Two counters.** `generation` is bumped by `run()` and `openPath()`; `load()`, `refreshStatus()`
  and `applyChange()` capture it and silently drop their result if it has moved, so a background
  reload cannot overwrite a fresher snapshot. `dataGen` records what has been *applied* to state
  and reaches the DOM as `data-gen` on `.statusbar`; the e2e suite waits on it, so **a new reload
  path must bump it** or every wait in the suite hangs.
- A watcher change arriving while `busy` is parked and flushed once when `busy` clears, and the
  background reload calls `window.api.loadRepo` directly rather than `load()`, whose failure path
  clears the open repository — a refresh nobody asked for must never do that. That failure path
  keeps `gitclient.lastRepo` but drops the path from `recentRepos`, so an entry whose folder moved
  stops being offered. `openPath(path)` is the one way a repository is switched.
- Every checkout goes through `runCheckout(name, doCheckout)`, which asks first and offers "Stash
  and check out" whenever a **tracked** file has staged, unstaged or conflicted changes. A tree
  holding only untracked files checks out silently — git carries those across untouched — and the
  prompt names the number of files actually at risk.
- **Cherry-pick, revert, merge and rebase go through `runSequencer(what, label, action)`** (GC-090),
  the same shape one step further on: git refuses all four outright while anything is staged, so the
  guard asks first, naming the staged count, and offers Cancel or "Stash and continue" — never
  "continue anyway", which git would only refuse. On failure the stash goes back **unless git
  stopped mid-operation**: a pop runs `git reset`, which deletes `CHERRY_PICK_HEAD`, so putting the
  index back would quietly clear the state the banner and Abort exist for; the error then says which
  stash holds the changes.
- **A drop composes the two: `runOnBranch(branch, what, label, action)`** (GC-015). The merge
  and rebase a drag offers name the branch they run on rather than taking whatever is checked
  out, so that branch is checked out first through `checkoutRef` — GC-004’s guard and its stash
  offer come with it — and the action goes through `runSequencer` for GC-090’s. Two operations
  on the status bar, not one: nesting `run()` in `run()` would take two busy tokens and reload
  twice. Between them git is asked where HEAD is, because a cancelled prompt and a failed
  checkout both return quietly and neither may be followed by a merge on the wrong branch.
- Menus come from `commitMenuItems`, `refMenuItems`, `stashMenuItems`, `wipMenuItems`,
  `remoteMenuItems` and `fileMenuItems`; `tipCommitActions(sha)` is the shared source for the
  commit actions the branch and commit menus both carry, so their wording cannot drift.

**Escape closes exactly one layer**, decided in one place: `App.tsx` computes `layerOpen` from
every open layer — including the toolbar popover, Pull's or Push's (GC-057), which is **one**
piece of state (`'pull' | 'push' | null`) rather than two flags, so both open is not a state the
app can reach however the button was activated (GC-119). `Toolbar`'s `mousedown` listener keeps
only the outside click, which is the job no keyboard activation produces. While a layer is up the
window handler closes the topmost and swallows every
other window-level shortcut. With no layer, Escape closes the file view first, then the search bar.
That handler runs in the **capture phase** and calls `stopPropagation()` on the key it consumes, so
no React handler underneath sees it. No layer handles Escape itself, and **no `window` keydown
listener exists anywhere in the renderer outside `App.tsx`** — a new layer joins `layerOpen`
rather than growing a listener of its own.

**No handler compares a key name of its own**: every one asks `matches(id, event)` from
`shortcuts.ts`, which is also what the `?` overlay renders from, so a binding cannot be documented
differently from the way it behaves. Adding a shortcut means an entry in that table and a
`matches('<id>', e)` call, never a bare `e.key === …`. `CommitGraph.tsx` imports it as
`isShortcut`, because `matches` is the search-results array in that file.

### UI layer (`ui/`)

`useUi()` gives `openMenu(at, items)`, `prompt(options)`, `confirm(options)`,
`confirmWithOption(options)`, and the pairs `dialogOpen`/`closeDialog()` and
`menuOpen`/`closeMenu()` that let `App` own Escape.

- **Every confirmation goes through `useUi().confirm`**; the native `confirm()` is not used. A
  confirmation that carries an option goes through **`confirmWithOption`**, which is the same
  question with `ConfirmOptions.checkbox` on it and answers `{ confirmed, checked }` (GC-131);
  `confirm` is that function's `confirmed` and nothing else. Both are `prompt({ input: false })`
  underneath, which is what a confirmation has always been — but only `UiContext` knows that, so
  `prompt` in a call site now means a dialog with a real input.
- `openMenu`'s `at` is a `MenuAnchor`: a right-click passes the event and leaves `owner` unset,
  while a control owning a dropdown passes itself as `owner` and gets a menu that toggles. That is
  decided from a capture-phase mousedown registered at mount, which therefore runs before the one
  `ContextMenu` registers when it opens.
- `PromptOptions.secondary` adds a third button resolving `choice: 'secondary'`; `required`
  defaults to true and only the stash prompt sets it false. OK stays
  `.modal-buttons .btn:last-child`, which the e2e helpers rely on.
- **Every modal is `h3` + `.modal-body` + `.modal-buttons`, in that order** (GC-103). `.modal` is
  capped at `calc(100vh - 40px)` and `.modal-body` is the only part that scrolls, so a dialog taller
  than the window keeps its title and its buttons on screen instead of overflowing off both ends.
  The gap between the children is `--modal-gap`, which `.modal.prefs` and `.modal.shortcuts` raise;
  a body that fits is spaced exactly as it was. A new modal joins this shape — no `max-height` of
  its own, or it is a scrollbar inside a scrollbar.
- **A context menu is capped against the window and scrolls inside itself** (GC-120), the same
  answer `.modal` has: `.ctx-menu` is `calc(100vh - 8px)` — the 4px the position clamp keeps at
  each edge — so the branch menu, whose height grows with the number of remotes, keeps its first
  and last rows reachable on a short window. It clamps rather than flips, so a cap costs it
  nothing. `ContextMenu`'s wheel listener ignores a wheel **inside** the menu, or a capped menu
  could not be scrolled: that wheel is the user reaching its last row, not the page moving.
- `MenuItem` supports `label`, `hint`, `onClick`, `disabled`, `danger`, `separator`, `hintPath` (a
  hint ellipsised at its *start*, so the folder naming an entry survives) and `caption` (a
  non-interactive heading rendered as `div.ctx-caption`, so no menu selector picks it up). In a row
  the label gives way last: `.ctx-label` is `flex: 0 1 auto`, `.ctx-hint` `flex: 1 1 0`.
- `useDragWidth({ key, def, min, max, dir, limit })` is the one drag-to-resize implementation —
  clamp, persist, double-click reset — used by the ref column and both side panels. It computes the
  released width from the release position rather than from state: the pointerup arrives before
  React has committed the last pointermove, so the closure's width is one step behind.
- **A drag starts from the width being drawn and ends at the last width the pointer reached**
  (GC-111, GC-115, GC-118). `start` is `clampDrag(width)` — what the element is on screen at — not
  the stored number, so travel is one-for-one with the edge even while a fit is reducing it.
  `dragWidth(start, delta, min, max, limit)` answers one position and stays pure;
  `reachedWidth(start, delta, min, max, limit)` is the rule the hook uses, and it answers the
  drag: the release width inside the wall, **the wall** when the release ran past it from a start
  inside it, and `null` — neither drawn nor stored — when the drag started on the wall or past it.
  The middle case is what keeps the edge from stopping one `pointermove` short of the wall on a
  fast drag, and it needs no record of the travel: the pointer covers the whole interval between
  `start` and the release. The third is what keeps the "stored widths are never touched" promise
  true on the **drag** path as well as the resize one — the wall's own value is never written over
  the wider width the user chose on a wider window. A `limit` must therefore be derived from what
  the *other* elements are **drawn** at, never from what is stored for them — the two differ
  exactly when the fit is doing something, and a limit taken from a stored width comes out below
  `min`, at which point a drag could reach nothing at all.
- **The centre is the last thing to give way, not the first** (GC-105). Each panel's own range
  (160–420, 300–720) says nothing about the window they share, and the two maxima sum to 1140
  against a 900px `minWidth`. `MIN_GRAPH_W` (440) is the graph's reserved share, and
  `fitPanels(left, detail, windowW, min)` answers the widths actually applied: the wider panel gives
  way first, down to the narrower one, then both in proportion to what each still has above its own
  minimum, and if even the two minima do not fit they stay at them and the centre takes the
  shortfall. 440 is not a round number — it makes `160 + 440 + 300` come to exactly the declared
  `minWidth`, and it is what keeps the message column over 200px at the default ref column.
  **The stored widths are never touched**: only `--left-panel-w` / `--detail-panel-w` are reduced,
  so widening the window restores what the user chose. `useWindowWidth()` re-applies the fit on
  resize, and `limit` — as far as a drag may go given the other panel — bounds the drag alone, never
  the width restored at mount or the double-click reset. A collapsed left panel is a fixed 44px rail
  that ignores its variable, so `App` passes it in as a zero-width panel with a zero floor.
- **And the same question one level in, for the ref column** (GC-110). `fitRefCol(stored, panelW,
  rest, min)` is `fitPanels` inside the graph panel: `MIN_MSG_W` (200) is what the commit message
  keeps, `rest` is everything a row spends outside those two columns — the lanes, plus any optional
  column that is on, since those are `flex: none` and take their width from the message too — and
  the panel is measured rather than assumed, off the same `ResizeObserver` on `.graph-body` that
  virtualises the rows (its client width is the box the rows are laid out in, so the scrollbar is
  out by construction). Same promise as the panels: only `--ref-col-w` is reduced, `gitclient.refColW`
  is never touched, and `limit` bounds the drag alone. A `panelW` of 0 means not measured yet and
  applies the stored width unchanged, rather than snapping to the minimum for one frame.
- **And what gives way after that: the optional columns themselves** (GC-116). `fitOptCols(want,
  panelW, lanes, refMin, w)` answers which of AUTHOR / DATE / SHA are actually drawn, dropping
  whole columns in that order — least identifying first — until the message can keep `MIN_MSG_W`.
  Whole ones rather than narrowed: half a timestamp identifies a commit no better than none and
  costs the message the same width. The set is decided against the ref column's **floor** and is
  never re-examined after `fitRefCol` has run against the survivors, and that order is the whole of
  why it is stable — a ref column allowed to grow back into the space a dropped column left would
  drop the next column, and the next.
- **Dragging a branch onto another is one module, `ui/refDrag.ts`** (GC-015). A chip in the
  graph and a row in the left panel stand for the same `GitRef`, and a drag crosses between
  them in either direction, so what may be picked up, what may be dropped on what and the HTML5
  handlers that say so live in one place; `App` holds the ref in flight, because both surfaces
  read it, and each surface keeps its own "which target is the pointer over". Only branches take
  part. **A pair that offers no action never becomes a drop target**: `canDropRef` refuses it,
  so the `dragover` does not `preventDefault`, and no highlight and no drop follow — merge needs
  the target checked out, so the target must be a local branch, and rebase checks the source
  out, so the source must be one. That is what keeps a drop from ever opening an empty menu.

### Graph (`graph/`)

`layoutGraph(commits, pinnedSha, prev?)` assigns lanes in the order commits arrive. `prev` is the
`state` a previous call returned — the lanes still open at the end of its range — so a later page
continues them instead of restarting at column 0, and the pin is not re-seeded on a page that is
not the first (GC-012). `lanes.test.ts` pins the property that matters: splitting a history at any
row and laying out the halves equals laying out the whole.

**`useLaneLayout` in `CommitGraph.tsx` is the one caller, and it is what makes that paging real**
(GC-106): a ref caches the last `(commits, pinned, layout)`, an unchanged pair returns the cached
layout, and only a strict **extension** lays out the new tail with the previous `state` and
concatenates — the old `RowLayout` objects are reused, and only the array holding them is new.
Everything else replaces `commits` wholesale — a reload, another repository, a change of pin or of
the hidden set — and is laid out from the first row. `continuesRange(prev, next)` in `lanes.ts` is
that decision, exported so it is tested rather than inlined: it requires `next` to be longer **and
both ends of `prev` still in place**, because a commit removed from the middle moves the sha that
used to sit last and a new commit at the top moves the first. Getting it wrong is not a slow graph
but a wrong one, carrying lanes from commits that are no longer there.

- **Column 0 is reserved for HEAD's lineage** (`active[0] = headSha` before the loop), so the
  checked-out branch is the leftmost straight line and the WIP node sits above it. "Pin to Left"
  passes another branch's sha instead.
- **No early forking**: when two lines share a parent they both continue until the parent's row.
  Forking early handed the checked-out branch's line to a side branch. Do not reintroduce it.
- Colour is the lane index (`--lane-0..9`), stable as lanes recycle. The ten are **interleaved,
  not a hue ramp** (GC-113): `laneColor[i] = i % 10`, so the lanes drawn side by side are always
  consecutive indices, and a ramp put exactly that pair closest together. Every adjacent pair is
  at least 100 degrees of hue apart in both themes, 9/0 included.

`GraphCell` renders one 28px row as inline SVG. **A join is three segments, never a diagonal**:
down its own lane to `mid - JOIN_R`, one quarter arc, then horizontally to the node's centre line,
mirrored below. `JOIN_R` is 8px — under `mid` (14) so a vertical piece survives in a 28px row,
under `LANE_W` (20) so a horizontal one survives between adjacent lanes, and clamped to the lane
distance. Joins are drawn after the through-lines.

`CommitGraph` virtualises rows (28px, overscan 12) and renders chips: a local branch **absorbs its
upstream** when both point at the same commit, then **exactly one chip** (`MAX_CHIPS = 1`) and a
`+N` for the rest — one at every width, because a second chip took its space from the first. The
folded refs are **not a popover: the chip grows**. `.more-list` is a sibling of the `+N` chip,
positioned against `.col-ref` so its first line lands on the pixel the row chip occupied; hovering
`.col-ref` opens it and hides the `+N` with `visibility: hidden`, keeping the box measurable. Two
CSS rules are load-bearing: the lines keep a chip's own `0 6px` padding, or the name shifts 3px as
the block opens; and the grow-to-full-name hover is `.col-ref > .ref-chip:hover`, a **direct
child**, or the block's own lines resize under the pointer. It flips above the row when hanging
below would cross `.graph-body`'s bottom edge, decided on each `mouseenter` against live rects
because the rows are virtualised.

Chip order: HEAD, the pinned branch, tracking locals, other locals, remotes, tags — the pin ranks
second so its marker survives the fold. With **no branch checked out** a synthetic `HEAD` chip is
built in the renderer from `headSha`; `getRefs` and `GitRef` never see it, so it opens
`commitMenuItems` rather than the ref menu and ignores double-click.

Three optional columns — AUTHOR, DATE / TIME and SHA — come from `prefs.graphColumns`, off by
default, fixed at 140/150/80px with `flex: none` so the message column absorbs the remainder;
`OPT_COL_W` in `CommitGraph.tsx` mirrors those three widths, because `fitRefCol` has to know what
they take before it can leave the message its own minimum (GC-110). What the preference asks for is
not always what is drawn: `fitOptCols` runs first and `cols` is its answer, so every render site —
header, rows and `restW` — reads one set and they cannot disagree (GC-116). In that column the
**summary wins**: the body preview sits in a `.body-wrap` with `flex: 1 1 0` and
`container-type: inline-size`, so it only gets space the summary did not need, and a
`@container (max-width: 40px)` rule drops it rather than leaving a lone ellipsis.

Commit search matches client-side on summary, body, author name, email and sha prefix. Matching
rows get `.match`, every other `.unmatched` (0.3 opacity) — GitKraken dims rather than hides, so
the graph stays continuous. The position in the results is derived from the current selection, not
from state of its own, and the bar's `{ open, tick, query }` lives in `App.tsx` because
`CommitGraph` unmounts whenever a file view opens; only `closeSearch` clears it. The ref column's
width is written as `--ref-col-w` on `.graph-panel` — `fitRefCol`'s answer, not the stored number
(GC-110, see the UI layer) — and its 4px `.col-resize` handle is absolutely positioned on the
column boundary so dragging reflows nothing.

**Hiding branches.** A per-repository hidden set (`gitclient.hidden.<repoPath>`, full ref names)
reaches `loadRepo(path, max, exclude)`. **One action hides exactly one ref**: hiding a local branch
does not also hide the upstream its chip absorbs, because the row and its eye stand for one ref and
taking a second silently would hide something the user did not name — so a branch whose commits are
also reachable from its upstream stays until that upstream is hidden too. The checked-out branch can
never be hidden. **The set is read for the path being opened, inside `load()`, so it reaches that
path's first `loadRepo`** (GC-099) — it is recorded in `hiddenRef` *after* the await, in the same
commit as `setSnapshot`, because the prune effect clears that ref while there is no snapshot and
would otherwise wipe a value primed before it. The set is still pruned against every snapshot, so a
name cannot outlive its ref, but that now reloads only when a hidden ref has genuinely disappeared:
an ordinary open costs one `git log`, not two, and no frame is painted with a chip the snapshot
already excludes. `App` hands `CommitGraph` only the visible refs; the left panel gets all of them
and marks the hidden.

### Diff (`diff/`)

`parseUnifiedDiff` handles `diff --git` headers, `@@` hunks with line numbers, `\ No newline` meta
lines and binary markers; `buildHunkPatch(file, hunk)` rebuilds a patch with the file header minus
the `index` line. `DiffView` replaces the graph while open, and the left panel collapses to an icon
rail. What is loaded is **keyed to the view it was loaded for**, in two parts. The *identity*
(`repo|source|path|sha`, or `repo|source|path|staged|kind`) decides what is on screen: only content
whose identity matches the current view renders, so a hunk from the other side of a file can never
sit under a header that has already flipped. The full key adds `version`, which every status reload
bumps: while a same-identity reload is pending the content stays and dims (`.diff-body.stale`) and
`actionsDisabled` is true, so no button is ever live over content whose load is not the newest.
Both are derived **during render**, not cleared from an effect — an effect runs after React has
committed the new view, painting one frame with the new header over the old hunks and live buttons.

**Two layouts, one load.** `prefs.diffView` picks the four-column unified table or the six-column
`.hunk-lines.split`, and the `Unified | Split` switch in the header (`.seg` / `.seg-btn`, the app's
only segmented control) writes that pref. `alignHunks(hunk)` is the pure function behind the split
one: it pairs each run of removals with the additions that follow it index by index, pads the
shorter side with `null`, puts a context line on both sides, and pairs a `\ No newline` marker only
with the marker opposite it. Three things must stay true (GC-014): the layout is a **render of what
is already loaded**, so flipping it costs no reload and disables no action; a hunk button still
builds from `hunk.raw`, so the same hunk staged from either layout is byte-for-byte the same patch
(e2e step 28 asserts exactly that); and in split the tint is on the **cells**, not the row, because
a split row is one line of each file — `.line.add` matches nothing there, which is why the e2e
suite has `waitSplitDiff` beside `waitDiff`. `table-layout: fixed` keeps the halves exactly equal
and a long line therefore wraps; clipping it or giving each side its own scrollbar would both hide
changed code.

**Intra-line marks, one source for both layouts** (GC-104). `wordDiff(old, new)` takes the common
prefix and suffix off, runs a word LCS on what is left and returns the spans per side — or `null`
for "mark nothing", when the lines are identical, share less than a quarter of the longer one, or
either side is over 400 tokens; a marked run never starts or ends on whitespace.
`hunkWordSpans(hunk)` keys those spans by the `DiffLine` object itself, off `alignHunks`' pairing,
so only a removal sitting opposite an addition is marked and **both layouts read the same map** —
`DiffView` renders every code cell through one `code()` helper, computed once per parsed file. Marks
are `span.word` tinted with `--diff-add-word` / `--diff-del-word` over the line's own tint; the hunk
buttons are untouched, since they still build from `hunk.raw`.

**A load that fails says so in the body** (GC-083): `loadError` is a `current` whose `text` is null,
and it gets a fourth `.diff-empty` branch beside "Loading diff…", "No textual changes." and "Binary
file." An action error is deliberately not that — it leaves the diff on screen and reports in the
sub-header only. Note that a WIP view cannot be made to show this by hand: `App` closes the file
view as soon as its path leaves the status list.

### Detail panel

Staging view (operation banner with Abort, Conflicted / Unstaged / Staged groups, commit form with
amend and the 72-character counter) or commit view (sha, refs, message, author, parent links, file
list). Every file row's context menu comes from `fileMenuItems`, whose Discard uses
`discardFileConfirm` — the same wording the row's `✕` button uses. An action that does not apply is
**absent rather than disabled**; Discard is offered only in the unstaged group; and **both shell
actions are disabled together on a row whose file is not in the working tree**, because
`repoFile()` refuses a path that is not on disk and neither could do anything but fail. **A
commit's file row also offers "Restore file from this commit"** (GC-107), the one action in that
menu that reaches a version of the file other than the working tree's: it is
`git checkout <sha> -- <path>`, which overwrites the working-tree copy **and stages it**, so it
asks first and the confirmation says so, and it is absent on a file the commit deleted. The three
"Ignore …" rows are offered on an **untracked** row only (GC-093) — a tracked file is in the index,
where `.gitignore` has no say — and their hints are bare paths, because `.ctx-hint.path` ellipsises
by turning the box RTL and a `/` at either end is reordered to the other one.

### Preferences and remembered state

`prefs.ts` is the single home for user settings: a typed `Prefs` with `DEFAULT_PREFS`, persisted as
one JSON blob under `gitclient.prefs`, read with `usePrefs()` and written with `setPrefs(patch)`.
`load()` validates each field and falls back to the default, so a hand-edited blob cannot break the
app. Settings: `avatars`, `pullMode`, `confirmDirtyCheckout`, `commitColumnGuide`, `theme`, `diffView`
and `graphColumns` — the one nested value, so `load()` falls back per column and a `defaults()` helper
copies it, a bare spread having shared the nested object. Adding a setting means: a field with a
default in `prefs.ts`, validation in `load()`, a row in `components/Preferences.tsx`, and reading
it with `usePrefs()`. There is no OK/Cancel; every change applies immediately.

**`theme` is `dark` | `light` | `system`, and `prefs.ts` resolves `system` itself** with `matchMedia`
rather than leaving it to a media query (GC-013): there has to be one answer to which theme is
showing, because the renderer hands it to the main process over `window:theme` to repaint the OS
window controls — the one part of the frame CSS cannot reach. `applyTheme()` stamps `data-theme` on
the document element on load, on every `setPrefs` and when the OS setting changes; it is guarded on
`document` because a node-environment test imports this module.

Remembered **state** deliberately stays on its own keys, never in the blob:

| Key | Holds |
| --- | --- |
| `gitclient.lastRepo` | the repository to reopen |
| `gitclient.recentRepos` | ten absolute paths, newest first, deduplicated on the normalised path |
| `gitclient.refColW` | ref column width in px (100–400, default 150) |
| `gitclient.leftPanelW` | left panel width in px (160–420, default 220) |
| `gitclient.detailPanelW` | detail panel width in px (300–720, default 400) |
| `gitclient.pinned.<repoPath>` | the branch pinned to the graph's left column |
| `gitclient.hidden.<repoPath>` | full names of the refs kept out of the graph |

Both side panels drag from a 4px `.panel-resize` handle on their own edge, absolutely positioned so
nothing reflows during the drag; `App` writes the widths as `--left-panel-w` / `--detail-panel-w`
on the app root and `tokens.css` keeps only the defaults. What it writes is `fitPanels`' answer, not
the stored number (GC-105, see the UI layer): the two keys keep what the user chose and the applied
value is what gives way on a narrow window. Double-clicking a handle resets it and removes its key.
While a file view is open the left panel is the icon rail and its handle is not shown; the detail
panel's handle keeps working.

Avatars are gated inside `useGravatar` itself, the one place `ui/Avatar.tsx` and the graph's
`NodeAvatar` both go through, so switching them off makes no request. Gravatar is the renderer's
one network call (SHA-256 of the lowercased email, `d=404`); failures are cached.

### Styling

`tokens.css` defines everything: Open Sans, 14px/20px base, 12px rows, the grey ramp
(`--bg-app #1c1e23`, titlebar `#2a2d34`, toolbar `#33373f`, panel `#272a31`, raised `#32363f`,
menu `#3d424d`), text as white alphas (.75/.6/.4), accent `#4d88ff`, semantic colours, ten lane
colours and the layout metrics. `app.css` is one file with a section per component.

**Every colour lives in `tokens.css`, none in `app.css`** (GC-013): `:root` is the dark palette and
`:root[data-theme='light']` redefines the same names for the light one, so a new colour is a token
or it does not flip with the theme. The nine `rgba()` literals `app.css` used to carry became
`--head-row`, `--match-row`, `--banner-bg`, `--hover-overlay`, `--backdrop`, `--accent-strong`,
`--success-strong` and `--diff-gutter`; `grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` must keep
printing nothing.

- **The form controls are the app's own too** (GC-101, GC-125). `input[type='checkbox']` and
  `input[type='radio']` are each styled once, globally, by type rather than by a class — there is
  no second look for either to have: `appearance: none`, a `--control-box` (14px) box on
  `--bg-raised` (square with a drawn tick, round with a drawn dot), `--accent` when checked, and a
  focus ring, since the global `input` rule's `outline: none` would otherwise leave a focused one
  indistinguishable. Neither mark is an icon or a background image: an `::after` cannot hold a
  component and an SVG would put a colour back in `app.css`. `.pref-select` is `appearance: none`
  with `font: inherit` and the app's own `ChevronDown`; the popup list it opens is still the OS's.
  A component rule written against a bare `input` therefore has to exclude both —
  `.commit-form input:not([type='checkbox']):not([type='radio'])` is the only one, and its 8px
  padding had floored the Amend box at 18px under `box-sizing: border-box`.
- **One global `::-webkit-scrollbar` rule set** near the top: 8px, a flat thumb at a 4px radius,
  transparent track and corner, no buttons. Every scroll container gets it with no per-component
  rule. Do **not** also set the standard `scrollbar-width` or `scrollbar-color`: either makes
  Chromium ignore the `::-webkit-` rules, and neither can remove the arrow buttons.
- The app grid uses `grid-template-columns: minmax(0, 1fr)` and `.main` has `min-width: 0;
  overflow: hidden`, or nowrap commit messages grow the frame past the window.
- Section headers are uppercase via CSS, so tests must compare `textContent` lowercased.

## Testing

### Unit tests

`npm test` (vitest 5, `vitest.config.ts`). Tests live next to the module they cover and **the file
extension picks the environment**: `node` runs `src/**/*.test.ts` and `tools/**/*.test.ts`, `dom`
runs `src/**/*.test.tsx` with `@vitejs/plugin-react`. Name a new test `.ts` unless it needs a DOM.
A project config does not inherit the root `resolve`, so both share one hoisted alias map.

Conventions a new test must follow:

- **No vitest globals**: import `describe`, `it` and `expect` from `vitest`. Because of that,
  `@testing-library/react` cannot register its own hooks, so a component test wires `cleanup()`
  into `afterEach` and `IS_REACT_ACT_ENVIRONMENT` into `beforeAll` itself.
- A component test also stubs `ResizeObserver` (jsdom has none), sets `avatars: false` to keep the
  render clear of `crypto.subtle` and gravatar, restores `DEFAULT_PREFS` and clears `localStorage`
  in `afterEach`, and fires hover as `mouseOver` — React synthesises `onMouseEnter` from the
  delegated `mouseover`, so a non-bubbling `mouseenter` never reaches the handler.
- It must **not** call `vi.resetModules()` when React Testing Library is imported statically: a
  re-import hands the component a second React instance and every hook throws. Only
  `prefs.test.ts`, which renders nothing, re-imports (its `load()` runs at import time).
- Both tsconfigs include the tests, so `npm run typecheck` covers them. The `.test.ts` in the
  `tools/**` include is deliberate: every other script there is `.mjs`, so `tools/e2e/run.mjs` can
  never be swept into the suite or the typecheck.
- `watch.test.ts` needs no Electron and no build; `npx esbuild --loader=ts --format=esm <
  src/main/watch.ts` shows the one runtime import it has.

184 tests today, one file per module covered. Two are not about the app: `tools/repo-hygiene` fails
on any C0 control byte that is not TAB or LF (CR included) across `src/`, `tools/` and the root
markdown — it is what guards rule 6 above — and `tools/launch-app` covers the attach path against a
fake CDP endpoint.

### The e2e suite

`npm run e2e:setup && npm run e2e`, after a build. `run.mjs` launches through
`tools/launch-app.mjs`, so the whole suite is stealthy, and drives the built app over CDP,
asserting against git after each step. 34 steps, 206 assertions, ~32s. It ends with
`total: 32.5s | git: 319 calls, 8.4s` — the run's own clock (GC-080) beside the cost of its own
verification (GC-081), counted and timed in `gitRun`, which every spawn in the file goes through.
A change that makes the suite slower is then a number, not an impression; the git half spawns a
fresh `git.exe` per call on Windows, so it is worth watching. `GIT_OPTIONAL_LOCKS=0` is set on
those spawns so the suite's own `git status` does not rewrite the index the app's watcher is
looking at. **The run stops its own
Electron on every exit path**: `stopOnce()` is registered on `process.on('exit')` as soon as
`launchApp` resolves, and SIGINT/SIGTERM exit explicitly so they reach it, so a throw, a CDP timeout
or a Ctrl+C no longer leaves a windowless app running until some later run frees the port (GC-040).

The fixture (`setup-testrepo.mjs`) has a merge, two tags, five branches, a commit that deletes a
file, a bare `origin`, a **second bare repository `remote2.git`, empty and not added as a remote**
(GC-056: step 17 adds it through the UI, and with both remotes pointing at one repository every
per-remote assertion passed whichever one the push had reached), a git note — a ref outside
heads/remotes/tags, so the suite can tell that the graph never draws one (GC-095) — and a mixed
working tree covering every staging state. **`main`'s tip carries seven refs** (GC-055): the
checked-out branch, a tracking local, a non-tracking local with a remote of its own, and a tag, so
the ref column folds to one chip plus `+4` and the fold has coverage at all — before it, nothing in
the fixture carried more than two chips and GC-020 and GC-023 both built the state by hand. It records the branch
tips in `<root>/.e2e-baseline.json` — a **file**, not a ref namespace, because `git log --all`
means every ref under `refs/` and a baseline ref kept a hidden branch's commits in the graph — and
writes `<root>/.e2e-owner.json` with its pid, refusing to wipe a root whose marker belongs to a
live process unless `--force` is passed (a marker over 30 minutes old is stale whatever its pid
says). What each step covers is its own `step(n, …)` title; read those rather than a second list
here. Rules a new step must respect:

- **Every git call goes through `git()`, which throws** (GC-098): it names the command and carries
  git's stderr, so a broken fixture stops the run where it happened instead of surfacing steps later
  as a row that never appeared. `gitMay()` is the explicit opt-out, for the commands whose failure is
  the normal case (the prologue's `--abort`s and deletes) and for the two that use git's exit code as
  their answer — `check-ignore`, and step 29's drift scan, which must report a missing branch rather
  than crash on it. `.git/index.lock` is retried five times at 200ms first, because the collision is
  with the app's own watcher refresh. A throw is caught by `bail`, which stops the run's Electron.
- **Wait on the DOM, never on a fixed sleep.** `waitFor(expression, what, max)` polls the renderer
  every 50ms. Four `sleep` calls are left, each commented with what is unobservable there — the
  newest being the frame after a viewport override, because `ContextMenu` closes on `resize` and
  the override's own resize event arrives after `window.innerHeight` has already changed (GC-126).
- **A wait that a click follows must prove the control is live, not just that the content is right**
  (GC-130). `waitDiff` and `waitSplitDiff` carry `LIVE_DIFF`, which refuses a `.diff-body.stale` —
  `DiffView` disables every hunk button while a reload it has not confirmed is in flight, and the
  watcher raises that 300ms behind the previous step's index write, so the very same hunks sit on
  screen with nothing on them clickable. `hunkAction` then polls its own atomic find-check-click
  rather than returning `DISABLED` into a `log()` that asserts nothing: a helper that gives up in
  silence turns into a wait failing five seconds later, somewhere unrelated.
- **`act()` covers one `run()`, not two.** A menu action that runs a second one after the first —
  a branch delete that also deletes the copy on its remote (GC-112) — satisfies `act` on the first
  reload while the second is still going. `waitGitFor` polls the git side, which is where that
  second call is the only thing observable.
- **A key that must activate a control carries its `text`** (GC-126). `Input.dispatchKeyEvent` with
  no `text` is a raw key event: React handlers read it (`ctrlEnter` wants exactly that) but the
  focused button's own default action never runs. `enterKey` sends `text: '\r'` on the keyDown and
  **no** following `char` event, which would activate the button a second time.
- **Every git action goes through `act(fn)`**, which reads `data-gen` off the status bar, performs
  the action and waits for that counter to have moved **and** the spinner to be gone. Both, because
  either alone is satisfiable by the wrong moment.
- `contextMenuOn` waits for the previous menu to be **gone** first: a synthetic `contextmenu` fires
  no `mousedown`, so it does not dismiss a menu still up.
- **The run is re-entrant and puts the fixture back.** The prologue aborts in-progress operations,
  removes what a run creates, restores the tracked file the checkout-guard step edits, and pops back
  both stashes a dead run could strand — popped, not dropped, because they hold the working tree
  later steps assert against. `restoreFixture()` runs there and again as the last step, which then
  asserts the fixture matches its baseline and names the drift. It matches commits by **subject**: a
  commit added by hand is not the run's to remove, and leaving it is what makes that step fail
  loudly instead of silently healing drift it exists to report.
- A step that changes the repository puts it back itself, with `git reset --soft` and never
  `--hard`: the index holds the fixture's own staged changes.
- Step 1 clears `gitclient.prefs` and every `gitclient.hidden.*` key, because the per-port profile
  persists between runs.
- Screenshots land in `<root>/shots/`, whose directory is created on demand. A fixture that
  predates the current baseline format, or a missing or invalid `testrepo`, exits 2 with the
  `npm run e2e:setup` message.

## Working conventions

- In this Windows + Git Bash environment, long `bash -c` scripts with nested quotes and heredocs
  fail in ways that are hard to see. Prefer the Write tool for files and Node scripts for
  multi-line edits, and keep shell one-liners simple. `\n` inside a heredoc can reach Node as a real
  newline; use `String.fromCharCode(10)` when it matters.
- After UI changes: `npm run typecheck && npm run build`, relaunch, take a CDP screenshot and
  **look at it**. Ricardo reviews visuals closely against GitKraken (lane continuity, chip
  behaviour, icon quality) and compares side by side.
- Verify claims with git (`git status --short`, `rev-parse`, `stash list`) rather than the UI alone.
- `innerText` reflects CSS `text-transform`; use `textContent` when matching labels in scripts.
- Run every git command in an unattended session with `GIT_TERMINAL_PROMPT=0` and
  `GCM_INTERACTIVE=never`. If a push is rejected for authentication, leave the commits local and
  report it; do not retry.

## The GitKraken study

`docs/reference/gitkraken/README.md` indexes it and records what each screenshot really shows,
including the two that are unusable. `01-layout.md` has the measured layout, `02-design-tokens.md`
the colours and sizes, `03-graph.md` the ordering and lane rules verified against git, and
`04-panels.md`, `05-menus-shortcuts.md`, `06-feature-inventory.md` the rest.

To repeat it: quit GitKraken, relaunch
`%LOCALAPPDATA%\gitkraken\app-<version>\gitkraken.exe --remote-debugging-port=9222`, then use
`tools/gk-recon/cdp.mjs` (`targets`, `eval`, `shot`, `css`, `click`, `clicksel`, `hoversel`,
`type`, `key`) and the `evals/` scripts. Synthetic CDP input drives React fine but does **not** open
GitKraken's native menus; the PowerShell helpers that would are for a hands-on session only and
must never run unattended.

## The backlog

**`TICKETS.md` is the backlog and the roadmap.** Every startable piece of work is a ticket `GC-0NN`
with one status (`todo`, `in-progress`, `done`, `blocked`), scope, acceptance criteria, files and
verification steps, and its log is where that ticket's history lives. Its "Routine protocol" is what
a scheduled session follows; the hourly backlog reviewer adds tickets and writes `GR-0NN` reviews
in the Reviews section. Do not keep a second roadmap here: when a ticket ships, update the ticket,
and this file only where a convention, a command or an invariant above changed.

Design decisions that must not be quietly undone, and where each is explained above: date order in
the log, column 0 for HEAD, no early forking, right-angle joins, one ref chip (Graph); one Escape
one layer, a drop that opens no empty menu and checks out the branch it acts on, one shortcut
table, every confirmation on the modal and an option on one carried by `confirmWithOption` rather
than by a prompt with its input switched off, the busy token every writer of `busy` takes (App state,
UI layer); the centre keeping `MIN_GRAPH_W` while the panels give way, the
message column keeping `MIN_MSG_W` while the ref column gives way, the optional columns giving way
after it, and only the applied widths ever clamped — on the drag path as well as the resize one, a
drag starting from the drawn width and ending on the last width the pointer reached (UI layer); a page continuing the previous range's `LaneState`,
and only a strict extension counted as one (Graph); every modal `h3` + `.modal-body` +
`.modal-buttons`, with only the body scrolling, and a context menu capped and scrolling the same way
(UI layer); one toolbar popover open at a time because there is one value for which,
every checkbox and every radio styled once by type (UI layer); `--index` on
stash apply and pop, `defaultRemote` shared both ways, a remote tag delete fully qualified (Main process); the diff keyed to its view
identity, the split layout a render of what is already loaded, a hunk patch built from
`hunk.raw` whichever layout is showing, and both layouts marking intra-line changes from one map
(Diff); the hidden set applied to a path's first load
(Graph); the lane colours interleaved rather than ramped (Graph); every colour a token, the
theme resolved in `prefs.ts` (Styling, Preferences); a failing e2e git call throwing, its Electron
stopped on every exit path, and a wait before a click proving the control is live rather than only
the content right (Testing);
stealth launches, narrow stops, the per-port profile (Commands); the LF working copy, control
characters as escapes, study-never-copy, no writes against the real repositories (The rules).

Memory for this project lives in the Claude memory directory (`gitclient-project.md`) and points
here. `README.md` is the public-facing overview with the same commands and dependency notes.
