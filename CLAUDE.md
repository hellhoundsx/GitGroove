# GitClient: handover for Claude sessions

Read this first. It captures everything a fresh session needs to continue the work without
re-deriving it. Keep it current when you change conventions, tooling or the roadmap.

## What this project is

A desktop Git client built from scratch whose UX is modelled on GitKraken Desktop 11.10.0.
Owner: Ricardo Gomes (`ricardo.gomes@catenamedia.com`), Windows 11, 3440x1440 screen.
Started 2026-09-05. About 5,100 lines of TypeScript, CSS and scripts so far.

Two hard rules:

1. **Study GitKraken, never copy it.** GitKraken is proprietary. `docs/reference/gitkraken/`
   holds observations (layout, measurements, colours, behaviours, screenshots) gathered by
   inspecting the running app over the Chrome DevTools Protocol. Nothing from GitKraken's
   bundle, CSS, icons or string table may be copied into `src/`. Colours and sizes in our
   tokens are our own values calibrated against the measurements.
2. **Never run write operations against Ricardo's real repositories** (`catena-feed`,
   `kyushu-route` under `C:/Users/Ricar/Documents/apps/`). Read-only loading for screenshots
   is fine. Anything that stages, commits, checks out, stashes, pushes or resets runs against
   the disposable e2e repository only (see Testing).

The project is a git repository (initialised 2026-09-05, branch `main`). `.gitattributes` pins
the working copy to LF (`* text=auto eol=lf`) because the system Git config has
`core.autocrlf=true`; do not commit unasked.

## Stack and version constraints

| Piece | Version | Notes |
| --- | --- | --- |
| Electron | 44 | frameless window with `titleBarOverlay`, renderer draws its own tabs bar |
| electron-vite | 5 | main + preload built as CJS, renderer as a Vite client bundle |
| Vite | 7 | **must stay on 7**: electron-vite 5 supports Vite 5 to 7 only |
| @vitejs/plugin-react | 5 | **must stay on 5**: 6.x requires Vite 8 |
| React | 19 | no global `JSX` namespace, components `import { type JSX } from 'react'` |
| TypeScript | 7 | `baseUrl` is gone, tsconfig `paths` are relative; `tsc --noEmit` per target |
| lucide-react | 1.x | the only icon source; wrap with `Icon` from `src/renderer/src/ui/icons.tsx` |
| @fontsource/open-sans | 5 | UI font, imported in `main.tsx` (400/600/700) |
| vitest | 5 | unit tests, two projects (node + jsdom); its Vite peer range is `^6.4 \|\| ^7 \|\| ^8`, so it does not force a Vite bump |
| jsdom | 30 | the `dom` project's environment; vitest peers it as `*`. `npm install` prints an `EBADENGINE` for it on Node 25 exactly as it does for vitest — a warning, and the suite runs |
| @testing-library/react | 16 | component rendering; peers React 18 or 19 and has no Vite peer, so it cannot force a bump. Needs `@testing-library/dom` 10 alongside it |
| git | system `git` on PATH | all repository access shells out, no libgit2 |

Node 25 and npm 11 are installed; no pnpm, no Rust (Tauri was ruled out for that reason).
`npm install` prints an `EBADENGINE` warning for vitest 5 (it wants Node 22/24/26+ and this is
Node 25); it is only a warning and the suite runs. Do not "fix" it by downgrading Node.

## Repository layout

```
TICKETS.md             the backlog: one ticket per startable task, each with a status (see roadmap section)
vitest.config.ts       unit-test config: the renderer aliases, src/**/*.test.ts, node environment
src/
  main/index.ts        Electron window (1400x900, dark background, overlay title bar), loads out/renderer
  main/git.ts          every git call; spawn('git', BASE_ARGS + args) with LC_ALL=C, GIT_TERMINAL_PROMPT=0
  main/ipc.ts          ipcMain.handle registrations with argument validation
  main/watch.ts        fs.watch recursive on the repo root, debounced, pushes repo:changed (GC-011)
  preload/index.ts     contextBridge: window.api (GitApi) and window.platform
  preload/index.d.ts   Window typing for the renderer
  shared/types.ts      Commit, GitRef, Stash, Remote, StatusEntry, RepoStatus, RepoSnapshot, GitApi ...
  renderer/index.html  CSP: self + gravatar.com images + bundled fonts
  renderer/src/
    main.tsx           fonts, tokens.css, app.css, <UiProvider><App/></UiProvider>
    App.tsx            all state and every git action (see "App state and the run() wrapper")
    components/        TitleBar, Toolbar, LeftPanel, DetailPanel, StatusBar
    graph/             lanes.ts (layout algorithm) + lanes.test.ts, GraphCell.tsx (one row's SVG), CommitGraph.tsx
    diff/              parseDiff.ts (unified diff parser + hunk patch builder) + parseDiff.test.ts, DiffView.tsx
    ui/                ContextMenu, Modal, UiContext (openMenu/prompt/confirm), icons, Avatar, avatars
    styles/            tokens.css (design tokens), app.css (all component styles, one file)
docs/reference/gitkraken/   the GitKraken study: 6 notes files + 19 screenshots (README has the index)
docs/screenshots/           screenshots of OUR app for the README
tools/launch-app.mjs        the only way to launch the built app: stealthy by default, --visible to show it
tools/gk-recon/             CDP driver + PowerShell helpers used for the GitKraken study
tools/e2e/                  setup-testrepo.mjs (scratch repo + bare remote), run.mjs (UI-driven assertions),
                            foreground.ps1 (proves a launch stole no focus and showed no window)
```

## Commands

```bash
npm run dev            # electron-vite dev with HMR
npm run build          # bundles to out/ (main, preload, renderer)
npm run typecheck      # tsc for node target then web target
npm test               # vitest run: the unit tests, once
npm run test:watch     # vitest in watch mode
npm run e2e:setup      # (re)creates the scratch repo under %TEMP%/gitclient-e2e (or $GITCLIENT_E2E_ROOT)
                       # the working repository is <root>/testrepo, its bare origin <root>/remote.git
npm run e2e            # drives the BUILT app through the UI, asserts against git, exits 1 on failure
```

Launch the built app for driving and screenshotting **only** through the launcher:

