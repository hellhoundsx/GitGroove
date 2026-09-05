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
| git | system `git` on PATH | all repository access shells out, no libgit2 |

Node 25 and npm 11 are installed; no pnpm, no Rust (Tauri was ruled out for that reason).

## Repository layout

```
TICKETS.md             the backlog: one ticket per startable task, each with a status (see roadmap section)
src/
  main/index.ts        Electron window (1400x900, dark background, overlay title bar), loads out/renderer
  main/git.ts          every git call; spawn('git', BASE_ARGS + args) with LC_ALL=C, GIT_TERMINAL_PROMPT=0
  main/ipc.ts          ipcMain.handle registrations with argument validation
  preload/index.ts     contextBridge: window.api (GitApi) and window.platform
  preload/index.d.ts   Window typing for the renderer
  shared/types.ts      Commit, GitRef, Stash, Remote, StatusEntry, RepoStatus, RepoSnapshot, GitApi ...
  renderer/index.html  CSP: self + gravatar.com images + bundled fonts
  renderer/src/
    main.tsx           fonts, tokens.css, app.css, <UiProvider><App/></UiProvider>
    App.tsx            all state and every git action (see "App state and the run() wrapper")
    components/        TitleBar, Toolbar, LeftPanel, DetailPanel, StatusBar
    graph/             lanes.ts (layout algorithm), GraphCell.tsx (one row's SVG), CommitGraph.tsx
    diff/              parseDiff.ts (unified diff parser + hunk patch builder), DiffView.tsx
    ui/                ContextMenu, Modal, UiContext (openMenu/prompt/confirm), icons, Avatar, avatars
    styles/            tokens.css (design tokens), app.css (all component styles, one file)
docs/reference/gitkraken/   the GitKraken study: 6 notes files + 19 screenshots (README has the index)
docs/screenshots/           screenshots of OUR app for the README
tools/gk-recon/             CDP driver + PowerShell helpers used for the study and for driving our app
tools/e2e/                  setup-testrepo.mjs (scratch repo + bare remote), run.mjs (UI-driven assertions)
```

## Commands

```bash
npm run dev            # electron-vite dev with HMR
npm run build          # bundles to out/ (main, preload, renderer)
npm run typecheck      # tsc for node target then web target
npm run e2e:setup      # (re)creates the scratch repo under %TEMP%/gitclient-e2e (or $GITCLIENT_E2E_ROOT)
npm run e2e            # drives the BUILT app through the UI, asserts against git, exits 1 on failure
```

Run the built app with a DevTools port so it can be driven and screenshotted:

```bash
npm run build && node_modules/.bin/electron . --remote-debugging-port=9333
```

On Windows from Git Bash the reliable detached launch is
`cmd //c start "" "<repo>\node_modules\.bin\electron.cmd" . --remote-debugging-port=9333`,
then poll `http://localhost:9333/json` until a `page` target appears. Stop it with
`taskkill //F //IM electron.exe` (this kills every Electron process on the machine).

Point the running app at a repository without the file dialog:

```bash
CDP_PORT=9333 node tools/gk-recon/cdp.mjs 0 eval load.js
# load.js: localStorage.setItem('gitclient.lastRepo', 'C:/path/to/repo'); setTimeout(() => location.reload(), 50)
```

The app remembers the last repository in `localStorage` (`gitclient.lastRepo`) and the pull
mode (`gitclient.pullMode`).

## tools/gk-recon/cdp.mjs (DevTools driver)

Node 22+ script, target is an index or a title substring, port from `CDP_PORT` (default 9222).
Commands: `targets`, `<t> eval <file.js>` (prints the returned value), `<t> shot <out.png>`,
`<t> css`, `<t> click <x,y>`, `<t> clicksel '<selector>[||left|right][||index]'`,
`<t> hoversel '<selector>'`, `<t> type "<text>"`, `<t> key <Escape|Enter>`.
Synthetic CDP input drives React fine (clicks, hover, contextmenu via dispatched MouseEvent) but
does **not** open GitKraken's native menus; for those use `rclick.ps1` (real OS click at renderer
coordinates, assumes a 1920x1080 window at 0,0 with 8px side border and 57px top chrome) and
`shot.ps1` (OS-level screenshot of the window) after `focus.ps1`. Details in `tools/gk-recon/README.md`.

