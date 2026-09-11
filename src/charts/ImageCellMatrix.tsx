import React from 'react';
import { Img } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { gridFit } from '../scale';
import type { Anchor, Resolve } from '../accent';
import { AccentLayer, Camera, useBeat, type Beat, type CameraStop } from '../motion';

export type MatrixCell = { row: number; col: number; entityId: string; name: string; last: string; headshot: string; value: number };
export type LeaderMatrixData = {
  title: string; sub: string;
  rowDim: { name: string; steps: string[] };
  colDim: { name: string; steps: string[] };
  cells: MatrixCell[];
};

// Wider/taller header bands than the geometry strictly needs: with 7 rows
// and only 6 columns in a portrait box the grid is always width-bound (a
// square-cell grid that fills 6 columns cannot also fill 7 rows of height
// without going non-square), so there is always vertical slack. Rather than
// leave it as dead space, it goes to headers big enough to read on a phone.
const HEADER_W = 110;
const HEADER_H = 84;
const GAP = 8;
const COL_LABEL_SIZE = 28;
const ROW_LABEL_SIZE = 26;

/**
 * 10 — image-cell-matrix. Two dimensions cross to NAME an entity, not to
 * measure one, so the cell IS the headshot. The spotlight — dimming every
 * cell except the ones a beat's entity actually holds — is the whole point:
 * it is how "these are all the categories one player led" reads on a grid.
 */
export const ImageCellMatrix: React.FC<{
  data: LeaderMatrixData;
  beats: Beat[];
  highlightCol?: string;
}> = ({ data, beats, highlightCol }) => {
  const { activeId, progress, active, beatMs } = useBeat(beats);

  const rows = data.rowDim.steps.length;
  const cols = data.colDim.steps.length;
  const g = gridFit(rows, cols, PLOT.w - HEADER_W, PLOT.h - HEADER_H, GAP);
  const originX = PLOT.x + HEADER_W + g.ox;
  const originY = PLOT.y + HEADER_H + g.oy;
  const cellX = (col: number) => originX + col * (g.cell + GAP);
  const cellY = (row: number) => originY + row * (g.cell + GAP);
  const cellCenter = (row: number, col: number) => ({ x: cellX(col) + g.cell / 2, y: cellY(row) + g.cell / 2 });

  const byId = new Map(data.cells.map((c) => [`${c.row}|${c.col}`, c]));

  const resolve: Resolve = (a: Anchor) => {
    const cell = data.cells.find((c) => c.entityId === a.entityId);
    return cell ? cellCenter(cell.row, cell.col) : null;
  };

  // A beat can name a column directly (e.g. a zoom/spotlight anchored with
  // step: 'PTS') to dim every column but one, the way the source video does
  // when it isolates a single stat — independent of, and combinable with,
  // the per-entity spotlight below.
  const autoCol = active?.accents
    ?.find((a) => (a.kind === 'zoom' || a.kind === 'spotlight') && a.at?.step !== undefined && data.colDim.steps.includes(String(a.at.step)))
    ?.at?.step;
  const effectiveCol = highlightCol ?? (autoCol !== undefined ? String(autoCol) : undefined);
  const highlightColIdx = effectiveCol ? data.colDim.steps.indexOf(effectiveCol) : -1;

  const NEUTRAL_FOCUS = { x: V.W / 2, y: V.H / 2, zoom: 1 };
  const clampFocus = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const zoomStops: CameraStop[] = [];
  for (const b of beats) {
    for (const a of b.accents ?? []) {
      if (a.kind !== 'zoom') continue;
      const p = a.at ? resolve(a.at) : null;
      const at = b.startMs + (b.endMs - b.startMs) * a.t;
      zoomStops.push({
        atMs: at,
        focus: p
          ? { x: clampFocus(p.x, V.W * 0.32, V.W * 0.68), y: clampFocus(p.y, PLOT.y + PLOT.h * 0.28, PLOT.y + PLOT.h * 0.72), zoom: 1.6 }
          : NEUTRAL_FOCUS,
      });
      if (p) zoomStops.push({ atMs: Math.min(b.endMs - 120, at + 2200), focus: NEUTRAL_FOCUS });
    }
  }
  zoomStops.sort((a, b) => a.atMs - b.atMs);

  return (
    <>
      <Camera stops={zoomStops} glideMs={620}>
        {data.colDim.steps.map((label, col) => (
          <div
            key={`ch${col}`}
            style={{
              position: 'absolute', left: cellX(col), top: PLOT.y + HEADER_H / 2 - COL_LABEL_SIZE / 2 - 6,
              width: g.cell, textAlign: 'center',
              fontFamily: TH.tick.font, fontWeight: 700, fontSize: COL_LABEL_SIZE, color: T.ink,
              opacity: highlightColIdx < 0 || col === highlightColIdx ? 1 : 0.4,
            }}
          >
            {label}
          </div>
        ))}
        {data.rowDim.steps.map((label, row) => (
          <div
            key={`rh${row}`}
            style={{
              position: 'absolute', left: PLOT.x, top: cellY(row) + g.cell / 2 - ROW_LABEL_SIZE / 2 - 4, width: HEADER_W - 16,
              textAlign: 'right', ...type.axisTick, fontSize: ROW_LABEL_SIZE, fontWeight: 700,
            }}
          >
            {label}
          </div>
        ))}

        {Array.from({ length: rows }, (_, row) =>
          Array.from({ length: cols }, (_, col) => {
            const cell = byId.get(`${row}|${col}`);
            if (!cell) return null;
            const isActive = cell.entityId === activeId;
            let op = active ? (isActive ? 1 : 0.22) : 1;
            if (highlightColIdx >= 0) op = Math.min(op, col === highlightColIdx ? 1 : 0.3);
            const x = cellX(col), y = cellY(row);
            const showValue = g.cell >= 76;
            const border = 2;
            const imgSize = g.cell - border * 2;
            return (
              <div key={`${row}|${col}`} style={{ position: 'absolute', left: x, top: y, width: g.cell, opacity: op }}>
                <Img
                  src={cell.headshot}
                  style={{
                    display: 'block', width: imgSize, height: imgSize,
                    objectFit: 'cover', objectPosition: 'top center',
                    borderRadius: TH.marker.shape === 'circle' ? '50%' : g.cell * 0.18,
                    border: `${border}px solid ${isActive ? T.highlight : TH.hairline}`,
                    boxShadow: isActive ? `0 0 0 4px ${T.highlight}55` : undefined,
                    background: TH.ground,
                  }}
                />
                {showValue && (
                  <div style={{ marginTop: 4, textAlign: 'center', fontFamily: TH.tick.font, fontSize: 16, fontWeight: 700, color: T.ink2 }}>
                    {cell.value.toFixed(1)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </Camera>
      <AccentLayer accents={active?.accents} progress={progress} beatMs={beatMs} resolve={resolve} />
    </>
  );
};
