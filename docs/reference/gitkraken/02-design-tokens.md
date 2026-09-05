# 02 Design tokens (dark theme as observed)

Values below are computed styles and custom property values read from the live
renderer. Use them to calibrate our own token set; do not copy names.

## Typography

| Role | Value |
| --- | --- |
| UI font | Open Sans, Arial, sans-serif. Weights 400 (body), 500 (semi-bold), 600 (bold), 700 for headings |
| Code font | Monaco, Menlo, Ubuntu Mono, Consolas, source-code-pro, monospace. The newer UI kit uses JetBrains Mono |
| Root size | `html { font-size: 62.5% }` so 1rem = 10px; the app then sets body to 14px / 20px line-height |
| Scale | fs-1 10px, fs-2 12px, fs-3 14px, fs-4 16px, fs-5 18px, fs-6 20px, fs-7 24px |
| Usage histogram | 14px (default UI), 12px (graph rows, status bar, panel labels, buttons), 16px (toolbar icons), 10px/11px (tiny labels) |
| Caps labels | Section headers are uppercase 12px bold, letter-spacing 0.2em |

## Spacing and shape

| Token | Value |
| --- | --- |
| space-1..4 | 5px, 10px, 20px, 40px (utility classes p1/m1 = 5px, p2 = 10px, p3 = 20px) |
| Row heights | graph row 22px content + 3px top/bottom padding = 28px; left panel section row 30px; graph header 22px |
| Radius | 2px (chips, buttons), 3px (inputs, general), 4px (text inputs, tabs top corners) |
| Border width | 1px everywhere |
| Handle width | 7px resize handles |
| Scrollbar | 8px thick, thumb rgba(255,255,255,0.15), no border |

## Text colours (white with alpha)

| Role | Value |
| --- | --- |
| selected / bright | #FFFFFF |
| normal | rgba(255,255,255,0.75) |
| secondary | rgba(255,255,255,0.60) |
| disabled | rgba(255,255,255,0.40) |
| dimmed | rgba(255,255,255,0.20) |
| inverse (on light chips) | #222222 |
| accent | #93A9EC |
| link | #40C5EC |

## Surface colours

| Role | Value |
| --- | --- |
| app background (graph, body) | #1C1E23 |
| toolbar bg0 (title bar) | rgb(42,45,52) |
| toolbar bg1 (toolbar, selected tab) | rgb(51,55,63) |
| toolbar bg2 | rgb(65,70,80) |
| panel bg0 (left panel, status bar, headers) | rgb(39,42,49) |
| panel bg1 (cards, menus, avatars) | rgb(50,54,63) |
| panel bg2 (menu borders, card) | rgb(61,66,77) |
| input bg | rgba(0,0,0,0.20) |
| code bg | #1C1E23 |
| section border | rgba(255,255,255,0.08) |
| subtle border | rgba(255,255,255,0.04) |
| modal overlay | rgba(0,0,0,0.5) |
| shadow | rgba(0,0,0,0.4) |
| panel accent (purple, ribbons) | #BC7EFF |

Depth is expressed with a very small set of greys stepping up by roughly 10 in
each channel. Panels are separated by 1px 8% white borders, not by shadows.

## Semantic colours

