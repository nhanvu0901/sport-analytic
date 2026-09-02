import React from 'react';
import { PLOT, T, TH, V, type } from '../theme';
import { scaleLinear, fitRows, fmt } from '../scale';
import { Scroll, useBeat, type Beat, type ScrollStop } from '../motion';

export type DeltaRow = {
  id: string; name: string; last: string; base: number; now: number; delta: number; abbr?: string;
};

/**
 * 06 — baseline bar plus the change. The gap is the data, so the baseline
 * stays visible and the delta is a differently-coloured extension.
 */
export const BarDelta: React.FC<{ rows: DeltaRow[]; beats: Beat[] }> = ({ rows, beats }) => {
  const { activeId, revealed, progress } = useBeat(beats);
  const fit = fitRows(rows.length, PLOT.h);
  const labelW = 300;
  const barX = PLOT.x + labelW;
  const barW = PLOT.w - labelW - 210;
  const max = Math.max(...rows.flatMap((r) => [r.base, r.now]));
  const x = scaleLinear([0, max], [0, barW]);

  const stops: ScrollStop[] = beats.map((b) => ({
    atMs: b.startMs,
    offset: rows.findIndex((r) => r.id === b.entityId) * fit.rowH,
  }));

  const body = (
    <div style={{ position: 'absolute', left: 0, top: 0, width: V.W }}>
      {rows.map((r, i) => {
        const isActive = r.id === activeId;
        const grow = isActive ? Math.min(1, progress / 0.35) : 1;
        const up = r.delta >= 0;
        const bw = x(Math.min(r.base, r.now));
        const dw = x(Math.abs(r.delta)) * grow;
        return (
          <div
            key={r.id}
            style={{
              position: 'absolute', top: i * fit.rowH, left: 0, height: fit.rowH, width: V.W,
              opacity: revealed.size > 0 && !isActive ? 0.55 : 1,
            }}
          >
            <div style={{ position: 'absolute', left: PLOT.x, width: labelW - 16, top: fit.rowH / 2 - 16, textAlign: 'right', ...type.rowName, fontSize: Math.min(25, fit.rowH * 0.56), whiteSpace: 'nowrap' }}>
              <span style={isActive ? { background: T.highlight, color: TH.onHighlight, padding: '2px 9px 4px', fontWeight: 700 } : undefined}>{r.name}</span>
            </div>
            {/* baseline: last season */}
            <div style={{ position: 'absolute', left: barX, top: fit.rowH * 0.2, width: bw, height: fit.rowH * 0.6, background: T.track, border: `1px solid ${TH.hairline}` }} />
            {/* the change */}
            <div style={{ position: 'absolute', left: barX + bw, top: fit.rowH * 0.2, width: dw, height: fit.rowH * 0.6, background: up ? T.good : T.bad }} />
            <div style={{ position: 'absolute', right: 34, top: fit.rowH / 2 - 15, ...type.rowValue, fontSize: Math.min(23, Math.max(18, fit.rowH * 0.5)), color: up ? T.good : T.bad, whiteSpace: 'nowrap' }}>
              {fmt.signed(r.delta)}
              <span style={{ color: T.ink3, fontWeight: 400 }}>{`  ${r.base}→${r.now}`}</span>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ position: 'absolute', left: 0, top: PLOT.y, width: V.W, height: PLOT.h }}>
      {fit.mode === 'scroll' ? (
        <Scroll stops={stops} contentHeight={rows.length * fit.rowH} viewport={PLOT.h}>{body}</Scroll>
      ) : body}
    </div>
  );
};
