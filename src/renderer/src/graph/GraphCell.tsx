import { useState, type JSX } from 'react';
import { Archive } from 'lucide-react';
import type { RowLayout, Segment, WipDash } from './lanes';
import { avatarFailed, markAvatarFailed, useGravatar } from '../ui/avatars';

export const ROW_H = 28;
export const LANE_W = 20;
export const NODE = 20;
const LEFT_PAD = 8;
/**
 * Corner radius where a join turns between its own lane and the node's centre line (GC-077).
 * Under `mid` (14) so a vertical piece stays visible above the corner, and under `LANE_W` (20)
 * so a horizontal piece stays visible between adjacent lanes.
 */
const JOIN_R = 8;

export const laneX = (lane: number): number => LEFT_PAD + lane * LANE_W + LANE_W / 2;

export function laneColor(index: number): string {
  return `var(--lane-${index % 10})`;
}

interface Props {
  row: RowLayout | null; // null for the WIP row
  width: number;
  /**
   * The WIP row's own node. `linked` is false when HEAD's commit is not in the loaded range: the
   * run has nowhere to land, so the node keeps its dashed outline and draws no stub rather than
   * starting a dash that runs off the bottom of the graph (GC-144).
   */
  wip?: { lane: number; color: number; linked: boolean };
  /**
   * A stash's own row, **branched out** of the commit it was taken from (GC-170, GC-216): a
   * full-size circle with a dashed outline and the stash glyph inside it, in a lane of its own
   * beside the parent's, with its line running down that lane into the curve the parent's row
   * draws from it. GC-170 had the node in the parent's own lane, where the row read as one more
   * commit on the branch rather than as something hanging off its tip.
   *
   * `lane` is the stash's, `color` and `parentLane` the parent's — the stash belongs to that
   * branch, so it is drawn in that branch's colour and lands in that branch's lane.
   *
   * `through`, `incoming` and `above` are the parent's, and they are what this row draws of every
   * *other* line: a lane passing the parent from above passes this row too, or a line would
   * appear to break where a stash was inserted. `others` are the lanes of the stashes above this
   * one, whose own lines run down past this row to the same parent. Dashed, like the
   * working-directory node, because what the row stands for is not a commit on the branch.
   */
  stash?: { lane: number; color: number; parentLane: number; through: Segment[]; incoming: Segment[]; above: boolean; others: number[] };
  /**
   * The lane the dashed WIP-to-HEAD run travels in as it passes this stash row (GC-170, GC-144).
   * The run has to cover the whole distance, and a stash row inserted inside it is one more row
   * it crosses. It is a plain pass-through now that the node has left the parent's lane (GC-216),
   * where it used to be drawn in two halves around it.
   */
  stashDash?: number;
  /**
   * The lanes of the stash rows sitting above this commit, each joining its node from the side
   * (GC-216). Drawn exactly as `row.incoming` is and dashed for the reason the stash's own node
   * is: what arrives is not a commit on this branch.
   */
  stashIn?: number[];
  /** Draw the dashed WIP-to-HEAD link in this lane: straight through the row, or down into this row's node. */
  wipDash?: WipDash;
  wipDashLane?: number;
  /**
   * Whether that stretch carries the run at all (GC-219).
   *
   * `layoutGraph` reserves column 0 for HEAD's lineage from the first row, so above HEAD's row
   * that lane is an open lane with **nothing above it** — no node, no child, nothing the line
   * could be coming from. What made it read as a line was the WIP node sitting on top of it, and
   * `wipDash` replacing the solid stroke with the dash that runs down from it (GC-144).
   *
   * With no working-directory row there is no such node, so the stretch is drawn as nothing: the
   * suppression `wipDash` performs still applies — it is what keeps the seed's solid line off the
   * row — and the dash simply is not drawn in its place. Otherwise a clean tree draws a line down
   * the whole graph that starts at the top edge and stands for no commit at all.
   */
  runDrawn?: boolean;
  /**
   * This commit has more than one parent (GC-221, asked for by Ricardo). A merge is the one thing
   * about a commit that is structural rather than editorial, and the graph says it only in the
   * lines — two curves leaving the node — which is legible while both parents are on screen and
   * invisible when the second is a hundred rows down. So the node says it too — as a small dot
   * rather than the full circle and avatar, because a merge carries no work of its own and is
   * rarely what anyone came to the graph to read. See `MergeNode`.
   */
  merge?: boolean;
  /** Draw the branch/tag connector from the left edge into the node (GC-147). */
  connector?: boolean;
  author?: { name: string; email: string; initials: string };
}

