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
npm test               # vitest run --reporter=dot: the unit tests, once, a dot per test

npm run test:watch     # vitest in watch mode
npm run e2e:setup      # (re)creates the scratch repo under %TEMP%/gitclient-e2e (or $GITCLIENT_E2E_ROOT)
npm run e2e            # drives the BUILT app through the UI, asserts against git, exits 1 on failure
node tools/backlog.mjs # locked / eligible / nothing eligible: what the routine asks before it reads anything

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

**Stopping the app is automatic** (GC-154): the app a `launchApp` spawns belongs to the process
that spawned it — `ownChild` registers an `exit` handler plus SIGINT/SIGTERM — and is stopped
however that process ends, so a driver that throws where `await app.stop()` should have been leaves
nothing holding the port for the next launch to attach to and measure a stale build. `stop()` stops
it now and `release()` hands it over, and both take the handlers off; the CLI calls `release()`
before it exits, because that command exists to leave an app running, and the `--keep-running`
attach path spawns nothing and so owns nothing. `stopApp(child)` stops one from a
child handle, and `stopPort(port)` stops the one process listening on a DevTools port. By hand:
`netstat -ano -p tcp | grep 9333`, then `taskkill //F //T //PID <pid>`.

**And a stop asks before it kills** (GC-162). Chromium commits `localStorage` on a timer, so
`taskkill /F` loses whatever the page wrote in the last second or so — silently, because the page
reads its own in-memory copy back, which is how three seeded keys were measured missing from the
next launch while the driver that wrote them saw them fine. `stop()` and `stopPort()` therefore
call `requestClose(port)` — the DevTools `/json/close/<target>` endpoint, so closing the window is
what quits the app — and wait a bounded `GRACEFUL_STOP_MS` for the process to go; the kill runs
unconditionally afterwards, so GC-154's promise is untouched by a graceful path that hangs. A
driver that seeds a `gitclient.*` key and relaunches on the same port to assert it came back needs
that. `stopNow()` is the immediate kill, which is what `tools/e2e/run.mjs` takes: an `exit` handler
cannot await, and the suite rewrites every key it depends on in step 1 anyway (GC-160).
`tools/e2e/foreground.ps1` proves a launch was invisible by printing the foreground window handle
and every top-level window an `electron` process owns — `Get-Process electron | MainWindowTitle` is
useless, a frameless window reports an empty title even on screen.

## Architecture

`src/main/` is `index.ts` (the window), `git.ts`, `ipc.ts` and `watch.ts`; `src/preload/` is the
contextBridge; `src/shared/` holds `types.ts` and `remotes.ts`; `src/renderer/src/` holds
`App.tsx`, `components/`, `graph/`, `diff/`, `ui/`, `prefs.ts`, `shortcuts.ts`, `tabs.ts`, `time.ts` and
`styles/` (`tokens.css` plus `app.css`, one file for every component). Outside `src/`: `docs/screenshots/`
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
- **`stashRename` drops `index + 1`, not `index`** (GC-129). git has no command for editing a
  stash's message, so it is `git stash store -m <new> <sha>` and then a drop of the old entry —
  and `store` **prepends** a reflog entry, so every stash already in the list has shifted down one
  by the time the drop runs. Dropping `index` takes the neighbour that moved into it and leaves
  both messages standing. The sha is read first, because the drop is what makes it unreachable,
  and the drop only runs once the store has resolved, or a failure loses the stash outright. The
  re-stored entry lands at `stash@{0}`, which is why the dialog says the stash moves to the top.
  It is `stashRenameWith(run, index, message)` with `stashRename` bound to a repository, the shape
  `restoreStashWith` already had, so the arithmetic that silently destroys a stash when it is wrong
  is four unit tests rather than only a 45-second e2e step (GC-167).
- **`pull(cwd, mode, remote?)` names the branch whenever it names a remote** (GC-057): `git pull
  <remote>` with no refspec still merges `branch.<name>.merge`, which is the upstream the caller
  asked to bypass, so a named remote becomes `git pull <flag> <remote> <branch>`.
- **A push with no remote named uses `defaultRemote(remotes)`** (`origin`, else the first remote).
  Every menu row that offers one therefore **names the remote, never an upstream ref** (GC-114):
  the push writes `<remote>/<branch>`, so a row naming `r.upstream` promised a different ref the
  moment the upstream's branch name was not the local name.
  `src/shared/` is the only place code is shared both ways, so a menu label cannot promise a
  different remote from the one the push uses.

