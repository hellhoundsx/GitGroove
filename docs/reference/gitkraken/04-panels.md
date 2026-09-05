# 04 Panels

## Left panel (refs)

Default 215px, header 60px on panel bg0, rows on panel bg0 with 1px top borders.

Header:
- Row 1: circular chevron-left button (collapse), then "Viewing N" where N is the
  number of refs currently shown, in accent blue bold.
- Row 2: filter input, 21px tall, placeholder `Filter (Ctrl + Alt + f)`, search icon
  at the right.

Sections (30px rows, chevron-right + section icon + uppercase 12px bold label +
count on the right; a small green `+` button appears on hover for sections that can
add items):

| Section | Icon | Hover action |
| --- | --- | --- |
| LOCAL | laptop | |
| REMOTE | cloud | Add Remote |
| CLOUD PATCHES | flask | Create Cloud Patch |
| PULL REQUESTS | fork | Create Pull Request |
| ISSUES | list | |
| TEAMS | users | |
| also possible: STASHES, TAGS, SUBMODULES, WORKTREES, GITFLOW, JIRA/GITHUB/GITLAB/TRELLO ISSUES | | |

Expanded sections show a tree (folders from slash-separated branch names, each
branch row with a checked-out indicator, ahead/behind counts, hide/solo toggles on
hover). Section context menu: show/hide all, maximize this section.

Collapsed state (while a file view is open): 43px icon rail, each section reduced
to its icon with the count below.

## Toolbar (see 01-layout.md for geometry)

Buttons and their tooltips / states observed:
- Undo, Redo: disabled when nothing to undo.
- Pull: split button; the caret opens Fetch All, Pull (fast-forward if possible),
  Pull (fast-forward only), Pull (rebase).
- Push, Branch (create branch inline in the graph), Stash, Pop (disabled when no
  stash), Terminal (in-app xterm panel).
- Actions = command palette / fuzzy finder. Search = commit search with author and
  team filters.

## Title bar

Left: tab strip. Right: tabs-list chevron, notifications bell with count badge,
preferences gear, profile chip. Tabs: Launchpad (focus view of PRs/issues across
repos), one tab per open repo, Release Notes.

## Status bar

Left: green outlined "Update Ready (Restart)" button when an update is downloaded,
then a quick-focus launcher showing the top Launchpad item (for example
"repo#178 is ready to merge").
Right: three small icon buttons (Launchpad list, keyboard shortcuts, gift),
zoom select with magnifier icon (80% to 130%), Support link, plan badge (orange
pill, 15px tall), version button.

## Detail panel: staging / WIP view

Shown when the WIP row is selected. Screenshot `02-main-1080.png` right side.

1. Header bar (36px, panel bg0, bottom border): red trash button (discard all),
   centred "N file change(s) on <branch chip>", AI sparkle button on the right.
2. Controls row: sort button (alpha), centred toggle group **Path | Tree**.
3. Two collapsible lists sharing the vertical space: "Unstaged Files (N)" with a
   green "Stage All Changes" button, and "Staged Files (N)" with "Unstage All".
   Rows show a status icon (green + added, orange pencil modified, red - deleted,
   purple renamed) then path in dim text and filename in normal text. Hover shows
   a "Stage File" button. Clicking a file opens the diff in the file view.
4. Bottom section (vertically resizable, default about 275px): tabs
   **Commit | Stash | Cloud Patch** (Code Suggest when a PR is checked out),
   "Amend previous commit" checkbox, message box with "Commit summary" input plus
   remaining-character counter (72) and an AI sparkle button, "Description"
   textarea, collapsible "Commit options" (push after commit, skip hooks, sign),
   "Compose commits with AI" gradient button, and the primary action button which
   reads "Stage Changes to Commit" when disabled and "Commit changes to N files"
   when staged.

## Detail panel: commit view

Shown when a commit is selected. Screenshot `03-commit-selected.png`.

1. Top blue banner "1 file change in working directory" with a "View Change"
   button (jumps back to WIP).
2. Header bar: "commit: <short sha>" (clickable to copy), AI split button
   "Recompose commit with AI".
3. Message box (resizable): summary as a heading, description body, scrollable.
4. Author block: 40px avatar, name, "authored <date> @ <time>", "parent: <sha>"
   link on the right (click to navigate), "Co-authors:" avatars.
5. Change summary: pencil icon "N modified" (plus added/deleted/renamed counts).
6. Controls: sort, **Path | Tree** toggle, "View all files" checkbox (show the full
   tree, not only changed files).
7. Virtualised file list; click opens the file view with the diff for that commit.

Multi-select shows "N commits selected" with a merged diff.

## File view (replaces the graph)

Screenshot `04-diff-view.png`.

- Header row: pencil icon + file name, encoding dropdown (UTF-8), close X.
- Toolbar: "Edit in Working Directory" (outlined), centre toggle **File View |
  Diff View**, right side **Blame | History**, previous/next change arrows, view
  mode toggles **Hunk | Inline | Split**, ignore-whitespace, word-wrap.
- Body: Monaco diff editor in `vs-dark`. Hunk view shows each hunk as a block with
  a `@@ -a,b +c,d @@` header and a "Revert Hunk" button on the right (in the WIP
  diff these become Stage Hunk / Discard Hunk, and lines can be staged
  individually). Line numbers for both sides, deleted lines tinted red, added
  lines tinted green with intra-line highlights.
