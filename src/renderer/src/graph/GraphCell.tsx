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
   * A stash's own row, in the lane of the commit it was taken from (GC-170): a full-size circle
   * with a dashed outline and the stash glyph inside it, the lane line running down from it into
   * that commit's node on the row below.
   *
   * `through`, `incoming` and `above` are that commit's, and they are what this row draws of
   * every *other* line: a lane passing the parent from above passes this row too, or a line would
   * appear to break where a stash was inserted. Dashed, like the working-directory node, because
   * what the row stands for is not on the branch.
   */
  stash?: { lane: number; color: number; through: Segment[]; incoming: Segment[]; above: boolean };
  /**
   * What a stash row draws of the dashed WIP-to-HEAD run passing it (GC-170, GC-144). The run has
   * to cover the whole distance, and a stash row inserted inside it is one more row it crosses:
   * `toNode` when the run is in this row's own lane and ends at the node below, otherwise a
   * through dash in `lane`.
   */
  stashDash?: { lane: number; toNode: boolean };
  /** Draw the dashed WIP-to-HEAD link in this lane: straight through the row, or down into this row's node. */
  wipDash?: WipDash;
  wipDashLane?: number;
  /** Draw the branch/tag connector from the left edge into the node. */
  connector?: boolean;
  author?: { name: string; email: string; initials: string };
}

const DASH = '2 3';

function NodeAvatar({ x, y, author, color }: { x: number; y: number; author: Props['author']; color: string }): JSX.Element {
  const url = useGravatar(author?.email);
  const [broken, setBroken] = useState(false);
  const r = NODE / 2;
  const showImage = url && !broken && !avatarFailed(url);
  return (
    <>
      <circle cx={x} cy={y} r={r - 1} fill="var(--bg-panel-raised)" stroke={color} strokeWidth={2} />
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
export function GraphCell({ row, width, wip, stash, stashDash, wipDash = null, wipDashLane, connector, author }: Props): JSX.Element {
  const mid = ROW_H / 2;
  if (!row && stash) {
    const x = laneX(stash.lane);
    const color = laneColor(stash.color);
    // Every lane that passes the parent row from above passes this one: its through lines, and
    // the lane each of its `incoming` curves arrives in. The parent's own lane is drawn above the
    // node only when a child is there to draw it for; below the node it is the run into the tip.
    const above = [...stash.through.map((s) => ({ lane: s.lane, color: s.color })), ...stash.incoming.map((s) => ({ lane: s.lane, color: s.color }))].filter(
      (s) => s.lane !== stash.lane && !(stashDash && !stashDash.toNode && s.lane === stashDash.lane),
    );
    const r = NODE / 2 - 1;
    const dashX = stashDash ? laneX(stashDash.lane) : 0;
    return (
      <svg width={width} height={ROW_H} aria-hidden="true">
        {above.map((s) => (
          <line key={`t${s.lane}`} x1={laneX(s.lane)} y1={0} x2={laneX(s.lane)} y2={ROW_H} stroke={laneColor(s.color)} strokeWidth={2} />
        ))}
        {/* The run passing this row, dashed in place of the solid line as everywhere else (GC-144). */}
        {stashDash && !stashDash.toNode && <line x1={dashX} y1={0} x2={dashX} y2={ROW_H} stroke={laneColor(stashDash.lane % 10)} strokeWidth={2} strokeDasharray={DASH} />}
        {stashDash?.toNode && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} strokeDasharray={DASH} />}
        {stash.above && !stashDash?.toNode && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} />}
        <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={DASH} />
        <circle cx={x} cy={mid} r={r} fill="var(--bg-panel)" stroke={color} strokeWidth={2} strokeDasharray={DASH} />
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
        {wip.linked && <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} strokeDasharray={DASH} />}
        <circle cx={x} cy={mid} r={NODE / 2 - 1} fill="var(--bg-app)" stroke={color} strokeWidth={2} strokeDasharray={DASH} />
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
      {through.map((s) => (
        <line key={`t${s.lane}`} x1={laneX(s.lane)} y1={0} x2={laneX(s.lane)} y2={ROW_H} stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {wipDash === 'through' && <line x1={dashX} y1={0} x2={dashX} y2={ROW_H} stroke={dashColor} strokeWidth={2} strokeDasharray={DASH} />}
      {wipDash === 'toNode' && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} strokeDasharray={DASH} />}
      {row.hasChildAbove && wipDash !== 'toNode' && <line x1={x} y1={0} x2={x} y2={mid} stroke={color} strokeWidth={2} />}
      {row.hasParentBelow && <line x1={x} y1={mid} x2={x} y2={ROW_H} stroke={color} strokeWidth={2} />}
      {row.incoming.map((s) => (
        <path key={`i${s.lane}`} d={curveIn(s.lane)} fill="none" stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {row.outgoing.map((s) => (
        <path key={`o${s.lane}`} d={curveOut(s.lane)} fill="none" stroke={laneColor(s.color)} strokeWidth={2} />
      ))}
      {connector && <line x1={0} y1={mid + 0.5} x2={x - NODE / 2 + 1} y2={mid + 0.5} stroke={color} strokeWidth={1} shapeRendering="crispEdges" opacity={0.8} />}
      <NodeAvatar x={x} y={mid} author={author} color={color} />
    </svg>
  );
}