- **A local branch's delete can take its remote copy with it** (GC-112). `remoteCopyOf` answers
  where else the branch lives — its upstream first, then a remote-tracking ref of the same name,
  and only ever one the snapshot lists — and the confirmation carries a checkbox for it. It is a
  pure function in `shared/remotes.ts` beside `defaultRemote`, under `remotes.test.ts`, and
  `App.tsx` keeps only a `copyOf` callback passing the snapshot in (GC-134). The split is at the
  remote's name rather than the first slash because a **branch** name may carry slashes; git makes
  the nested-*remote* case unreachable, refusing `origin/fork` beside `origin` in both directions. The local delete runs first and the remote one only if it succeeded; the remote half goes
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
resolved **and remembers it**, and `TITLE_BAR_OVERLAY` with it lives in `ipc.ts` rather than
`index.ts` because `index.ts` already imports `registerIpc` and the other direction would be a
cycle (GC-013). Remembering is what lets `createWindow` build the window in the right theme at all
(GC-102): the setting lives in the renderer's `localStorage`, which does not exist yet, so the main
process keeps its own copy in `window-theme.json` under the profile's `userData` — per Electron
profile, so a launcher run cannot change what Ricardo's own window opens as (GC-060) — and
`rememberedTheme()` feeds both `WINDOW_BACKGROUND` and `TITLE_BAR_OVERLAY` where two dark literals
used to sit. Nothing remembered still means dark. Adding an API means: type in
`shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in `preload/index.ts`.
`remote:cancel` is the only handler besides `repo:checkGit` that takes no arguments at all: what
it stops is a process, not something inside a repository (GC-169). `shell:*` is the group that
never touches git: its two handlers live in `ipc.ts` itself, go through
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

**And one repository at a time out of several: the tabs** (GC-016). `tabs.ts` is what a tab *is* —
an `id` and a `path` — plus the three pure answers the bar needs: the stored list read back, which
tab is left showing when one is closed, and which one Ctrl+Tab moves to. `App` holds `tabs` and
`activeId`, and a `parked` Map keyed by **tab id** holding the `TabState` each tab that is not
showing was left with: snapshot, selection, file view, hidden set, `paged`, `hasMore`, the find
bar and the graph's scroll offset. It is keyed by id rather than by path because the path changes
under it the moment git answers with its canonical form.

- **A switch is one commit, then a refresh.** `showTab` puts the parked state back in a single
  render — no frame is painted between the two repositories, which is what preserves the scroll
  position — bumps `dataGen` like any other reload, and then calls `reloadSnapshot(path)`
  underneath, because the watcher only ever followed the tab that was showing and what this one
  kept may be minutes old. `reloadSnapshot` is the extracted body of `applyChange`'s `refs`
  branch and is shared with it: both are refreshes nobody asked for, so neither may take
  `load()`'s failure path, which clears the open repository (GC-025).
- **`repoPath` is not the tab's path.** The tab is showing the moment it is clicked; `repoPath` is
  still the previous repository until git answers, and stays null if the load fails. So
  `gitclient.lastRepo` follows the **active tab's** path, while the effect that adopts git's
  canonical spelling only fires when the two are the same repository under `normRepoPath` — without
  that guard a tab shown before its first load took the previous tab's path and kept it when its
  own load failed.
- **The staging form's draft is `App` state and part of `TabState`** (GC-148) — summary, body and
  the amend flag — for the reason GC-030 lifted the find bar's query out of `CommitGraph`: the
  panel unmounts behind a file view and on every tab switch, so the user's own typing cannot live
  in it. GC-016's two promises are kept explicitly rather than by the panel's key: `openIn` clears
  the draft, which is the one path a repository takes into the showing tab, and a successful commit
  still clears the form.
- **The graph and the detail panel are keyed by repository**, so the state they keep for themselves
  — the find bar's author chip, the lane-layout cache, the commit message being written — belongs
  to the tab it was made in. The two keys are **prefixed** (`graph-`, `detail-`) because they are
  siblings: two siblings under one key is not a swap, and React left both graphs on screen at once.
- **A tab may hold no repository, and that is what `+` makes** (GC-163). `Tab.path` is
  `string | null`; `storedPaths(tabs)` is what `gitclient.tabs` is written from, so an empty tab is
  never remembered, and `showEmpty()` — extracted from `closeTab`'s last-tab branch — is its
  content: the empty state, now a tab's page rather than only the whole window's. `+` (and Ctrl+T)
  appends one, parks the showing tab and selects it, and opens no dialog; the bar draws it as a real
  tab labelled "New Tab", with its close button and middle-click, and with no tabs at all draws
  nothing — the inert placeholder that used to stand there was not a tab. Giving it a repository
  fills **that** tab, which is `openPath`'s existing `activeId !== null` path.
- **A recents row opens a tab; the folder button and "Open repository…" replace one** (GC-164).
  Both surfaces that draw the list — `openRepoMenu`, which the title-bar chevron and the branch
  breadcrumb share, and the empty state's `.recent-row` buttons — go through `openRecent`, which is
  `openNewTab` unless the showing tab holds nothing, in which case it fills it in place. `openPath`
  rewrote the active tab's path, so a second repository silently replaced the first and dropped
  everything it had parked. Either way a repository already in the bar takes the user to its tab
  rather than opening a second copy of it. Closing a tab falls to its right neighbour, then its
  left, then the empty state. The graph's scroll offset reaches `App` as a ref (`graphTop`)
  reported by `CommitGraph`, so a wheel event re-renders nothing.
- **And because scrolling re-renders nothing, the offset is read at park time, not from the
  mirror** (GC-172). `live.current` is rebuilt on every render, so its copy of `graphTop` is only
  as fresh as the last one, and a tab scrolled and then switched away from was parked at the offset
  it had *before* the user scrolled. `park()` is `{ ...live.current, graphTop: graphTop.current }`
  and every one of the three sites that parks a tab goes through it. The other half of GC-016's
  promise is in `CommitGraph`: `shouldRevealSelection` gates the "keep the selected row visible"
  pass on the selection having **changed**, so a reload, a page append or the refresh a tab switch
  runs underneath no longer re-runs it — with the working-directory row selected, which is what a
  repository opens on, that row is 0 and any of the three pulled the graph back to the top. The
  restore marks the parked selection as already revealed, and the pass still does what it is for:
  a selection made off-screen is scrolled into view.

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
  prompt names the number of files actually at risk. **That count, and the sequencer's below, come
  from `statusRef`, not from the closure's `snapshot`** (GC-124): the ref mirrors
  `snapshot?.status` on every render the way `live` does, because `runOnBranch` awaits a checkout
  before the sequencer's guard runs, and a guard that measures the tree from before it would offer
  to stash nothing and then pop an unrelated stash.
- **Cherry-pick, revert, merge and rebase go through `runSequencer(what, label, action)`** (GC-090),
  the same shape one step further on: git refuses all four outright while anything is staged, so the
  guard asks first, naming the staged count, and offers Cancel or "Stash and continue" — never
  "continue anyway", which git would only refuse. That stash carries **no `-u`** (GC-097), unlike the
  checkout guard it was copied from: what git refuses these four for is the index, and it carries
  untracked files through all of them untouched, so the message says as much in the same sentence. On failure the stash goes back **unless git
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
- **The status bar has two severities, and an error wins** (GC-091). `notice` sits beside `error`
  in `App` and reaches `StatusBar` as a `.notice` in `--warning` with the same dismiss button;
  `run()` clears both on entry and sets at most one on the way out, so they are never both up. What
  routes a failure to the quieter one is `GitError.advisory`, which `git.ts` sets on GC-082's stash
  fallback — an action that did most of what was asked. **The flag rides on the error's `name`**:
  Electron serialises a rejected handler down to a string, so a property of its own never crosses,
  and `ADVISORY` (`GitAdvisory`, in `shared/types.ts`) is the one word both processes agree on —
  the same name `msg()` already had to strip off the front. A new advisory outcome means passing
  `true` as `GitError`'s fifth argument and nothing else.
- **A credential refusal is a failure with more to say than a status bar can hold** (GC-169), and
  it rides on the name the same way: `AUTH_FAILURE` (`GitAuthError`), `GitError`'s sixth argument,
  which `msg()` strips like the other two. The message under it is a summary line naming the remote
  and its URL followed by **the whole of what git wrote**, because `headline()` picks the `fatal:`
  line and that is the one saying 403 and nothing else — the `remote:` lines telling the user to
  re-authorise are what a one-line bar was dropping. `App` splits the two at the first newline:
  the summary goes in the bar and `AuthErrorDialog` gets the rest, opening straight away and again
  whenever the summary is clicked (`onErrorDetails`, which is set only for this kind, so an
  ordinary error's line still dismisses on a click). `authFailure` is cleared by the next `run()`,
  so the bar can never offer to reopen a dialog about something else.
- **Only the commands that reach a remote may ask for a credential** (GC-169). `RunOptions.prompt`
  is what `runGit` reads for `GIT_TERMINAL_PROMPT`, and only `runRemote` sets it: everything else
  keeps `'0'`, because an unattended `git status` must never sit on a prompt. Such a child is
  registered for `cancelRemote()` and given two minutes, since a helper's window waits for a
  person; `run(label, fn, { remote: true })` is what puts Cancel on the busy line, and a cancelled
  command reports as an advisory notice rather than as a failure. **Which functions reach
  `runRemote` is a test, not a convention** (GC-176): `fetch`, `remoteAdd`, `pull`, `push`,
  `deleteRemoteBranch` and `deleteRemoteTag` — five commands, the last two being pushes that GC-169
  missed and that reported one ellipsised `403` until they were wired up. `git.test.ts` reads
  `git.ts` for every function calling it and names the six, so a seventh cannot join them silently.
- Menus come from `commitMenuItems`, `refMenuItems`, `stashMenuItems`, `wipMenuItems`,
  `remoteMenuItems` and `fileMenuItems`; `tipCommitActions(sha)` is the shared source for the
  commit actions the branch and commit menus both carry, so their wording cannot drift — and
  `commitMenuItems` now **composes** it rather than keeping its own copy of the five, which is what
  made GC-074's reset group changeable in one place. That group says its target once, in a
  `caption` row (`Reset <branch> to <sha>`) over `Soft` / `Mixed` / `Hard`: repeating it on every
  row put the middle one 7px past the menu's 420px cap, and whichever of the label and the hint was
  allowed to win, the other was the one cut.

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

**Whether a binding fires from inside a text field is the table's answer too** (GC-033): the window
handler's `hit(id)` is `matches(id, e) && (firesWhileTyping(id) || !isEditable(e.target))`, so
`Shortcut.whileTyping` — carried since GC-010 and read by nothing — is what decides it, rather than
one `isEditable` check placed halfway down the ladder. Ctrl+F and Ctrl+Shift+M are the two that
carry it: both are how a field is *reached*. The body-scope bindings are Ctrl+B (branch at HEAD),
Ctrl+L (fetch), Ctrl+J / Ctrl+K (the two panels), Ctrl+Alt+F (the ref filter), Ctrl+Shift+S /
Ctrl+Shift+U (stage and unstage all), Ctrl+Shift+M and Ctrl+T / Ctrl+Tab / Ctrl+Shift+Tab (the
repository tabs, GC-016, GC-163); the four that run git follow the toolbar's own disabled states.
Ctrl+K's `detailCollapsed` hides the detail panel outright, and what brings it back is `select()`
or the 16px `.detail-reveal` strip standing where the panel was (GC-136) — a strip rather than a
toolbar button, so it is absent exactly while the panel is showing, which is the left panel's rail
answered for the one panel that has no icons to keep. The two focus bindings reach their field through a **tick** prop
(`focusFilter`, `focusSummary`) rather than a boolean, the shape `searchTick` already used, so
asking twice focuses twice. A hidden detail panel goes into `fitPanels` as a zero-width panel with
a zero floor, exactly as the collapsed left rail does.

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
- **A dialog may ask for several things at once** (GC-026): `PromptOptions.fields` is a list of
  `PromptField`s and `PromptResult.values` answers them keyed by name, each input carrying its
  `name` so a driver fills one by name rather than by position. OK waits for **every** field that
  did not say `required: false`. `promptFields(options)` is the one place the two forms meet and
  is pure: no `fields` means one field named `value` built from `label` / `defaultValue` /
  `placeholder` / `required`, and `input: false` means none at all — which is why `result.value`
  still answers every existing caller and a confirmation is still no body. "Add remote" is the
  first user: it asked for the name, waited for OK, then asked for the URL.
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
- **A menu whose rows are a list rather than a set of actions carries `filter: true`** (GC-096): one
  `.ctx-filter` input at the top, focused when the menu opens, and `filterMenuItems(items, query)` —
  pure and exported — is what the rows narrow by. A caption goes when its group empties, a separator
  when it divides nothing, and a query matching nothing says "No matches" rather than collapsing the
  menu to a bare field. The narrowing is `ContextMenu`'s own state, never the caller's: reopening
  the menu is what would move it and take the focus off the field. Enter takes the first row still
  standing, off `matches('dialogConfirm', e)` like the modal's input, so no key name is compared
  here either; Escape is still `App's`. The branch crumb is the one menu that has it.
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
  **`useDragScroll` in the same module scrolls a container while a drag is over its edges**
  (GC-122), spread onto `.graph-body`, without which a drag could only ever reach a chip already
  drawn. `dragover` sets a speed and one `requestAnimationFrame` loop does the scrolling, so the
  rate comes from the clock and not from how often the browser fires the event — a pointer held
  still at the edge would otherwise crawl or stop. `dragScrollSpeed` is the pure half and ramps
  with the distance into the band rather than switching on, so crossing the band's edge is not a
  lurch. Only a drag carrying `REF_DRAG_TYPE` scrolls anything, and a `dragleave` into one of the
  container's own children is not a leave — that event bubbles from every chip the pointer
  crosses, so `relatedTarget` decides.
  **What the two surfaces say about the gesture is keyed to `draggable`, not to a class** (GC-127):
  `cursor: grab` is `.ref-chip[draggable='true'], .ref-row[draggable='true']`, which is `attrs()`'
  own answer, so a tag chip and the synthetic HEAD chip keep `.graph-row`'s pointer instead of
  promising a drag they refuse. `.drop-over` is a 2px accent ring with a 2px `--accent-soft` halo
  on both surfaces: a chip's background is a lane-colour mix set inline and cannot be tinted from
  CSS, so the halo is what carries it, and a 1px ring on it was unreadable at 100%.

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

