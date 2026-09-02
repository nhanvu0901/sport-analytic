import React from 'react';
import { PLOT, T, TH, V, series as PALETTE, type } from '../theme';
import { scaleLinear, niceTicks, fmt, ensureContrast } from '../scale';
import { PlotFrame } from '../chrome/PlotFrame';
import { AnnotationLayer, PortraitLabel, Headshot, revealState, useBeat, type Beat } from '../motion';

export type Serie = {
  id: string; name: string; first: string; last: string; total: number;
  headshot: string; points: { season: string; value: number }[];
};

/**
 * 01 — cumulative multi-line. Each series is drawn up to the point the
 * narration has reached; series already covered stay on screen but faded.
 *
 * The white halo under every stroke is not decoration: without it, crossing
 * lines merge into one shape at 1080 wide.
 */
export const CumulativeLines: React.FC<{
  data: { seasons: string[]; series: Serie[]; yLabel: string };
  beats: Beat[];
}> = ({ data, beats }) => {
  const { activeId, revealed, progress, active } = useBeat(beats);

  const yMax = Math.max(...data.series.map((s) => s.total));
  const ticks = niceTicks(0, yMax, 9);
  const y = scaleLinear([0, ticks.at(-1)!], [PLOT.h, 0]);
  const x = scaleLinear([0, data.seasons.length - 1], [0, PLOT.w]);
  const seasonIndex = new Map(data.seasons.map((s, i) => [s.slice(0, 4), i]));

  const pointsOf = (s: Serie) =>
    s.points
      .map((p) => {
        const i = seasonIndex.get(p.season.slice(0, 4));
        return i === undefined ? null : ([x(i + 1), y(p.value)] as [number, number]);
      })
      .filter(Boolean) as [number, number][];

  return (
    <>
      <PlotFrame
        yTicks={ticks.map((v) => ({ v, pos: y(v) }))}
        xTicks={data.seasons.map((s, i) => ({ v: i, pos: x(i), label: s }))}
        yLabel={data.yLabel}
        format={fmt.int}
      >
        {data.series.map((s, i) => {
          const st = revealState(s.id, revealed, activeId);
          if (!st.shown) return null;
          const pts = [[x(0), y(0)] as [number, number], ...pointsOf(s)];
          // The active line draws on across its own beat; older ones are whole.
          const shown = st.active
            ? pts.slice(0, Math.max(2, Math.ceil(pts.length * Math.min(1, progress / 0.7))))
            : pts;
          const d = shown.map((p) => p.join(',')).join(' ');
          const color = ensureContrast(PALETTE[i % PALETTE.length], TH.ground);
          return (
            <g key={s.id} opacity={st.opacity}>
              {TH.line.halo && (
                <polyline points={d} fill="none" stroke={TH.line.halo}
                  strokeWidth={TH.line.width + 6} strokeLinejoin="round" strokeLinecap={TH.line.cap} />
              )}
              <polyline points={d} fill="none" stroke={color}
                strokeWidth={st.active ? TH.line.width : TH.line.width * 0.72}
                strokeLinejoin="round" strokeLinecap={TH.line.cap} />
            </g>
          );
        })}
      </PlotFrame>

      {/* portraits ride the end of each drawn line */}
      {data.series.map((s, i) => {
        const st = revealState(s.id, revealed, activeId);
        if (!st.shown) return null;
        const pts = pointsOf(s);
        if (!pts.length) return null;
        const idx = st.active
          ? Math.min(pts.length - 1, Math.max(0, Math.ceil(pts.length * Math.min(1, progress / 0.7)) - 2))
          : pts.length - 1;
        const [px, py] = pts[idx];
        const color = ensureContrast(PALETTE[i % PALETTE.length], TH.ground);
        const clampX = (size: number) => Math.min(V.W - size / 2 - 10, PLOT.x + px + 30);
        if (st.active && progress > 0.72) {
          return <Headshot key={s.id} src={s.headshot} x={clampX(92)} y={PLOT.y + py} size={92} ring={TH.marker.ringFrom === 'ground' ? TH.ground : color} />;
        }
        if (st.active) {
          return (
            <PortraitLabel
              key={s.id}
              src={s.headshot}
              first={s.first}
              last={s.last}
              color={color}
              x={Math.max(PLOT.x + 24, Math.min(PLOT.x + px - 300, 600))}
              y={Math.max(PLOT.y + 16, Math.min(PLOT.y + py - 340, PLOT.y + PLOT.h - 430))}
            />
          );
        }
        return <Headshot key={s.id} src={s.headshot} x={clampX(72)} y={PLOT.y + py} size={72} ring={TH.marker.ringFrom === 'ground' ? TH.ground : color} opacity={0.8} />;
      })}

      <AnnotationLayer ann={active?.annotation} progress={progress} />
    </>
  );
};
