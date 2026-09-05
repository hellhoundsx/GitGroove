# GitKraken UI reference notes

Design research on GitKraken Desktop 11.10.0 (Windows), captured on 2026-09-05.
These notes describe **what the UI does and how it is laid out** so we can build our
own Git client with a comparable experience. They are observations, not source.

## Ground rules

- GitKraken is proprietary (Axosoft LLC, "UNLICENSED"). Nothing here may be copied
  into our code: no CSS, no icons, no bundle code, no string tables.
- Measurements, colours, layout structure and behaviours recorded here are facts
  about the product, gathered to inform our own original implementation.
- Screenshots are for internal reference only. Do not ship or publish them.

## How this was captured

- Relaunched GitKraken with `--remote-debugging-port=9222` and drove it over the
  Chrome DevTools Protocol from a small Node script (`Runtime.evaluate`,
  `Page.captureScreenshot`, `Input.dispatchMouseEvent`).
- Dumped the live DOM (element tree with bounding boxes), computed styles per
  region, and all CSS custom properties defined on `:root` and the theme selectors.
- Listed the contents of `resources/app.asar` to learn the tech stack and file layout.

## What GitKraken is built with

| Layer | Choice |
| --- | --- |
| Shell | Electron (Chromium + Node) |
| UI | React + Redux, TypeScript, one webpack renderer bundle |
| Styling | LESS compiled to a single stylesheet, CSS custom properties for theming, utility classes (basscss style), a newer vanilla-extract based "gk-ui-kit" |
| Virtual lists | react-virtualized `Grid` (one grid per graph column, scroll-synced) |
| Diff / file view | Monaco editor (`monaco-diff-editor`, `vs-dark` theme) |
| Terminal | xterm.js |
| Icons | Font Awesome 5 SVG icons rendered inline (`svg-inline--fa`), plus Material Design Iconic Font and codicons |
| Font | Open Sans (300..800) bundled as TTF, monospace stack for code |
| Git | Bundles a full Git for Windows and shells out to `git.exe` (no libgit2) |
| Theming | `<html data-theme="dark|light">` plus `body.dark-theme` / `body.light-theme` |

## Files in this folder

| File | Contents |
| --- | --- |
| `01-layout.md` | Window regions, sizes, component hierarchy, panel behaviour |
| `02-design-tokens.md` | Type scale, spacing, colours, button and input styles, graph palette |
| `03-graph.md` | Commit graph anatomy: columns, rows, nodes, lines, refs, WIP row |
| `04-panels.md` | Left ref panel, toolbar, title bar, status bar, commit/staging panel, file diff view |
| `05-menus-shortcuts.md` | Application menu tree, keyboard shortcuts, context menu actions |
| `06-feature-inventory.md` | Every feature area found in the UI string table, with a build/skip recommendation |
| `screenshots/` | Numbered captures at 1920x1080 referenced from the notes |

## Screenshot index

Captures 05, 06, 07, 09, 10, 11 and 20 are OS-level screenshots of the whole
window (they include the native title and menu bar); the rest are renderer
captures without window chrome.

| File | Shows |
| --- | --- |
| `01-initial.png` | Small window as first opened, with a tutorial popover anchored to a branch chip |
| `02-main-1080.png` | Default repo view: ref panel, graph, staging panel with the WIP row selected |
| `03-commit-selected.png` | Commit selected: detail panel with message, author, parent, file list |
| `04-diff-view.png` | File opened from a commit: graph replaced by the Monaco diff, left panel collapsed to icons |
| `05-context-menu-commit.png` | Right-click menu on a commit row |
| `06-context-menu-branch.png` | Right-click menu on the checked-out branch chip in the graph |
| `07-context-menu-wip.png` | Right-click on the WIP row (single item) |
| `08-left-panel-expanded.png` | LOCAL and REMOTE sections expanded with branch tree |
| `09-repo-dropdown.png` | Repository breadcrumb dropdown |
| `10-branch-dropdown.png` | Branch breadcrumb dropdown |
| `11-pull-dropdown.png` | Pull caret popover with the four pull/fetch modes |
| `12-preferences.png` | Preferences, General page |
| `13-command-palette.png` | Command palette modal |
| `14-commit-search.png` | Inline commit search bar over the graph header |
| `15-wip-diff-staging.png` | Unstaged file opened from the staging panel, Stage File button |
| `16-terminal.png` | Terminal panel docked under the graph |
| `17-launchpad.png` | Launchpad tab |
| `18-preferences-ui.png` | Preferences, UI Customization page |
| `20-context-menu-leftpanel-branch.png` | Right-click menu on a branch row in the left panel |
