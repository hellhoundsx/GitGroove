# 01 Layout

Reference window: 1920x1080 (renderer viewport 1904x1015 with Windows chrome).
Screenshots: `screenshots/02-main-1080.png` (repo open, WIP selected),
`screenshots/03-commit-selected.png`, `screenshots/04-diff-view.png`.

## Vertical bands

| Band | Height | Notes |
| --- | --- | --- |
| Title bar / tabs bar | 34px | Custom frameless title bar. Holds repo tabs, new-tab button, and account controls on the right. Window drag region. |
| Toolbar | 48px (47 + 1px bottom border) | Breadcrumb (repository / branch dropdowns) on the left, action buttons in the middle, Actions and Search on the right. |
| Main area | remaining (907px at 1080p) | Three side-by-side panels, see below. |
| Status bar | 26px (1px top border) | 12px font. Update prompt, Launchpad quick launcher on the left; icons, zoom select, Support, plan badge, version on the right. |

Variables the app exposes for these: `title-bar-height 34px`, `tabs-bar-height 34px`,
`toolbar-height 48px`, `toolbar-border 1px`, `info-bar-height 26px`,
`left-panel-header-height 60px`, `graph-row-height 22px`.

## Horizontal panels in the main area

| Panel | Default width | Resizable | Notes |
| --- | --- | --- | --- |
| Left panel (refs) | 215px (208 content + 7px handle) | Yes, drag right edge (`handle-width 7px`) | Collapses to a 43px icon rail when a file view is open. Each section becomes an icon with a count. |
| Graph panel | flexible (fills) | Column widths resizable | Contains the column headers and the virtualised commit graph. Replaced entirely by the file view panel when a file is opened. |
| Detail panel (right) | 400px | Yes, drag left edge | Shows either the staging/WIP panel or the selected commit's details. Stays visible when the file view is open. |

All three are absolutely positioned inside `.bottom-panel` (a flex row). Resizable
panels follow one pattern: a `resizable` wrapper, a `contents` element carrying a
`resize-edge-{right|left|top|bottom}` class, and a thin `resizable-handle` (7 to
10px) overlaid on the edge. Vertical resizers (commit message box) use a 100x4px
grip centred on the edge.

## Component hierarchy (simplified)

```
body.dark-theme.win32
  section#gitkraken-app
    .gk-shell > .gitkraken > .layout
      .title-bar > .tabs-bar
      .top-panel > .toolbar > .upper          (48px, absolute)
      .bottom-panel                           (flex row, absolute, y=82)
        .left-panel > #expanded-left-panel-container > .resizable.ref-panel-container
        .right-panel
          .inner-right-panel  > .gk-graph  |  .file-view-panel   (one or the other)
          .resizable.detail-panel > .commit-detail-wrapper > .commit-detail-panel
      .status-bar                             (26px, absolute, bottom)
      .gk-hot-toast-container                 (toasts, fixed, inset 16px)
    .static-overlay-container                 (modals)
  #react-select-portal-target                 (dropdown portals)
  .gk-overlay-container.annotation            (tutorial popovers, absolute)
```

Layout is done almost entirely with utility classes (`flex`, `items-center`,
`justify-between`, `flex-1`, `min-width-0`, `truncate`, `px2`, `mb1`, `absolute`,
`top-0`, `z1`..`z6`) on plain `div`s. Very few semantic elements.

## State changes that alter layout

- **Selecting a commit** swaps the detail panel from the staging view to the
  commit detail view. Graph row gets a selected highlight.
- **Opening a file** (click a file in the detail panel) adds `expanded-detail-panel`
  on the app root, unmounts the graph, mounts `.file-view-panel` in its place, and
  collapses the left panel to the 43px icon rail. Closing the file view (X in the
  file header, or Escape) restores the graph and left panel.
- **Dragging a branch chip** onto another ref/commit opens a drop menu (merge,
  rebase, etc.). Drag targets are highlighted using `droppable` / `drop-target`
  colours.
- **Tutorial annotations** (`Pin a branch to the left`) render as a blue popover
  with an arrow anchored to the target element.

## Tabs bar detail

- Tab height 34px, horizontal padding 20px left / 25px right, top radius 4px.
- Inactive tab text at 60% white, selected tab white on the toolbar background
  `rgb(51,55,63)` so it visually merges with the toolbar below.
- Fixed tabs: Launchpad (rocket icon), repo tabs (branch icon + repo name + close
  x), Release Notes. `+` new tab button at 40px wide.
- Right cluster (each 28x28): tabs list chevron, notifications bell with a badge,
  preferences gear, profile avatar + name + caret (128px wide).

## Toolbar detail

- Breadcrumb: two dropdown buttons, "repository / name" (143px) and "branch / name"
  (110px). Small caption label above, bold value below, caret to the right.
- Action buttons are 48x47 icon-over-label buttons (`btn-xs`, 16px icon, 10px
  label): Undo, Redo, Pull (split button with caret for pull options), Push,
  Branch, Stash, Pop, Terminal. Disabled state is 50% opacity.
- Right side: Actions (fuzzy finder), Search (commit search). Toolbar labels can
  be hidden in preferences.
