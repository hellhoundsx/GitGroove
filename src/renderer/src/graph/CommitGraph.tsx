import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react';
import { Check, Cloud, Minus, Pencil, Plus, Tag, TriangleAlert } from 'lucide-react';
import type { Commit, GitRef, RepoStatus } from '@shared/types';
import { layoutGraph, type RowLayout } from './lanes';
import { GraphCell, LANE_W, ROW_H, laneColor, type WipDash } from './GraphCell';
import { Icon } from '../ui/icons';
import { initialsOf } from '../ui/avatars';

interface Props {
  commits: Commit[];
  refs: GitRef[];
  status: RepoStatus | null;
  headSha: string | null;
  selected: string | null; // sha, or WIP
  onSelect(sha: string): void;
  onCommitMenu(e: MouseEvent, commit: Commit): void;
  onWipMenu(e: MouseEvent): void;
  onRefMenu(e: MouseEvent, ref: GitRef): void;
  onRefActivate(ref: GitRef): void;
}

export const WIP = 'WIP';
const OVERSCAN = 12;
const MAX_CHIPS = 2;

/** A ref chip to draw; a local branch absorbs its upstream when both point at the same commit. */
interface Chip {
  ref: GitRef;
  upstreamHere: boolean;
}

function chipsFor(refs: GitRef[]): Chip[] {
  const absorbed = new Set<string>();
  for (const r of refs) if (r.kind === 'head' && r.upstream && refs.some((o) => o.kind === 'remote' && o.name === r.upstream)) absorbed.add(r.upstream);
  return refs.filter((r) => !(r.kind === 'remote' && absorbed.has(r.name))).map((r) => ({ ref: r, upstreamHere: r.kind === 'head' && !!r.upstream && absorbed.has(r.upstream) }));
}

const laneFree = (row: RowLayout, lane: number): boolean =>
  row.lane !== lane && !row.through.some((s) => s.lane === lane) && !row.incoming.some((s) => s.lane === lane) && !row.outgoing.some((s) => s.lane === lane);