/**
 * The dash every "not a commit" mark is drawn with — the WIP node, a stash node, the WIP-to-HEAD
 * run and a stash's line into its parent.
 *
 * **Its period has to divide `ROW_H`** (GC-218). A row is its own `<svg>` and each dashed line
 * starts its pattern at y = 0, so the pattern only tiles down a run of rows when a whole number of
 * them fits in one row. It was `2 3` — period 5 in a 28px row — and 28 % 5 = 3, so every row
 * boundary shifted the phase by 3px: the phase walks 0, 3, 1, 4, 2 and realigns only every fifth
 * row, which draws a short gap or a doubled dash once per row all the way down. Invisible on the
 * WIP node's own 14px stub, which is where the dash started life; unmissable on a run that spans
 * a screenful, which is what it does whenever HEAD's tip is not the newest commit loaded.
 *
 * 7 divides 28 four times, and 3 on / 4 off is the duty cycle nearest the 2 / 3 it replaces.
 * `dashTiles` is the invariant, held by a test rather than by this comment.
 */
const DASH_ON = 3;
const DASH_OFF = 4;
export const DASH_PERIOD = DASH_ON + DASH_OFF;
const DASH = `${DASH_ON} ${DASH_OFF}`;

/** Whether the dash pattern tiles across row boundaries, which is the whole of GC-218. */
export const dashTiles = (rowHeight: number = ROW_H, period: number = DASH_PERIOD): boolean => period > 0 && rowHeight % period === 0;
/**
 * The row's lane band (GC-186): 22px, the height `.col-msg` uses, filling the graph cell to the
 * **right** of the node. `03-graph.md` line 45 puts it there and GC-147 put it on the other side
 * of the node, where it doubled as the chip connector; the connector is a 2px line and nothing
 * else (line 58), so the two are separate things again.
 *
 * On every row, not only the selected and WIP ones the study observed it on: Ricardo's own
 * capture of `catena-feed` has it throughout, and a band appearing on some rows and not others
 * reads as a property of those commits rather than of the row's lane.
 *
 * 10% rather than GC-147's 14% for exactly that reason — a tint chosen for four rows in nine is a
 * stripe when it is on all nine — and not lower: 8% was measured first and, at 100% on the
 * fixture, read as a smudge rather than as the lane. Stated here rather than in the stylesheet
 * because this is drawn in SVG, where a `color-mix` on a lane variable has no equivalent; an
 * opacity on the lane colour is the same result and takes the theme with it.
 */
const BAND_H = 22;

/**
 * The band is lit from the lane rather than printed on the row (GC-201). GC-186's one opacity from
 * the node's edge to the cell's read as a rectangle: it had a hard right edge in the middle of the
 * row and nothing about it said which end the lane was at. So the paint falls away to the right —
 * `BAND_PEAK` at the node, `BAND_FADE` of that at the far edge — and the average across the cell is
 * about the 10% GC-186 settled, which is why the peak is above it rather than at it: a peak is not
 * sustained the way a wash is.
 *
 * The colour is still the lane variable and nothing else, so the theme comes with it and no
 * literal joins the component or a stylesheet (`CLAUDE.md`, Styling).
 */
const BAND_PEAK = 0.16;
const BAND_FADE = 0.3;

/**
 * The band, drawn from the node's **centre** to the cell's own right edge. First in the SVG, so
 * every line and node paints over it — it is a background, not a mark.
 *
 * It starts at the centre rather than at the node's drawn radius because a square corner cannot
 * meet a circle (GC-200). Butted against it at `x + NODE / 2 - 1`, the two touched at exactly one
 * point: at that x the node's outer boundary spans only ±sqrt(10² − 9²) = ±4.36px of the row, so
 * above and below the meeting point about 6.6px of untinted row showed through in two crescents,
 * one at each corner — and a taller band makes them larger, not smaller, which is why `BAND_H`
 * could never tune it away. Run under the node instead and the circle covers what it overlaps,
 * which is `03-graph.md` line 45's own answer: the node's neighbourhood is a region it masks,
 * rather than a rectangle stopped short of an arc. The 1px of band left standing above and below
 * the circle is the crescent, now filled.
 */