- File View shows the whole file with syntax highlighting; Blame colours lines by
  commit; History lists commits touching the file.
- The left panel collapses to the icon rail while a file view is open; the detail
  panel stays.

## Left panel expanded (screenshot `08-left-panel-expanded.png`)

- LOCAL expanded shows one row per branch (about 26px tall, 20px indent):
  branch icon, name, and for the checked-out branch a green check icon plus a
  green row tint (rgba(92,184,92,0.3)).
- REMOTE expanded shows remotes as folders (remote avatar + name) with their
  branches nested one level deeper.
- Expanded sections are separated by a horizontal drag handle (10px) so their
  share of the panel height can be changed.
- Branch names with slashes group into collapsible folders.

## Dropdowns, palette and search

- Breadcrumb dropdowns (repository, branch) are DOM menus: 250px wide `ul`,
  background rgb(65,70,80), no radius, shadow 0 6px 12px rgba(0,0,0,0.18), 14px
  text, 27px items, 25px group headers ("Recently opened", "View all
  repositories"). These measurements were taken over CDP against the live DOM,
  not read off a screenshot. `09-repo-dropdown.png` and `10-branch-dropdown.png`
  were meant to illustrate this but are unusable (GC-065): both show Ricardo's
  desktop (a Claude Code window and a browser) instead of GitKraken, because
  `focus.ps1` did not raise GitKraken before `shot.ps1` fired — see the
  "Unusable captures" note in `README.md`. Recapturing them needs a hands-on
  GitKraken session and is not done here.
- Pull caret opens a DOM popover under the button (`11-pull-dropdown.png`): a
  caption "Select a default pull/fetch operation to execute when clicking this
  button" and four radio rows: Fetch All, Pull (fast-forward if possible), Pull
  (fast-forward only), Pull (rebase). Selected row highlighted green.
- Command palette (`13-command-palette.png`): full-window modal with dimmed
  backdrop; a 600px wide input at the top (34px, blue focus ring, caret on the
  right) with placeholder "Search for commands and actions (e.g., Open Repo)";
  results list below with 40px rows, first row highlighted. Commands are the
  Actions list in `05-menus-shortcuts.md`.
- Commit search (`14-commit-search.png`): not a modal. Clicking Search (or
  Ctrl+F) reveals a 200x24 "find commit" input at the right end of the graph
  header row, with filter chips for author and team. Results filter the graph.

## Preferences (screenshots `12-preferences.png`, `18-preferences-ui.png`)

Opens inside the current tab (Escape or "Exit Preferences" returns to the repo).
Two-column page:
- Left nav, 290px, panel background: "Exit Preferences" back link; "Current
  profile" card; "Organization" row; "Preferences" list: General, Profiles, SSH,
  Integrations, GitKraken AI, External Tools, Notifications, UI Customization,
  Commit Signing, Editor, In-App Terminal, Experimental; then "Repo-Specific
  Preferences" for the open repo: Encoding, Gitflow, Git Hooks, and more.
  Nav rows are about 45px with a 16px icon; the selected row has a blue tint
  and a left accent.
- Content column: page title (24px), then label / control rows. Labels right
  aligned in a 300px column at 14px; controls are 300px inputs, checkboxes, or
  Browse buttons; helper text 12px secondary below each control, warnings
  prefixed with a triangle icon.

General page settings worth mirroring: auto-fetch interval, auto-prune, default
branch name, delete .orig after merge, show all commits / initial commit count /
lazy load, remember tabs, path to sh.exe, longpaths, autocrlf.

UI Customization settings: theme (dark / light), show commit message /
description / tree / refs / author / changes / date / sha in graph, description
Always / On hover / Never, toolbar icon labels, spell check, notification
location, date/time locale and formats, language, author initials instead of
avatars, ghost refs on hover, highlight rows on ref hover, compact graph
column, reset columns.

## Terminal panel (screenshot `16-terminal.png`)

Toolbar "Terminal" toggles a dock at the bottom of the graph area: 245px tall,
full graph width, 30px header with a ">_ Terminal" title and a close x, xterm
below on pure black. The graph shrinks to make room; left and right panels are
unaffected.

## Launchpad tab (screenshot `17-launchpad.png`)

A whole-tab page: rocket icon + "Launchpad" title; filter tabs with counts (MY
PULL REQUESTS, MY ISSUES, WIPS, ALL, SNOOZED, + SAVE A VIEW); Personal / Team
toggle and a "View Settings" button on the right; Collapse All / Expand All /
refresh and a search box; filter chips (Workspace, PRs: GitHub, All labels).
Items are grouped into collapsible sections (Ready to Merge, Unassigned
Reviewers, Resolve Conflicts, Needs My Review, Draft, Other) rendered as a table
with columns: pin, age, STATUS, ITEM (title, number, +adds / -deletes, labels),
AUTHOR, COLLABORATORS, REPO/BRANCH, ACTION (green Merge split button).

## Modals and overlays

- Modals render into a static overlay container with a 50% black backdrop.
- Toasts stack top-right inside the main area (`gk-hot-toast`).
- Dropdowns (branch, repository, encoding) portal to a body-level container.
- Tutorial annotations are blue (#0669F7) popovers with a title, body, close X and
  a "Got it" button, anchored with an arrow.