```bash
npm run build && node tools/launch-app.mjs --repo "$TEMP/gitclient-e2e/testrepo"
# --port <n>   DevTools port, default 9333
# --repo <p>   sets gitclient.lastRepo over CDP and reloads, so no load.js is needed
# --visible    the normal, focused window; without it the launch is stealthy
# --keep-running  don't free the port first: attach to the app already on it (GC-041, GC-054)
```

It is **stealthy by default**: it spawns `node_modules/electron/dist/electron.exe` directly
(never `electron.cmd`, never `cmd /c start`, both of which pop a console window) and sets
`GITCLIENT_STEALTH=1`, which makes `src/main/index.ts` build the window with
`webPreferences.offscreen: true` plus `skipTaskbar`, `focusable: false` and a 10fps frame rate.
Offscreen rendering is the approach that shipped for GC-028: no OS window exists at all, so
nothing appears in the taskbar and the foreground window never changes, and CDP
`Page.captureScreenshot` still returns a real render (77 KB for the graph, against a few KB for
a blank frame). `--visible` drops the variable **and** `windowsHide`, which matters: on Windows
`windowsHide` puts `SW_HIDE` in the child's `STARTUPINFO` and Chromium honours it for the first
window it shows, so a visible launch with it set stays invisible.

Every launch the launcher makes, stealth or `--visible`, also runs on **its own Electron profile**
(GC-060): it sets `GITCLIENT_USER_DATA` to `<os.tmpdir()>/gitclient-profiles/<port>` (exported as
`profileDir(port)`) and `src/main/index.ts` calls `app.setPath('userData', ...)` at module scope
whenever that variable is set. So the worker (9333), the e2e suite (`GITCLIENT_E2E_PORT`) and the
backlog reviewer (9334) each keep a `localStorage` of their own that survives between runs on that
port and never reaches the one Ricardo sees; before this, every `--repo` launch rewrote his
`gitclient.lastRepo`, and a `gitclient.refColW` of 100 left behind by GC-022's hand check made two
review screenshots show one chip plus `+1` while both logs said 150px. An explicit
`GITCLIENT_USER_DATA` in the environment wins over the default, and only a start that never goes
through the launcher (`npm run dev`, a packaged app) uses the real profile.

Ricardo uses this machine while the scheduled routines run, often in a full-screen game, so an
unattended session must never steal focus: never launch the app any other way, and never run
`tools/gk-recon/*.ps1` (`focus`, `rclick`, `shot`, `cursor`, `esc`) or any other OS-level input
or screenshot — those exist for the GitKraken study only. `tools/e2e/foreground.ps1` is the
check that proves a launch was invisible: it prints the foreground window handle and every
top-level window owned by an `electron` process, so run it before and after
(`Get-Process electron | MainWindowTitle` is useless here, a frameless window reports an empty
title even when it is on screen). **Never stop the app with `taskkill //F //IM electron.exe`**: that
kills every Electron process on the machine, including the hourly backlog reviewer's own build and
any `npm run dev` Ricardo has open (GC-035). `tools/launch-app.mjs` exports the narrow stops
instead: `launchApp` resolves with `stop()` (and `stopApp(child)` does the same from a child
handle), which kills that process tree only; `stopPort(port)` frees a DevTools port a stale run is
still holding by stopping the one process listening on it, and is what the launcher CLI and the
e2e prologue use. By hand, look the pid up (`netstat -ano -p tcp | grep 9333`) and
`taskkill //F //T //PID <pid>`.

The app remembers the last repository in `localStorage` (`gitclient.lastRepo`), the ten most
recently opened repositories (`gitclient.recentRepos`, a JSON array of absolute paths, newest
first, deduplicated on the normalised path — GC-044), the ref
column's width (`gitclient.refColW`, a number of pixels) and the branch pinned to the graph's
left column, per repository (`gitclient.pinned.<repoPath>`, the branch name). Everything the
user can actually set lives in one JSON blob under `gitclient.prefs` (see Preferences below);
the old `gitclient.pullMode` key is migrated into it on first load and then removed. All of it
lives in the profile's `localStorage`, which is the state a launcher launch keeps away from
Ricardo's own profile (GC-060, above).

## tools/gk-recon/cdp.mjs (DevTools driver)

Node 22+ script, target is an index or a title substring, port from `CDP_PORT` (default 9222).
Commands: `targets`, `<t> eval <file.js>` (prints the returned value), `<t> shot <out.png>`,
`<t> css`, `<t> click <x,y>`, `<t> clicksel '<selector>[||left|right][||index]'`,
`<t> hoversel '<selector>'`, `<t> type "<text>"`, `<t> key <Escape|Enter>`.
Synthetic CDP input drives React fine (clicks, hover, contextmenu via dispatched MouseEvent) but
does **not** open GitKraken's native menus; for those use `rclick.ps1` (real OS click at renderer
coordinates, assumes a 1920x1080 window at 0,0 with 8px side border and 57px top chrome) and
`shot.ps1` (OS-level screenshot of the window) after `focus.ps1`. Those three, and `cursor.ps1`
and `esc.ps1`, take the foreground: they are for a hands-on GitKraken session only and must never
run in an unattended session. Details in `tools/gk-recon/README.md`.

To repeat the GitKraken study: quit GitKraken, relaunch
`%LOCALAPPDATA%\gitkraken\app-<version>\gitkraken.exe --remote-debugging-port=9222`, then use the
`evals/` scripts. GitKraken 11.10.0 facts: Electron + React + Redux, LESS compiled to one
stylesheet, react-virtualized grids per graph column, Monaco for diffs, xterm terminal, Font
Awesome icons, Open Sans, bundled Git for Windows shelled out to. Native (Chromium) context menus.

## Architecture in one pass

### Main process (`src/main/git.ts`)

- `runGit(cwd, args, { input?, okCodes? })` spawns git with `--no-pager -c core.quotepath=off -c
  color.ui=never`. It rejects **before** spawning when `cwd` does not exist
  ("Repository folder not found: <path>"), and maps a spawn `ENOENT` to `GIT_MISSING_MESSAGE`
  ("git was not found on PATH..."). Node reports the same `spawn git ENOENT` for a missing binary
  and a missing cwd, so the `existsSync` guard is the only thing that tells a moved repository
  apart from an uninstalled git (GC-025). `checkGit()` runs one `git --version` at startup in the
  home directory — never in the last repository, whose path may be stale. Non-zero exit rejects with `GitError`; the message is stderr, or the last six
  stdout lines when stderr is empty (merge/cherry-pick conflicts report on stdout).