| Role | Value |
| --- | --- |
| red / danger | #D9413D |
| orange / warning | #DE9B43 |
| yellow | #ECB91C |
| green / success | #5CB85C |
| teal | #2ECE9D |
| blue / primary / focus | #4D88FF |
| light blue | #5BC0DE |
| purple | #C517B6 |
| AI gradient | linear-gradient(to right, #7900C9, #196FFF) |
| stats added / deleted / files | #347D39, #C93C37, #E2C08D |

## Row states

| State | Value |
| --- | --- |
| hover row | rgba(77,136,255,0.10) |
| selected row | rgba(77,136,255,0.20) |
| danger row | rgba(217,65,61,0.60) |
| warning row | rgba(222,155,67,0.60) |
| droppable (drag target candidate) | rgba(236,185,28,0.30) |
| drop target (hovered) | rgba(92,184,92,0.50) |
| checked-out ref | rgba(92,184,92,0.30) |
| soloed ref | rgba(222,155,67,0.30) |
| filter match | rgba(77,136,255,0.50) |
| WIP status | rgba(77,136,255,0.40) |

## Buttons

Pattern for the coloured variants: 20% tint background, 1px solid border in the
full colour, text at 75% white, hover raises the background to 60% tint and text to
white. Radius 2px. Small buttons are 22px tall, 12px font weight 600, padding 1px 5px.

| Variant | Background | Border |
| --- | --- | --- |
| default | transparent | rgba(255,255,255,0.75), white on hover |
| plain | rgb(39,42,49) | rgba(255,255,255,0.08), hover bg rgba(77,136,255,0.1) |
| primary | rgba(77,136,255,0.2) | #4D88FF |
| success | rgba(92,184,92,0.2) | #5CB85C |
| warning | rgba(222,155,67,0.2) | #DE9B43 |
| danger | rgba(217,65,61,0.2) | #D9413D |
| text | transparent | transparent, text to white on hover |
| link | transparent | text #40C5EC, underline on hover |
| toggle (Path / Tree) | transparent, checked rgba(77,136,255,0.2) | rgba(255,255,255,0.2) |
| AI button | purple-to-blue gradient border trick (gradient at 20% inside, full gradient as border) | |

Disabled: opacity 0.5. Toolbar icon buttons: 48x47, transparent, icon 16px, label
10px, icon+label at 40% white when disabled.

## Inputs

- Text input: 34px tall in forms, 21px in the left panel filter; bg rgba(0,0,0,0.2),
  1px border rgba(255,255,255,0.2), radius 4px, inset shadow 0 1px 1px
  rgba(0,0,0,0.075), text at 90% white, focus border #4D88FF.
- Checkbox / radio: 12px, border rgba(255,255,255,0.4), bg rgba(0,0,0,0.2),
  checked fill #40C5EC with a #222222 check mark, radius 1px.
- Select (zoom): 25px tall, 12px font, padding 0 5px.

## Diff and conflict colours

| Role | Value |
| --- | --- |
| added line | rgba(92,184,92,0.20) |
| deleted line | rgba(217,65,61,0.20) |
| modified line | rgba(0,0,0,0.25) |
| conflict left / right / output | rgba(21,160,191,0.25) / rgba(242,202,51,0.25) / rgba(197,23,182,0.25) with solid borders #15A0BF / #F2CA33 / #C517B6 |

## Graph lane palette (10 colours, cycled by column index)

| Index | Colour | Name |
| --- | --- | --- |
| 0 | #15A0BF | light blue |
| 1 | #0669F7 | dark blue |
| 2 | #8E00C2 | magenta |
| 3 | #C517B6 | purple |
| 4 | #D90171 | dark purple |
| 5 | #CD0101 | red |
| 6 | #F25D2E | orange |
| 7 | #F2CA33 | yellow |
| 8 | #7BD938 | green |
| 9 | #2ECE9D | teal |

Each lane colour also exists as 10% and 50% alpha tints, and as four
pre-mixed dark backgrounds (roughly 50%, 45%, 25%, 15% blends over the app
background) used for ref chips and row bands. Example for lane 0:
#195F71, #195969, #1A3F4A, #1B323A. Lane 0 is the checked-out branch.

## Terminal palette (xterm)

Black #000000, red #F24A4A, green #0DBC79, yellow #E5E510, blue #4A98EE,
magenta #E063E0, cyan #11A8CD, white #E5E5E5; bright variants #686868, #FF5656,
#23D18B, #F5F543, #51A4FF, #D670D6, #29B8DB, #E5E5E5; selection #304676.

## Light theme

Selected via `data-theme="light"`. The newer UI kit swaps to: text rgba(0,0,0,0.7),
surfaces #F0F0F0 / #FAFAFA / #F3F3F3, borders #CCCCCC, success #00A857,
danger #9F1A16, link #005C95, accent #395BBF. Primary blue stays #4D88FF.
Custom user themes were removed in 11.8; only dark and light remain.
