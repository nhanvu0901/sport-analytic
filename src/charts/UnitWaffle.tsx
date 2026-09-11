import React from 'react';
import { PLOT, T, TH, series as PALETTE, type } from '../theme';
import { gridFit, waffleLayout, ensureContrast, fmt, easeOut } from '../scale';
import type { Anchor, Resolve } from '../accent';
import { AccentLayer, useBeat, type Beat } from '../motion';

export type WafflePart = { key: string; label: string; points: number; share: number };
export type WaffleData = {
  title: string; sub: string; entityId: string; name: string; headshot: string; total: number;
  parts: WafflePart[]; bySeason: { season: string; points: number }[];
};

const UNITS_TOTAL = 420;
const GAP = 6;
const TOP_BAND = 140;     // headline total number
const BOTTOM_BAND = 3 * 40 + 20; // one legend line per part

/**
 * 11 — unit-waffle. One headline total whose scale is the story; a dot per
 * unit of the total makes the SIZE felt in a way a single number cannot.
 * No camera moves here (router marks this chart `camera: 'static'`) — the
 * whole point is the full grid sitting still while parts light up in it.
 */
export const UnitWaffle: React.FC<{ data: WaffleData; beats: Beat[] }> = ({ data, beats }) => {
  const { activeId, revealed, progress, active, beatMs } = useBeat(beats);

  const gridW = PLOT.w;
  const gridH = PLOT.h - TOP_BAND - BOTTOM_BAND;
  const cols = Math.max(1, Math.round(Math.sqrt(UNITS_TOTAL * (gridW / gridH))));
  const rows = Math.ceil(UNITS_TOTAL / cols);
  const g = gridFit(rows, cols, gridW, gridH, GAP);
  const originX = g.ox;                    // local to the PLOT box
  const originY = TOP_BAND + g.oy;

  const units = waffleLayout(data.parts.map((p) => ({ key: p.key, points: p.points })), cols, UNITS_TOTAL);
  const partCount = new Map<string, number>();
  for (const p of data.parts) partCount.set(p.key, units.filter((u) => u.key === p.key).length);
  const localIndex = new Map<number, number>();
  { const seen: Record<string, number> = {}; units.forEach((u) => { localIndex.set(u.index, seen[u.key] ?? 0); seen[u.key] = (seen[u.key] ?? 0) + 1; }); }

  const dotCenter = (index: number) => {
    const row = Math.floor(index / cols), col = index % cols;
    return { x: originX + col * (g.cell + GAP) + g.cell / 2, y: originY + row * (g.cell + GAP) + g.cell / 2 };
  };

  // Before any beat starts, show the whole picture — the intro shot. Once
  // narration begins, the active part's dots sweep in, prior parts stay
  // full, and parts not yet reached stay hidden.
  const partProgress = (key: string): number => {
    if (!active) return 1;
    if (key === activeId) return easeOut(Math.min(1, progress / 0.45));
    return revealed.has(key) ? 1 : 0;
  };

  const colorOf = (i: number) => ensureContrast(PALETTE[i % PALETTE.length], TH.ground);
  const colorByKey = new Map(data.parts.map((p, i) => [p.key, colorOf(i)]));

  const resolve: Resolve = (a: Anchor) => {
    const matching = units.filter((u) => u.key === a.entityId);
    if (!matching.length) return null;
    const pts = matching.map((u) => dotCenter(u.index));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return { x: PLOT.x + cx, y: PLOT.y + cy };
  };

  return (
    <>
      <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, width: PLOT.w, textAlign: 'center', ...type.title, fontSize: Math.min(type.title.fontSize, 96), color: T.ink }}>
        {fmt.int(data.total)}
      </div>

      <svg width={PLOT.w} height={PLOT.h} style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, overflow: 'visible' }}>
        {units.map((u) => {
          const pp = partProgress(u.key);
          if (pp <= 0) return null;
          const total = partCount.get(u.key)!;
          const revealCount = Math.round(total * pp);
          if (localIndex.get(u.index)! >= revealCount) return null;
          const { x, y } = dotCenter(u.index);
          return <circle key={u.index} cx={x} cy={y} r={g.cell * 0.34} fill={colorByKey.get(u.key)} />;
        })}
      </svg>

      <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y + PLOT.h - BOTTOM_BAND + 10, width: PLOT.w, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {data.parts.map((p, i) => {
          const isActive = p.key === activeId;
          const dim = active && !isActive && partProgress(p.key) <= 0;
          return (
            <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 14, opacity: dim ? 0.35 : 1 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: colorOf(i), flexShrink: 0 }} />
              <span style={{ ...type.rowName, fontSize: 26, flex: 1, fontWeight: isActive ? 700 : 500, color: isActive ? T.ink : T.ink2 }}>{p.label}</span>
              <span style={{ ...type.rowValue, fontSize: 24, color: T.ink }}>{fmt.int(p.points)} · {fmt.pct(p.share)}</span>
            </div>
          );
        })}
      </div>

      <AccentLayer accents={active?.accents} progress={progress} beatMs={beatMs} resolve={resolve} />
    </>
  );
};