- Log: `git log --exclude=refs/stash --all --date-order --max-count=N --format=<fields joined by
  \x1f, records by \x1e>`. **Date order is deliberate**: it reproduces GitKraken's row order
  (topo-order groups branches into blocks and was wrong). Stash commits are excluded so they do
  not appear as anonymous rows. Renderer asks for 2000 commits (`MAX_COMMITS` in App.tsx).
- Refs: `for-each-ref` over heads, remotes, tags with peeled sha, HEAD marker, upstream and
  ahead/behind; `refs/remotes/*/HEAD` skipped.
- Status: `status --porcelain=v2 --branch -z --untracked-files=all`; conflicted entries have
  both `staged` and `unstaged` set to `'conflicted'`. `operation` (merge/rebase/cherry-pick/revert)
  is detected from files in the git dir (`MERGE_HEAD`, `rebase-merge`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`).
- Commit files: `diff-tree -r -M --name-status -z <sha>^ <sha>`, falling back to `--root` for
  the first commit. Commit diffs compare with the first parent. Untracked file diffs are
  synthesised in code (git has no diff for them).
- Mutations: stage (`add -A`), unstage (`reset -q --`, fallback `rm --cached` on an unborn
  branch), discard (`checkout --` + `clean -f`), `apply --cached/--reverse --recount` for hunks,
  commit via `--file=-` on stdin (empty summary means `--no-edit` to conclude a merge), checkout
  (`--detach`, `--track` with fallback to the existing local branch), branch create/delete/
  rename, remote add (followed by a fetch of that remote) / remove / set-url / rename, merge
  `--no-edit`, rebase, cherry-pick, revert, reset soft/mixed/hard, tags, fetch
  `--all --prune`, pull (`--no-rebase` | `--ff-only` | `--rebase`), push (`-u <remote> <branch>`
  when setting upstream, `--force-with-lease` for force), stash push/apply/pop/drop.
- **A push with no remote named picks `defaultRemote(remotes)` from `src/shared/remotes.ts`**
  (`origin`, else the first remote): `getRemotes` sorts by name, so a plain `remotes[0]` sent
  tag pushes to a remote called `alpha` while branch pushes went to `origin` (GC-031). Main and
  renderer import the same helper so a menu label cannot promise a different remote from the
  one the push uses; `src/shared/` is the only place code is shared both ways, and it is
  covered by `remotes.test.ts`.
- Credentials rely on the system credential helper; `GIT_TERMINAL_PROMPT=0` prevents hangs.

### The file-system watcher (`src/main/watch.ts`)

One `fs.watch(repo, { recursive: true })` per window, keyed by `webContents` id — **not** chokidar,
which would be a new dependency: on Windows the recursive watch is ReadDirectoryChangesW, so the
single watcher on the working-tree root covers `.git/` too (GC-011). Events are filtered, scoped,
debounced 300ms with the strongest scope winning, then pushed as `repo:changed`. Ignored:
`node_modules`, `.git/objects`, `.git/logs`, `.git/lfs`, `.git/modules`, `.git/fsmonitor--daemon`,
`.git/COMMIT_EDITMSG`, every `.git/**.lock`, **and a bare `.git` path**. That last one is the whole
reason the first implementation looped: our own `git status` writes and removes `.git/index.lock`,
Windows reports that as a `change` on the `.git` directory itself, and a directory event has no
second path segment for the ignore list to match, so the renderer reloaded the status, which ran
`git status` again — a push every 300ms forever on an idle repository. Anything that really
changes inside `.git` arrives under its own relative path, so dropping the bare event costs
nothing — the rule `watch.test.ts` now pins (GC-063). `.git/refs`, `HEAD` and `packed-refs` scope to `refs` (full snapshot reload); everything
else scopes to `tree` (status only). `git check-ignore` is deliberately not used: every git call
lives in `git.ts`, so the watcher stays pure fs. In the renderer a change that arrives while
`busy` is set is parked and flushed exactly once when `busy` clears, and the background reload
calls `window.api.loadRepo` directly rather than `load()`, whose failure path clears the open
repository (GC-025) — a refresh nobody asked for must never do that; it sets neither `busy` nor
the error banner.

### IPC and preload

Channels are grouped by prefix: `repo:*`, `commit:*`, `workdir:*`, `ref:*`, `remote:*`,
`stash:*`. `repo:checkGit` is the one handler taking no arguments, so the only one with nothing
to validate. `ipc.ts` validates every argument (`str`, `strs`, `int`, `oneOf`). The preload maps
each `GitApi` method to `ipcRenderer.invoke` with a tiny `call(channel)` helper; adding an API
means: type in `shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in `preload/index.ts`.
`repo:changed` is the **one main -> renderer push** (GC-011): a `webContents.send` from `watch.ts`,
subscribed by a hand-written preload entry that returns an unsubscribe so a React effect can clean
up, not a `call()`. Its companion handler `repo:watch` only points the watcher at a repository.

### App state and the `run()` wrapper (`App.tsx`)

State: `snapshot` (info, commits, refs, status, stashes, remotes), `selected` (sha or the `WIP`
sentinel), `fileView` (`{source:'commit', sha, path, kind}` or `{source:'wip', path, staged, kind}`),
`leftCollapsed`, `workdirVersion` (bumped to make the DiffView reload), `busy` (label of the
running operation), `error`, `gitError` (git itself is missing — it replaces the empty state's
prompt line, and `error` is suppressed when identical so the sentence is not printed twice),
`pullMode`. `load()`'s failure path clears `repoPath` so the status bar stops naming a path that
did not load, while `gitclient.lastRepo` is kept in case the folder comes back (GC-025).
`load()` also maintains `gitclient.recentRepos` (GC-044): a successful load unshifts git's
canonical path and caps the list at ten, a failed one drops the path that was asked for, so an
entry whose folder has moved stops being offered while `gitclient.lastRepo` still points at it.
`openPath(path)` is the one way a repository is switched — the folder dialog, the repository
breadcrumb's dropdown and the empty state's recents rows all go through it — and `openRepoMenu(at)`
builds that dropdown from the same `MenuItem` machinery as every other menu, anchored at the
clicked control's bottom-left corner rather than at the pointer. The title bar's `+` opens the same
menu until GC-016 gives it tabs.

`run(label, fn, { statusOnly?, rethrow? })` is the only way git actions execute: sets busy,
runs, then reloads the whole snapshot (or only the status for staging actions), and **re-applies
the error after the reload** because git often exits non-zero while leaving a state the panels
must show (conflicts, an empty cherry-pick). `msg()` strips Electron's IPC prefix from errors.
Staging actions are exposed to the DetailPanel as `StagingActions`; menus are built by
`commitMenuItems`, `refMenuItems`, `stashMenuItems`, `wipMenuItems`, `remoteMenuItems`.

Keyboard: ArrowUp/Down move the selection across WIP + commits, Ctrl+F opens the graph's commit
search (from anywhere, including the commit form) and `?` opens the shortcuts overlay.
**Escape closes exactly one layer** (GC-034, GC-037, GC-038), decided in one place: `App.tsx`
computes `layerOpen = shortcutsOpen || prefsOpen || ui.dialogOpen || ui.menuOpen || pullOpen`, and while a layer is up
its window handler closes the topmost one (the overlay also on `?`) and swallows every other
window-level shortcut, so the graph does not move and the diff does not close behind it; with no
layer, Escape closes the file view first, then the search bar — the bar sits behind the diff while
one is open, so closing the diff is what the user is asking for (GC-030). That handler runs in the **capture
phase** and calls `stopPropagation()` on the key it consumes, so no React handler underneath sees
it — the find bar's input closes itself on Escape otherwise, and one Escape would again close two
layers. Every other key still reaches the focused element, which is what keeps a modal's input
and its Enter handler working. No layer handles Escape itself — `Modal` and `Preferences` only
keep `dialogConfirm`, `ContextMenu` closes on an outside click, a scroll, a resize or a blur but
never on a key, `UiProvider` exposes `dialogOpen`/`closeDialog()` and `menuOpen`/`closeMenu()`
so `App` can see and close the modal and the menu it owns, and the toolbar's Pull popover keeps
only its outside-click handler because its open flag was lifted into `App` as `pullOpen` and is
passed back down as `pullOpen` + `onPullOpenChange` (GC-038). No `window` keydown listener
exists anywhere in the renderer outside `App.tsx`; a new layer joins `layerOpen` rather than
growing a listener of its own. The search
bar's state lives in `App.tsx` as `{ open, tick, query }`: `tick` changes on every request to open it so a
second Ctrl+F refocuses a bar that is already showing, and `query` is up there rather than in
`CommitGraph` because that component unmounts whenever a file view opens, which used to throw the
query and the dimming away (GC-030). Only `closeSearch` clears it, so a diff can open over the
graph and the search comes back untouched; the toolbar's Search button with a diff open closes the
diff and refocuses the bar instead of closing a search the user cannot see. **No handler compares a key name of its
own** (GC-010): every one asks `matches(id, event)` from `src/renderer/src/shortcuts.ts`.
With several remotes configured, `refMenuItems` offers one "Push <branch> to <remote>" entry per
remote in its own separated group, and the tag menu one "Push tag <name> to <remote>" per remote
(`MenuItem` has no submenu, so a separated group is the whole mechanism); with a single remote
both keep their original label, and the toolbar's Push title names the remote it would use when
the branch has no upstream (GC-031).
Double-clicking a branch chip or a left-panel branch row checks it out (matches GitKraken).
Every checkout the UI can trigger — chips, left-panel rows, the ref menu, the commit menu's
detached checkout — goes through `runCheckout(name, doCheckout)`, which asks first and offers
"Stash and check out" (stash push `-u`, checkout, stash pop, all inside one `run()`; the stash is
popped back if the checkout itself fails) whenever a tracked file has staged, unstaged or
conflicted changes. A tree holding only untracked files checks out silently, because git carries
those across untouched (GC-019); the prompt names the number of files actually at risk, which is
the staging list minus its untracked rows.

### UI layer (`src/renderer/src/ui`)

`UiProvider` gives `useUi()` with `openMenu(event, items)` (DOM context menu, viewport-clamped,
closes on outside click / wheel / resize), `prompt(options)` (modal with optional text
input and checkbox, resolves `{ value, checked, choice }` or null), `confirm(options)`, and the
pairs `dialogOpen` / `closeDialog()` and `menuOpen` / `closeMenu()` that let `App` own Escape for
every layer (GC-034, GC-037).
`PromptOptions.secondary` adds a third button between Cancel and OK which resolves with
`choice: 'secondary'` (GC-004's "Stash and check out"); `PromptOptions.required` defaults to true and
only the stash prompt sets it false, so a prompt whose label says "(optional)" keeps OK and Enter
live on an empty field (GC-029); `confirm` returns true only for `'ok'`,
and OK stays `.modal-buttons .btn:last-child` so the e2e helpers keep working. `MenuItem`
supports `label`, `hint`, `onClick`, `disabled`, `danger`, `separator`. Every confirmation in the
renderer goes through `useUi().confirm` (GC-003); the native `confirm()` is not used anywhere.

### Keyboard shortcuts (`src/renderer/src/shortcuts.ts`, `components/Shortcuts.tsx`)

`shortcuts.ts` is the single table of bindings (GC-010): one entry per shortcut with an id, the
chords to display, a description, and a `match(e)` predicate over `KeyLike` (the four fields both
DOM and React key events share). `matches(id, e)` is the only place in the renderer that compares
a key name, and `components/Shortcuts.tsx` renders the overlay straight from the same list, so a
binding cannot be documented differently from the way it behaves. The overlay opens with `?`
(or Shift+/) and from the toolbar's Shortcuts button, closes with Escape, the button or the
backdrop, and while it is open `App.tsx` swallows the other keys so the graph does not move
behind it. Adding a shortcut means: an entry in the table, and `matches('<id>', e)` in the
handler — never a bare `e.key === ...`. `CommitGraph.tsx` imports it as `isShortcut` because
`matches` is the search-results array in that file.

### Preferences (`src/renderer/src/prefs.ts`, `components/Preferences.tsx`)

`prefs.ts` is the single home for user settings (GC-007): a typed `Prefs` record with
`DEFAULT_PREFS`, persisted as one JSON blob under `gitclient.prefs`, exposed as `usePrefs()` (a
`useSyncExternalStore` over a module-level store) and mutated with `setPrefs(patch)`, which
writes and re-renders every reader. `load()` validates each field and falls back to the default,
so a hand-edited or truncated blob cannot break the app; it also migrates the old
`gitclient.pullMode` key on first load and deletes it. Settings today: `avatars`,
`pullMode`, `confirmDirtyCheckout`, `commitColumnGuide`, `graphColumns` (GC-032). `graphColumns`
is the one nested value, so `load()` falls back per column and a `defaults()` helper copies it: a
bare `{ ...DEFAULT_PREFS }` would hand every caller the same nested object. Remembered *state* (last repository,
ref column width, the per-repository pin) deliberately stays on its own keys.

Adding a setting means: a field with a default in `prefs.ts`, validation in `load()`, a row in
`components/Preferences.tsx`, and reading it with `usePrefs()` where it applies. The dialog is
opened from the toolbar gear (`onOpenPreferences`), reuses the `.modal` styling with its own
`.pref-*` classes, and every change applies immediately — there is no OK/Cancel.

Avatars are gated inside `useGravatar` itself, the one place both `ui/Avatar.tsx` and the
graph's `NodeAvatar` go through, so switching them off makes no gravatar.com request at all.

### Graph (`src/renderer/src/graph`)

`layoutGraph(commits, pinnedSha)` assigns lanes in the order commits arrive:

- `active[i]` is the sha lane *i* is waiting for. A commit takes the lowest lane waiting for it;
  other waiting lanes become `incoming` curves. First parent continues the lane, other parents
  fork to an existing lane awaiting them or open a new one.
- **Column 0 is reserved for HEAD's lineage** by seeding `active[0] = headSha` before the loop,
  so the checked-out branch is always the leftmost straight line and the WIP node sits above it.
  "Pin to Left" (the ref menu, GC-005) passes another branch's sha instead; the WIP node and its
  dashed link follow HEAD into whatever lane it lands in.
- **No early forking**: when two lines share a parent they both continue until the parent's row.
  Forking early handed the checked-out branch's line to a side branch (the bug that split master
  at 1.86.1 on catena-feed). Do not reintroduce it.
- Colour = lane index (`--lane-0..9`), stable as lanes recycle.

`GraphCell` renders one 28px row as an inline SVG: pass-through lines, curves in and out,
a 1px connector from the ref chips into the node, the dashed WIP link (`wipDash` `'through'` on
rows between WIP and HEAD when the head lane is free, `'toNode'` on the HEAD row), and the node:
20px circle, Gravatar image clipped by the shared `#gc-node-clip` clipPath, initials fallback.

`CommitGraph` renders the optional AUTHOR / DATE / TIME / SHA columns after the message when
`prefs.graphColumns` enables them (GC-032), all off by default, at a fixed 140/150/80px with
`flex: none` so the message column absorbs the remainder and keeps truncating — the window never
widens and the graph SVG is untouched; the WIP row leaves the cells empty. It virtualises rows
(28px, overscan 12, absolute positioning inside a spacer), keeps the selected row visible, and renders chips: a local branch **absorbs its upstream** when both
point at the same commit (cloud icon appended), at most `chipBudget(refColW)` chips (one per
75px of ref column, 1 to 6, so the default 150px still shows two) then a `+N` chip
whose hover shows the rest in a dropdown — flipped above the chip (`.more-list.flip-up`) when
hanging below would cross `.graph-body`'s bottom edge and be clipped by it, decided on every
`mouseenter` against the live rects because the rows are virtualised (GC-022); hovering a chip
expands it to its full name over the
graph (per-chip hover, not per-cell, otherwise the `+N` chip moves away from the pointer).
Chip order: HEAD, the pinned branch, tracking locals, other locals, remotes, tags — the pin ranks
second so its marker survives the fold into `+N`, where it would explain the leftmost lane only on
hover (GC-020).

Commit search (GC-009) is a find bar `CommitGraph` draws above its header when `searchOpen`:
matching is client-side over the loaded commits on summary, body, author name, author email and
sha prefix. Matching rows get `.match`, every other row `.unmatched` (0.3 opacity) — GitKraken
dims rather than hides, so the graph stays continuous. The position in the results is derived from
the current selection (`matches.indexOf(selected)`) instead of its own state, so clicking a row
mid-search moves the readout and "next" continues from there; a new query jumps to the first match
and the keep-selection-visible effect scrolls it in.

The ref column is resizable (GC-005's neighbour, GC-006): `CommitGraph` holds the width in state,
writes it to `--ref-col-w` on `.graph-panel` (`tokens.css` only carries the 150px default) and
persists it to `gitclient.refColW` on pointer-up. The 4px `.col-resize` handle is absolutely
positioned on the column boundary inside `.graph-header`, so dragging it reflows nothing; the
drag uses pointer capture, clamps to 100-400px, and double-clicking resets to 150px.

### Diff (`src/renderer/src/diff`)

`parseUnifiedDiff` handles `diff --git` headers, `---/+++`, `@@` hunks with line numbers,
`\ No newline` meta lines and binary markers. `buildHunkPatch(file, hunk)` rebuilds a patch with
the file header minus the `index` line for `git apply`. `DiffView` shows hunks in a table with
Stage/Discard hunk (unstaged), Unstage hunk (staged), Stage file / Discard changes / Delete file
buttons and reloads when `workdirVersion` changes. It replaces the graph while open; the left
panel collapses to an icon rail.

### Detail panel

Staging view: header with discard-all, operation banner (merge/rebase/cherry-pick/revert with
Abort), Conflicted / Unstaged / Staged groups with hover actions, commit form (amend prefills
HEAD's message, 72-character counter, Ctrl+Enter commits, "Commit merge" when concluding a merge
with an empty summary). Commit view: sha (click copies), refs, message box, Avatar + author +
date, parent links (click selects), counts, file list that opens the DiffView.

### Styling

`tokens.css` defines everything: Open Sans, 14px/20px base, 12px rows, grey ramp
(`--bg-app #1c1e23`, titlebar `#2a2d34`, toolbar `#33373f`, panel `#272a31`, raised `#32363f`,
menu `#3d424d`), text as white alphas (.75/.6/.4), accent `#4d88ff`, semantic colours, ten lane
colours, layout metrics (`--row-h 28px`, `--ref-col-w 150px`, `--left-panel-w 220px`,
`--detail-panel-w 400px`). `app.css` is one file with a section per component. Layout gotcha
that cost time: the app grid uses `grid-template-columns: minmax(0, 1fr)` and `.main` has
`min-width: 0; overflow: hidden` because nowrap commit messages otherwise grow the frame past
the window. Section headers are uppercase via CSS, so tests must compare `textContent` lowercased.

## Testing

`npm run e2e:setup && npm run e2e` (build first). `run.mjs` launches through
`tools/launch-app.mjs`, so the whole suite is stealthy. `setup-testrepo.mjs` creates a repository
with a merge, a tag, three branches, a bare `origin` with everything pushed, and a mixed working
tree (unstaged edits, untracked file, staged edit, staged deletion, a two-hunk file). `run.mjs`
kills Electron, launches the built app with the DevTools port, loads the repo through
`localStorage`, and asserts against git after each step: branch create/checkout/delete via prompt
and menus, stash with an empty message (git's own `WIP on <branch>`) and with a name, then pop,
a real merge conflict with banner + message + abort, cherry-pick (clean
and already-applied: git leaves it in progress and the message must stay visible), push, fetch
(`Fetch all` lives in the Pull caret popover), pull after a commit from a second clone, tag create
and delete, WIP menu, a per-file delete through the confirm modal, and the dirty-checkout guard
(clean tree raises no prompt; an untracked-only tree raises none either and keeps its file; a
tracked edit does prompt, and the message counts only the file at risk even with an untracked one
beside it (GC-019); Cancel changes nothing; "Stash and check out" lands on the branch
with the tree re-applied), commit search (message, sha prefix, stepping through
matches, the position following a clicked row, a diff opened over the graph and closed again with
the query, readout, selection and dimming intact — compared from a fixed scroll position through
`searchStateAtTop()`, because the rows are virtualised (GC-030) — and Escape), and remote management (add a second remote
pointing at the bare origin and fetch it; with both remotes present, check the branch menu lists
a push entry per remote, push a scratch `push-target` branch to the added one and assert
`git ls-remote` carries the sha, then delete it on both sides — GC-031, and note that both
remotes are the same bare repository today, so the assertion cannot yet tell them apart
(GC-056); then rename the remote, edit its URL, remove it, origin untouched),
and the layering guard (GC-039): with the find bar open and focus in its input, a commit context
menu, a ref-menu prompt and the toolbar Pull popover are each opened over it and closed with one
real Escape, the find bar keeping its query every time, and only the Escape after that closes the
find bar itself. Reverting GC-037 or GC-038 locally fails that step.
It waits on the DOM rather than on fixed sleeps (GC-053): `waitFor(expression, what, max)` polls
the renderer every 50ms for the state a step needs — a menu present or gone, a modal, the Pull
popover, the find bar and its readout, the selected row, a file view, a file-row count — and
`waitIdle` polls the status-bar spinner. Five `sleep` calls are left, each with a comment saying
what is unobservable there: the two poll intervals, `waitIdle`'s post-spinner reload, `settle`'s
own window, and one query in step 16 that lands on the same single commit as the one before it.
A fixed sleep caused one flake, and the 61 of them cost about 19s of idle time per run (64s
before, 44-46s after). `contextMenuOn` waits for the previous menu to be **gone** before it
dispatches: a synthetic `contextmenu` fires no `mousedown`, so it does not dismiss a menu that is
still up, and step 15 opens the same menu four times. All 66 assertions passed on the last three runs. Screenshots land in `<root>/shots/`. The run is re-entrant (prologue
aborts in-progress operations, removes the refs and the remotes it creates (including the
`push-target` branch step 17 pushes, locally and on the bare origin), and drops the
`e2e checkout guard` stash a run interrupted in step 15 would leave behind, restores `feature.txt`,
the tracked file that step edits (GC-019), and pops back both the
unnamed stash step 5 parks the tree in for a moment and the named `test stash` a run that died
between steps 5 and 8 would strand — popped, not dropped, because it holds the mixed working tree
every later step asserts against (GC-036)). Step 1 also removes
`gitclient.prefs`: the per-port profile persists between runs, so a setting toggled by hand in an
earlier session on that port (GC-007 left `confirmDirtyCheckout` off) would still silently disable
whole steps — it is just no longer Ricardo's own profile the suite reads (GC-060).

### Unit tests

`npm test` (vitest 5, config in `vitest.config.ts`). Tests live next to the module they cover, and
**the file extension picks the environment** (GC-046): `vitest.config.ts` declares two projects,
`node` (`src/**/*.test.ts`, `environment: 'node'`, no plugins) for the pure modules, and `dom`
(`src/**/*.test.tsx`, `environment: 'jsdom'`, `@vitejs/plugin-react` applied) for anything that
renders a component. Name a new test `.ts` unless it needs a DOM and `.tsx` when it does; there is
nothing else to configure, though a project config does not inherit the root `resolve`, so both
projects share one hoisted alias map. `npx vitest run --project node|dom` runs one of them.
`tsconfig.web.json` already includes both via `src/renderer/src/**/*`, so `npm run typecheck`
type-checks the tests too; import `describe`, `it` and `expect` from `vitest` explicitly rather
than turning on globals. Because there are no vitest globals, `@testing-library/react` cannot
register its own auto-cleanup or act-environment hooks, so a component test wires `cleanup()` into
`afterEach` and `IS_REACT_ACT_ENVIRONMENT` into `beforeAll` itself. None of the DOM
devDependencies reaches `out/`: the renderer builds from `index.html` and nothing in that graph
imports a test file.

Covered today (68 tests, 64 in the node project and 4 in the dom project): `parseDiff.test.ts` (file headers, hunk line numbering, omitted `@@`
counts, `\ No newline` meta lines, new/deleted/binary files, renames with and without hunks,
multi-file diffs, and `buildHunkPatch` round-tripping back through the parser including the
synthesised header an untracked file needs) and `lanes.test.ts` (empty and linear history, a
merge's fork and join, the **no early forking** regression guard, HEAD's lineage in column 0, a
pinned sha that is not HEAD, an unknown pinned sha, colour stability when a lane index is
recycled, and `maxLane`). The early-forking guard was mutation-checked: reintroducing the bug
fails three of these tests. `shortcuts.test.ts` guards the binding table: unique ids, Ctrl and
Cmd both accepted, `?` and Shift+/ but not Ctrl+?, the graph arrows rejecting modifiers so
Ctrl+ArrowDown does not move the selection, and Enter versus Shift+Enter in the find bar.
`prefs.test.ts` covers `prefs.ts` (GC-024): the defaults on empty storage, a blob round-trip,
per-field fallback for an unknown or wrongly typed field, malformed JSON, the legacy
`gitclient.pullMode` migration writing the blob and removing the old key, that same key ignored
when a blob already exists, and `setPrefs` merging, persisting and notifying. Two things it has
to do that a new test in this file should copy: `load()` runs at import time, so a case seeds a
`localStorage` stub and then re-imports the module through `vi.resetModules()` rather than
reaching for a reset function; and the subscriber list is reachable only through `usePrefs`, so
React's `useSyncExternalStore` is stubbed with `vi.mock` to capture the `subscribe` callback,
which keeps `prefs.ts` free of exports that exist only for tests. Mutation-checked: deleting the
migration branch in `load()` fails the migration case.
`remotes.test.ts` covers `defaultRemote` (GC-031): no remotes, a single oddly named one, `origin`
winning over an `alpha` that sorts before it and over a `zeta` that sorts after it, and the
first-remote fallback when there is no `origin`. Mutation-checked: reverting the helper to
`remotes[0]` fails the alpha case. It sits in `src/shared/` next to the module it covers, which
the existing `src/**/*.test.ts` include already picks up.
`watch.test.ts` covers the watcher's two path rules (GC-063): the bare `.git` event that made
GC-011 loop, the `.lock` files, `objects`, `logs`, `COMMIT_EDITMSG` and `node_modules` all ignored;
`refs`, `HEAD` and `packed-refs` scoping to `refs`; `.git/index`, `MERGE_HEAD` and a working-tree
file to `tree`; and a backslash path proving the normalisation. `ignored`, `scopeOf` and `toRel`
are exported for it, `toRel` having been lifted out of the change handler so the test feeds the
rules the same string the watcher does rather than a second copy of the normalisation. It needs no
Electron and no build: `npx esbuild --loader=ts --format=esm < src/main/watch.ts` leaves one
runtime import, `node:fs`, both `electron` and `@shared/types` being type-only. Mutation-checked:
deleting the bare-`.git` rule fails the guard case and nothing else.
`repo-hygiene.test.ts` guards the repository rather than the renderer (GC-047): it walks `src/`
and `tools/` plus the root markdown files, skipping `node_modules/`, `out/`, `dist/` and the
binary extensions, and fails on any C0 control byte that is not TAB or LF — CR included, because
`.gitattributes` pins the working copy to LF. The message names the file and the byte offset, so
the fix is obvious from the output alone. It lives under `src/renderer/src/` only so the existing
`vitest.config.ts` include and `tsconfig.web.json` cover it with no config change, and it carries
its own `/// <reference types="node" />` because the web project does not pull in the node types;
move it and both configs need editing. This is what would have caught GC-042's literal U+0000 the
day it was written. Mutation-checked: a NUL written into a scratch file under `src/` fails it with
that file and offset.
`Preferences.test.tsx` is the first component test in the `dom` project (GC-046):
it renders the Preferences dialog, clicks the avatars row's checkbox and asserts both that
`getPrefs().avatars` flipped and that the controlled input reflects it. Two things it does
differently from `prefs.test.ts`, deliberately: no `vi.resetModules()` — React Testing Library is
imported statically, so re-importing `prefs.ts` would hand the component a second React instance
and every hook in it would throw — and it restores `DEFAULT_PREFS` and clears `localStorage` in
`afterEach`, because jsdom's storage is real and persists across cases in a file. Mutation-checked:
replacing the avatars row's `setPrefs` call with a no-op fails it.

`CommitGraph.test.tsx` is the second, and it guards GC-022's folded-refs flip (GC-058), which the
e2e suite never reaches because no step folds a ref (GC-055). `onMoreEnter` decides the direction
from three live rects, so the test renders one commit carrying six refs — the default 150px column
budgets two chips, so four fold into `+4` — and stubs `getBoundingClientRect` on `.graph-body`, on
the `+N` chip and on the hidden `.more-list`, jsdom reporting every rect as zeroes; only `top`,
`bottom` and `height` matter. Three cases: room below (no flip), a chip 20px from the container's
bottom (flip), and a list taller than the whole body opening on whichever side has more room, in
both directions. Three things a new component test here should copy. The hover is fired as
`mouseOver`, not `mouseEnter`: React synthesises `onMouseEnter` from the delegated `mouseover`, so
a non-bubbling `mouseenter` never reaches the handler. `beforeAll` installs a no-op
`ResizeObserver`, which the virtualisation effect constructs and jsdom does not have. And
`beforeEach` sets `avatars: false`, which keeps the render clear of `crypto.subtle` and of any
gravatar.com request through the gate already in `useGravatar`. The assertion is on the `flip-up`
class rather than a computed `top`/`bottom`, because jsdom applies no stylesheet.
Mutation-checked: forcing `setMoreUp(null)` unconditionally in `onMoreEnter` fails two of the three.

## Working conventions learned the hard way

- In this Windows + Git Bash environment, long `bash -c` scripts with nested quotes and heredocs
  failed repeatedly. Prefer the Write tool for files, Node scripts for multi-line edits, and keep
  shell one-liners simple. `sed -i` with single quotes is fine.
- After UI changes: `npm run typecheck && npm run build`, relaunch the app, load a repo, take a
  CDP screenshot and **look at it**. Ricardo reviews visuals closely against GitKraken (lane
  continuity, chip behaviour, icon quality) and compares side by side.
- Verify claims with git (`git status --short`, `rev-parse`, `stash list`) rather than the UI alone.
- `innerText` reflects CSS `text-transform`; use `textContent` when matching labels in scripts.
- The physical mouse position affects `:hover` and where native menus pop; park it before OS-level
  captures (`cursor.ps1`).
- Gravatar is the one network call from the renderer (SHA-256 of the lowercased email, `d=404`);
  failures are cached so scrolling does not re-request. Should become a preference.

## State of the roadmap

Done: layout shell; open repo; virtualised graph with lanes, refs, WIP row and dashed HEAD link;
commit details and file lists; unified diff with hunk staging; stage/unstage/discard/commit/amend;
branch create/checkout/rename/delete; merge, rebase, cherry-pick, revert, reset; fetch/pull/push
with upstream setup; stash save/apply/pop/drop; tags; remotes listed and managed (add, edit URL,
rename, remove — GC-008); context menus everywhere;
in-progress operation banner with abort; conflicted files group; icon set; Open Sans; palette
calibrated to the reference; chip folding, hover expansion, `+N` list; e2e suite; vitest unit
tests for `parseDiff.ts` and `lanes.ts` (GC-002) and for `prefs.ts` (GC-024); every
confirmation on the styled modal (GC-003);
the dirty-tree checkout guard with "Stash and check out" (GC-004); "Pin to Left" giving any local
branch the leftmost column, remembered per repository (GC-005); the resizable ref column with a
width-aware chip fold (GC-006); the Preferences dialog behind one `gitclient.prefs` key, with
avatars, default pull mode, the dirty-checkout confirmation and the 72-character counter all
switchable (GC-007); commit search over the loaded commits from the toolbar button or Ctrl+F,
dimming non-matches instead of hiding them (GC-009); the commit search surviving a diff opening over the graph, its query owned by `App` (GC-030);
a named message when git is missing from PATH, told apart from a repository folder that no longer
exists (GC-025); the pinned branch's chip ranking second so the fold cannot hide its marker
(GC-020);
one push entry per remote in the branch and tag menus, with the `origin`-first default shared
between main and renderer so labels and behaviour agree (GC-031); the e2e prologue recovering the named stash a run interrupted between steps 5 and 8
strands (GC-036); the launcher's header naming `--keep-running`, the flag it actually reads
(GC-041), and that flag attaching to the app already on the port instead of spawning a second
Electron that could never bind it (GC-054); a byte-level test that fails on a raw control byte in any source or root markdown file
(GC-047); toolbar buttons sized to their labels so "Shortcuts" and "Preferences" no longer run
together (GC-048); the checkout prompt firing only when a tracked file is actually at risk, with
the count of those files in the message (GC-019); the folded-refs dropdown opening upwards when
the scroll container would otherwise clip it (GC-022); a jsdom project alongside the node one so
components can be unit tested, the file extension picking the environment and the Preferences
dialog serving as the first component test (GC-046);
one table of keyboard shortcuts behind
`matches(id, event)` with the `?` overlay rendered from it (GC-010); stealth launches through
`tools/launch-app.mjs` so unattended runs never steal focus or show a window (GC-028); every
stop narrowed to one process tree, so a run no longer kills every Electron on the machine
(GC-035); the stash prompt's "(optional)" message really being optional, on a per-prompt
`required` flag (GC-029); Escape closing exactly one layer, decided once in `App.tsx`, for
the dialogs (GC-034), the context menu (GC-037) and the toolbar's Pull popover (GC-038), with an
e2e step that fails if any of the three regresses (GC-039);
`shortcuts.test.ts` stored as text again, its raw NUL byte replaced by the `\u0000` escape so
git stops classifying it as binary (GC-042); the optional AUTHOR / DATE / TIME / SHA graph columns
behind one `graphColumns` preference (GC-032); the file-system watcher that refreshes on an
editor's save or a terminal commit, with the bare-`.git` event that made it loop dropped
(GC-011); the e2e suite waiting on the DOM through `waitFor` instead of 61 fixed sleeps, five
left and each commented (GC-053); and a unit test for the launcher's attach path that proves it
against a fake CDP endpoint without starting Electron (GC-059); every launch the launcher makes
running on its own Electron profile under `<os.tmpdir()>/gitclient-profiles/<port>`, so an
unattended run can no longer rewrite the last repository, the ref column width or the preferences
Ricardo sees (GC-060); unit tests for the watcher's ignore and scope rules, the bare-`.git`
regression among them (GC-063); the recently-opened repositories list behind
`gitclient.recentRepos`, offered from the repository breadcrumb, the title bar's `+` and the empty
state, with an entry that no longer loads dropping itself (GC-044); and a component test for the
folded-refs dropdown flip, the second in the `dom` project (GC-058). Write control characters into a source file as an
escape, never as the byte itself: a literal one makes git treat the whole file as binary, and
`git diff`, `git blame`, review and the `.gitattributes` LF rule all silently skip it while
vitest, `tsc` and the build keep passing. The trap catches generators too: a Node script that
writes the escape by typing it emits the byte instead, so build it as
`String.fromCharCode(92) + 'u0000'` (that is how GC-042 repaired both the test and two log lines
this same rule had corrupted in `TICKETS.md` and here).

**The backlog lives in `TICKETS.md`** (root). Every piece of startable work is a ticket
`GC-0NN` with one status (`todo`, `in-progress`, `done`, `blocked`), scope, acceptance
criteria, files and verification steps. The "Routine protocol" section at the top of that file
is what a scheduled session follows: it fires every few minutes, exits immediately if any ticket
is `in-progress`, otherwise claims the first eligible `todo`, commits and pushes the claim to
`main` first (that is the lock), implements, verifies, then commits and pushes with the ticket
set to `done` or `blocked`. One ticket in flight at any time. A second scheduled task, the
hourly backlog reviewer, reads what shipped, checks health and the running app against the
study, and adds `GC` tickets; its own `GR-0NN` review tickets live in the Reviews section of
`TICKETS.md` and share the same lock. Do not keep a second roadmap here;
when a ticket ships, update the "Done" paragraph above and the ticket file, not a list in this
section.

## Reference material

- `docs/reference/gitkraken/README.md` indexes the study; `03-graph.md` has the ordering and lane
  rules verified against git; `02-design-tokens.md` has the measured colours and sizes.
- `README.md` is the public-facing overview with the same commands and dependency notes.
- Memory for this project lives in the Claude memory directory (`gitclient-project.md`) and
  points here.
