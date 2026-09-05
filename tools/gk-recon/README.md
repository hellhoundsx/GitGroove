# gk-recon: tooling used to study GitKraken's UI

Small scripts used to drive GitKraken Desktop over the Chrome DevTools Protocol
and capture what the notes in `docs/reference/gitkraken/` describe. Nothing here
touches GitKraken's files; it only observes the running app.

## Setup

1. Quit GitKraken, then relaunch it with remote debugging enabled:

   ```bash
   "$LOCALAPPDATA/gitkraken/app-<version>/gitkraken.exe" --remote-debugging-port=9222
   ```

2. Confirm the target list at <http://localhost:9222/json>.

## cdp.mjs

Node 22+ (uses the built-in `WebSocket`). Target is an index or a title
substring, e.g. `"GitKraken Desktop"`.

| Command | What it does |
| --- | --- |
| `node cdp.mjs targets` | list debuggable pages and workers |
| `node cdp.mjs <t> eval <file.js>` | run a script in the renderer, print the returned string or JSON |
| `node cdp.mjs <t> shot <out.png>` | screenshot of the renderer viewport |
| `node cdp.mjs <t> css` | dump every stylesheet's text via the CSS domain |
| `node cdp.mjs <t> click <x,y>` | synthetic left click at viewport coordinates |
| `node cdp.mjs <t> clicksel '<selector>[\|\|right][\|\|index]'` | synthetic click on the centre of a matched element |
| `node cdp.mjs <t> hoversel '<selector>'` | move the synthetic mouse over an element |
| `node cdp.mjs <t> type "<text>"` | insert text at the focused element |
| `node cdp.mjs <t> key <Escape|Enter>` | key press |\|Enter>` | key press |

## PowerShell helpers (Windows)

Synthetic CDP input does not open GitKraken's context menus (they are Electron
menus that need real OS input) and CDP screenshots do not include them. Use:

| Script | What it does |
| --- | --- |
| `focus.ps1` | bring the GitKraken window to the foreground |
| `cursor.ps1 X Y` | park the OS cursor at screen coordinates |
| `rclick.ps1 X Y [1\|2]` | real left (1) or right (2) click at renderer coordinates, assuming a 1920x1080 window at 0,0 (8px side border, 57px top chrome) |
| `shot.ps1 out.png [delayMs]` | OS-level screenshot of the GitKraken window rectangle |
| `esc.ps1` | send Escape through SendKeys (closes native menus) |

## evals/

Renderer scripts for `cdp.mjs eval`:

- `dom-outline.js` element tree with bounding boxes and display/position
- `tokens.js` every CSS custom property by selector, plus font faces
- `region-styles.js` computed styles for the main regions, font/colour histograms
- `region-text.js` visible text, labels and test ids per region
- `graph-structure.js`, `graph-rows.js`, `graph-zones.js` commit graph anatomy
- `outline-of.tpl.js`, `text-of.tpl.js` templates; replace `__SEL__` with a selector
- `menu-dump.js` any visible DOM menu or dropdown
- `state.js`, `tabs.js` quick state checks