**What a ref chip is lives in `graph/RefChip.tsx`** (GC-087): `Chip`, `chipsFor` — the ordering and
the absorb-the-upstream rule — `HEAD_REF`, `headChipFor`, and the `RefChip` component itself, which
is the markup and nothing more. Two surfaces render it: the graph's ref column, which adds the lane
colour, the pin marker, the drag attributes and the `+N` fold, and the commit view's header, which
adds none of them. It is one module because the two draw the same refs on the same commit, and the
panel used to print git's `%D` decoration as text beside a graph drawing chips.

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

**And it opens for a drag too, which `:hover` never does** (GC-123). Chromium does not update
`:hover` while an HTML5 drag is in flight, so a folded ref could be neither picked up nor dropped
on — four of the seven refs on the fixture's `main`. `moreDrag` in `CommitGraph` holds the sha of
the row a drag is over, set from `dragover` when it carries `REF_DRAG_TYPE`, cleared when the
pointer leaves the cell for something outside it (`relatedTarget` decides, as `useDragScroll`
already has it) or when the ref in flight goes. It takes **both** halves of the hover state:
`.col-ref.more-drag` joins the rule that sets `display: flex` *and* the one that sets
`overflow: visible; z-index: 3`. The second is the load-bearing one — `.col-ref` is
`overflow: hidden`, so a block opened without it is cut to the row's 28px and shows one line.

