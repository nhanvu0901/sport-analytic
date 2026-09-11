import React from 'react';
import { Img } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { scaleLinear, niceTicks } from '../scale';
import { PlotFrame } from '../chrome/PlotFrame';
import { AccentLayer, Headshot, useBeat, type Beat, type CameraStop, Camera } from '../motion';
import type { Anchor, Resolve } from '../accent';

export type Pt = { id: string; name: string; last: string; x: number; y: number; abbr?: string; logo?: string; headshot: string };

/**
 * 07 — two measures, position in the plane is the comparison. Marker size is
 * chosen by how many points are on screen, which is exactly what the router
 * decides: 56px portraits up to 14, 40px to 40, then team logos.
 */
export const Scatter: React.FC<{
  data: { rows: Pt[]; xLabel: string; yLabel: string };
  beats: Beat[];
  formatX?: (v: number) => string;
  formatY?: (v: number) => string;
  marker?: 'headshot-56' | 'headshot-40' | 'logo-32';
}> = ({ data, beats, formatX, formatY, marker = 'logo-32' }) => {
  const { activeId, progress, active, beatMs } = useBeat(beats);
  const xs = data.rows.map((r) => r.x);
  const ys = data.rows.map((r) => r.y);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs), 6);
  const yt = niceTicks(Math.min(0, ...ys), Math.max(...ys), 7);
  const x = scaleLinear([xt[0], xt.at(-1)!], [0, PLOT.w]);
  const y = scaleLinear([yt[0], yt.at(-1)!], [PLOT.h, 0]);

  const resolve: Resolve = (a: Anchor) => {
    const r = data.rows.find((v) => v.id === a.entityId);
    return r ? { x: PLOT.x + x(r.x), y: PLOT.y + y(r.y) } : null;
  };

  const size = marker === 'headshot-56' ? 92 : marker === 'headshot-40' ? 62 : 38;

  // A zoom anchored near an edge pushes the axes out of frame, so the focus
  // point is clamped toward the middle before the camera uses it.
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const stops: CameraStop[] = beats.map((b) => {
    const r = data.rows.find((p) => p.id === b.entityId);
    return {
      atMs: b.startMs,
      focus: r
        ? {
            x: clamp(PLOT.x + x(r.x), V.W * 0.34, V.W * 0.66),
            y: clamp(PLOT.y + y(r.y), PLOT.y + PLOT.h * 0.3, PLOT.y + PLOT.h * 0.7),
            zoom: 1.18,
          }
        : { x: V.W / 2, y: V.H / 2, zoom: 1 },
    };
  });

  return (
    <>
      <Camera stops={stops}>
        <PlotFrame
          yTicks={yt.map((v) => ({ v, pos: y(v) }))}
          xTicks={xt.map((v) => ({ v, pos: x(v), label: formatX ? formatX(v) : String(v) }))}
          yLabel={data.yLabel}
          xLabel={data.xLabel}
          format={formatY}
        />
        {data.rows.map((r) => {
          const isActive = r.id === activeId;
          const px = PLOT.x + x(r.x);
          const py = PLOT.y + y(r.y);
          const s = isActive ? size * 1.5 : size;
          if (marker === 'logo-32' && r.logo && !isActive) {
            return (
              <div
                key={r.id}
                style={{
                  position: 'absolute', left: px - s / 2, top: py - s / 2, width: s, height: s,
                  borderRadius: s / 2, background: TH.logoPlate ? 'rgba(255,255,255,0.72)' : undefined,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Img src={r.logo} style={{ width: s * 0.86, height: s * 0.86, objectFit: 'contain' }} />
              </div>
            );
          }
          return <Headshot key={r.id} src={r.headshot} x={px} y={py} size={s} ring={isActive ? T.bad : undefined} opacity={isActive ? 1 : 0.9} />;
        })}
      </Camera>
      <AccentLayer accents={active?.accents} progress={progress} beatMs={beatMs} resolve={resolve} />
    </>
  );
};