function Band({ x, color, width }: { x: number; color: string; width: number }): JSX.Element {
  const mid = ROW_H / 2;
  // The gradient is referenced, not defined here: a row is its own `<svg>` and there are hundreds
  // of them, so ten definitions live once in `BandGradients` and every band points at the one for
  // its lane. `color` stays on the rect as the fallback the SVG `fill` syntax allows, so a band is
  // still drawn — flat, exactly as GC-186 had it — if the defs are ever not on the page.
  return <rect x={x} y={mid - BAND_H / 2} width={Math.max(0, width - x)} height={BAND_H} fill={`url(#${bandGradientId(color)}) ${color}`} opacity={BAND_PEAK} />;
}

/**
 * One gradient per lane colour, and the id it is referenced by. Keyed by the colour rather than by
 * the row, because that is all a band's paint depends on: the stops are `objectBoundingBox` units,
 * so each one spans its own rect — which starts at the node's centre on every row (GC-200) and ends
 * at the cell's edge, whatever lane the commit is in.
 */
const bandGradientId = (color: string): string => `graph-band-${color.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')}`;

/** The ten lane colours, which is every paint a band can be made of. */
const LANE_COLORS = Array.from({ length: 10 }, (_, i) => laneColor(i));

/**
 * The ten definitions, rendered once by the graph. A zero-sized `svg` because `defs` is never
 * rendered and this element exists only to hold them; `aria-hidden` for the reason every other
 * `svg` here carries it.
 */
export function BandGradients(): JSX.Element {
  return (
    <svg width={0} height={0} aria-hidden="true" style={{ position: 'absolute' }}>
      <defs>
        {LANE_COLORS.map((c) => (
          <linearGradient key={c} id={bandGradientId(c)} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor={c} stopOpacity={1} />
            <stop offset="1" stopColor={c} stopOpacity={BAND_FADE} />
          </linearGradient>
        ))}
      </defs>
    </svg>
  );
}

/**
 * The opaque disc a **dashed** node needs under it once the band runs beneath it (GC-200).
 *
 * A solid node needs none: its 2px stroke sits on r = 9 and so covers 8..10 unbroken, and its own
 * fill covers everything inside. A dashed one leaves the stroke's outer half open wherever the
 * dash has a gap, and the band would read through those gaps as a tinted ring around the node.
 * This is the node's fill taken out to the stroke's outer edge, drawn after the band and before
 * the circle, so the gaps show the node's own ground exactly as they did before the band moved.
 */
function NodeMask({ x, fill }: { x: number; fill: string }): JSX.Element {
  return <circle cx={x} cy={ROW_H / 2} r={NODE / 2} fill={fill} />;
}

/**
 * A merge commit's node (GC-221): a small filled dot in the lane colour, and nothing else.
 *
 * **Smaller than a commit node, deliberately.** A merge is rarely the commit anyone came to the
 * graph to read — it carries no work of its own, and its author is whoever ran the merge — so the
 * node says "a merge happened here" by getting out of the way rather than by taking the full
 * 20px circle and an avatar. It is the one node that does *not* interrupt its lane line: the line
 * runs behind it, which is what makes it read as a point on the branch rather than a stop on it.
 *
 * This replaced a full-size node carrying the merge glyph, which was legible and too loud: on
 * `catena-feed` it drew the eye harder than the commits either side of it.
 */
const MERGE_R = 5;
function MergeNode({ x, y, color }: { x: number; y: number; color: string }): JSX.Element {
  return <circle cx={x} cy={y} r={MERGE_R} fill={color} />;
}

