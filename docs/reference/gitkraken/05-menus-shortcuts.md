# 05 Menus and keyboard shortcuts

Sources: the Windows application menu definition and the shared key-binding map
bundled with the app, plus the context menu string table. "Ctrl" below is
"Cmd" on macOS.

## Application menu (Windows)

**File**
- New Tab `Ctrl+T`, Close Tab `Ctrl+W`, Reopen Closed Tab `Ctrl+Shift+T`
- Clone Repo `Ctrl+N`, Init Repo `Ctrl+I`, Open Repo `Ctrl+O`,
  Open Repo Management `Ctrl+Alt+O`, Open Repo in External Editor `Ctrl+Shift+E`
- Open Terminal `Alt+T`, Open in File Manager `Alt+O`
- Preferences `Ctrl+,`
- Update states (checking / restart and install / check for update / errored /
  downloading), Sign into different account, Exit `Alt+F4`

**Edit**: Undo `Ctrl+Z`, Redo `Ctrl+Y`, Cut, Copy, Paste, Select All.

**View**
- Relaunch `Ctrl+Shift+R`, Toggle Full Screen `Ctrl+Shift+F` / `F11`
- Tabs submenu: next `Ctrl+Tab`, previous `Ctrl+Shift+Tab`, tabs list
  `Ctrl+Shift+A`, Select Tab 1..9 `Ctrl+1..9`
