# GitGroove brand kit

The mark is **three rings of dots with one side left open, and a single commit picked out in a
branch colour**. A record's grooves and a commit graph's rings are the same drawing; the one
coloured dot is what says which of the two you are looking at.

It is **generated, not drawn**: every dot's position comes from a ring radius, a count and an
angle in `gitgroove-logo.mjs`. Nothing here was traced, and nothing here should be edited by hand.

## Files

| File | What it is |
| --- | --- |
| `gitgroove-mark.svg` | the mark, `currentColor` for the dots and `--gg-accent` for the commit |
| `gitgroove-mark-dark.svg` | the same, fixed to `#ECECEC` — for a dark ground |
| `gitgroove-mark-light.svg` | the same, fixed to `#1A1A1A` — for a light ground |
| `gitgroove-icon.svg` | the app icon: the mark alone, filling 92% of the canvas, **no ground** |
| `gitgroove-icon-tile.svg` | the same on the `#212121` tile at `rx` 22.5%, for anywhere that wants one |
| `gitgroove-favicon.svg` | the icon at 48px |
| `gitgroove-lockup-dark.svg` | mark + wordmark, for a dark ground |
| `gitgroove-lockup-light.svg` | mark + wordmark, for a light ground |
| `gitgroove.ico` | Windows icon, 16/24/32/48/64/128/256 as embedded PNGs |
| `png/` | the icon at 16–1024, both lockups at 2x, the mark at 512 and 1024 |
| `showcase.html` | the thirteen concepts this was chosen from, with the reasoning for each |
| `gitgroove-logo.mjs` | the generator — run it to rewrite every SVG above |
| `wordmark.json` | the wordmark as outlines; the generator reads it (see below) |
| `gitclient-logo-v1.prompt.md` | the prompt behind the superseded GitClient mark, kept as history |

## Colour

Three values, and all three are the application's own tokens — see `src/renderer/src/styles/tokens.css`.

| | Value | Token |
| --- | --- | --- |
| dots | `#ECECEC` | `--text-primary` |
| the commit | `#C549B7` | `--lane-1` |
| tile | `#212121` | `--bg-card` |

**The accent is the whole of the colour budget.** The app's one colour rule is that saturated
colour means a branch and never anything else, so the mark spends it on exactly one dot. A second
coloured dot, or a coloured ring, breaks that rule and should not be added.

On a light ground the dots go to `#1A1A1A` and the commit stays `#C549B7` — it is legible on both
and it is the one thing that must not change between the two.

## Using it

**Clear space** is one ring gap — 8.5 units of the 100 box, so about 8.5% of the mark's width — on
every side. The lockup already carries it.

**Smallest size.** One build is used at every size, which is a deliberate choice: below about 24px
the rings stop resolving and the mark reads as a textured disc rather than as dots. That is
accepted. If a favicon ever has to hold up at 16px, the answer is a second build with fewer and
larger dots at the same outer radius and the same gap angle — not a redrawn mark.

**The icon carries no ground.** A rounded tile is an Apple convention; on a Windows taskbar it is
invisible against the bar and costs the mark half its canvas, so `gitgroove-icon.svg` and
everything cut from it — `png/`, `gitgroove.ico` — is the mark alone on transparency, filling 92%.
The known cost: the dots are `#ECECEC`, so **on a light taskbar the mark nearly disappears** and
only the magenta commit reads. An `.ico` cannot follow the system theme. If that ever matters, the
options are the tile back at icon sizes only, or a mid-tone ink that is mediocre on both grounds —
not a second theme-aware icon, which Windows will not ask for.

**Don't**: rotate it (the gap belongs in the upper right), recolour the commit, close the gap, add
a stroke, put it on a saturated ground, or stretch the lockup — the space between mark and
wordmark is set from the wordmark's cap height and is not free.

## Regenerating

```bash
node assets/branding/gitgroove-logo.mjs
```

That rewrites the seven SVGs from the numbers at the top of the file. It does **not** rewrite the
PNGs or the `.ico`: there is no rasteriser in this checkout — no Python, so the skill's own
`svg_to_png.py` (cairosvg) cannot run, and no `sharp`. Those were produced by loading each SVG into
a canvas in Chromium and packing the results, and they need redoing the same way if the geometry
changes.

The wordmark is **Inter**, the app's own UI face, cut to outlines at weight 600 from the variable
font already in `node_modules/@fontsource-variable/inter` — decompressed from woff2 with `wawoff2`
and read with `opentype.js`, laying the glyphs out one at a time because opentype.js's shaper does
not handle Inter's `ccmp` lookups. `wordmark.json` is the result, so neither package is a
dependency of this repo. "Git" is set at 60% opacity against "Groove" at full, which is one weight
and two values rather than two weights — the stems stay identical that way.

## Provenance

Designed with the [logo-generator](https://github.com/op7418/logo-generator-skill) skill: eight
concepts across its six pattern families, narrowed to the dot matrix, then six refinements of that
direction. `showcase.html` is the record. Nothing from GitKraken was used, in keeping with the
first rule in `CLAUDE.md`.