function NodeAvatar({ x, y, author, color }: { x: number; y: number; author: Props['author']; color: string }): JSX.Element {
  const url = useGravatar(author?.email);
  const [broken, setBroken] = useState(false);
  const r = NODE / 2;
  const showImage = url && !broken && !avatarFailed(url);
  return (
    <>
      <circle cx={x} cy={y} r={r - 1} fill="var(--node-fill)" stroke={color} strokeWidth={2} />
      {showImage ? (
        <image
          href={url}
          x={x - r + 2}
          y={y - r + 2}
          width={NODE - 4}
          height={NODE - 4}
          clipPath="url(#gc-node-clip)"
          preserveAspectRatio="xMidYMid slice"
          onError={() => {
            markAvatarFailed(url);
            setBroken(true);
          }}
        />
      ) : (
        author && (
          <text x={x} y={y + 3} textAnchor="middle" fontSize={8} fontWeight={600} fill="var(--text-muted)" style={{ fontFamily: 'var(--font-ui)' }}>
            {author.initials}
          </text>
        )
      )}
    </>
  );
}

/**
 * One row of the graph column: pass-through lines, curves into and out of the node, the
 * branch connector and the node itself. Everything is drawn in the row's own 28px coordinate
 * space so adjacent rows line up (node centre at y = 14).
 */
