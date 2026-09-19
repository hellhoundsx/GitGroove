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
| @fontsource-variable/inter | 5 | **the UI font** (GC-213), imported in `main.tsx`; one variable file for the whole weight axis, and it carries the optical-size axis `optical-sizing: auto` drives |
| @fontsource/open-sans | 5 | the bundled **fallback**, imported in `main.tsx` (400/600/700), behind Inter and Segoe UI Variable |
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
`App.tsx`, `components/`, `graph/`, `diff/`, `ui/`, `checkout.ts`, `prefs.ts`, `shortcuts.ts`, `tabs.ts`,
`time.ts` and
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
- **A push may be forced, and only ever with a lease** (GC-203). `push()` has turned
  `PushRequest.force` into `--force-with-lease` since the field existed — never `--force`, which is
  not a thing this app does — and no call site passed it, so amending a published commit left the
  user with nothing to do. The **Push popover** is the one place that offers it: one row per remote
  (so the row names what it overwrites, GC-114), `.danger`, behind `App`'s `forcePush` and a
  `useUi().confirm` naming the remote and the branch. The caret is therefore drawn with one remote
  too, where GC-057 had it as "which remote" alone. It is deliberately **not** offered from the
  rejection dialog GC-202 draws: that would make overwriting a remote a click on an error message.
  The staging form says so where it leads people into it — with Amend ticked on a branch that has an
  upstream and nothing ahead, a `.form-hint` in `--warning` says the commit is on that ref, which is
  a derivation from the snapshot and costs no git call.

- **A conflict can be resolved to a side, not only marked resolved** (GC-181).
  `resolveConflictWith(run, path, side)` is `git checkout --ours|--theirs -- <path>` followed by
  `git add -- <path>` — one function, so a resolved row leaves the Conflicted group in one action —
  and the add runs only if the checkout did, or a half-resolved path is recorded. Which sides exist
  is **`conflictSides` in `shared/types.ts`**, keyed by the two-letter porcelain code `getStatus`
  now carries on an unmerged entry (`StatusEntry.unmerged`): `--ours` needs stage 2 and `--theirs`
  stage 3, so a delete/add conflict has one of them and the menu leaves the other row out rather
  than offering a call git will refuse (GC-072's rule). **The labels are derived from
  `status.operation`, never from the flag** — during a rebase git replays your commits onto the
  upstream, so "ours" is the branch being rebased *onto*, the reverse of what the word suggests.
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
`HEAD`, `packed-refs` **and `config`** scope to `refs` (full reload); everything else to `tree`
(status only). `config` is there because the remotes, and a branch's upstream with them, live only
in the full snapshot (GC-190): a `git remote add` typed in a terminal wrote `.git/config`, which
was "everything else", so the status refreshed and no REMOTE row ever appeared until the page was
reloaded by hand. It cannot loop the way the bare `.git` event did — a full reload reads config
and never writes it — and it costs the app's own `remoteAdd` nothing new: the watcher echo after
an action was already a `bumpGen`, and this changes what that echo does rather than how many there
are.
`git check-ignore` is deliberately not used: every git call lives in `git.ts`, so the watcher stays
pure fs.

**IPC and preload** — channels grouped by prefix: `repo:*`, `commit:*`, `workdir:*`, `ref:*`,
`remote:*`, `stash:*` and `shell:*`. `ipc.ts` validates every argument (`str`, `strs`,
`int`, `oneOf`); `repo:checkGit` is the only handler taking none. `repo:clone`, `repo:init` and `repo:chooseFolder` are the three that take no repository path,
because there is no repository yet, so none of them goes through `repoFile()` (GC-128).
**The `window:*` group is gone** (GC-213), along with the two settings it served: `window:theme`
repainted the OS window controls for a theme that no longer varies, and `window:material`
answered which of three materials had been applied when there is now one. `TITLE_BAR_OVERLAY`
and `WINDOW_BACKGROUND` are single constants in `ipc.ts` rather than a pair each — kept there
rather than in `index.ts` because `index.ts` already imports `registerIpc` and the other
direction would be a cycle (GC-013) — and `window-theme.json` under every profile went with
them. With one palette there is nothing to remember and nothing to get wrong on the first frame,
which is the whole of what GC-102 existed to solve. Adding an API means: type in
`shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in `preload/index.ts`.
`remote:cancel` is the only handler besides `repo:checkGit` that takes no arguments at all: what
it stops is a process, not something inside a repository (GC-169). `shell:*` is the group that
never touches git: its three handlers live in `ipc.ts` itself, and the two that take a file go through
`repoFile()` — which resolves a repository-relative path against the repository and **refuses one
landing outside it** (a `..`, an absolute path, another drive) or missing from the working tree —
and are exposed as their own `window.shell` bridge, not as more of `window.api`.
**`shell:openExternal` is the third, and it has no `repoFile()` to lean on** (GC-159): what it hands
to the OS is a URL, and `shell.openExternal` follows whatever it is given, so it refuses any scheme
but `http:` and `https:` — `isWebUrl` in `shared/remotes.ts`, the same one line
`setWindowOpenHandler` in `index.ts` now asks, because a second copy of a security check is a second
chance to get it wrong. **The path check is two functions, and which one a handler takes is the
whole of it** (GC-198). `repoRelAny()` is the containment rule alone — the one implementation of
"it has to land inside this repository", refusing a `..`, an absolute path and another Windows
drive — answering the repository-relative path; `repoRel()` is that plus `existsSync`, and
`repoFile()` is `repoRel` resolved. `workdir:ignore` takes `repoRel`, because a `.gitignore`
pattern is built from a file the user is looking at (GC-093). The three that ask git about a path
the working tree may no longer have — `repo:fileLog`, `workdir:restoreFile` and
`workdir:resolveConflict` — take `repoRelAny`, where each used to take a bare `str` with its own
comment saying why it could not use `repoRel`: the check that actually matters was skipped by
exactly the handlers that could not afford the other one. `repo:changed` is
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
bar, the left panel's ref filter and the graph's scroll offset. It is keyed by id rather than by path because the path changes
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
- **So is the left panel's ref filter** (GC-179), for the same reason and with the same fix.
  `LeftPanel` is not keyed by repository, so a query typed in one tab was still in the box when
  another was shown: measured with two tabs open, `release` in the fixture's panel left the second
  repository drawing **zero** `.ref-row's under section headers still counting its real branches,
  which reads as a repository with no refs rather than as a filter. The panel is a controlled
  input now — it reports typing and narrows by nothing of its own — so the query has one home,
  `openIn` clears it and a switch away and back restores it.
- **The staging form's draft is `App` state and part of `TabState`** (GC-148) — summary, body and
  the amend flag — for the reason GC-030 lifted the find bar's query out of `CommitGraph`: the
  panel unmounts behind a file view and on every tab switch, so the user's own typing cannot live
  in it. GC-016's two promises are kept explicitly rather than by the panel's key: `openIn` clears
  the draft, which is the one path a repository takes into the showing tab, and a successful commit
  still clears the form. **The graph WIP row's field is that same summary** (GC-182): it reads the
  draft and writes it, so typing in either types in both, and Enter there is the table's
  `commitInline` binding, held to the staging form's own rule — nothing staged, or an empty
  summary, does nothing and says nothing. It was an uncontrolled `<input>` wired to nothing, which
  is exactly what GC-148 and GC-030 exist to prevent.
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
  fills **that** tab, which is `openPath`'s existing `activeId !== null` path. **And an empty tab
  that hands the user to another tab closes itself** (GC-173): picking a repository already in the
  bar is answered by taking the user to its tab, which is right, but the tab they asked from was
  made for a repository it never got, so the bar grew by one holding nothing. `revisitTab` is that
  one path — both `openPath` and `openNewTab` go through it — and it drops the empty tab with a
  `setTabs` rather than through `closeTabs`, because an empty tab is in neither `gitclient.tabs`
  nor the reopen stack and the tab left showing is already decided. Only that case: an empty tab
  the user leaves by clicking another tab is still theirs, so `selectTab` never drops one.
- **The tab strip scrolls once there are more tabs than fit** (GC-149). A tab's padding, icon and
  close box are `flex: none` and stop it shrinking at about 40px, so past a dozen repositories the
  row spilled to the right and pushed `+` and the recents chevron under the 140px the OS window
  controls reserve, where neither could be clicked. `.tabs` scrolls inside itself instead, the
  three bar buttons are `flex: none`, and `TitleBar` scrolls the showing tab into view whenever it
  changes — including the first render, which is the restart case, since `gitclient.lastRepo`
  rarely names the leftmost tab. Measured with twenty tabs on a 1400px window: `+` and the chevron
  at 1180-1260, inside the reserve and answering `elementFromPoint`, narrowest tab 123px.
- **A tab answers a right-click like every other repeated row** (GC-151): `tabMenuItems` gives it
  Close tab, Close other tabs, Close tabs to the right, Reopen closed tab and Copy repository path,
  each **absent** rather than disabled when it does not apply. `Ctrl+W` and `Ctrl+Shift+T` are the
  two of those that are also bindings, in `shortcuts.ts` like every other. Closing several tabs is
  one `closeTabs(ids)`, so `gitclient.tabs` is written once, and `survivorOf` in `tabs.ts` is
  `neighbourOf` generalised to a set — a single close and a group close cannot then disagree about
  what is left showing. The reopen stack (`pushClosed` / `popClosed`) is session-only and lives in a
  ref: `gitclient.tabs` is the list of what is open, not a history.
- **A recents row opens a tab; the folder button and "Open repository…" replace one** (GC-164).
  Both surfaces that draw the list — `openRepoMenu`, which the title-bar chevron and the branch
  breadcrumb share, and the empty state's `.recent-row` buttons — go through `openRecent`, which is
  `openNewTab` unless the showing tab holds nothing, in which case it fills it in place. `openPath`
  rewrote the active tab's path, so a second repository silently replaced the first and dropped
  everything it had parked. Either way a repository already in the bar takes the user to its tab
  rather than opening a second copy of it. Closing a tab falls to its right neighbour, then its
  left, then the empty state. The graph's scroll offset reaches `App` as a ref (`graphTop`)
  reported by `CommitGraph`, so a wheel event re-renders nothing.
- **And both surfaces lose the same end of a path** (GC-165): `direction: rtl` is set once, for
  `.ctx-item .ctx-hint.path` and `.recent-row .recent-path` together, so the folder that names an
  entry survives on the empty state as it already did in the menu — that page ellipsised at the end
  and threw away the half that identifies a repository, on the one screen with nothing else on it to
  go by. Which end gives way is the shared declaration; where a path that *fits* sits stays each
  surface's own (`text-align`), since a recents path sits beside the name it belongs to.
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

- **What is selected is not always what `selected` holds** (GC-219). With nothing to commit there
  is no working-directory row to stand on, and `WIP` is what the app opens on, so `shown` — derived
  during render, never written back — falls to `info.headSha` while that row is absent. The state
  is deliberately left as `WIP`: it is the app's **default**, not a choice the user made, so a file
  edited or a merge stopping with conflicts puts the selection straight back where it defaults to,
  with the panel on the thing that just happened. Writing HEAD into the state would make that
  one-way — the row would come back with the panel still on a commit, and the e2e suite's own
  conflict step is what caught it. A selection the user did make is a sha, so none of this reaches
  it, and an unborn HEAD has nothing to fall to and keeps the staging view. Every consumer reads
  `shown`; only `setSelected` writes, and the tab is parked with the state so a switch back
  restores the default rather than a commit nobody chose.
- **`run(label, fn, opts)` is the only way git actions execute.** It sets busy, runs, reloads the
  snapshot (or only the status for staging actions), and **re-applies the error after the reload**,
  because git often exits non-zero while leaving a state the panels must show.
  It also takes a **busy token** on entry and clears `busy` — and applies its error — only while it
  still owns it (GC-084), so of two overlapping actions the one that finishes first no longer takes
  the status bar away from the one still running.
  **`opts.at` names the control the work belongs to** (GC-214), which is what lets the button the
  user actually clicked say so while the status bar says it in words at the other end of the
  window. `takeBusy(label, at)` sets `busyAt` through the same door as the label, so GC-108's rule
  covers both and a stale "who is working" is not a second thing to get wrong; a success sets
  `done` to `{ at, n }` behind the same `owns()` guard, and a **failure sets nothing** — a failure
  has a sentence to say and `report` has already put it where sentences go. `at` is set only where
  the control is **still on screen when the work ends**: the six toolbar buttons and the commit
  button. A menu row, a popover row (`Fetch all`) or a file row's stage button is gone or may be
  gone by then, so those actions name no control and keep the status bar alone. A `rethrow` caller gets its exception either way.
  **`opts.quiet` is the failure the caller answers itself** (GC-215) — a predicate, because only
  some of an action's failures are its to answer: when it holds, `run` skips `report` and leaves
  the bar alone, and `rethrow` still delivers the exception. `runCheckout` is the one caller, for
  the refusal it turns into a question.
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
- **Every checkout goes through `runCheckout(name, doCheckout)`, and it tries first** (GC-215).
  git carries uncommitted changes onto the branch being checked out wherever it can, which is what
  someone double-clicking a branch is asking for — to be on that branch with their work still in
  front of them — so the checkout is attempted and nothing is asked. GC-004 asked before every
  dirty checkout instead, which put a dialog in front of the case that works and offered "Check out
  anyway", the one answer that does nothing different. The **preference went with it**
  (`confirmDirtyCheckout`): with the guard moved to git's own refusal, its "on" state was a warning
  before something that was going to succeed, and the dialog it raised now appears exactly where it
  is earned.
  git refuses this one way, having touched nothing, and `checkoutBlock(message)` in
  `renderer/src/checkout.ts` is what tells that refusal from every other failure — a pure read of
  git's own words, the way `git.ts` reads `/already exists/` and `headline` reads this same text,
  because only an error's `name` survives IPC and the paths are the part worth saying. It answers
  the files and which of the two refusals it is (a tracked file the checkout would rewrite, or an
  untracked one sitting where the branch has one), `blockedList` names the first three and counts
  the rest, and the question offers the **way through** rather than "anyway": stash, check out, put
  the changes back on top. `run`'s `quiet` predicate keeps that refusal off the status bar, since a
  red line behind the dialog describes a decision the user has not made yet; every other failure is
  reported there and `runCheckout` returns having done nothing.
  **A conflicting pop is then the outcome to report, and it says so in words.** git's own line is
  about the index it could not restore (GC-092) and git *keeps* the stash when a pop conflicts, so
  the message names the conflicted count and says the stash was kept — advisory, not red, because
  the branch was checked out and the changes did come back. The staging panel's Conflicted group is
  already showing them.
- **And a remote branch takes you to where it points** (GC-217). `checkoutRef` passes `--track`,
  whose own fallback in `git.ts` switches to the local copy when one already exists — and that was
  the whole of it, so double-clicking `origin/master` while sitting on a `master` two commits
  behind ran a checkout of the branch already checked out and changed **nothing at all**: a
  spinner, two reloads, the same `↓2` in the crumb. The gesture names the *remote* branch, so
  landing on the local one and stopping there answers half of it. The local copy is therefore
  brought up to the ref that was clicked, with `fastForward` — the same call the branch menu's row
  makes (GC-100), which after the checkout is `git merge --ff-only`, so it can only move the branch
  forward. Nothing is attempted when the two are already one commit or when there is no local copy
  at all (`--track` makes it there); a branch merely *ahead* answers "Already up to date"; and one
  that has **diverged** is an advisory naming both branches and the three ways out, not a failure —
  the checkout asked for did happen. Only git's own `not possible to fast-forward` is read as
  divergence, because everything else has to propagate as itself: a working tree in the way says
  "would be overwritten by **merge**", which is GC-215's question, and a sentence about branches
  that have not diverged would be a lie in front of it.
  Both halves are inside one `run()`, so one busy token and one reload — and "Stash and check out"
  re-runs the pair, landing the user on the branch at the remote's tip with their changes back on
  top. Which is the whole of what the gesture asked for.
  `runCheckout` therefore takes **two names**: `name`, the branch landed **on**, which every
  sentence about the checkout uses, and `onto`, the ref being gone **to**, which the blocked
  question uses — "a file that `master` would overwrite" says nothing to someone already standing
  on `master`. They are the same for every other ref, and `onto` defaults to `name`.
  **A divergence is a question, not a line** (GC-221): the checkout happened and the catch-up could
  not, which is the one outcome only the user can settle, so the dialog offers `Reset <local> to
  <remote>` — `danger`, and it says how many commits it drops — or `Create a branch here…`, which is
  `createBranchAt` at the remote s commit. The advisory it replaces named the problem and offered
  nothing. It is recorded by the action and asked *after* `run()` resolves, because a dialog cannot
  be opened from inside one: the reload is still to come.
  `splitRemoteRef` in `shared/remotes.ts` is what answers which local branch a remote ref is a copy
  of: `remoteCopyOf`'s own split, exported rather than written twice (GC-134's reasoning, with its
  tests).
