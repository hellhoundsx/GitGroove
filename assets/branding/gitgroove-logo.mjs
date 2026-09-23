// The GitGroove mark, as geometry rather than as a picture. `node gitgroove-logo.mjs`
// rewrites every SVG in this folder; the PNGs and the .ico are rasterised separately
// (see README.md), because nothing in this checkout can rasterise an SVG on its own.
//
// Retuning the mark means changing RINGS, GAP or COMMIT below and re-running. Do not
// edit the generated SVGs by hand — they are output.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = dirname(fileURLToPath(import.meta.url))
const ROOT = join(OUT, '..', '..')

// ---- the values -----------------------------------------------------------
export const INK = '#ECECEC' // --text-primary, on the dark tile
export const INK_LIGHT = '#1A1A1A' // the same mark on a light ground
export const ACCENT = '#C549B7' // --lane-1: the one saturated colour, and it means a branch
export const TILE = '#212121' // --bg-card

// Three rings. The gap between rings is held near 8.5 and the dots taper inward, so the
// weight sits on the outside the way a record's does.
const RINGS = [
  { r: 28, n: 20, dr: 2.6 },
  { r: 19.5, n: 14, dr: 2.3 },
  { r: 11, n: 8, dr: 2.0 },
]
const GAP = [288, 352] // the aperture, in screen degrees; dots inside it are not drawn
const COMMIT = { r: 28, at: 0, dr: 3.8 } // the one dot that is a branch

const rad = (d) => (d * Math.PI) / 180
const f = (n) => Math.round(n * 100) / 100
const pt = (r, d) => [f(50 + r * Math.cos(rad(d))), f(50 + r * Math.sin(rad(d)))]
const norm = (a) => ((a % 360) + 360) % 360

/** The mark's drawn width as a fraction of the 100 box — what sets the lockup. */
const DRAWN = ((COMMIT.r + COMMIT.dr) * 2) / 100

/**
 * The ink's real bounding box, computed rather than assumed: the gap makes the mark
 * asymmetric, so its drawn centre is not (50, 50) and an icon centred on the box would
 * sit visibly off. Returns the box and what it takes to fill `span` units of the canvas.
 */
function bbox() {
  let x1 = 100
  let y1 = 100
  let x2 = 0
  let y2 = 0
  const see = (r, d, dr) => {
    const [x, y] = pt(r, d)
    x1 = Math.min(x1, x - dr)
    y1 = Math.min(y1, y - dr)
    x2 = Math.max(x2, x + dr)
    y2 = Math.max(y2, y + dr)
  }
  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const a = norm(-90 + (360 / ring.n) * i)
      if (a >= GAP[0] && a <= GAP[1]) continue
      if (ring.r === COMMIT.r && a === COMMIT.at) continue
      see(ring.r, a, ring.dr)
    }
  }
  see(COMMIT.r, COMMIT.at, COMMIT.dr)
  return { x1, y1, x2, y2, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2, w: x2 - x1, h: y2 - y1 }
}

/**
 * The mark scaled to fill the canvas, on transparency — which is what a Windows icon is.
 * A rounded tile is an Apple convention; on a Windows taskbar it is invisible against the
 * bar and costs the mark half its canvas, so the icon carries no ground of its own.
 */
function filled(body, span = 92) {
  const b = bbox()
  const s = span / Math.max(b.w, b.h)
  return `<g transform="translate(50 50) scale(${f(s)}) translate(${f(-b.cx)} ${f(-b.cy)})">
  ${body}
  </g>`
}

export function mark({ ink = 'currentColor', accent = ACCENT } = {}) {
  const out = []
  for (const ring of RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const a = norm(-90 + (360 / ring.n) * i)
      if (a >= GAP[0] && a <= GAP[1]) continue
      if (ring.r === COMMIT.r && a === COMMIT.at) continue // drawn last, in the accent
      const [x, y] = pt(ring.r, a)
      out.push(`<circle cx="${x}" cy="${y}" r="${ring.dr}" fill="${ink}"/>`)
    }
  }
  const [cx, cy] = pt(COMMIT.r, COMMIT.at)
  out.push(`<circle cx="${cx}" cy="${cy}" r="${COMMIT.dr}" fill="${accent}"/>`)
  return out.join('\n  ')
}

const DESC =
  'GitGroove: three rings of dots cut like the grooves of a record, left open on one side, with a single commit picked out in a branch colour.'

const doc = (body, { w = 100, h = 100, vb = '0 0 100 100', title, desc = DESC } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}" role="img" aria-label="${title}">
  <title>${title}</title>
  <desc>${desc}</desc>
  ${body}