export function CommitGraph({ commits, refs, status, headSha, selected, onSelect, onCommitMenu, onWipMenu, onRefMenu, onRefActivate }: Props): JSX.Element {
  const layout = useMemo(() => layoutGraph(commits, headSha), [commits, headSha]);
  const refsBySha = useMemo(() => {
    const m = new Map<string, GitRef[]>();
    for (const r of refs) {
      const list = m.get(r.sha) ?? [];
      list.push(r);
      m.set(r.sha, list);
    }
    // checked-out branch first, then tracking locals, other locals, remotes, tags
    const rank = (r: GitRef): number => (r.isHead ? 0 : r.kind === 'head' ? (r.upstream ? 1 : 2) : r.kind === 'remote' ? 3 : 4);
    for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return m;
  }, [refs]);

  const graphWidth = Math.max(3, layout.laneCount) * LANE_W + 16;
  const headRowIndex = headSha ? layout.rows.findIndex((r) => r.sha === headSha) : -1;
  const headRow = headRowIndex >= 0 ? layout.rows[headRowIndex]! : null;
  const wipLane = headRow ? { lane: headRow.lane, color: headRow.color } : { lane: 0, color: 0 };

  const counts = useMemo(() => {
    const c = { add: 0, mod: 0, del: 0, conflict: 0 };
    for (const e of status?.entries ?? []) {
      const k = e.unstaged ?? e.staged;
      if (k === 'conflicted') c.conflict++;
      else if (k === 'added' || k === 'untracked') c.add++;
      else if (k === 'deleted') c.del++;
      else if (k) c.mod++;
    }
    return c;
  }, [status]);
  const hasChanges = counts.add + counts.mod + counts.del + counts.conflict > 0;

  // ---- virtualisation -----------------------------------------------------
  const bodyRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const update = (): void => setViewport({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hasWip = !!status;
  const total = layout.rows.length + (hasWip ? 1 : 0);
  const first = Math.max(0, Math.floor(viewport.top / ROW_H) - OVERSCAN);
  const last = Math.min(total, Math.ceil((viewport.top + viewport.height) / ROW_H) + OVERSCAN);

  // keep the selected row visible when the selection changes (keyboard navigation)
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || selected === null) return;
    const index = selected === WIP ? 0 : commits.findIndex((c) => c.sha === selected) + (hasWip ? 1 : 0);
    if (index < 0) return;
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  }, [selected, commits, hasWip]);

  const renderChip = ({ ref: r, upstreamHere }: Chip, color: string): JSX.Element => (
    <span
      key={r.fullName}
      className={`ref-chip ${r.kind} ${r.isHead ? 'head' : ''}`}
      title={`${r.fullName}${upstreamHere ? `\nup to date with ${r.upstream}` : ''}\nDouble-click to checkout, right-click for actions`}
      style={r.kind === 'tag' ? undefined : { background: `color-mix(in srgb, ${color} 30%, var(--bg-panel))` }}
      onContextMenu={(e) => {
        e.stopPropagation();
        onRefMenu(e, r);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onRefActivate(r);
      }}
    >
      {r.isHead && <Icon of={Check} size={11} className="chip-icon" />}
      {r.kind === 'tag' && <Icon of={Tag} size={11} className="chip-icon" />}
      {r.kind === 'remote' && <Icon of={Cloud} size={11} className="chip-icon" />}
      <span className="chip-name">{r.name}</span>
      {upstreamHere && <Icon of={Cloud} size={11} className="chip-icon trailing" />}
    </span>
  );

  const renderRow = (index: number): JSX.Element | null => {
    const style = { top: index * ROW_H };
    if (hasWip && index === 0) {
      return (
        <div key="wip" className={`graph-row wip ${selected === WIP ? 'selected' : ''}`} style={style} onClick={() => onSelect(WIP)} onContextMenu={onWipMenu}>
          <div className="col-ref" />
          <div className="col-graph" style={{ width: graphWidth }}>
            <GraphCell row={null} width={graphWidth} wip={wipLane} />
          </div>
          <div className="col-msg">
            <input className="wip-input" placeholder="// WIP" spellCheck={false} onClick={(e) => e.stopPropagation()} />
            {hasChanges ? (
              <span className="readout">
                {counts.conflict > 0 && (
                  <span className="del">
                    <Icon of={TriangleAlert} size={11} /> {counts.conflict}
                  </span>
                )}
                {counts.add > 0 && (
                  <span className="add">
                    <Icon of={Plus} size={11} /> {counts.add}
                  </span>
                )}
                {counts.mod > 0 && (
                  <span className="mod">
                    <Icon of={Pencil} size={11} /> {counts.mod}
                  </span>
                )}
                {counts.del > 0 && (
                  <span className="del">
                    <Icon of={Minus} size={11} /> {counts.del}
                  </span>
                )}
              </span>
            ) : (
              <span className="readout dim">no changes</span>
            )}
          </div>
        </div>
      );
    }
    const i = hasWip ? index - 1 : index;
    const row = layout.rows[i];
    const c = commits[i];
    if (!row || !c) return null;
    const rowRefs = refsBySha.get(c.sha) ?? [];
    const chips = chipsFor(rowRefs);
    const color = laneColor(row.color);
    let wipDash: WipDash = null;
    if (hasWip && headRow) {
      if (i < headRowIndex && laneFree(row, headRow.lane)) wipDash = 'through';
      else if (i === headRowIndex && !row.hasChildAbove) wipDash = 'toNode';
    }
    return (
      <div key={c.sha} className={`graph-row ${selected === c.sha ? 'selected' : ''}`} style={style} onClick={() => onSelect(c.sha)} onContextMenu={(e) => onCommitMenu(e, c)}>
        <div className="col-ref">
          {chips.slice(0, MAX_CHIPS).map((chip) => renderChip(chip, color))}
          {chips.length > MAX_CHIPS && (
            <span className="ref-chip more" title="More refs on this commit">
              +{chips.length - MAX_CHIPS}
              <span className="more-list">{chips.slice(MAX_CHIPS).map((chip) => renderChip(chip, color))}</span>
            </span>
          )}
          {rowRefs.length > 0 && <span className="ref-line" style={{ background: color }} />}
        </div>
        <div className="col-graph" style={{ width: graphWidth }}>
          <GraphCell
            row={row}
            width={graphWidth}
            wipDash={wipDash}
            wipDashLane={wipDash === 'through' ? headRow!.lane : undefined}
            connector={rowRefs.length > 0}
            author={{ name: c.authorName, email: c.authorEmail, initials: initialsOf(c.authorName) }}
          />
        </div>
        <div className="col-msg" title={`${c.summary}\n\n${c.body}`.trim()}>
          <span className="strip" style={{ background: color }} />
          <span className="summary">{c.summary}</span>
          {c.body && <span className="body">{c.body.split('\n')[0]}</span>}
        </div>
      </div>
    );
  };

  const rows: JSX.Element[] = [];
  for (let i = first; i < last; i++) {
    const r = renderRow(i);
    if (r) rows.push(r);
  }

  return (
    <div className="graph-panel">
      {/* shared clip for the round avatars inside every row's svg */}
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <clipPath id="gc-node-clip" clipPathUnits="objectBoundingBox">
            <circle cx={0.5} cy={0.5} r={0.5} />
          </clipPath>
        </defs>
      </svg>
      <div className="graph-header">
        <div className="col-ref">Branch / Tag</div>
        <div className="col-graph" style={{ width: graphWidth }}>
          Graph
        </div>
        <div className="col-msg">Commit message</div>
      </div>
      <div className="graph-body" ref={bodyRef} onScroll={(e) => setViewport({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })}>
        <div className="graph-rows" style={{ height: total * ROW_H }}>
          {rows}
        </div>
      </div>
    </div>
  );
}
