# 03 Commit graph

Screenshots: `02-main-1080.png`, `03-commit-selected.png`.

## Columns

The graph is a table with one virtualised list per column. All lists share one
scroll position. Column headers are a separate 22px row (plus 2px margin) with
draggable, resizable header cells and a settings cog on the far right.

| Column | Default width | Header label | Content |
| --- | --- | --- | --- |
| Refs | 130px | BRANCH / TAG | Branch and tag chips for refs pointing at that commit |
| Graph | 84px | GRAPH | Lane lines and the commit node |
| Message | flexible | COMMIT MESSAGE | Summary, optional description, WIP input on row 0 |
| Optional | user-enabled | AUTHOR, COMMIT DATE / TIME, SHA, CHANGES | Toggle in column settings |

Header text is 14px at 40% white, uppercase. Columns can be reordered by dragging
the header, resized by a 10px handle at the header's right edge, and reset to a
default or compact layout from preferences.

## Rows

- Row pitch 28px: 22px content with 3px padding top and bottom.
- Every column renders its own absolutely positioned cell per row, keyed by
  `data-row-idx`; the WIP row is index 0.
- Row text is 12px. Message summary at 75% white, description appended inline at
  60% opacity when "show description in graph" is set to Always (or on hover).
- Hover highlights the row across all columns at rgba(77,136,255,0.10); selected
  at rgba(77,136,255,0.20). A 2px colour strip in the lane colour sits at the left
  edge of the message cell.
- The full commit message is exposed as a native tooltip (title attribute).

## Node and lines

- Commit node: 22x22 circle with a 2px solid border in the lane colour, filled with
  the author avatar (18px image) over the app background. Placed at x = 28 within
  the graph column so lane 0 has its centre at x = 39.
- WIP node: same circle with a 2px **dotted** border, no avatar.
- Lines are not a canvas. Each graph cell has a background image that is an
  inline SVG (data URI) drawn for that row only: straight segments as `line`,
  curves as paths, stroke width 2, lane colour, and `stroke-dasharray 2` for the
  dashed WIP-to-HEAD segment. Adjacent rows line up because every row draws from
  y = 0 to y = 28 in its own coordinate space (node centre at y = 14).
- A background band (`commit-bg-color`, 50% lane tint) fills the graph cell to the
  right of the node on the selected row and WIP row, and a wider app-background
  mask hides lines behind the node.
- Lane x positions step by a fixed lane width; the graph column grows or gets a
  horizontal scrollbar when more lanes are active than fit.

## Ref chips (branch / tag labels)

- Chip: 22px tall, radius 2px, padding 5px, 12px medium white text, background is
  the lane colour's darkest blend (for lane 0: rgb(25,95,113)).
- Contents left to right: status icon (check mark = checked out), name (truncated
  with ellipsis), then small icons: laptop = local branch, cloud or remote logo =
  remote, 14px author avatar for the ref's last committer.
- A 2px `hr` line in the lane colour connects the chip to the node.
- Chips are draggable (drop onto another chip or commit to merge, rebase,
  fast-forward, etc.) and have their own context menu.
- When a commit has more refs than fit, a "+N more refs" indicator appears.
- Right-click a local branch to "Pin to Left" so it always occupies the leftmost
  lane. Hovering a chip highlights its rows; hovering a commit shows a ghost ref.

## WIP row (row 0)

- Refs column: empty (WIP has no refs) but receives the dotted node in the graph
  column.
- Message column: a text input with placeholder `// WIP`, followed by a tiny files
  readout: green plus icon with "+N" added, orange pencil for modified, red minus
  for deleted. Clicking the row opens the staging panel on the right.
- Row is selected by default when the repo opens.

## Ordering and lane rules (verified against git)

- Rows follow commit-date order with topological constraints, which is what
  `git log --date-order` produces: side branches interleave with the main line by
  date rather than being grouped into blocks (`--topo-order` groups them and puts
  the whole FEED branch below v1.83.0, where GitKraken shows it above).
- The checked-out branch owns column 0 from the WIP row down, and its first-parent
  line never leaves that column. When two lines share a parent, each stays in its
  own lane until the parent's row, where the lower lane takes the node and the
  higher lane curves into it. Forking early into the other lane breaks the straight
  line of the checked-out branch.

## Behaviour to replicate

- Virtualised rendering; the app loads 500+ commits initially and lazy-loads more.
- Click selects, Ctrl/Shift-click for multi-select (used by squash, cherry-pick,
  drop, and "N commits selected" in the detail panel).
- Right-click for the commit context menu (see `05-menus-shortcuts.md`).
- Keyboard: up/down select previous/next, Alt+up/down by branch (topological),
  left/right across lanes.
- Column settings: show/hide author, date, SHA, changes; commit description
  Always / On hover / Never; compact layout; branch visibility All / Smart.