- **The sequencer's count comes from `statusRef`, not from the closure's `snapshot`** (GC-124): the
  ref mirrors `snapshot?.status` on every render the way `live` does, because `runOnBranch` awaits
  a checkout before the sequencer's guard runs, and a guard that measures the tree from before it
  would offer to stash nothing and then pop an unrelated stash. `runCheckout` counts nothing now —
  git's refusal names the files — so this is the sequencer's rule alone.
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
- **Any failure git wrote more than one line about has more to say than a status bar can hold**
  (GC-169, GC-202), and the dialog is `ErrorDetailsDialog` — named for that rather than for the
  credential refusal it was built for. `failureParts` in `App.tsx` answers `null` for a one-line
  failure, which is what leaves that case exactly as it always was: one line, and a click
  dismisses. For anything longer, `onErrorDetails` is set, the bar draws a `Details` mark beside
  the headline because a `title` is not an announcement, and the dialog holds git's message
  **entire** — a rejected push's four `hint:` lines as much as an SSO refusal's `remote:` ones.
  A credential refusal keeps its two extra properties and nothing else: it rides on the name the
  way an advisory does (`AUTH_FAILURE` / `GitAuthError`, `GitError`'s sixth argument, stripped by
  `msg()` like the other two), so its bar line is the **summary the main process composed** rather
  than `headline()`'s pick, and it is the one kind that opens the dialog by itself, because the
  user has to go and re-authorise something. `failureDetails` is cleared by the next `run()`, so
  the bar can never offer to reopen a dialog about something else.
- **The line the bar draws is the one that says why** (GC-202). `headline()` in `StatusBar.tsx`
  tries `HEADLINE_PATTERNS` one at a time over every line — the `! [rejected]` line first, whose
  parenthesis holds the reason, then `CONFLICT`, then `fatal:`, then `error:`, then `failed` — so
  the choice is by priority and not by which pattern git happened to print first. One pattern
  holding every alternative matched in document order and drew `error: failed to push some refs to
  '<url>'`, which names no cause and no remedy and spends the bar's width on a path.
- **Only the commands that reach a remote may ask for a credential** (GC-169). `RunOptions.prompt`
  is what `runGit` reads for `GIT_TERMINAL_PROMPT`, and only `runRemote` sets it: everything else
  keeps `'0'`, because an unattended `git status` must never sit on a prompt. Such a child is
  registered for `cancelRemote()` and given two minutes, since a helper's window waits for a
  person; `run(label, fn, { remote: true })` is what puts Cancel on the busy line, and a cancelled
  command reports as an advisory notice rather than as a failure. **Which functions reach
  `runRemote` is a test, not a convention** (GC-176): `fetch`, `remoteAdd`, `pull`, `push`,
  `deleteRemoteBranch`, `deleteRemoteTag` and `cloneRepo` — six commands, of which two are the
  pushes GC-169 missed and that reported one ellipsised `403` until they were wired up.
  `git.test.ts` reads `git.ts` for every function calling it and names the seven, so an eighth
  cannot join them silently.
