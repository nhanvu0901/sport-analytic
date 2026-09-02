import React from 'react';
import { Img } from 'remotion';
import { PLOT, T, TH, V, series as PALETTE, type } from '../theme';
import { scaleLinear, niceTicks, fmt, ensureContrast } from '../scale';
import { PlotFrame } from '../chrome/PlotFrame';
import { useBeat, type Beat } from '../motion';

export type CapRow = { id: string; name: string; last: string; value: number; headshot: string };
export type Thresholds = { cap: number; floor: number; tax: number; apron1: number; apron2: number; season: string };

/**
 * 02 — one budget decomposed into people, judged against fixed thresholds.
 * The channel's most repeated format: ~40 videos, 126K–648K views each.
 */
export const StackedColumn: React.FC<{
  rows: CapRow[];
  thresholds: Thresholds;
  beats: Beat[];
}> = ({ rows, thresholds, beats }) => {
  const { activeId, revealed, progress } = useBeat(beats);

  const total = rows.reduce((s, r) => s + r.value, 0);
  const top = Math.max(total, thresholds.apron2) * 1.02;
  const ticks = niceTicks(0, top, 12);
  const y = scaleLinear([0, ticks.at(-1)!], [PLOT.h, 0]);

  const colX = PLOT.w * 0.3;
  const colW = PLOT.w * 0.42;

  // stack from the floor upward, biggest contract on top
  let acc = 0;
  const segs = [...rows].reverse().map((r, i) => {
    const y0 = acc;
    acc += r.value;
    return { r, y0, y1: acc, color: ensureContrast(PALETTE[(rows.length - 1 - i) % PALETTE.length], TH.ground) };
  });

  const lines: [string, number][] = [
    ['2nd Apron', thresholds.apron2],
    ['1st Apron', thresholds.apron1],
    ['Luxury Tax', thresholds.tax],
    ['Salary Cap', thresholds.cap],
    ['Salary Floor', thresholds.floor],
  ];

  return (
    <>
      <PlotFrame yTicks={ticks.map((v) => ({ v, pos: y(v) }))} format={fmt.moneyShort}>
        {lines.map(([label, v]) => (
          <line
            key={label}
            x1={0} y1={y(v)} x2={PLOT.w} y2={y(v)}
            stroke={T.capLine} strokeWidth={4} strokeDasharray="16 12" opacity={0.85}
          />
        ))}
        {segs.map((s) => {
          const isActive = s.r.id === activeId;
          const h = y(s.y0) - y(s.y1);
          return (
            <rect
              key={s.r.id}
              x={colX} y={y(s.y1)} width={colW} height={h}
              fill={s.color}
              stroke={TH.ground} strokeWidth={2}
              opacity={activeId === undefined || isActive ? 1 : 0.42}
            />
          );
        })}
      </PlotFrame>

      {lines.map(([label, v]) => (
        <div
          key={label}
          style={{
            position: 'absolute', right: 30, top: PLOT.y + y(v) - 26,
            ...type.axisTick, fontWeight: 700, color: T.ink, fontSize: 21,
            whiteSpace: 'nowrap', background: TH.plate, padding: '1px 6px',
          }}
        >
          {label}
        </div>
      ))}

      {/* portrait + name + salary inside each band that is tall enough */}
      {segs.map((s) => {
        const isActive = s.r.id === activeId;
        const h = y(s.y0) - y(s.y1);
        if (h < 52) return null;
        const cy = PLOT.y + (y(s.y0) + y(s.y1)) / 2;
        return (
          <div key={s.r.id} style={{ opacity: activeId === undefined || isActive ? 1 : 0.82, position: 'absolute', left: PLOT.x + colX, width: colW, top: cy - h / 2, height: h, display: 'flex', alignItems: 'center', gap: 10, paddingLeft: 8 }}>
            {h > 62 && (
              <Img src={s.r.headshot} style={{ width: Math.min(64, h - 10), height: Math.min(64, h - 10), objectFit: 'cover', objectPosition: 'top center', borderRadius: 6, border: `2px solid ${TH.hairline}` }} />
            )}
            <div style={{ lineHeight: 1.05, overflow: 'hidden' }}>
              <div style={{ ...type.rowName, color: '#fff', fontWeight: 700, fontSize: Math.min(30, Math.max(17, h * 0.30)), textShadow: '0 1px 2px rgba(0,0,0,.45)', whiteSpace: 'nowrap' }}>
                {s.r.name}
              </div>
              {h > 46 && (
                <div style={{ ...type.rowValue, color: 'rgba(255,255,255,.94)', fontSize: Math.min(24, Math.max(15, h * 0.22)), textShadow: '0 1px 2px rgba(0,0,0,.45)' }}>
                  {fmt.money(s.r.value)}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {(() => {
        const smalls = segs.filter((s) => y(s.y0) - y(s.y1) < 52);
        if (!smalls.length) return null;
        const top0 = Math.min(...smalls.map((s) => y(s.y1)));   // smaller y = higher up
        const bot0 = Math.max(...smalls.map((s) => y(s.y0)));
        return (
          <div style={{ position: 'absolute', left: PLOT.x + colX, width: colW, top: PLOT.y + (top0 + bot0) / 2 - 15, textAlign: 'center', ...type.rowName, fontWeight: 700, color: '#fff', fontSize: 22, textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>
            {smalls.length} more, near the minimum
          </div>
        );
      })()}

      <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y + PLOT.h + 20, width: PLOT.w, textAlign: 'center', ...type.sub, fontSize: 30 }}>
        {fmt.money(total)} committed · {thresholds.season}
      </div>
    </>
  );
};