</svg>\n`

const tile = (body, scale = 0.78, radius = 22.5) =>
  `<rect width="100" height="100" rx="${radius}" fill="${TILE}"/>
  <rect x=".3" y=".3" width="99.4" height="99.4" rx="${f(radius - 0.3)}" fill="none" stroke="#ffffff" stroke-opacity=".07" stroke-width=".6"/>
  <g transform="translate(50 50) scale(${scale}) translate(-50 -50)">
  ${body}
  </g>`

// ---- the lockup -----------------------------------------------------------
// The wordmark is Inter, cut to outlines from the variable font the app already bundles
// (see README.md). Everything here is set off one measurement: its cap height.
const wm = JSON.parse(readFileSync(join(OUT, 'wordmark.json'), 'utf8'))
const CAP = wm.metrics.capHeight
const MARK = (CAP * 1.18) / DRAWN // the mark reads a little taller than the caps
const drawn = MARK * DRAWN
const SPACE = CAP * 0.46 // clear space between mark and wordmark

function lockup(ink) {
  const textX = drawn + SPACE
  const pad = CAP * 0.16
  const wTot = textX + wm.wordmark600.width + pad * 2
  const hTot = drawn + pad * 2
  return doc(
    `<g transform="translate(${f((-MARK * (1 - DRAWN)) / 2)} ${f(-CAP / 2 - MARK / 2)}) scale(${f(MARK / 100)})">
    ${mark({ ink })}
  </g>
  <g transform="translate(${f(textX)} 0)" fill="${ink}">
    <path d="${wm.wordmark600.paths[0]}" fill-opacity=".6"/>
    <path d="${wm.wordmark600.paths[1]}"/>
  </g>`,
    {
      w: f(wTot),
      h: f(hTot),
      vb: `${f(-pad)} ${f(-CAP / 2 - drawn / 2 - pad)} ${f(wTot)} ${f(hTot)}`,
      title: 'GitGroove',
    }
  )
}

// ---- write ----------------------------------------------------------------
const files = {
  'gitgroove-mark.svg': doc(mark({ accent: `var(--gg-accent, ${ACCENT})` }), { title: 'GitGroove mark' }),
  'gitgroove-mark-dark.svg': doc(mark({ ink: INK }), { title: 'GitGroove mark' }),
  'gitgroove-mark-light.svg': doc(mark({ ink: INK_LIGHT }), { title: 'GitGroove mark' }),
  // The app icon: the mark alone, filling the canvas. This is what the .ico and png/ are cut from.
  'gitgroove-icon.svg': doc(filled(mark({ ink: INK })), { w: 256, h: 256, title: 'GitGroove' }),
  'gitgroove-favicon.svg': doc(filled(mark({ ink: INK })), { w: 48, h: 48, title: 'GitGroove' }),
  // The tile is kept for the places that do want a ground under it — a store listing, a website,
  // a macOS build — but nothing on Windows uses it.
  'gitgroove-icon-tile.svg': doc(tile(mark({ ink: INK })), { w: 256, h: 256, title: 'GitGroove' }),
  // The macOS Dock icon: the tile on Apple's icon grid, an 824 body centred in a 1024 canvas, so
  // it sits at the same size as every other icon in the Dock rather than bleeding to the edge.
  // png/gitgroove-icon-macos-1024.png is cut from this.
  'gitgroove-icon-macos.svg': doc(
    `<g transform="translate(9.765625 9.765625) scale(0.8046875)">
  ${tile(mark({ ink: INK }))}
  </g>`,
    { w: 1024, h: 1024, title: 'GitGroove' },
  ),
  'gitgroove-lockup-dark.svg': lockup(INK),
  'gitgroove-lockup-light.svg': lockup(INK_LIGHT),
}

for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body)

// The application needs its own two copies, and they are written from here so they cannot drift
// from the kit. Vite will not import from outside the renderer root, and a favicon has to sit
// beside index.html in the build output — `src/renderer/public/` is what Vite copies there, which
// keeps the href relative and so correct under both the dev server and `loadFile`.
const appCopies = {
  'src/renderer/src/assets/gitgroove-mark.svg': files['gitgroove-mark-dark.svg'],
  'src/renderer/public/gitgroove-favicon.svg': files['gitgroove-favicon.svg'],
}
for (const [rel, body] of Object.entries(appCopies)) {
  mkdirSync(dirname(join(ROOT, rel)), { recursive: true })
  writeFileSync(join(ROOT, rel), body)
}

console.log(`${Object.keys(files).length} svg files written to ${OUT}`)
console.log(`${Object.keys(appCopies).length} copies written into src/renderer`)