- **A repository can be made rather than only opened** (GC-128). `cloneRepo(url, parentDir, name?)`
  runs in the **parent** — `runGit` refuses a cwd that does not exist and the target is precisely
  what does not — and names the folder on the command line, so the absolute path it answers with is
  the path git used rather than something parsed out of a progress stream `runGit` buffers and
  never sees. `cloneTargetName(url)` is that name — in `shared/remotes.ts` since GC-221, because the dialog names the folder while the user is still typing the URL: `PromptOptions.note` is a line under the fields recomputed on every keystroke, and the clone dialog shows the path it is about to create rather than a sentence explaining that it creates one. **Its folder picker is inside the field it fills in** (`PromptField.pick`), not a third button beside Cancel and Clone: it only ever answered "Clone into", and standing among the buttons that answer the dialog it read as a third way of answering it. The dialog stays open while the OS picker runs, which is what let GC-185s `fillsIn` — a secondary that closed the dialog and reopened it with the answer — be deleted outright. Pure and tested; a URL it cannot name, and a
  name that is a path rather than one folder, are both refused before anything is spawned.
  `initRepo(dir)` is `git init` in a folder that exists, answering the same kind of path. Both
  answer what `openPath` takes, so what they made joins the tab bar and `recentRepos` like any
  other repository.
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
- **A third button that fills the form in is not gated on the form being complete** (GC-185):
  `secondary.fillsIn` says so, and `resolveWith`'s own `incomplete` guard reads it too, or a live
  button would do nothing when clicked. The clone dialog's "Browse…" is the one caller — it supplies
  the folder the form is waiting for, so gating it on the answer being complete made the picker
  unreachable from a cold dialog, which is every first clone. The two guard dialogs' secondaries
  **answer** their question and stay gated; that is the whole distinction, and it is stated on the
  option rather than special-cased in `App`.
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
  its own, or it is a scrollbar inside a scrollbar. **And the horizontal padding is on the children,
  not on `.modal`** (GC-195): a classic scrollbar is laid out between the border and the padding
  box, so a body that spans the dialog and carries the inset itself puts the bar at the dialog's own
  edge with the content stopping 16px short of it — where the padding on `.modal` put the bar 17px
  in, with dead space one side and the controls flush against the other. `.modal > *` is the rule,
  so a fourth block joining the shape is inset like the three.
- **A context menu is capped against the window and scrolls inside itself** (GC-120), the same
  answer `.modal` has: `.ctx-menu` is `calc(100vh - 8px)` — the 4px the position clamp keeps at
  each edge — so the branch menu, whose height grows with the number of remotes, keeps its first
  and last rows reachable on a short window. It clamps rather than flips, so a cap costs it
  nothing. `ContextMenu`'s wheel listener ignores a wheel **inside** the menu, or a capped menu
  could not be scrolled: that wheel is the user reaching its last row, not the page moving.
- **A surface that draws menu items as buttons reads `MenuItem.short`** (GC-213). The menu never
  uses it; it is for the stash view's head, which renders `stashMenuItems`' own items (GC-178) in
  a 400px row beside `stash@{0}: 59ff3b1`. The four long labels came to 390px against 376px of
  room and wrapped onto two ragged lines, because the menu needs the noun — it is opened from a
  row in a list of many — and the head does not. Handler, hint, `danger` and confirmation still
  come from the one item, so the two surfaces cannot drift on anything but how much they restate.
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
  at least 100 degrees of hue apart, 9/0 included. GC-213 **softened them and moved no hue** —
  saturation back ~15%, lightness up 6 points, max hue drift **0.57 degrees** over the whole set,
  worst adjacent pair **100.47** (1/2, which was 100.1 before, so a straight desaturation rounded
  it to 99.9 and those two carry a deliberate 0.2-degree nudge apart), and every lane at **3.06 or
  better** against the #212121 ground where a 2px stroke wants 3. Retuning one means moving its
  saturation or its lightness; moving a **hue** is a different change and has to be re-checked
  against both its neighbours.

**The dash's period divides the row height, or a long run stutters** (GC-218). A row is its own
`<svg>` and every dashed line starts its pattern at y = 0, so the pattern tiles down a run only
when a whole number of periods fits in one row. It was `2 3` — period 5 in a 28px row — and
28 % 5 = 3, so every row boundary shifted the phase by 3px: it walks 0, 3, 1, 4, 2 and realigns
only every fifth row, drawing a short gap or a doubled dash once per row all the way down.
Invisible on the WIP node's own 14px stub, which is where the dash started life; unmissable on a
run spanning a screenful, which is what the WIP-to-HEAD run does whenever HEAD's tip is not the
newest commit loaded. It is `3 4` now — 7 divides 28 four times, and 3 on / 4 off is the duty
cycle nearest the one it replaces — and `dashTiles` holds the rule in a test, so a change to
`ROW_H` fails rather than quietly staggering the line again. Every dashed mark shares it: the WIP
node, a stash node, the run itself and a stash's line into its parent are all "not a commit yet".

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

**A merge commit says so on its node** (GC-221): `parents.length > 1` draws a small filled dot in the lane colour instead of the full circle and its avatar. The graph said it only in the lines — two curves leaving the node — which is legible while both parents are on screen and invisible when the second is a hundred rows down. **Smaller** deliberately: a merge carries no work of its own and its author is whoever ran it, so the node marks the spot rather than competing with the commits either side, and it is the one node that does not interrupt its lane line — the line runs behind it, which is what makes it read as a point on the branch rather than a stop on it. A full-size node carrying a merge glyph was tried first and drew the eye harder than the commits around it.

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
a stash: `stashLanes(parentRow, count, dashLane?)` takes the parent's laid-out row, so
`layoutGraph`'s own lanes are untouched and the split-and-rejoin property holds.

**And the row branches out of its parent rather than standing in its lane** (GC-216, asked for by
Ricardo). GC-170 drew the node in the parent's own lane, where the row read as one more commit on
that branch — a straight line with a dashed circle somewhere in it. A stash *is* a child of that
commit, its first parent being the tip it was taken from, so it is drawn the way every other child
is: a lane of its own beside the parent's, its line running down that lane, and the **parent's row
draws the curve into its node** — `curveIn`, the same right-angle join, dashed (`stashIn`). Drawing
the join inside the stash's own row instead would lay a dash over the solid line already in the
parent's lane wherever that commit has a child above it, which is exactly what GC-144 forbids.
`stashLanes` takes the free lanes to the right of the parent — `laneFree` answering which, plus the
lane the WIP-to-HEAD run travels in, which is not `laneFree`'s to know since that run replaces a
line rather than joining the layout (GC-144) — and hands them back in row order, so the stash
**nearest** the parent takes the innermost lane and no two lines cross. `graphWidth` counts them:
a stash reaching past the last lane its parent's row uses would otherwise be drawn off the end of
the cell. The colour stays the parent's, because what the row hangs off is that branch.