**A stash is a row of its own, above the commit it was taken from** (GC-140, GC-170).
`getStashes` reads the first field of `%P` on the same `git stash list` walk, so `Stash.parent`
costs no extra spawn, and `stashesByParent` keys the stashes onto that commit. GC-140 drew them as
a 20x20 marker in the commit's ref cell, where the message — the only thing saying which stash it
is — was a tooltip and the 20px came out of the primary chip's name (GC-156); GitKraken's answer,
recorded in `03-graph.md` from Ricardo's capture, is a row, and it costs the ref column nothing.

**The rows are therefore no longer the commits one to one, and `displayRows` is what they are.**
It is pure and exported: the WIP row when there is one, then every commit with the stashes taken
from it immediately above it, newest first in `git stash list` order. Everything that counts rows
reads that list — the virtualiser, the scroll height, and `rowIndexOf`, which is now a `findIndex`
over it and has no offset left to get wrong (GC-141's bug by construction). `lanes.ts` never sees
a stash: the row borrows the lane of its parent, so the split-and-rejoin property is untouched.

`GraphCell` draws it from the parent's layout: a full-size dashed circle with the archive glyph,
the lane line running down into the tip, and every lane that passes the parent from above passing
this row too, so nothing appears to break where a stash is inserted. A row inside the WIP-to-HEAD
run carries the dash as well (`stashDashFor`, `wipDashFor`'s own rule asked of the parent), or
GC-144's "covers the whole distance" would fail at the one row a user is looking at. The message
column reads the stash's own message with git's `On <branch>: ` or `WIP on <branch>: ` prefix
stripped — `stashMessageText`, for display only, never in the `title` and never in what
`stashRename` stores. The row is selectable like a commit row, right-click gives `stashMenuItems`
and double-click applies, the same two gestures from the same source. A stash whose parent is
outside the loaded range is never looked up and draws nothing.

**The dashed WIP-to-HEAD run covers the whole distance, not the first 14px** (GC-144).
`wipDashFor` in `lanes.ts` answers what each row draws of it, and `headOwnsLane` is the load-bearing
part: while nothing else is pinned, `layoutGraph` reserves column 0 for HEAD from the first row, so
the line in it above HEAD's row **is** the run and `GraphCell` draws it dashed *in place of* the
solid one — the through segment is filtered out, and the node's own line above it dropped. Drawing
the dash on top instead is what made the run read as a solid line with a dash on it. A commit
reaching HEAD's tip from above cannot take that lane (the seed holds it), so it arrives as an
`incoming` curve and no real child's line is ever dashed. With another branch pinned, only a lane
nothing else uses may carry the run; with HEAD outside the loaded range the WIP node draws no stub
at all rather than a dash running off the bottom.

**At the narrow end of the ref column the name wins over the furniture** (GC-071): with less than
`CHIP_CLOUD_MIN` (79px) of room the primary chip drops its trailing upstream cloud, and the chip
inside the expanded `+N` block keeps it, not being bound by the column's width. With the cloud a
chip wants 71px; at the 100px minimum column it was given 59, which is where `main` rendered as
`ma…`. The cloud only repeats what the chip already says by absorbing its upstream, and the title
still says it in words, so the cloud is what gives way — the name is the identity of the ref.

**How much room that is, is `chipRoom(refColW, more)`, and it counts every sibling** (GC-156,
GC-170). GC-071 had it as the constant `width - 41` — the `+N` chip and the gaps either side —
which was every sibling in `.col-ref` until GC-140 put a stash marker there; the marker was 20px
plus a gap the arithmetic never saw, so above the threshold the cloud was kept and the *name* paid
for it, and at a fitted 134px column `main` was given 27px for a 29px string. The marker is a row
of its own now (GC-170) and the sum is back to the two siblings it started with, but the threshold
stays stated as the chip's **own** room rather than as the column's width, which is the part that
was right whatever is in the cell. `REF_COL_PAD`, `REF_COL_GAP`, `MORE_CHIP_W` and `REF_LINE_MIN`
mirror `app.css` the way `OPT_COL_W` mirrors the optional columns, and the function is pure and
exported so the measurement lives in a test. A new non-ref marker in that cell joins this sum,
rather than being paid for out of the name.

Chip order: HEAD, the pinned branch, tracking locals, other locals, remotes, tags — the pin ranks
second so its marker survives the fold. With **no branch checked out** a synthetic `HEAD` chip is
built in the renderer from `headSha`; `getRefs` and `GitRef` never see it, so it opens
`commitMenuItems` rather than the ref menu and ignores double-click.

Three optional columns — AUTHOR, DATE / TIME and SHA — come from `prefs.graphColumns`, off by
default, fixed at 140/150/80px with `flex: none` so the message column absorbs the remainder;
`OPT_COL_W` in `CommitGraph.tsx` mirrors those three widths, because `fitRefCol` has to know what
they take before it can leave the message its own minimum (GC-110). What the preference asks for is
not always what is drawn: `fitOptCols` runs first and `cols` is its answer, so every render site —
header, rows and `restW` — reads one set and they cannot disagree (GC-116). **Preferences reads it
too** (GC-117): `CommitGraph` hands the set up through `onDrawnCols`, so a row that is checked but
not drawn carries a `.pref-note` saying the window is why, rather than showing a setting that
appears to do nothing. It must stay that set and never a second reading of the width, or the
dialog and the graph can disagree; with a file view open there is no graph to have an answer and
the dialog is handed `null`, which claims nothing either way. In that column the
**summary wins**: the body preview sits in a `.body-wrap` with `flex: 1 1 0` and
`container-type: inline-size`, so it only gets space the summary did not need, and a
`@container (max-width: 40px)` rule drops it rather than leaving a lone ellipsis.

Commit search matches client-side on summary, body, author name, email and sha prefix. Matching
rows get `.match`, every other `.unmatched` (0.3 opacity) — GitKraken dims rather than hides, so
the graph stays continuous. The position in the results is derived from the current selection, not
from state of its own, and the bar's `{ open, tick, query }` lives in `App.tsx` because
`CommitGraph` unmounts whenever a file view opens; only `closeSearch` clears it.
**The author chip beside the field is the other half of the filter** (GC-027): `authorsOf` lists
the authors of the loaded commits, deduplicated on the lowercased email and most commits first, and
picking one narrows the matches to that author. Both halves must hold, and with a chip set the
term matches the message and the sha **only** — the author fields drop out of `commitMatches`,
because a name that also appears in messages is exactly what the plain field could not separate.
One state decides what is filtered at all (`filtering = needle !== '' || author !== null`): the
readout, the jump-to-first-match effect and the row classes all read it, so a chip on its own dims
the graph the way a query does. The chip lives in `App`'s `search` state beside the query
(GC-137), for the reason the query does (GC-030): this component unmounts whenever a file view
opens, and two halves of one filter must not have two lifetimes — the chip was silently cleared
while the query, the readout and the dimming all came back. `closeSearch` clears both and a tab is
parked with both. The ref column's
width is written as `--ref-col-w` on `.graph-panel` — `fitRefCol`'s answer, not the stored number
(GC-110, see the UI layer) — and its 4px `.col-resize` handle is absolutely positioned on the
column boundary so dragging reflows nothing.

**The left panel header says where HEAD is** (GC-094): the checked-out branch, or `detached HEAD`
with the short sha when `info.branch` is null — the wording the breadcrumb and the staging header
already use, so the three agree, and the panel is no longer silent in the one case no row in LOCAL
marks. It carries no number: the ref count it used to show repeated the section counts directly
beneath it and, one line above the status bar's "N commits", read as a commit count that disagreed
with it. What the graph is actually drawing is still visible per ref, on the eye of each hidden row.

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

**A single click on a ref row selects that ref's tip** (GC-141), in all three of LOCAL, REMOTE and
TAGS; double-click still checks out. It costs no git call — `GitRef.sha` is already the tip — and a
row whose sha is the selection takes `.ref-row.selected`, so the panel and the graph agree on what
is selected. Marked **by sha rather than by which row was clicked**, so selecting a commit in the
graph marks its rows here too and several refs on one commit all light up. `rowIndexOf` in
`CommitGraph.tsx` is the guard that makes an unloaded tip safe: it answers -1 **before** the WIP
row's offset is added, where `findIndex` + 1 used to turn "not found" into row 0 and scroll the
graph to the WIP row.

**The four sections share the panel's height, and each scrolls inside itself** (GC-153). The
column is not one scroll box: every section is a `.panel-section` whose `.section-head` is
`flex: none` and whose `.section-rows` scrolls, so a header — which is the section's count — can
never scroll away. On `catena-feed` (LOCAL 7, REMOTE 52, TAGS 283, STASHES 1) all four headers are
on screen at once, which is the whole ask: before this, TAGS and STASHES were not on screen at all.

`fitSections(stored, avail, min, natural)` in `useDragWidth.ts` is the share, and it is
`fitPanels` one axis over: only the **applied** heights are clamped, `gitclient.sectionHeights` is
never written over by a fit, and a closed section is its 30px header and takes no part (the way a
collapsed left rail goes into `fitPanels` as a zero-width panel). What a section asks for is the
height the user gave it, else what its rows measure, else an equal share of what the sized ones
leave; the column is then filled **level by level** — every section asking for no more than an
equal share of what remains gets exactly that, and the ones still asking for more split the rest,
repeatedly. That is what makes 52 remote branches behave: REMOTE alone gives up the space and the
other three keep their rows. `MIN_SECTION_H` (82px: a header and two rows) is the floor, because
a section squeezed to its header alone is present and useless; when even the floors do not fit
they all sit on one and the column scrolls.

Each section reports what its rows measure through `onNatural`, observed on the content rather
than on the scroll box — whose height is the answer being computed. **A drag moves a boundary, not
an edge**, so it is `useBoundaryDrag` rather than `useDragWidth`: a pair sharing a fixed total
rather than one size against one key. It is in the same module and the rule that decides where the
edge lands is `reachedWidth`, the same one, with the wall set at the pair's total less the other's
floor — so GC-111, GC-115 and GC-118 hold here without a second copy of them. A double-click drops
both stored heights, and the pair then splits what is left, which is an equal share without that
being a case of its own.

**Slash-separated names fold into folders in the left panel** (GC-051). `buildRefTree(refs, label)`
in `LeftPanel.tsx` is the pure half: `label` is the name **relative to the section**, so a remote
groups without its own segment — the remote's row is already the first level — and a folder's count
is the refs beneath it at any depth, never its sub-folders. A folder row is `.ref-row.folder`; every
row carries its own `--row-depth`, and `app.css` turns that into 16px of padding a level, so a name
with no slash renders exactly where it always did. The closed set is keyed `<section>/<folder path>`
and stores what is **closed**, so a folder that appears later starts open. A filter forces every
drawn folder open, which is sound because the tree is built from the matches alone. The section
counts still count refs, never folders.

**And that set is remembered per repository** (GC-139), on `gitclient.folded.<repoPath>` — state,
so its own key rather than the prefs blob, like the hidden set. Two things it has to get right.
It is **pruned against `folderKeys(refs, remotes)`**, the pure answer to which folders the snapshot
can produce, built from the ref names rather than from the trees, because a filter narrows the
trees and the whole snapshot is what decides whether a folder exists. And `LeftPanel` is **not**
keyed by repository, so the path the set was read for is held beside it and a switch is noticed
during render — the way `DiffView` derives rather than clearing from an effect (GC-075) — or one
frame is painted with the previous repository's folders.

**A stash row says how old it is** (GC-135). `Stash.date` had been on every snapshot since the list
existed and was drawn nowhere, while "how old is this" is the question a stash list is read for.
`relativeTime` renders it into a `.row-when` on the right edge of the row, the way a branch row's
ahead/behind sits, with the absolute form joining the message on the row's `title`. It is
`flex: none` at 39px, so the **message** is what ellipsises: the age is four or five characters and
the message is the part with room to give. That costs the message about 43px at the 220px default
panel; at 300px and above the name is back at its natural width.

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

**Lines are picked out of one hunk, and the two directions are not the same patch** (GC-121). A
changed line on the unstaged side takes `.pickable`; clicking takes it, clicking again drops it,
shift extends the run over the hunk's *changed* lines. The selection is `DiffView` state carrying
the `viewKey` it was made against and compared during render like everything else here, so a reload
of any kind takes it away rather than leaving a count describing lines that are gone; it lives in
one hunk, because a patch is built from one hunk's header. `buildLinePatch(file, hunk, selected,
{ reverse })` is the builder, and **which file the patch has to fit decides how the unselected
lines are written**: staging goes to the *index*, so an unselected removal becomes a context line
and an unselected addition is dropped; discarding is reversed onto the *working tree*, so it is the
mirror — the unselected addition is the context and the unselected removal is dropped. Built the
staging way and reversed, `git apply` refuses it, because the unselected additions sit in the file
with nothing in the patch accounting for them. With every changed line picked, either direction is
byte-for-byte `buildHunkPatch`'s output, which is what `parseDiff.test.ts` pins and what lets both
layouts share one selection: the split view clicks the cell and the unified the row, but they hold
the same `DiffLine` objects. The buttons say `Stage N lines` / `Discard N lines` while a hunk has a
selection and the whole-hunk wording otherwise. Line picking is off on the staged side — a partial
unstage is its own ticket — and off while `-w` is on, like every other patch button.

**Three controls in the header, and only one of them costs a reload** (GC-052). Previous / next
change scroll by **stop** — the `scrollTop` that would put a `.hunk-head` at the top of the body,
clamped to what the body can actually reach — rather than by a header's offset from the border box:
the body has top padding, so the first header is a few pixels down when nothing is scrolled and
read as being *below* the top, which sent the first Next click nowhere. Clamping is what makes the
wrap-around true at the bottom, where the last hunks all share one position. **Which stop is next
is `nextHunkStop(stops, at, dir)`, pure and exported** (GC-138), with `gotoHunk` keeping only the
measuring — the rects, the padding and the clamp: it is arithmetic, it got both of those answers
wrong before it was right, and a throwaway script was what caught them. Its test names each. **Wrap** is a class on
the body and nothing more, so it costs no reload and disables nothing; a hunk scrolls sideways
inside itself when it is off (it used to be `overflow: hidden`, which clipped a long line away with
nothing to say it was there). **Ignore whitespace** is the one that reaches git: `-w` on the diff
command, carried by `WorkdirDiffRequest.ignoreWhitespace` and the new `DiffOptions`. It belongs to
the load key and **not** to the identity, so the hunks on screen stay and dim while it reloads
(GC-086), and while it is on **every button built from `hunk.raw` is disabled and says why** — a
`-w` diff is not a patch `git apply` will take. Stage file, Discard changes and Unstage file go
through no patch and stay live. Both toggles are preferences, so the header and Preferences cannot
disagree.

**A load that fails says so in the body** (GC-083): `loadError` is a `current` whose `text` is null,
and it gets a fourth `.diff-empty` branch beside "Loading diff…", "No textual changes." and "Binary
file." An action error is deliberately not that — it leaves the diff on screen and reports in the
sub-header only. Note that a WIP view cannot be made to show this by hand: `App` closes the file
view as soon as its path leaves the status list.

### Detail panel

**One boundary treatment, listed once for both views** (GC-142). A block in `.detail-body` is
either a **card**, which carries its own border — the message box, a banner, an error — or a
**section**, separated from the block above it by a 1px rule and the body's own 12px: `.author`,
`.readout`, `.file-list` and `.commit-form`, with `:first-child` taking neither. A file list's
`.group-head` is a band rather than a second hairline, which is what makes Unstaged and Staged read
as two groups, and the commit view's file list carries the same head so a file list is one thing in
both views. `.author` is a three-column grid — avatar, identity, parents — so the parents list has
a place of its own and the authored date ellipsises rather than being wrapped into. **The middle
column carries a floor and the parents column is the one that gives way** (GC-157): with the
parents column `auto` it was sized to its content and never shrank, so the flexible middle absorbed
the whole shortfall and a two-parent commit clipped the date at the *default* 400px panel rather
than at the 300px minimum. It is now `minmax(min(60%, var(--author-when-w)), 1fr)` against
`minmax(0, auto)`, and `.parents` carries `max-width: 100%` — `justify-self: end` makes it
shrink-to-fit and `fit-content` floors at its own min-content whatever the track is, so without the
cap a 31px track still drew a 52px box that reached back over the date. `--author-when-w` (180px)
is a measured metric in `tokens.css`: the authored line wants 172px in the one format GC-133
settled, and the 60% is what lets the floor yield at the panel's minimum instead of cutting the
parents column to four characters. **The authored line reads the distance, not the instant**
(GC-135): `relativeTime(iso, now)` in `time.ts` beside the two absolute formatters, with the
absolute string on the line's `title`. `now` is injected so the boundaries are testable rather than
raced against the clock, a timestamp in the **future** shares the "just now" branch rather than
counting backwards — a commit made under a skewed clock is ordinary — and past 30 days the distance
becomes the absolute date, since "412 days ago" is arithmetic rather than an answer. It is
materially shorter than the format above, which is what takes the pressure off this grid at the
panel's minimum. The graph's DATE / TIME column is deliberately untouched: a column exists to be
read down and compared.

Staging view (operation banner with Abort, Conflicted / Unstaged / Staged groups, commit form with
amend and the 72-character counter), commit view (sha, refs, message, author, parent links, file
list), or **stash view** (GC-170): `stash` is asked about first, because a stash row's selection is
a sha the loaded commits do not hold and the panel would otherwise fall through to the staging view
and say nothing about what was selected. It copies the commit view — a stash *is* a commit, so its
files come from the same `commit:files` call on its own sha — and says the three things the marker
it replaced could only say in a tooltip: which stash it is, its whole untouched message, prefix
included, and how long it has been there. **The commit view's header draws its refs as chips, not as git's decoration** (GC-087):
`chipsFor` over the refs sitting on that commit, from `graph/RefChip.tsx`, so the ordering and the
absorb rule are the graph's; they wrap under `commit: <sha>` in a `.ref-chips` row rather than
ellipsising, which is what used to cut `origin/m…` off the end and lose the remote. `App` hands the
panel the same `visibleRefs` and the same two handlers the graph gets, so right-click opens
`refMenuItems` and double-click checks out through `runCheckout`. With no refs the row is not
rendered at all, so the head keeps its 36px; `.commit-id` is `flex: none`, so the chips take the
rest of the row and never break `commit: <sha>` in two. Clicking the sha copies the full one.
**The commit view keeps the working directory in sight** (GC-045): with `status.entries`
non-empty a `.banner.info` above the message box counts them — the staging header's own number,
conflicted entries included — and its "View changes" button selects the `WIP` row. It is the panel's
second kind of banner, so a reader of `.banner` has to say which one it means; the e2e suite's
`state()` reads `.banner:not(.info)`, because the informational one is true of nearly every moment
of a run. Every file row's context menu comes from `fileMenuItems`, whose Discard uses
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
app. Settings: `avatars`, `pullMode`, `confirmDirtyCheckout`, `commitColumnGuide`, `theme`, `diffView`,
`diffIgnoreWhitespace`, `diffWordWrap` and `graphColumns` — the one nested value, so `load()` falls
back per column and a `defaults()` helper copies it, a bare spread having shared the nested object.
Adding a setting means: a field with a default in `prefs.ts`, validation in `load()`, a row in
`components/Preferences.tsx`, and reading it with `usePrefs()`. There is no OK/Cancel; every change
applies immediately.

**`theme` is `dark` | `light` | `system`, and `prefs.ts` resolves `system` itself** with `matchMedia`
rather than leaving it to a media query (GC-013): there has to be one answer to which theme is
showing, because the renderer hands it to the main process over `window:theme` to repaint the OS
window controls — the one part of the frame CSS cannot reach. `applyTheme()` stamps `data-theme` on
the document element on load, on every `setPrefs` and when the OS setting changes; it is guarded on
`document` because a node-environment test imports this module.

Remembered **state** deliberately stays on its own keys, never in the blob:

| Key | Holds |
| --- | --- |
| `gitclient.tabs` | the open repositories as a JSON array of paths, in bar order; a tab holding none contributes nothing (GC-016, GC-163) |
| `gitclient.lastRepo` | which of those tabs was showing, so a restart comes back to it |
| `gitclient.recentRepos` | ten absolute paths, newest first, deduplicated on the normalised path |
| `gitclient.refColW` | ref column width in px (100–400, default 150) |
| `gitclient.leftPanelW` | left panel width in px (160–420, default 220) |
| `gitclient.detailPanelW` | detail panel width in px (300–720, default 400) |
| `gitclient.sectionHeights` | the left panel's section heights in px, per section id (GC-153) |
| `gitclient.pinned.<repoPath>` | the branch pinned to the graph's left column |
| `gitclient.hidden.<repoPath>` | full names of the refs kept out of the graph |
| `gitclient.folded.<repoPath>` | the left panel's closed folders, `<section>/<folder path>` (GC-139) |

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

406 tests today, one file per module covered. Three are not about the app: `tools/repo-hygiene` fails

on any C0 control byte that is not TAB or LF (CR included) across `src/`, `tools/` and the root
markdown — **`TICKETS-ARCHIVE.md` included, and the tree-walk test names it outright** (GC-158), so
the 82% of the backlog GC-145 moved into it cannot fall out of rule 6's guard again with nothing
failing — it is what guards rule 6 above — **and on a backlog whose two files disagree** (GC-145):
`backlogProblems` is pure and reports one sentence per problem, so a `done` section or row left in
`TICKETS.md`, a row disagreeing with its section or one resolving to nothing fails `npm test` rather
than being noticed months later (GC-174 moved the `done` rows to a board in the archive). `tools/backlog`
pins the routine's lock check and batch selection on synthetic text.
 `tools/launch-app` covers the attach path against a fake CDP endpoint, and the ownership a launch
takes over the app it spawned (GC-154) against a sleeping node process — a unit test never starts
Electron, and `ownChild` cares only that it was handed something with a pid. GC-162's graceful stop
is covered the same way: a fake CDP whose `/json/close` stops that process is the app asking to be
closed, and a port nobody holds is the fallback.

### The e2e suite

`npm run e2e:setup && npm run e2e`, after a build. `run.mjs` launches through
`tools/launch-app.mjs`, so the whole suite is stealthy, and drives the built app over CDP,
asserting against git after each step. 40 steps, 292 assertions, ~45s. It ends with
`total: 45.0s | git: 373 calls, 9.9s` — the run's own clock (GC-080) beside the cost of its own
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
  every 50ms. Seven `sleep` calls are left, each commented with what is unobservable there — the
  frame after a viewport override, because `ContextMenu` closes on `resize` and the override's own
  resize event arrives after `window.innerHeight` has already changed (GC-126), and the quiet
  window inside `waitSettled`, which is the absence of an event and so cannot be waited on
  (GC-121). Step 39's two are the second kind: what it asserts after a `dragend`, and after a
  drag that is not ours, is that the graph does **not** scroll (GC-168). The scroll it does expect
  is a `waitFor`, not a sleep — one `dragover` and then the DOM, which is what proves the rAF loop
  runs off the clock rather than off the event. **`waitSettled` is not `waitIdle`**: the first answers "no reload is still coming" by
  sampling `data-gen` until it holds, the second only "no action is running". A step that picks
  diff lines needs the first — a watcher echo landing while the bar is already idle bumps the
  version, and the selection is keyed to it, so the picks vanish between two clicks.
- **A wait that a click follows must prove the control is live, not just that the content is right**
  (GC-130). `waitDiff` and `waitSplitDiff` carry `LIVE_DIFF`, which refuses a `.diff-body.stale` —
  `DiffView` disables every hunk button while a reload it has not confirmed is in flight, and the
  watcher raises that 300ms behind the previous step's index write, so the very same hunks sit on
  screen with nothing on them clickable.
- **Every click goes through `liveClick(what, expression, max)`** (GC-130, GC-132), which is the
  atomic find-check-click that used to live in `hunkAction` alone. The snippet it evaluates answers
  a message saying what it did, `MISS …` when the target is not there, or `DISABLED …` when it is
  there but not live; only the last is polled out, and both failures end in a `check()` on the line
  that produced them. Nothing may hand a "no such control" or "disabled" string to a bare `log()`,
  which prints and asserts nothing — the step then carried on and failed several waits later at a
  line with nothing to do with the miss. A new helper joins `liveClick` rather than writing its own
  `ev()` with a silent miss in it.
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
- Step 1 clears **every** `gitclient.*` key by prefix, writes `gitclient.lastRepo` back and asserts
  in the same page turn that nothing else survived, because the per-port profile persists between
  runs and every hand-written driver shares it (GC-160). It then asserts the run starts from
  exactly one tab, the fixture's. A list of names was what it had, and it kept losing: a tab a
  driver left pointing at a folder it had deleted failed step 1 and cascaded into 30 failures about
  nothing in the code under test (GC-155), and a driver's `gitclient.refColW=400` was later
  measured surviving a whole run. A key added to `prefs.ts` or to the remembered-state table above
  now costs the suite nothing to stay isolated from.
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

**It is two files, split by status** (GC-145, GC-174). `TICKETS.md` is the one to read, in full:
the scaffolding, the board of open tickets, every `todo`, `in-progress` and `blocked` section, and
the newest review. `TICKETS-ARCHIVE.md` holds every `done` ticket's row and section and every
review a newer one superseded; it is looked up by id when a finished ticket's history is wanted
and otherwise not read at all. A `done` row sits on the archive's board beside its section, which
is the whole mapping. **A session that sets a ticket to `done` moves its row and section in the
same commit**, and the reviewer moves the review it supersedes when it writes a new one; `npm
test`'s backlog check fails if the two files disagree — an id sectioned in both, a `done` row or
section left in `TICKETS.md`, an open one filed in the archive, a row disagreeing with its
section, a board row resolving to nothing, or a second review kept beside the newest.
**And neither file is read until `node tools/backlog.mjs` has said there is a batch** (GC-174):
it prints `locked`, `eligible` or `nothing eligible` in one line, so the routine's frequent
no-op runs cost that line rather than the 56k tokens the two reads came to.


**`INBOX.md` is Ricardo's, and it is git-ignored.** He drops small plain-English observations there
as `- ` bullets; the reviewer drains it at the start of every run, investigates each item and turns
it into a ticket, an extension of one, or a written reason for neither — see "Review routine" in
`TICKETS.md`. It is deliberately outside git so it can be edited at any moment without dirtying the
worker's `git status`. Nothing else reads it, and no ticket is ever written *in* it.

Design decisions that must not be quietly undone, and where each is explained above: date order in
the log, column 0 for HEAD, no early forking, right-angle joins, one ref chip, a stash as a row of
its own above its parent rather than a marker in its ref cell, rows built by `displayRows` so
nothing adds the WIP offset by hand, a WIP-to-HEAD dash drawn in place of the line rather than over
it and carried by a stash row that falls inside it (Graph); one Escape
one layer, a drop that opens no empty menu and checks out the branch it acts on, one shortcut
table, every confirmation on the modal and an option on one carried by `confirmWithOption` rather
than by a prompt with its input switched off, the busy token every writer of `busy` takes (App state,
UI layer); each left-panel section
scrolling under a header that never moves, sharing the column by what each one actually needs and
dragged by a boundary rather than an edge (UI layer); the centre keeping `MIN_GRAPH_W` while the panels give way, the
message column keeping `MIN_MSG_W` while the ref column gives way, the optional columns giving way
after it, a column dropped for want of width marked in Preferences from that same answer, and only the applied widths ever clamped — on the drag path as well as the resize one, a
drag starting from the drawn width and ending on the last width the pointer reached (UI layer); a page continuing the previous range's `LaneState`,
and only a strict extension counted as one (Graph); every modal `h3` + `.modal-body` +
`.modal-buttons`, with only the body scrolling, and a context menu capped and scrolling the same way
(UI layer); one toolbar popover open at a time because there is one value for which,
every checkbox and every radio styled once by type, a menu filter that is the menu's own state and
narrows by one pure function (UI layer); `--index` on
stash apply and pop, a stash rename dropping the shifted index rather than the one it was given, `defaultRemote` and `remoteCopyOf` shared both ways, a remote tag delete fully qualified (Main process); the diff keyed to its view
identity, the split layout a render of what is already loaded, a hunk patch built from
`hunk.raw` whichever layout is showing, both layouts marking intra-line changes from one map, and
the whitespace flag in the load key rather than the identity, with every patch button off while it
is on, and a line selection written for whichever file its patch must fit — the index one way, the
working tree the other (Diff); the hidden set applied to a path's first load
(Graph); the lane colours interleaved rather than ramped, one module answering what a ref chip is
so the graph and the commit view cannot draw the same refs differently, the chip's name winning
over its upstream marker in a narrow column, and the room it is drawn at counted against every
sibling in the cell rather than the `+N` alone (Graph, Detail panel); an error and a notice never both
on the status bar, with the advisory flag carried on the error's name because that is all IPC
keeps, a credential refusal carrying the whole of git's message under a summary line and only the
three remote commands ever able to prompt (App state, Main process); every colour a token, the
theme resolved in `prefs.ts` and remembered per profile by the main process so the window is built in it, one module answering how a timestamp is written so no component
reaches for `toLocaleString` and one answering how long ago it was, with the graph column left absolute (Styling, Preferences); a drag scrolling the graph off the clock rather than off the browser's event rate (UI layer); a failing e2e git call throwing, its Electron
stopped on every exit path, a wait before a click proving the control is live rather than only
the content right, every click going through `liveClick` so a missing or dead control fails
where it happened, and step 1 clearing every remembered key by prefix rather than a list of names
(Testing); one rule for which shortcuts fire while typing, read off the table's
own `whileTyping` (App state); a tab switch restoring in one commit and refreshing underneath, the
tab keyed by id rather than by its path, `gitclient.lastRepo` following the active tab while git's
canonical spelling is adopted only within one repository, and two keyed siblings never sharing a
key (App state); a tab allowed to hold no repository and never remembered when it does,
a recents row opening a tab beside the showing one rather than replacing it, and the guards reading
the tree from a ref rather than from the render they were built in (App state); the folded block
opening for a drag by taking both halves of the hover state, and what a drag promises keyed to
`draggable` rather than to a class (Graph, UI layer); a hidden detail panel leaving a strip that is
absent exactly while it shows, the graph's offset parked at the moment it is parked and the
selection pass acting only on a selection that changed (App state);
a single click selecting a tip and an unloaded one moving nothing, one boundary treatment for both
detail views with the parents column giving way before the authored date, the commit draft parked
with its tab, the left panel header naming HEAD rather than
counting what its sections already count (Graph, Detail panel, App state); the backlog
split by status across two files, row and section moved in the same commit as the status change,
and neither file read before `backlog.mjs` says there is a batch (The backlog); one dialog able to
ask for several things with the single-field form unchanged underneath it, and the closed folders
remembered per repository and pruned against the refs that exist (UI layer, Graph); every function
that may ask for a credential named by a test rather than by a convention, and the stash rename's
index shift held by unit tests rather than only by a 45-second run (Main process, Testing);

stealth launches, narrow stops asked for before they are taken, the per-port profile, and a launch owned by the process that made it
until that process stops or releases it (Commands); the LF working copy, control
characters as escapes, study-never-copy, no writes against the real repositories (The rules).

Memory for this project lives in the Claude memory directory (`gitclient-project.md`) and points
here. `README.md` is the public-facing overview with the same commands and dependency notes.
