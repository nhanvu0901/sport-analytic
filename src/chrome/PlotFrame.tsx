import React from 'react';
import { PLOT, T, TH, type } from '../theme';
import { fmt } from '../scale';

export type Tick = { v: number; pos: number };

/**
 * Grid, axes and tick labels. Shared by the seven charts that live in a
 * cartesian box; the waffle and the map do not use it.
 */
export const PlotFrame: React.FC<{
  yTicks?: Tick[];
  xTicks?: (Tick & { label?: string })[];
  yLabel?: string;
  xLabel?: string;
  format?: (v: number) => string;
  zeroLine?: number;
  children?: React.ReactNode;
}> = ({ yTicks = [], xTicks = [], yLabel, xLabel, format = fmt.int, zeroLine, children }) => (
  <>
    <svg
      width={PLOT.w}
      height={PLOT.h}
      style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, overflow: 'visible' }}
    >
{/* A channel is as recognisable by the grid it omits as by the one it draws. */}
      {TH.grid.horizontal && yTicks.map((t) => (
        <line key={`y${t.v}`} x1={0} y1={t.pos} x2={PLOT.w} y2={t.pos}
          stroke={TH.grid.horizontal!} strokeWidth={TH.grid.width}
          strokeDasharray={TH.grid.dash ?? undefined} strokeLinecap="round" />
      ))}
      {TH.grid.vertical && xTicks.map((t) => (
        <line key={`x${t.v}`} x1={t.pos} y1={0} x2={t.pos} y2={PLOT.h}
          stroke={TH.grid.vertical!} strokeWidth={TH.grid.width}
          strokeDasharray={TH.grid.dash ?? undefined} strokeLinecap="round" />
      ))}
      {zeroLine !== undefined && TH.axis && (
        <line x1={zeroLine} y1={0} x2={zeroLine} y2={PLOT.h} stroke={TH.axis} strokeWidth={2.5} />
      )}
      {TH.axis && <line x1={0} y1={0} x2={0} y2={PLOT.h} stroke={TH.axis} strokeWidth={2} />}
      <line x1={0} y1={PLOT.h} x2={PLOT.w} y2={PLOT.h}
        stroke={TH.axis ?? T.ink} strokeWidth={TH.baselineWidth} />
      {children}
    </svg>

    {yTicks.map((t) => (
      <div
        key={`yl${t.v}`}
        style={{
          position: 'absolute', left: 26, top: PLOT.y + t.pos - 14, width: PLOT.x - 26 - 12,
          textAlign: 'right', ...type.axisTick,
        }}
      >
        {format(t.v)}
      </div>
    ))}
    {xTicks.map((t) => (
      <div
        key={`xl${t.v}`}
        style={{
          position: 'absolute', left: PLOT.x + t.pos - 60, top: PLOT.y + PLOT.h + 14,
          width: 120, textAlign: 'center', ...type.axisTick, fontWeight: 700, color: T.ink,
        }}
      >
        {t.label ?? t.v}
      </div>
    ))}
    {yLabel && (
      <div
        style={{
          position: 'absolute', left: -22, top: PLOT.y + PLOT.h / 2,
          transform: 'translateY(-50%) rotate(-90deg)', transformOrigin: 'center',
          whiteSpace: 'nowrap', ...type.axisTitle,
        }}
      >
        {yLabel}
      </div>
    )}
    {xLabel && (
      <div
        style={{
          position: 'absolute', left: PLOT.x, width: PLOT.w, top: PLOT.y + PLOT.h + 58,
          textAlign: 'center', ...type.axisTitle,
        }}
      >
        {xLabel}
      </div>
    )}
  </>
);