`GraphCell` draws it from the parent's layout: a full-size dashed circle with the archive glyph in
the stash's own lane, its line running down to the join below, and every lane that passes the
parent from above passing this row too — its through lines, its incoming curves, the parent's own
lane, and the lanes of the stashes above this one on their way down to the same commit — so
nothing appears to break where a stash is inserted. A row inside the WIP-to-HEAD
run carries the dash as well (`stashDashFor`, `wipDashFor`'s own rule asked of the parent), or
GC-144's "covers the whole distance" would fail at the one row a user is looking at. The message
column reads the stash's own message with git's `On <branch>: ` or `WIP on <branch>: ` prefix
stripped — `stashMessageText`, for display only, never in the `title` and never in what
`stashRename` stores. The row is selectable like a commit row, right-click gives `stashMenuItems`
and double-click applies, the same two gestures from the same source. A stash whose parent is
outside the loaded range is never looked up and draws nothing.

**The working-directory row is drawn only when there is a working directory to show** (GC-219,
asked for by Ricardo). `hasWipRow(status)` is the rule, pure and exported: entries, or an
operation in progress. It used to be drawn whenever a repository was open, so a clean tree spent a
row of the graph, the dashed run down to HEAD that goes with it, and the selection the app opens
on, all on the words "no changes". **An operation keeps the row even with a clean tree**: the
staging view is where the banner and its Abort live and this row is the only way into that view, so
a rebase stopped on an `edit` with nothing modified must not be a trap.

**And the reserved lane above HEAD then carries the run, or nothing** — the half that only showed
once the row was gone. `layoutGraph` seeds column 0 for HEAD's lineage from the first row, so above
HEAD's row that lane is open with **nothing above it**: no node, no child, nothing the line could
come from. What made it read as a line was the WIP node sitting on top of it, with `wipDash`
replacing the solid stroke with the dash running down from that node (GC-144). Take the node away
and the seed's own solid line stands there instead, running off the top of the graph for no commit
at all — measured on a clean tree with HEAD on an old branch: `18:0-28` on every row, nodeless.
So `wipDashFor` is asked on **every** row whether or not there is a WIP row — it answers two
things, which stretch must not be drawn solid and where the dash goes instead — and `runDrawn`
(`hasWip`) is what decides whether anything is drawn in its place. The suppression is the part that
always applies.

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

**Status icons lead a chip's name and kind icons trail it** (GC-146), which is the study's own
vocabulary and order: the check and the pin in front, then the name, then what the ref *is* and
where else it lives — a laptop for a local branch, a cloud for a remote one, a tag for a tag, and
laptop **and** cloud on a branch that has absorbed its upstream, because that chip stands for two
refs. `kindMarksOf(chip)` in `RefChip.tsx` is the one answer to which marks those are, and the
left panel's rows take the same two icons, so a branch is marked the same way on both surfaces.
The synthetic HEAD chip takes none: it is on no branch. `CommitGraph` counts them, because how
many there are is what `chipMarksFit(room, marks)` needs — GC-071's threshold generalised, one
glyph and one gap more per extra mark — and below it **every** trailing mark goes, so a chip at
the ref column's minimum is exactly as wide as it was before the laptop existed. Measured on the
fixture: at 100px `main` keeps its whole 29px name where GC-071 recorded `ma…`, and its two marks
come back at a 135px column rather than the 120 one mark needed.

**A line joins the last chip on a row to its node, and a band fills the cell on the other side of
it** (GC-147, GC-186). They are two separate things, which GC-147 had merged into one on the wrong
side of the node: `03-graph.md` line 58 makes the chip-to-node stretch a **2px line in the lane
colour and nothing else**, and its line 45 puts a lane-tinted **band right of the node**.

The connector is two halves that meet at the column boundary — `.ref-line`, whose line is drawn
from `currentColor` with the lane set inline, and a line in the row's SVG so the far end meets the
node to the pixel — and it is drawn only on a row that has a chip. `.ref-line` stays a normal-flow
sibling, so the absolutely positioned `.more-list` still paints over it opaquely when the fold
opens.

The band is `Band` in `GraphCell.tsx`, drawn **first** in every one of the three cell kinds
(commit, stash, WIP) so every line and node paints over it: 22px, `.col-msg`'s own height, from the
node's **centre** to the cell's own edge, in the lane colour. From the centre
because a square corner cannot meet a circle (GC-200): butted against the node's drawn radius the
two touched at one point and left about 6.6px of untinted row above and below it, two crescents a
taller band only makes larger. Run under the node and the circle covers what it overlaps, which is
`03-graph.md` line 45's own "mask" — and the two **dashed** nodes therefore carry a `NodeMask`,
their own fill taken out to the stroke's outer edge, or the band reads through the gaps in the dash
as a tinted ring. A solid node needs none: its stroke has no gaps. On **every** row, not
only the selected and WIP ones the study first recorded — Ricardo's own capture of `catena-feed`
has it throughout, and a band on some rows only reads as a property of *those commits* rather than
of the row's lane. A selected row keeps its accent wash, which is the app's own selection language
and spans the whole row where the band spans one cell. Nothing here adds a colour to a stylesheet:
both halves take the lane variable.

**And the paint is light off the lane rather than a flat wash** (GC-201). One opacity from the node
to the cell's edge read as a printed rectangle: it had a hard right edge in the middle of the row
and nothing about it said which end the lane was at. So the band's fill is a `linearGradient` —
`BAND_PEAK` (16%) at the node falling to `BAND_FADE` (30%) of that at the far edge, which averages
about the 10% GC-186 settled and is why the peak sits above it: a peak is not sustained the way a
wash is. The ten definitions, one per lane colour, are `BandGradients`, rendered **once** by
`CommitGraph` beside the avatar clip path, because a row is its own `<svg>` and there are hundreds
of them; the stops are `objectBoundingBox` units, so one gradient serves every row whatever lane it
is in, and the rect keeps the flat lane variable as the SVG `fill` fallback so a band is still
drawn if the defs are ever absent. Everything GC-186 promised is unchanged and asserted rather than
assumed: drawn first in all three cell kinds, on every row, with every line and node over it.

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

**And which sections are open is remembered with them** (GC-177), on `gitclient.sectionOpen` —
global like the heights, since these are the same four sections in every repository, and unlike
the closed folders, which are per path. GC-153 is why it matters: the open set is what decides how
the column is shared, so a user who arranged the panel was losing the arrangement while the
heights they dragged came back. The key holds **only the sections the user has actually toggled**,
so one they have never touched keeps its default and STASHES goes on following whether there are
any; a missing, hand-edited or empty value is absent rather than "all closed", which is
`readSectionHeights`' own rule.

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

**A stash row says how old it is, in a box of its own** (GC-135, GC-171). `Stash.date` had been on
every snapshot since the list existed and was drawn nowhere, while "how old is this" is the question
a stash list is read for. `relativeTime` renders it into a `.row-when` on the right edge of the
row, the way a branch row's ahead/behind sits, with the absolute form joining the message on the
row's `title`.

**The width is `--row-when-w` and not the phrase's own** (GC-171), which is where GC-135 was
wrong: it was `flex: none` with no width at all, so the box was content-sized and grew with what
`relativeTime` produced — "2 minutes ago" is thirteen characters and 66px, not the four or five
characters the ahead/behind readout it was copied from has — and it grew out of the **message**,
which is the only thing on the row saying *which* stash this is. The box is 72px — the widest
phrase `relativeTime` can produce, measured at `--fs-xs` ("59 minutes ago" 72, "1 minute ago" 62,
the absolute form past 30 days 57) — so the age is drawn whole and the `overflow: hidden` on it is
a guard rather than the normal case (GC-199). It was 46px while the row also carried GC-150's sha;
the 26px became affordable when the sha started giving way. And the drawn message is `stashMessageText`'s, the graph
row's own answer (GC-170), so git's `On <branch>: ` prefix is off the line here too — every stash
git makes carries it, so the nine characters that survived the column were the ones identical
across every stash on the branch, and two stashes on `main` drew the same row. Never in the
`title`, and never in what `stashRename` stores.

**What is left is five items on a 220px row, so two of them give way** (GC-199). The folder-tree
indent goes for good, in the stylesheet: `.ref-row`'s 26px left padding aligns a leaf row's icon
under a folder row's, and the STASHES section has no folders, so `.ref-row.stash` takes those 18px
back. The rest is `fitStashCols`, `fitOptCols` one panel over (GC-116): the **sha** is dropped
**whole** below the width the message needs — half a sha identifies a commit no better than none,
and of the five it is the one repeated verbatim a few pixels away, on the graph row GC-170 draws
directly above the same stash — and comes back when there is room, from the panel's own measured
width (the same `ResizeObserver` that answers `fitSections`' column height, with 0 meaning "not
measured yet" and drawing everything). The age is never dropped: it is the question a stash list is
read for and it is repeated nowhere on this screen. `STASH_ROW_W` mirrors `app.css` the way
`OPT_COL_W` mirrors the optional columns, so the arithmetic lives in a test.

Measured in the app on two stashes on `main`: at the default 220px panel the message went from
**48px to 89px** with no sha drawn and the age whole, at 300px the sha is back at its full 41px with
120px of message, and at 420px the message is at its natural 191px. The old claim that "at 300px
and above the name is back at its natural width" was never true.

**And which commit it was taken from, in the graph's own vocabulary** (GC-150): a `.row-sha` beside
the age. A single click selects the stash — the gesture every other row in the panel answers, and
the stash's own sha rather than `Stash.parent`, because GC-170 gave it a graph row directly above
that commit, so selecting it reaches both and opens the stash view. The row takes `.selected` on
either sha, so the panel and the graph agree however the user got there; double-click still
applies. An unloaded parent moves nothing, which `rowIndexOf` already answered (GC-141).

### Diff (`diff/`)

`parseUnifiedDiff` handles `diff --git` headers, `@@` hunks with line numbers, `\ No newline` meta
lines and binary markers; `buildHunkPatch(file, hunk)` rebuilds a patch with the file header minus
the `index` line. `splitHunkHeader` is the range/context split, read off the fence rather than
assuming two `@`s (GC-180).

**And it handles git's combined form, which is what an unmerged path answers with** (GC-180):
`diff --cc <path>`, an `@@@` header whose parent count comes off its own `-` ranges, and one prefix
column per parent on every line. `FileDiff.combined` says so and `DiffLine.combined` carries the
marker string, so the view can say which parent a line came from: a line is in the result unless
some column is `-`, and unchanged only when every column is a space. Two rules follow from it —
**`DiffView` can never render an empty body**, so a parsed file with no hunks takes the same
`.diff-empty` treatment as no file at all (the guard, not the fix: before it, an unmerged path drew
a void under a header claiming a file, with `Stage file` and `Discard changes` live over it); and a
combined diff is drawn as **one column** whatever `prefs.diffView` says, with every `hunk.raw`
button off for the reason `-w` turns them off. On a conflicted file the file-view header follows the
row menu's own rule: `Discard changes` is absent and staging says `Mark resolved`.

**And the layout switch says what is drawn, not what is preferred** (GC-188). `drawSplit`
(`split && !isCombined`) is what both the segmented control and the body read, so a control can
never show a setting that is not on screen — GC-117's rule for the graph's optional columns, one
component over. Split is **disabled with its reason in a `title`** rather than absent, since it
comes back the moment another file is opened, and `prefs.diffView` is never written, so the next
ordinary file opens in the layout the user chose. `.seg-btn:disabled` carries that state for the
whole control, not only for `.toggle`.

**A commit can also be read against the working directory** (GC-152). `getCompare(cwd, sha)` and
`getCompareFileDiff(cwd, sha, path, opts)` are `git diff <sha>` — a third diff **source**, not a
flag on the commit one, so `compare` is part of `DiffView`'s *identity* and the same file at the
same sha can never render under the other's header. Every patch button is off and the sub-header
says why. `App` holds it as `compareSha`, the sha the mode belongs to rather than a flag, so
"selecting another commit leaves the mode" needs no effect at all. `DiffView` replaces the graph while open, and the left panel collapses to an icon
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

**A file can be followed as well as diffed: History is a mode of this view** (GC-166).
`04-panels.md` puts History in the file view's own header, which is the slot `DiffView` already
occupies, so it costs no new window, no new layer and no new Escape case. The `Diff | History`
segmented control sits beside `Unified | Split`; the list is `getFileLog(cwd, path, max)` behind
`repo:fileLog` — `git log --follow` over one path, the same `--date-order` traversal and the same
`LOG_FORMAT` `getLog` uses, both parsed by the shared `parseCommits` so the fields cannot drift,
and deliberately **not** the graph traversal: `--follow` takes one pathspec and walks from HEAD, so
the globs and the hidden set have no part in a question about one file. The path goes through
`repoRelAny()` and not `repoRel()` (GC-198): a history is read precisely for a file the working tree
no longer has, which `repoRel` would refuse for not being on disk, and the containment half of the
check is the one that matters here.

Which body is showing is `DiffView` state carrying the identity it was chosen for, compared during
render like `loaded` and `sel` (GC-075), so opening another file asks the question again. The diff's
own load is untouched by it, which is what keeps GC-014's promise one control over: switching to
History and back reloads nothing, and the list itself is keyed by path, so a visit to it is not a
fetch. Selecting a commit hands the sha **up** (`onOpenCommit`) rather than loading it here — the
file view becomes a commit-source view of the same path, which is the existing load and the existing
header. Every diff-only control — both arrows, both toggles and `Unified | Split` — is disabled with
one reason on it while the list is up, GC-188's rule. `fileMenuItems` carries a **File history** row
that opens the view straight into it, through `FileViewSource.history`, which is not part of
`identityKey`: it says which body is showing, not what is loaded.

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

**One mark per file kind, listed once for both halves of the panel** (GC-143). `FileKindIcon`
draws the file rows *and* the commit view's change readout, which was literal text — `+`, `✎`,
`−`, `→` — so a modified file was a lucide pencil in the list and the character `✎` in the line
above it. The marks are 12px, where the app's 1.75 stroke is a hairline, so they carry a weight of
their own; the pencil is filled instead, because its meaning is the silhouette and a heavier
outline of the same shape is only a fatter outline. Both are props on the one `Icon` — `weight`
and `filled`, the latter `fill: currentColor` on the lucide glyph — rather than a second icon
component: there is one place the app's stroke weight is decided and it stays that way. **The
graph's WIP row is the third surface and now the same one** (GC-183): its three counts draw
`FileKindIcon` under the `kind-*` classes the tokens are keyed by, so the one rule colours the row
and the panel alike and `app.css` no longer carries a second `.add`/`.mod`/`.del` set for it.

**The staging view's three groups collapse, and a closed one is its head alone** (GC-197). The head
is a toggle carrying the left panel's own chevron; a closed `.file-list` is `flex: none`, so the
open group takes the room it releases — measured with 32 unstaged files, the Staged head rose from
y 591 to 176. The open set is stored on **`gitclient.stagingGroups`**, global rather than per
repository for GC-177's reason (the same three groups in every repository), holding only the groups
the user has actually toggled so an untouched one starts open, and pruned of any group that is
currently empty, or a close made while a group had rows would hide them when it filled again. It is
`localStorage` read at mount rather than `App` state on purpose: this panel unmounts behind a file
view and on every tab switch, which is exactly when the arrangement is in use (GC-148). What each
open group is *given* is still an equal share, which is GC-207.

**The stash view offers what can be done with the stash it is showing** (GC-178): the four rows
`stashMenuItems` returns, rendered from that list rather than reimplemented, so a stash dropped
from the panel asks precisely what dropping it from the left panel asks. It needs no guard against
showing a stash that no longer exists — `selectedStash` is derived from the snapshot, so the panel
falls back to whatever the selection then is.

**The staging head's title is centred against the head, not against what is left of it** (GC-196):
`.head-balance` is the trash button's own width mirrored on the other side. The `span` that used to
close that row had no width but still took the head's gap, which put the title 12px off; a margin
compensating for the button alone left 4px, the gap's half. An element the same size as the thing
it mirrors cannot drift that way.

**The file list is the block that gives way; nothing above or below it moves** (GC-191). A flex
item whose `overflow` is anything but `visible` has an automatic minimum size of **zero**, so
`.message-box` — the one block in the column that carried `overflow: auto` — was the only one that
could be crushed, and a 29-file list beside it, having no overflow of its own, crushed it to 12px
of the 160 it wanted. It is `flex: none` now with the cap moved onto its `pre`, so the summary is
whole at whatever height it needs and only the description scrolls; `.file-list` takes
`flex: 1 1 0; max-height: max-content; overflow: auto` and a floor of **its head and one whole
row** and is what scrolls in all three views, with
`.file-row` and `.group-head` `flex: none` inside it — a row's 26px is a basis a bounded flex
column will otherwise shrink, and 29 of them came out at 15px each, all on screen and none
readable. The `.group-head` is `sticky`, since the count and the Stage-all button are what a list
scrolling away would take with it — and because it is, **`.file-list` carries no `padding-top`**
(GC-209): a scroll container with a sticky child carries no padding on that child's sticky edge, in
this panel and in the next one that grows a sticky head. A sticky inset resolves against the
container's *content* box while overflow clips at its *padding* box, so GC-142's 12px left the head
stuck 12px below the line the rows are cut at, and whatever passed through the strip between them
was drawn — measured on a 33-file commit at 1400x900, half a file row above the band, reading as one
file torn in two. A margin or a border sits outside the clip and costs nothing; padding is the one
that cannot. GC-142's own "a rule and the body's own 12px" is the `.detail-body` gap above the
border and is untouched; what went is the second 12px, which was between the rule and the head.
`.file-list .group-head` is the only `position: sticky` rule in `app.css`, and the left panel's
sections are safe by construction — `.section-head` is `flex: none` outside `.section-rows`, which
has no padding of its own (GC-153). What this buys is the staging view: `.commit-form` keeps the
bottom of the panel at every file count, where it used to sit 328px below the fold. `.detail-body`
keeps its own `overflow: auto` as the fallback for a panel too short even for the blocks that
cannot shrink.

**A path is one thing, and the file name is its identity** (GC-192). Both surfaces that draw a
changed file's path — the detail panel's `.file-row` and the file view's `.file-view-head` — put
the dim folder and the bright name in one `.path` flex item, so the row's own 8px gap falls after
the kind icon and before the hover actions and never between the two halves of one path. The
folder is the **only** shrinkable item (`.name` is `flex: none` with `max-width: 100%`) and loses
its **head**, joining the `direction: rtl` rule `.ctx-hint.path` and `.recent-row .recent-path`
already share. Two things there are load-bearing: a large shrink factor is not enough, because
shrinkage is distributed in proportion to factor times base size and a name left 0.03px short is
one Chromium draws an ellipsis in — measurably whole and visibly `…Name10.t…`; and the folder's
text is re-isolated LTR inside that RTL box, or the trailing `/` is reordered to the other end
(GC-093).

**The lists share the column by what each one holds, and flexbox is what does it** (GC-213, the
behaviour `GC-207` specifies). `flex-basis: 0` asks for an equal share and `max-height:
max-content` clamps a list to its content; resolving that max violation freezes the item and
redistributes what it gave up to the others, repeatedly — which is `fitSections`' fill, level by
level, with no measurement, no `ResizeObserver` and no state. It replaces `flex: 1 1 auto`, where
the basis was each list's content and shrinkage is proportional to basis, so the **bigger** list
kept the bigger share: measured at a 400px panel with 6 unstaged and 38 staged, Unstaged was
given 76px — one whole row and a sliced second, for six files — against Staged's 416. It is now
202 (all six rows, no scrollbar) and 290 (nine rows and a scrollbar), and the inverse case is
symmetric: with 42 unstaged and 2 staged, Staged takes exactly its 90px of content and Unstaged
the remaining 402. `.commit-form` sits at y 647 in every one of those, which is GC-191's promise.
A closed group is `flex: none` and still takes no part (GC-197). **`GC-207` is still open**: what
is left of it is its unit test, which has no function to test here, and whether the split should
be draggable.

**A list's floor is its head and one whole row** (GC-213), `calc(30px + var(--sp-1) + var(--row-h))`,
built from the parts rather than rounded so a list sitting on it ends *between* rows and never
through one. It was 30px — the head alone — which is exactly what GC-153 rejected one panel over:
measured on a 620px window with 1 unstaged and 17 staged, Unstaged was given 30px and its single
file was not on screen at all, and Staged came out at 182px, which is a head, five rows and a
sixth sliced through the middle. This is the floor only; **how the lists divide what is left is
`GC-207`**, still `todo`, and it names this value as its own.

**One boundary treatment, listed once for both views** (GC-142). A block in `.detail-body` is
either a **card** — the message box, a banner, an error — or a
**section**, separated from the block above it by a 1px rule and the body's own 12px: `.author`,
`.readout` and `.commit-form`, with `:first-child` taking neither. `.file-list` is the exception
and takes **no rule** (GC-213): it is the one section that opens with a filled, inset head, so the
hairline was a second divider sitting directly on the first, and the body's own 12px gap already
separates it. A file list's
`.group-head` is a band rather than a second hairline, which is what makes Unstaged and Staged read
as two groups, and the commit view's file list carries the same head so a file list is one thing in
both views. **A banner is a card with a coloured edge, not a coloured outlined box** (GC-213): the
app's raised surface at the app's own radius with a 3px `--sel-bar`-width bar at its leading edge
— warning, danger or, for the working-directory banner, the accent — drawn as an inset shadow so
it follows the radius. The outline it replaces was a saturated ring in a window whose one rule is
that saturated colour means a branch, at the last `--radius-sm` in the panel, and `.info` drew the
accent as a full border *and* a tinted field. **`.author` is a wrapping flex row — avatar, identity, parents — and the parents take a
line of their own rather than being crushed on this one** (GC-142, GC-157, GC-196). It was a
three-column grid whose parents column gave way, which fixed GC-157's overlap and then went one
step too far: measured at the panel's 300px minimum, the date's floor resolved to 165px and it
wanted exactly 165, leaving `parent: 7774cac` a 46px column for 49px of text — 2.5 lines, 40px tall
in a 53px block, with the sha cut at the panel's edge. Neither could yield to the other because at
that width the row does not hold three things at all. So the identity is the one flexible item,
carrying `--author-when-w` as its basis, `.parents` is `flex: none` held right by `margin-left:
auto`, and the wrap is what happens when even that basis cannot be met: nothing is clipped at any
width, which the grid could not promise. `--author-when-w` (180px) is a measured metric in
`tokens.css` — the authored line wants 172px in the one format GC-133 settled. **The authored line reads the distance, not the instant**
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
it replaced could only say in a tooltip: which stash it is, its message, and how long it has been
there. That message is **`stashMessageText`'s**, not the raw one (GC-213): GC-170 drew git's
`On <branch>: ` here on purpose, the marker having managed only a tooltip, but the prefix is the
one part that says nothing — the head one line up already names the stash, every stash taken on a
branch carries the same words, and they pushed what the user actually wrote off the front of the
title. All three surfaces that draw a stash message now agree; the whole one is on the `title`,
and `stashRename` still stores and edits the untouched string. Its four actions are
`stashMenuItems`' own items rendered as buttons (GC-178), drawn at `MenuItem.short` where an item
has one — see the UI layer. **The commit view's header draws its refs as chips, not as git's decoration** (GC-087):
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
asks first and the confirmation says so. It is absent when there is nothing at that sha to restore,
and **which kind that is depends on which list the row came from** (GC-187): `FileMenuTarget`'s
source is `commit` or `compare`, because the two read `CommitFile.kind` in opposite directions — in
a commit `deleted` means the commit removed the file, while in a comparison the codes are relative
to the commit, so `deleted` means the working tree has since lost a file the commit still has, which
is the case restoring exists for, and `added` is the empty one. The three
"Ignore …" rows are offered on an **untracked** row only (GC-093) — a tracked file is in the index,
where `.gitignore` has no say — and their hints are bare paths, because `.ctx-hint.path` ellipsises
by turning the box RTL and a `/` at either end is reordered to the other one.

### Preferences and remembered state

`prefs.ts` is the single home for user settings: a typed `Prefs` with `DEFAULT_PREFS`, persisted as
one JSON blob under `gitclient.prefs`, read with `usePrefs()` and written with `setPrefs(patch)`.
`load()` validates each field and falls back to the default, so a hand-edited blob cannot break the
app. Settings: `avatars`, `pullMode`, `commitColumnGuide`,
`diffView`, `diffIgnoreWhitespace`, `diffWordWrap` and `graphColumns` — the one nested value, so `load()` falls
back per column and a `defaults()` helper copies it, a bare spread having shared the nested object.
Adding a setting means: a field with a default in `prefs.ts`, validation in `load()`, a row in
`components/Preferences.tsx`, and reading it with `usePrefs()`. There is no OK/Cancel; every change
applies immediately.

**`theme` and `windowMaterial` are no longer settings** (GC-213). There is one palette and one
material, so `resolveTheme`, `applyTheme`, the `prefers-color-scheme` listener, the `data-theme`
stamp and the round trip that asked the main process which material it had applied are all gone;
what is left in `prefs.ts` is what a preference actually is, a value the user picked. A blob
still carrying the two old keys loads cleanly and drops them, which is a unit test. The material
is stamped by `main.tsx` from a `?material=acrylic` query parameter the **main process** puts on the
URL, before the first render — see Styling.

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
| `gitclient.sectionOpen` | which of the left panel's sections are open, only the ones toggled (GC-177) |
| `gitclient.stagingGroups` | which of the staging view's three groups are open, only the ones toggled (GC-197) |
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

`tokens.css` defines everything: the type stack, 14px/20px base, 12px rows, the surfaces, text as
white alphas (.90/.68/.52), the accent, semantic colours, ten lane colours and the layout metrics.
`app.css` is one file with a section per component.

**There is one look.** The theme setting (dark / light / system) and the material setting
(mica / acrylic / none) are both gone (GC-213): `tokens.css` is a single `:root` block plus one
`[data-material]` override, and the light palette went with the setting. **No selector anywhere
keys off `data-theme` and nothing stamps it** — `grep -n "data-theme" src/` prints two lines and
both are comments saying so. A rule that brings the attribute back is bringing a second palette
back with it.

**The language is the ChatGPT desktop app, taken for its language and not for its spacing**
(GC-213), the way GC-212 took Fluent's mechanics and left its padding. The density is ours and
unchanged: 28px graph rows, 26px ref rows, 12px furniture. Five things carry it, each stated
where it lives, in `tokens.css`'s own header:

- **Neutral near-black, not blue-black.** Every grey is R=G=B. Fluent's ground was cool — #17191d
  has 6 points of blue over red — and a neutral one is most of why ChatGPT's dark mode reads as
  paper-in-the-dark rather than as a themed window.
- **A tone step, not a stroke.** `--base` (#141414) is the window ground, the two side panels take
  `--bg-sidebar` (#181818) and the graph takes `--bg-card` (#212121), with **no line between
  them** — the sidebar is *darker* than the working surface, which is the structural thing to
  keep. This reverses GC-212's "three panels, one card, divided by strokes" deliberately, because
  the boundary is carried by fill now. `--border` survives only for things that genuinely are
  outlines, and is quieter than it was.
- **Radius rises and the small controls go to a capsule**: 6 / 10 / 16 against Fluent's 4 / 6 / 8,
  plus `--radius-pill` for anything wider than it is tall (a button, a segmented switch, a chip)
  and `--radius-xs` (4px) for the one mark that could not be lifted — at 6px on a 14px box a
  checkbox is 43% round and reads as a radio.
- **The primary action is white**, not the accent: `--btn-primary-bg` / `-fg` / `-hover`, which is
  ChatGPT's send button and its every confirming dialog button. That takes the largest field of
  accent blue out of a window whose lane palette already owns blue.
- **Elevation is a set, not one shadow**: `--elev-4` rests, `--elev-16` floats, `--elev-64` is the
  dialog — softer and wider than Fluent's, which is ChatGPT's own shape.

**Colour means branch; shape means state** — GC-212's rule, kept and taken further. The ten lane
colours are the only saturated colour in the window and `--accent` may not be a large field beside
them: `--lane-8` is hue 218 and the accent is the same blue. A selected row is a **neutral** fill
with a 3x14 `--sel-bar` at its leading edge, drawn as a `background-image` so no row needs a
pseudo-element or a positioned ancestor (`.col-ref`'s folded block escapes its cell on z-index
alone, GC-123) — and since GC-213 that bar is **white**, not the accent, because a mark with no
hue in it says "selected" beside a magenta lane where a blue one said "selected, and also
possibly something about blue". `--head-bar` is green for the checked-out branch, green being a
*state*. What is left of `--accent` is a link, a checked control and the diff's line picker.

**Three rules decide translucency, and the first is the one the others are written around: no
blur behind data, ever.** Not behind a 28px row of 1px lane strokes, not behind a diff, at any
cost in frames. Then: **what floats is glass** — `--bg-menu` plus `--flyout-blur` on `.ctx-menu`,
`.popover` and `.modal` and nowhere else. **A modal blurs the window by blurring the window**
(GC-220): `--content-blur` is a real `filter` on `.app.behind-modal`, not a `backdrop-filter` on the
layer above it. A backdrop samples what is behind it, and on this window that is not a reliable
thing to sample — with the acrylic material on, `body` is 74% and the panels are white tints, so
the filter composites the desktop too, and a sampled blur was measured rendering at neither the
radius nor the saturation its own computed style reported. A filter on the element blurs the pixels
the element drew, identically with or without a material, and it screenshots honestly, which the
sampled one did not. **Every modal is therefore a sibling of `.app`** — the three that were its
last children (Preferences, Shortcuts, the error details) were being blurred along with the window
they stand in front of, which made Preferences unreadable. A menu and a popover are not in this:
they are small and anchored to what opened them, so `modalUp` is the backdrop-carrying layers only. **Both are a small blur and nothing but a blur** (GC-220). Each carried a `saturate()` — 1.8 on
the flyouts, 1.1 on the backdrop — meant to stop a translucent surface going grey as it averages
what is under it, and what it did instead was bloom: a blur does not dim what it smears, so a 2px
lane stroke at full chroma comes out as a wash the width of the radius and a filled ref chip as a
blob the size of the chip plus the radius, with the lift putting back exactly the chroma the
spreading had diluted. Dropping the `saturate()` is **half** the fix and was measured not to be
enough alone — at 20px a magenta chip is still a magenta blob, just an unboosted one — so the
radius comes down to 8px as well. Both alphas are untouched: the fix was the filter, not the
darkness. A `saturate()` added back, or the radius taken back up, is the bloom back with it. **The sticky file-list head takes the same treatment**, because its own filter stacks on the backdrop when a dialog is open: at `blur(18px) saturate(1.5)` the two heads came out more blurred and more saturated than the rows between them, so a panel behind a dialog read as bands rather than as one surface. One blur, one radius, no chroma lift, on every surface that has one.
And: **nothing in the window is ever at the mercy of what is behind it** — the chrome
— and **there is exactly one scrim.** `body` carries `--window-scrim` and nothing else does: the
chrome paints nothing and simply shows it, `.main` paints nothing, and its children carry white
**tints** over it (`--bg-card-glass` for the working surface, `--bg-sidebar-glass` for the two
panels) reproducing the flat ramp's own steps — ground, +4 for a sidebar, +13 for the work.
`.main > *` rather than the containers by name, because the centre is `.graph-panel`,
`.file-view` or the empty state depending on what is open. All flat alphas rather than filters,
so the graph pays nothing per frame and the blur is the OS's, already applied behind the window.

Two wrong answers came first and both are worth knowing. **A scrim per surface** gave the side
panels 0.56 over the card's 0.76 — they are its *children*, so it composited to 0.89 while the
chrome beside them sat at 0.66, and the window read as three unrelated materials with the header
the most see-through thing on screen. **Matching the alphas** fixed the chrome and left the last
hole: the `--card-inset` gutter around the card is painted by no element but `body`, so that 8px
frame was raw acrylic with no scrim at all. One scrim on the one element that covers the whole
window is what makes the gutter, the title bar, the toolbar and the status bar the same pixels.

**The sticky file-list head is the one exception to "no blur behind data"** (GC-213), and it is
stated as one rather than smuggled in: what is behind it is file rows. It is a 30px strip in a
400px panel rather than the graph or a diff, so the frame cost the rule is written about is not
in question; nothing is meant to be legible through it, since it is an occluder and a blur is the
strongest form of occluding there is; and it is what the reference does. `--head-blur` is **not
load-bearing for legibility** — `--bg-subtle`'s own alpha is what stops the text being read, and
the blur is what keeps the remaining 7% from being a ghost of a glyph rather than a smear.

**Two surfaces stay opaque under the material, and both have to.** `--bg-subtle` is the sticky
file-list head (GC-209), so its job is to hide the rows passing under it; `--node-fill` is the
graph node, whose job is to interrupt the lane line it sits on. Both took a token the material
turns into a white veil so a *field* lifts the glass, and both stopped occluding — the node most
visibly, with the lane line running through every circle in the graph. **All three node kinds
take `--node-fill`**, where they used to take three different values: over a flat ground that
read as a raised disc and two holes, and over glass as a grey disc and two dark spots, because a
hole needs something behind it to be a hole in. The dash is what says a node is not a commit.

**The face is Inter** (GC-213), bundled as `@fontsource-variable/inter` and as close to ChatGPT's
as Windows can get — SF Pro is macOS-only and ChatGPT Sans is not distributed. One variable file
covers the whole weight axis, and `optical-sizing: auto` on `body` drives Inter's own optical axis,
which is what **replaces GC-212's three named Segoe cuts**: the size-keyed family rule that named
every container wholly 12px and under is gone, and nothing has to be kept in step with it. Segoe
UI Variable stays in the stack behind Inter and Open Sans behind that.

**The window material is the one piece of glass CSS cannot draw**, since `backdrop-filter` reaches
only inside the page and what is behind this window is the desktop. It is **acrylic, always, where
the OS can give us one** — no longer a preference. **Acrylic and not mica, which GC-213 tried
first and got wrong**: mica is a desaturated, heavily blurred wallpaper *tint* that Windows draws
to be almost invisible, and behind a content card at any alpha the graph is readable through it
comes to nothing — on the real window it looked like no transparency at all. Acrylic is the only
material on this platform that reads as glass. Its cost is real and accepted: Windows flattens an
acrylic window to a solid colour whenever it is **not focused**. `glassAvailable` in `ipc.ts` is Windows 11
(build 22000+) **and not stealth**: an offscreen window has no OS window for the compositor to put
anything behind, and a translucent stylesheet over a ground nothing paints would bring every
unattended screenshot back over a void. `index.ts` builds the window with it *and* puts
`?material=acrylic` on the URL, so `main.tsx` stamps `data-material` **before the first render**
rather than a round trip later (GC-213 — the IPC channel and `prefs.ts`'s `applyMaterial` both
went). `backgroundColor` must be transparent whenever the material is on, or the window's own fill
paints over it. **A material cannot be tuned without a real on-screen window**: an offscreen
render has no material at all and a harness backdrop is a guess at one, so every value in that
block was set from a screenshot of the actual app and should be changed the same way.

**Every colour lives in `tokens.css`, none in `app.css`** (GC-013), and with one palette that is
now the whole of the rule: a new colour is a token or it is in the wrong file.
`grep -nE '#[0-9a-fA-F]{3,8}|rgba?\(' app.css` must keep printing nothing, which
`tools/repo-hygiene` does not check and a reviewer should.

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
- **A control that answers the pointer answers with a shape, not with alpha** (GC-193). The two
  vocabularies are `--accent-hover` (every row in both panels) and `--hover-overlay` (a control on
  the title bar or the toolbar); a hover that only lifts `--text-muted` to `--text-bright` is 25%
  of alpha on a 10px label and is not one. The tab row's rule is a **`background-image`** — a
  single-colour `linear-gradient` — because that composites over whatever `background-color` the
  element already has, so one rule answers both an unselected tab, which tints the title bar
  showing through it, and the **selected** tab, which lands one step above its `--bg-toolbar` and
  had no hover response at all. `.tool-btn` takes `--hover-overlay` as an ordinary background
  inside the 4px-inset box its own margin makes, `:not(:disabled)` so a disabled button still
  answers with nothing, and its colour stays in a rule `.tool-btn.active` outranks.
- **A control that opens a menu draws a chevron** (GC-194). Both toolbar crumbs are
  `owner`-anchored dropdowns and were the only controls in the window that opened one silently,
  while the same window drew `ChevronDown` on the recents button, on `.pref-select` and on the
  split buttons' caret. `.crumb.as-button` is a row of a `.stack` and that icon, so the menu still
  hangs off the crumb's own bottom-left corner and the chevron is part of the button rather than a
  second target.
- **One global `::-webkit-scrollbar` rule set** near the top: 8px, a flat thumb at a 4px radius,
  transparent track and corner, no buttons. Every scroll container gets it with no per-component
  rule. Do **not** also set the standard `scrollbar-width` or `scrollbar-color`: either makes
  Chromium ignore the `::-webkit-` rules, and neither can remove the arrow buttons.
- The app grid uses `grid-template-columns: minmax(0, 1fr)` and `.main` has `min-width: 0;
  overflow: hidden`, or nowrap commit messages grow the frame past the window.
- Section headers are uppercase via CSS, so tests must compare `textContent` lowercased.

**Motion is a token, and that is the whole of why it can be switched off** (GC-214). `tokens.css`
carries three durations — `--dur-1` (90ms, the pointer's own answer), `--dur-2` (140ms, a control
or a flyout), `--dur-3` (220ms, the window changing) — four curves (`--ease-standard` for most of
it, `--ease-out` for entrances, `--ease-in` for the one thing that exits, `--ease-settle` for the
app's single overshoot), the distances a surface travels as it arrives, and `--dur-spin`. **Every
transition and every keyframe in `app.css` is written from them**, because the app's entire answer
to `prefers-reduced-motion: reduce` is one block at the end of `tokens.css` that overrides those
values and nothing else: the distances go to zero, the overshoot goes flat, and the two longer
durations come down to the shortest, so an animation written after it is covered by it
automatically. A literal duration in `app.css` is invisible to that block —
`grep -nE '[0-9]+m?s' app.css` should find them only inside comments. The shared vocabulary (the
keyframes, and the one transition that answers a hover) is a **Motion** section near the top of
`app.css`; where each is used stays in its own component's section like every other rule.

The personality is the sober one, one step faster than the archetype's 200/300/450, because almost
every animation in this window is the direct answer to a pointer and the interaction budget — a
hover inside 100ms, a press inside 150 — binds before the element-size table does. Three things do
not move at all, and each is a rule rather than an omission:

- **Nothing in the data.** No transition and no animation on `.graph-row`, its cells, a ref chip or
  a diff line. A virtualised row is the same DOM node holding a different commit a moment later, so
  a class landing on it is not a state *changing*; transitioned, a fast scroll leaves selection and
  match tints fading in and out of rows they never belonged to. It is also the one thing the window
  exists to draw, and it pays nothing per frame — the same rule that keeps a blur off it.
- **Nothing a fit function measures, incidentally.** The panel widths, the ref column and the left
  panel's section heights are computed from measured rects (`fitPanels`, `fitRefCol`,
  `fitSections`, `onNatural`), and a `ResizeObserver` firing on an intermediate size runs the fit
  against a width that exists for 140ms — dropping a column, and another on the way back. The word
  is load-bearing: what is forbidden is a *hover* or an *entrance* moving a box something else is
  reading. The **left panel's own collapse is the exception**, and the only layout in the window
  that animates, because there the width change is precisely what the user asked for and the graph
  re-fitting as it happens is the answer rather than a side effect — it is also the path a drag on
  the panel's edge already takes sixty times a second. See the drawer, below.
- **Nothing on the way out.** Entrances only. A menu, a popover and a dialog are unmounted the
  moment they close, and keeping a dead layer on screen long enough to animate it would put
  something clickable over the app, leave the e2e suite waiting on a layer that is visibly gone and
  not yet absent, and make `App`'s one-Escape-one-layer rule a question of timing.

What does move: the two flyouts open out of their anchor (`flyout-in`, 96% with `transform-origin`
at the corner they are placed by), a dialog and its backdrop arrive (`dialog-in`, `fade-in`), a
banner and the status bar's busy, error and notice lines rise into a slot the layout has already
given them (`rise-in`), the file view fades while its head rises — its body is code being read, and
4px of travel is 4px of text sliding under the reader's eye — every control answers the pointer in
90ms, a button gives 3% under it, and a checked box's tick is the one mark in the window that
overshoots.

**The side panel is a drawer, and it is the one layout in the window that animates** (GC-214):
`width` on `.left-panel` at `--dur-3`, which covers both directions at once because `LeftPanel`
returns two different `<aside>`s from the same place in the tree — React reuses the node and only
the class changes, the rail's `width: 44px` against the panel's own variable, so nothing had to
learn that a panel can be "closing". Its contents are the second layer: `.panel-head`,
`.sections` and the rail's items each fade in behind the edge on a `--dur-1` delay with
`animation-fill-mode: backwards` — without the fill they are drawn at full strength through the
delay and the fade becomes a flash. Because the standard curve front-loads the distance, the
panel is at 90% of its width by the halfway point, so the contents land in a box that is
already the right size. Two things hold it up: `.app.resizing .left-panel` sets
`transition: none`, because `useDragWidth` writes a width per `pointermove` and GC-111/115/118
are three tickets about that width being the one the pointer is at; and `.panel-head` and
`.sections` clip themselves, since `overflow: hidden` on `.left-panel` — the obvious place —
would take half of `.panel-resize` with it, the handle straddling the panel's edge on a -2px
margin. Measured frozen mid-transition at 55/110/165ms: nothing spills the panel's box at any
width. **The detail panel does not do this**, and cannot without new state in `App`: it is not a
class on a surviving element but two different elements, `.detail-panel` and the 16px
`.detail-reveal`, so closing it unmounts the thing that would have to shrink.

**An action that takes time says so in three places, and none of them for an action that does
not** (GC-214). The layers are the control, the words and the window: `ActionMark` puts a spinner
in the acting button — sharing one grid cell with its icon, which fades out under it, so nothing
moves — the status bar's busy line says what is happening in prose, and `.busy-sweep` draws an
indeterminate band along the bar's top edge for the one kind of command whose length nothing here
can predict, a command that has left the machine. Indeterminate because there is nothing to
determine: git writes its progress to a stream `runGit` buffers and never reads, so a percentage
would be a fiction. Linear, like the spinner — an eased loop appears to stall twice a turn, and a
progress indicator is the exception the "never linear for spatial movement" rule itself names.

**`--dur-work` (200ms) is the threshold under which none of it is drawn at all**, and it is the
part that matters most: a commit here takes 40ms and a push to GitHub takes four seconds through
the same code, so a spinner drawn at once flashes on nine actions out of ten and reads as a fault.
It is an `animation-delay` with `backwards` fill rather than a timer — an element removed before
its delay elapses was never painted — so the fast path costs nothing and there is nothing to
remember to cancel. Sampled on the running app at 20ms: a pull was `working` at t=22 with the
spinner and the sweep both at opacity 0, crossed over between t=221 and t=281 (spinner 0→0.97,
icon 1→0), and a Refresh that finished inside 120ms drew neither. Measured the same way, the tick
that follows lives `--dur-done` (700ms): up by t=343, held, gone by t=821. In the narrow band
where an action takes 200-350ms the spinner is brief, and that is accepted rather than fixed with
a minimum-display timer: what follows it is always the tick, so the eye reads "working, then
done" rather than a mark that appeared and vanished into nothing.

The success mark is the app's second overshoot and the same one: `--ease-settle`, on the same
grounds as the checkbox's tick — a small mark standing for a decision that landed. Its easing is
**per keyframe**, because one curve over the whole animation would overshoot the fade-out too and
a mark that bounces on its way out is still moving when the eye arrives. **The mark unmounts on its own `animationend`**, which is
exact, needs no timer and is what lets the icon underneath know the flourish is over: the first
version left it in the tree at `opacity: 0` with `forwards` fill, and a permanent mark meant the
toolbar icon either stayed hidden for good or came back *under* the tick — measured on a Refresh
whose arrows rendered tinted green, since a check over a circular arrow is still mostly a circular
arrow. The icon steps aside for the spinner on `.working` and for the tick on `:has(.done)`, which
is the only thing that knows the tick is showing. And the button that is working keeps
`opacity: 1` while the rest of the row is dimmed by `:disabled` — "unavailable" and "busy" are
different things and the row reads better for saying which is which.

The status bar deliberately does **not** shake on an error: that is a state with a
dismiss button on it, not a transient alert, and a thing that shakes on arrival still has to be
read afterwards.

**An entrance that scales is a rect that lies** (GC-214). `ContextMenu`'s viewport clamp measures
`offsetWidth`/`offsetHeight` and never `getBoundingClientRect()`: it runs in a layout effect before
the first paint, which is exactly when the keyframe's own 96% is what the element computes.
Measured on the running window, 284.73 painted against 297 laid out — 12px of a 420px branch menu
hanging over the right edge. A surface that animates is measured by its layout box.

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
- And it ends an animation under **both** names (GC-214). jsdom defines no `AnimationEvent`, so
  React asks at startup whether the unprefixed event exists, concludes it does not, and registers
  `webkitAnimationEnd`: an `animationend` dispatch then reaches the element — a hand-written
  listener sees it — and never reaches the component. `ActionMark.test.tsx` fires both, and the
  one that lands on an already-unmounted node is harmless.
- It must **not** call `vi.resetModules()` when React Testing Library is imported statically: a
  re-import hands the component a second React instance and every hook throws. Only
  `prefs.test.ts`, which renders nothing, re-imports (its `load()` runs at import time).
- Both tsconfigs include the tests, so `npm run typecheck` covers them. The `.test.ts` in the
  `tools/**` include is deliberate: every other script there is `.mjs`, so `tools/e2e/run.mjs` can
  never be swept into the suite or the typecheck.
- `watch.test.ts` needs no Electron and no build; `npx esbuild --loader=ts --format=esm <
  src/main/watch.ts` shows the one runtime import it has.

535 tests today, one file per module covered. Three are not about the app: `tools/repo-hygiene` fails

on any C0 control byte that is not TAB or LF (CR included) across `src/`, `tools/` and the root
markdown — **`TICKETS-ARCHIVE.md` included, and the tree-walk test names it outright** (GC-158), so
the 82% of the backlog GC-145 moved into it cannot fall out of rule 6's guard again with nothing
failing — it is what guards rule 6 above — **and on a backlog whose two files disagree** (GC-145):
`backlogProblems` is pure and reports one sentence per problem, so a `done` section or row left in
`TICKETS.md`, a row disagreeing with its section or one resolving to nothing fails `npm test` rather
than being noticed months later (GC-174 moved the `done` rows to a board in the archive). `tools/backlog`
pins the routine's lock check and batch selection on synthetic text.
 `tools/scratch-worktree` pins the property whose violation cost this checkout 129 packages
(GC-189): a worktree's junctioned `node_modules` is removed as a **link**, never recursively, and
the target's contents survive. `addWorktree`/`removeWorktree` are the one safe order — unlink the
junction, assert it is gone *and* that this checkout's `node_modules/.bin` still exists, only then
`git worktree remove` — and the guard refuses rather than repairs, leaving the worktree standing,
because an unremoved worktree costs a `git worktree prune` and a recursive delete through a live
junction costs an `npm install`. Every session following the review routine's isolation recipe by
hand should call it instead.
`tools/launch-app` covers the attach path against a fake CDP endpoint, and the ownership a launch
takes over the app it spawned (GC-154) against a sleeping node process — a unit test never starts
Electron, and `ownChild` cares only that it was handed something with a pid. GC-162's graceful stop
is covered the same way: a fake CDP whose `/json/close` stops that process is the app asking to be
closed, and a port nobody holds is the fallback.

### The e2e suite

`npm run e2e:setup && npm run e2e`, after a build. `run.mjs` launches through
`tools/launch-app.mjs`, so the whole suite is stealthy, and drives the built app over CDP,
asserting against git after each step. 43 steps, 334 assertions. It ends with
`total: 57.7s | git: 412 calls, 12.0s` — measured 2026-09-19, and the clock is worth reading as a
comparison rather than as a constant: the same suite has ended at 45s on an idle machine and takes
about twice that with another Electron and a build running beside it. The line is
the run's own clock (GC-080) beside the cost of its own
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
its own branching out of its parent rather than a marker in its ref cell, rows built by `displayRows` so
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
status icons leading a chip's name and kind icons trailing it, with every trailing mark giving
way together so a narrow column costs the name nothing, and a band joining the last chip to its
node in two halves that meet at the column boundary (Graph); one mark per file kind across both
halves of the detail panel, with the per-icon weight a prop on the one `Icon` (Detail panel); a
tab strip that scrolls rather than pushing the bar's buttons under the window controls, and the
showing tab scrolled into view on every change including the first (App state); a clone named
before it is spawned and run in the parent folder, so the path it answers with is the path git
used (Main process); the ref filter parked with its tab like every other piece of the user's own
input (App state);
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
a combined diff parsed rather than silently drawn as a void, a body that can never be empty and
one column of code whatever the layout preference says, a conflict resolvable to a side git
actually holds a blob for and labelled by the operation rather than by the flag, a commit readable
against the working directory as a third source in the view identity with every patch button off,
the WIP row's field the one commit draft rather than a decoy, a tab answering a right-click with
several tabs closed through one path so the stored list is written once, and a stash row selecting
the stash the graph draws a row for (Diff, Main process, App state, Graph);
the lane band right of the node on every row and the chip connector a 2px line with nothing under
it, a layout switch reading what is drawn rather than what is preferred, a third dialog button that
fills the form in never gated on the form being complete, a restore whose direction is read from
the list the row came from, one scheme check shared by the two places a URL can reach
`openExternal`, and one `direction` rule for both surfaces that draw the recents (Graph, Diff, UI
layer, Detail panel, Main process);
a file's history a mode of the file view rather than a screen of its own, with the diff's own load
untouched by the switch and the picked sha handed up rather than loaded in place, a stash row's age
in a box that does not move with its phrase and git's prefix off the drawn line on both surfaces
that draw it, an empty tab closing itself only when it hands the user to another one, a
`.git/config` write scoped to the full reload the remotes need, and the light surfaces holding the
dark ramp's ratios rather than its lightnesses inverted (Diff, Graph, App state, Main process,
Styling); a scratch worktree's junction removed as a link, with the removal refusing rather than
reaching through it (Testing);
the file list the block that gives way while the message box and the commit form keep their place,
a row inside it `flex: none` so it scrolls rather than being squeezed, a path drawn as one item
whose folder is the only half that may shrink and loses its head with its text re-isolated LTR, a
hover that carries a shape and answers the selected tab as well, a control that opens a menu
drawing a chevron, a modal's horizontal padding on its children so the scrollbar sits at the
dialog's edge, and the left panel's open set remembered beside its heights (Detail panel, Diff, UI
layer, Styling, Graph);
the bar drawing the line that says why rather than the first one matching, every multi-line failure
offering the whole of git's message with only a credential refusal raising it unasked, the band
starting at the node's centre with a dashed node masking it, the staging groups collapsing under an
open set stored where the left panel's is, a stash view offering the stash menu's own rows, the WIP
row's counts drawn with the panel's file-kind marks, and the author block's parents wrapping rather
than being crushed (App state, Graph, Detail panel);

a force push offered from one place only, always with a lease and never from an error message, with
the amend that leads to it saying so; no padding on the sticky edge of a scroll container that has a
sticky child; the containment check split from the working-tree one so the handlers that cannot have
the second still get the first; a stash row's sha dropped whole for its message and its age given
the widest phrase it can produce; the band's paint a falloff from the lane defined once for all
rows; and the folded block opened in a run by the class the CSS treats as hover, so a rendered
stylesheet is what answers for it (App state, Detail panel, Main process, Graph, Testing);

the chrome painting nothing so the window's material shows through it, no blur ever behind data and
glass only on what floats, a modal that blurs the window rather than sampling it, with every modal a sibling of the window so none is inside its own blur; a merge commit marked on its node rather than only in the lines; a divergence put as a choice rather than as a sentence; a heading given its own leading, and the first-child reset scoped to the sections whose separator it removes rather than to any card that happens to be first; an accent that may not be a large field beside the lanes so state is a
shape and colour is a branch, elevation a set of three rather than one shadow, and a window
material asked for only where an OS window exists to put it behind (Styling);

one look and one material, with the theme and the material settings deleted rather than defaulted
so no selector keys off `data-theme` and nothing has a second palette to drift from; the sidebars
separated from the working surface by a **fill** rather than a stroke, and darker than it; the
primary action white because colour in this window means a branch or a state, never an action;
the selection bar white for the same reason; the material decided before a renderer exists and
carried to it on the URL so it is stamped before the first frame rather than a round trip later;
one variable face with its own optical axis in place of three named cuts kept in step by a list
of selectors; the lane palette softened with **every hue held** and the one pair that has always
been on the 100-degree line nudged clear of it; and the sticky file-list head the single surface
allowed to stay opaque under the glass, because an occluder that lets the rows through is not one
(Styling, Graph, Detail panel, Main process);

an action that takes time answered in three layers — the control that started it, the words, and
an indeterminate line for a command that has left the machine — with none of it drawn until the
work has lasted `--dur-work`, and a success marked where the click was while a failure is left to
the sentence that explains it (Styling, App state);

motion written only from the duration and easing tokens, so one `prefers-reduced-motion` block
answers for all of it including what is written later; nothing animated in the data, and nothing
incidentally animated in what a fit function measures — the side panel drawer being the one layout
that moves, because there the width change is the thing asked for; entrances only, with a dismissal
instant; and a scaling entrance measured by its layout box rather than its painted one (Styling, UI
layer);

a checkout attempted rather than asked about, because git carries the working tree across wherever
it can, with the question moved onto git's own refusal and answered by the way through rather than
by "anyway" — and the conflicting pop that may follow named in words, the kept stash included;
a remote branch taking you to the commit it points at rather than only to its local copy, with the
catch-up a fast-forward and nothing else, and the two names a checkout needs when the branch landed
on is not the ref gone to; and
a stash drawn as a child of the commit it was taken from, in a lane of its own with the join drawn
by the parent's row, never over the line already in the parent's lane; a dash whose period
divides the row height, because every row is its own `<svg>` and a pattern that does not tile
staggers once per row down the whole of a long run; and no working-directory row without a working
directory — with HEAD's reserved lane above it then drawing the run or nothing at all, and the
selection falling to HEAD by derivation so that the row coming back takes it straight home
(App state, Graph);

stealth launches, narrow stops asked for before they are taken, the per-port profile, and a launch owned by the process that made it
until that process stops or releases it (Commands); the LF working copy, control
characters as escapes, study-never-copy, no writes against the real repositories (The rules).

Memory for this project lives in the Claude memory directory (`gitclient-project.md`) and points
here. `README.md` is the public-facing overview with the same commands and dependency notes.