To repeat the GitKraken study: quit GitKraken, relaunch
`%LOCALAPPDATA%\gitkraken\app-<version>\gitkraken.exe --remote-debugging-port=9222`, then use the
`evals/` scripts. GitKraken 11.10.0 facts: Electron + React + Redux, LESS compiled to one
stylesheet, react-virtualized grids per graph column, Monaco for diffs, xterm terminal, Font
Awesome icons, Open Sans, bundled Git for Windows shelled out to. Native (Chromium) context menus.

## Architecture in one pass

### Main process (`src/main/git.ts`)

- `runGit(cwd, args, { input?, okCodes? })` spawns git with `--no-pager -c core.quotepath=off -c
  color.ui=never`. Non-zero exit rejects with `GitError`; the message is stderr, or the last six
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
  rename, merge `--no-edit`, rebase, cherry-pick, revert, reset soft/mixed/hard, tags, fetch
  `--all --prune`, pull (`--no-rebase` | `--ff-only` | `--rebase`), push (`-u <remote> <branch>`
  when setting upstream, `--force-with-lease` for force), stash push/apply/pop/drop.
- Credentials rely on the system credential helper; `GIT_TERMINAL_PROMPT=0` prevents hangs.

### IPC and preload

Channels are grouped by prefix: `repo:*`, `commit:*`, `workdir:*`, `ref:*`, `remote:*`,
`stash:*`. `ipc.ts` validates every argument (`str`, `strs`, `int`, `oneOf`). The preload maps
each `GitApi` method to `ipcRenderer.invoke` with a tiny `call(channel)` helper; adding an API
means: type in `shared/types.ts`, function in `git.ts`, handler in `ipc.ts`, entry in `preload/index.ts`.

### App state and the `run()` wrapper (`App.tsx`)

State: `snapshot` (info, commits, refs, status, stashes, remotes), `selected` (sha or the `WIP`
sentinel), `fileView` (`{source:'commit', sha, path, kind}` or `{source:'wip', path, staged, kind}`),
`leftCollapsed`, `workdirVersion` (bumped to make the DiffView reload), `busy` (label of the
running operation), `error`, `pullMode`.

`run(label, fn, { statusOnly?, rethrow? })` is the only way git actions execute: sets busy,
runs, then reloads the whole snapshot (or only the status for staging actions), and **re-applies
the error after the reload** because git often exits non-zero while leaving a state the panels
must show (conflicts, an empty cherry-pick). `msg()` strips Electron's IPC prefix from errors.
Staging actions are exposed to the DetailPanel as `StagingActions`; menus are built by
`commitMenuItems`, `refMenuItems`, `stashMenuItems`, `wipMenuItems`, `remoteMenuItems`.

Keyboard: ArrowUp/Down move the selection across WIP + commits, Escape closes the file view.
Double-clicking a branch chip or a left-panel branch row checks it out immediately (matches
GitKraken; a confirmation for dirty trees was discussed but not added).

### UI layer (`src/renderer/src/ui`)

`UiProvider` gives `useUi()` with `openMenu(event, items)` (DOM context menu, viewport-clamped,
closes on outside click / Escape / wheel / resize), `prompt(options)` (modal with optional text
input and checkbox, resolves `{ value, checked }` or null) and `confirm(options)`. `MenuItem`
supports `label`, `hint`, `onClick`, `disabled`, `danger`, `separator`. Native `confirm()` is
still used inside DiffView and DetailPanel for a few destructive actions.

### Graph (`src/renderer/src/graph`)

`layoutGraph(commits, pinnedSha)` assigns lanes in the order commits arrive:

- `active[i]` is the sha lane *i* is waiting for. A commit takes the lowest lane waiting for it;
  other waiting lanes become `incoming` curves. First parent continues the lane, other parents
  fork to an existing lane awaiting them or open a new one.
- **Column 0 is reserved for HEAD's lineage** by seeding `active[0] = headSha` before the loop,
  so the checked-out branch is always the leftmost straight line and the WIP node sits above it.
- **No early forking**: when two lines share a parent they both continue until the parent's row.
  Forking early handed the checked-out branch's line to a side branch (the bug that split master
  at 1.86.1 on catena-feed). Do not reintroduce it.
- Colour = lane index (`--lane-0..9`), stable as lanes recycle.

`GraphCell` renders one 28px row as an inline SVG: pass-through lines, curves in and out,
a 1px connector from the ref chips into the node, the dashed WIP link (`wipDash` `'through'` on
rows between WIP and HEAD when the head lane is free, `'toNode'` on the HEAD row), and the node:
20px circle, Gravatar image clipped by the shared `#gc-node-clip` clipPath, initials fallback.

`CommitGraph` virtualises rows (28px, overscan 12, absolute positioning inside a spacer), keeps
the selected row visible, and renders chips: a local branch **absorbs its upstream** when both
point at the same commit (cloud icon appended), at most `MAX_CHIPS = 2` chips then a `+N` chip
whose hover shows the rest in a dropdown; hovering a chip expands it to its full name over the
graph (per-chip hover, not per-cell, otherwise the `+N` chip moves away from the pointer).
Chip order: HEAD, tracking locals, other locals, remotes, tags.

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

`npm run e2e:setup && npm run e2e` (build first). `setup-testrepo.mjs` creates a repository
with a merge, a tag, three branches, a bare `origin` with everything pushed, and a mixed working
tree (unstaged edits, untracked file, staged edit, staged deletion, a two-hunk file). `run.mjs`
kills Electron, launches the built app with the DevTools port, loads the repo through
`localStorage`, and asserts against git after each step: branch create/checkout/delete via prompt
and menus, stash and pop, a real merge conflict with banner + message + abort, cherry-pick (clean
and already-applied: git leaves it in progress and the message must stay visible), push, fetch
(`Fetch all` lives in the Pull caret popover), pull after a commit from a second clone, tag create
and delete, WIP menu. It waits for the status-bar spinner (`waitIdle`) rather than fixed sleeps;
a fixed sleep caused one flake. All 22 assertions passed on the last run. Screenshots land in
`<root>/shots/`. The run is re-entrant (prologue aborts in-progress operations and removes the
refs it creates).

There are no unit tests yet; `parseDiff.ts` and `lanes.ts` are the obvious first candidates.

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
with upstream setup; stash save/apply/pop/drop; tags; remotes listing; context menus everywhere;
in-progress operation banner with abort; conflicted files group; icon set; Open Sans; palette
calibrated to the reference; chip folding, hover expansion, `+N` list; e2e suite.

**The backlog lives in `TICKETS.md`** (root). Every piece of startable work is a ticket
`GC-0NN` with one status (`todo`, `in-progress`, `done`, `blocked`), scope, acceptance
criteria, files and verification steps. The "Routine protocol" section at the top of that file
is what a scheduled session follows: it fires every few minutes, exits immediately if any ticket
is `in-progress`, otherwise claims the first eligible `todo`, commits and pushes the claim to
`main` first (that is the lock), implements, verifies, then commits and pushes with the ticket
set to `done` or `blocked`. One ticket in flight at any time. Do not keep a second roadmap here;
when a ticket ships, update the "Done" paragraph above and the ticket file, not a list in this
section.

## Reference material

- `docs/reference/gitkraken/README.md` indexes the study; `03-graph.md` has the ordering and lane
  rules verified against git; `02-design-tokens.md` has the measured colours and sizes.
- `README.md` is the public-facing overview with the same commands and dependency notes.
- Memory for this project lives in the Claude memory directory (`gitclient-project.md`) and
  points here.