export function GraphCell({ row, width, wip, stash, stashDash, stashIn, wipDash = null, wipDashLane, runDrawn = true, merge, connector, author }: Props): JSX.Element {
  const mid = ROW_H / 2;
  if (!row && stash) {
    const x = laneX(stash.lane);
    const px = laneX(stash.parentLane);
    const color = laneColor(stash.color);
    // Every lane that passes the parent row from above passes this one: its through lines, and
    // the lane each of its `incoming` curves arrives in. The parent's own lane and the lanes the
    // other stashes descend is each drawn below, for its own reason.
    const above = [...stash.through, ...stash.incoming].filter((s) => s.lane !== stashDash);
    const r = NODE / 2 - 1;
    return (
      <svg width={width} height={ROW_H} aria-hidden="true">
        <Band x={x} color={color} width={width} />
        {above.map((s) => (
          <line key={`t${s.lane}`} x1={laneX(s.lane)} y1={0} x2={laneX(s.lane)} y2={ROW_H} stroke={laneColor(s.color)} strokeWidth={2} />
        ))}
        {/* The parent's own lane, carrying its child's line straight past this row — a stash is
            inserted into that run, so the line must not appear to break at it (GC-170). Dropped
            when the WIP-to-HEAD run travels in that lane: the dash replaces the line rather than
            being drawn over it (GC-144). */}
        {stash.above && stashDash !== stash.parentLane && <line x1={px} y1={0} x2={px} y2={ROW_H} stroke={color} strokeWidth={2} />}
        {/* The run passing this row, dashed in place of the solid line as everywhere else (GC-144). */}
        {stashDash !== undefined && runDrawn && <line x1={laneX(stashDash)} y1={0} x2={laneX(stashDash)} y2={ROW_H} stroke={laneColor(stashDash % 10)} strokeWidth={2} strokeDasharray={DASH} />}
        {/* The stashes above this one, each descending its own lane to the same parent (GC-216). */}
        {stash.others.map((l) => (
          <line key={`s${l}`} x1={laneX(l)} y1={0} x2={laneX(l)} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={DASH} />
        ))}
        {/* This stash's own line: out of the node, down its lane, and into the curve the parent's
            row draws from it on the row below (GC-216). */}
        <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={DASH} />
        <NodeMask x={x} fill="var(--node-fill)" />
        <circle cx={x} cy={mid} r={r} fill="var(--node-fill)" stroke={color} strokeWidth={2} strokeDasharray={DASH} />
        {/* The glyph inside the node. A lucide icon is its own `svg`, so it is positioned by a
            `g` around it rather than by x/y of its own, and drawn in the lane's colour. */}
        <g transform={`translate(${x - 6}, ${mid - 6})`} color={color}>
          <Archive width={12} height={12} strokeWidth={2} stroke="currentColor" />
        </g>
      </svg>
    );
  }
  if (!row && wip) {
    const x = laneX(wip.lane);
    const color = laneColor(wip.color);
    return (
      <svg width={width} height={ROW_H} aria-hidden="true">
        <Band x={x} color={color} width={width} />
        {wip.linked && <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={DASH} />}
        <NodeMask x={x} fill="var(--node-fill)" />
        <circle cx={x} cy={mid} r={NODE / 2 - 1} fill="var(--node-fill)" stroke={color} strokeWidth={2} strokeDasharray={DASH} />
      </svg>
    );
  }
  if (!row) return <svg width={width} height={ROW_H} />;

  const x = laneX(row.lane);
  const color = laneColor(row.color);
  // A join runs down its own lane, turns through a quarter arc and finishes along the node's
  // centre line, rather than cutting across the row on a diagonal (GC-077).
  const curveIn = (fromLane: number): string => {
    const fx = laneX(fromLane);
    if (fx === x) return `M ${fx} 0 V ${mid}`;
    const r = Math.min(JOIN_R, Math.abs(x - fx));
    const right = x > fx;
    return `M ${fx} 0 V ${mid - r} A ${r} ${r} 0 0 ${right ? 0 : 1} ${right ? fx + r : fx - r} ${mid} H ${x}`;
  };
  const curveOut = (toLane: number): string => {
    const tx = laneX(toLane);
    if (tx === x) return `M ${x} ${mid} V ${ROW_H}`;
    const r = Math.min(JOIN_R, Math.abs(tx - x));
    const right = tx > x;
    // The mirror image below the node: centre line out, corner down, then the lane.
    return `M ${x} ${mid} H ${right ? tx - r : tx + r} A ${r} ${r} 0 0 ${right ? 1 : 0} ${tx} ${mid + r} V ${ROW_H}`;
  };
  const dashLane = wipDashLane ?? row.lane;
  const dashX = laneX(dashLane);
  const dashColor = wipDashLane !== undefined ? laneColor(wipDashLane % 10) : color;
  // The dash replaces the solid line in that lane rather than being drawn over it (GC-144): a
  // through segment for the row it passes, the node's own line above it for HEAD's row. Drawn on
  // top, the two together read as a solid line with a dash on it.
  const through = wipDash === 'through' ? row.through.filter((s) => s.lane !== dashLane) : row.through;

  return (
    <svg width={width} height={ROW_H} aria-hidden="true">
      <Band x={x} color={color} width={width} />
      {through.map((s) => (
        <line key={`t${s.lane}`} x1={laneX(s.lane)} y1={0} x2={laneX(s.lane)} y2={ROW_H} stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {wipDash === 'through' && runDrawn && <line x1={dashX} y1={0} x2={dashX} y2={ROW_H} stroke={dashColor} strokeWidth={2} strokeDasharray={DASH} />}
      {wipDash === 'toNode' && runDrawn && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} strokeDasharray={DASH} />}
      {row.hasChildAbove && wipDash !== 'toNode' && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} />}
      {row.hasParentBelow && <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} />}
      {row.incoming.map((s) => (
        <path key={`i${s.lane}`} d={curveIn(s.lane)} fill="none" stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {row.outgoing.map((s) => (
        <path key={`o${s.lane}`} d={curveOut(s.lane)} fill="none" stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {/* A stash sitting above this commit joins its node the way any other child does (GC-216):
          the same right-angle curve, in this branch's own colour, dashed because what arrives is
          not a commit on it. Before the node, so the node paints over where the two meet. */}
      {stashIn?.map((l) => (
        <path key={`s${l}`} d={curveIn(l)} fill="none" stroke={color} strokeWidth={2} strokeDasharray={DASH} />
      ))}
      {/* The graph cell's half of the chip-to-node connector: a 2px line in the lane colour and
          nothing else, which is what `03-graph.md` line 58 records (GC-186). Inside the row's own
          SVG so it meets the node exactly, and flush with `.ref-line`'s half at x = 0 — the one
          part of GC-147 that was right. Centred on `mid` at 2px, so it covers the same 13..15 the
          stylesheet's half does. */}
      {connector && <line x1={0} y1={mid} x2={x - NODE / 2 + 1} y2={mid} stroke={color} strokeWidth={2} shapeRendering="crispEdges" />}
      {merge ? <MergeNode x={x} y={mid} color={color} /> : <NodeAvatar x={x} y={mid} author={author} color={color} />}
    </svg>
  );
}