- Favorites submenu: Open Favorite 1..9 `Ctrl+Alt+1..9`
- Toggle left panel `Ctrl+J`, toggle detail panel `Ctrl+K`, toggle terminal
  `` Ctrl+` ``
- Developer submenu only in development builds (`Ctrl+Shift+I` dev tools).

**Help**: Command palette `Ctrl+P`, Keyboard Shortcuts `Ctrl+/`, About, version,
Release Notes, Support Docs, Support Logs (error / performance / activity),
Feature requests, Contact support, social link.

## In-app key bindings (body scope)

| Keys | Action |
| --- | --- |
| Ctrl+B | Create branch (inline in the graph) |
| Ctrl+P / Ctrl+Shift+P | Toggle command palette (fuzzy finder) |
| Ctrl+Shift+O | Palette in "open repo" mode |
| Ctrl+Shift+H | Palette in "file history / blame" mode |
| Ctrl+F | Focus search in modal, or open commit search |
| Ctrl+Alt+F | Focus the left panel filter |
| Ctrl+L | Fetch all |
| Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z | Undo / redo git operation |
| Ctrl+J | Toggle left (ref) panel |
| Ctrl+K | Toggle detail panel |
| Ctrl+/ | Toggle keyboard shortcuts overlay |
| Ctrl+- / Ctrl+= / Ctrl+0 | Zoom out / in / reset |
| Ctrl+D | Open selected file in external diff/merge tool |
| Ctrl+S | Save and mark resolved (merge tool) |
| Ctrl+Shift+T | Reopen closed tab |
| Up / Down, K / J | Select previous / next commit |
| Shift+Up / Shift+Down, Shift+K / Shift+J | Previous / next commit in the same branch (topological) |
| Left / Right, H / L | Select item to the left / right (lanes, columns) |
| Ctrl+Home / Ctrl+End, Ctrl+Up / Ctrl+Down (Windows) | Jump to first / last |
| S | Stage current file |
| Ctrl+Shift+S | Stage all |
| U | Unstage current file |
| Ctrl+Shift+U | Unstage all |
| Ctrl+Shift+M | Focus commit message |
| Ctrl+Enter (in message input) | Commit |
| Ctrl+Shift+Enter (in message input) | Stage all and commit |
| P / R / D (interactive rebase) | Pick / reword / drop commit |
| Escape | Close current view / modal / file view |

The map is scoped by CSS selector: the body scope, the commit message inputs,
the reword inputs, and the graph component (which lets native up/down pass through
to the virtual list). The shortcuts overlay groups them as Repo Actions,
Navigation, Command Palette, UI.

## Context menus

Context menus are **native Electron menus** (not DOM), so they take the OS look
and cannot be styled. Screenshots: `screenshots/05-context-menu-commit.png`,
`06-context-menu-branch.png`, `07-context-menu-wip.png`.

Commit row (right-click):
- Checkout this commit, Create branch here, Create tag here / annotated tag here
- Cherry pick commit, Revert commit, Reset `<current branch>` to this commit
  (submenu: Soft - keep all changes, Mixed - keep working copy but reset index,
  Hard - discard all changes)
- Edit commit message, Squash commit, Drop commit, Move commit up / down,
  Interactive rebase children of this commit, Recompose with AI
- Compare commit against working directory, Create worktree from this commit
- Copy commit sha, Copy link to this commit (on remote), Open Jira to this commit
- With multiple commits selected: Cherry pick N commits, Squash N commits, Drop N
  commits, Rebase N commits onto..., Move N commits up / down.

Observed on a plain commit three rows below HEAD (screenshot
`05-context-menu-commit.png`), in order with separators: Checkout this commit |
Create worktree from this commit | Create branch here, Cherry pick commit, Reset
main to this commit >, Revert commit | Recompose commit with AI (Preview),
Recompose 3 children of `<sha>` with AI (Preview), Interactive Rebase 3 children
of `<sha>`, Edit commit message, Drop commit, Move commit up, Move commit down |
Copy commit sha, Copy link to this commit on remote: origin, Create patch from
commit, Share commit as Cloud Patch | Compare commit against working directory |
Create tag here, Create annotated tag here. The menu is about 340px wide with
28px rows, dark background close to the panel colour, 1px separators, and a
chevron for submenus.

Branch chip (right-click on a local branch):
- Checkout `<name>`, Merge `<name>` into `<current>`, Rebase `<current>` onto
  `<name>`, Interactive Rebase, Fast-forward
- Push `<name>` to... / to `<remote>` / to all remotes, Push and start a pull
  request, Start a pull request to..., Set upstream
- Rename `<name>`, Delete `<name>` (and remote), Hide / Show / Solo in graph,
  Pin to Left / Unpin
- Create worktree from `<name>`, Copy branch name, Copy link to branch,
  Explain branch changes (AI)

Observed on the checked-out `main` chip (screenshot `06-context-menu-branch.png`),
in order with separators: Pull (fast-forward if possible), Push, Set Upstream |
Checkout | Create worktree from | Create branch here, Reset main to this commit,
Edit commit message, Revert commit | Recompose commit with AI (Preview), Drop
commit, Move commit down | Start a pull request to origin from..., Explain Branch
Changes (Preview) | Apply patch, Rename main, Delete main, Delete origin/main,
Delete main and origin/main. So the chip menu merges branch actions with the
actions for the commit the branch points at.

Observed on the `main` row in the left panel (screenshot
`20-context-menu-leftpanel-branch.png`), about 340px wide, 28px items, dark
Chromium menu with separators and a submenu arrow on Reset: Pull (fast-forward if
possible), Push, Set Upstream | Create branch here, Reset main to this commit >,
Edit commit message, Revert commit | Recompose commit with AI (Preview), Drop
commit, Move commit down | Start a pull request to origin from origin/main,
Explain Branch Changes (Preview) | Apply patch, Rename main, Delete main | Copy
branch name, Copy commit sha, Copy link to branch: origin/main, Copy link to this
commit on remote: origin | Hide, Pin to Left, Solo | Compare commit against
working directory | Create tag here, Create annotated tag here.

WIP row (screenshot `07-context-menu-wip.png`): a single item, Explain working
changes (Preview). Staging actions live on the file rows and section headers.

Remote branch adds: Checkout (creates local tracking branch), Delete from remote,
Fetch remote, View on hosting service. Tag: checkout, push tag, delete locally /
from remote, annotate, copy name.

WIP row: Stage all, Unstage all, Discard all changes, Stash all, Export to patch,
Cherry pick from stash.

File rows (staging or commit file list): Stage / Unstage / Discard, Ignore file,
Ignore all files with extension, Ignore folder, Open file, Open in external
editor, Show in folder, Copy file path, Blame, History, Restore file from this
commit, Save and stage editor changes.

Left panel sections: Show / hide all local branches, Show / hide all remotes,
Maximize this section, Add remote, Create pull request, Open Gitflow, Add
submodule, Add worktree. Tabs: Close tab, Close other tabs, Close tabs to the
right, Reopen closed tab, Rename tab, Alias repository, Favorite repository.

## Toolbar dropdowns

- Pull caret: Fetch All, Pull (fast-forward if possible), Pull (fast-forward
  only), Pull (rebase). The last choice becomes the default pull action.
- Repository breadcrumb: search box, Favorites, Recently opened, Open Repo
  Management.
- Branch breadcrumb: search box, local and remote branches grouped, checkout on
  select.
- Actions (palette) entries include: checkout ref, create branch / tag, stash,
  open repo, search commits, file history / blame, view / edit / create / delete
  file, stage / unstage all, discard all, open in terminal / file manager, switch
  theme, switch profile, toggle syntax highlighting, toggle toolbar labels,
  settings, release notes, error and performance logs, configure Gitflow / GPG /
  LFS, initialise LFS, share as cloud patch, generate commit message with AI.
