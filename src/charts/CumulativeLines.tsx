import React from 'react';
import { interpolate } from 'remotion';
import { PLOT, T, TH, V, series as PALETTE, type } from '../theme';
import { scaleLinear, niceTicks, fmt, ensureContrast, pathAt, easeOut, arcFractions, thinLabels, type Pt } from '../scale';
import type { Anchor, Resolve } from '../accent';
import { PlotFrame } from '../chrome/PlotFrame';
import { AccentLayer, Camera, PortraitLabel, Headshot, revealState, revealExtentAt, useBeat, type Beat, type CameraStop } from '../motion';

export type Serie = {
  id: string; name: string; first: string; last: string; total: number;
  headshot: string; points: { season: string; value: number }[];
};

/**
 * 01 — cumulative multi-line.
 *
 * Two things the first version got wrong, both fixed here:
 *  - the line grew by slicing the point array, so it advanced one whole SEASON
 *    at a time — eight visible jumps, and the portrait teleported between
 *    vertices. `pathAt` interpolates by arc length instead.
 *  - accents carried absolute pixels. They now carry a data Anchor and this
 *    chart resolves it, because this is the only place that knows the scales.
 */
export const CumulativeLines: React.FC<{
  data: {
    seasons: string[]; series: Serie[]; yLabel: string;
    /**
     * A record chase: one absolute mark, drawn as a horizontal reference
     * line. NOT a second series — the point of this prop is that a chase
     * needs the holder's total and nothing else, which is what makes a
     * record whose season-by-season data no source carries (ESPN returns 5
     * of Wilt Chamberlain's 14 seasons and zero rebounds) chartable at all.
     */
    record?: { value: number; label: string };
  };
  beats: Beat[];
}> = ({ data, beats }) => {
  const { activeId, revealed, progress, active, ms } = useBeat(beats);

  // The record is inside the domain, not outside it. That is the whole visual
  // argument: at 23,924 against 12,095 the chaser's line has to be dwarfed,
  // and a y scale fitted to the series alone would draw the same line filling
  // the frame and quietly answer the opposite question.
  const yMax = Math.max(...data.series.map((s) => s.total), data.record?.value ?? 0);
  const ticks = niceTicks(0, yMax, 9);
  const y = scaleLinear([0, ticks.at(-1)!], [PLOT.h, 0]);
  const x = scaleLinear([0, data.seasons.length - 1], [0, PLOT.w]);
  const seasonIndex = new Map(data.seasons.map((s, i) => [s.slice(0, 4), i]));

  const pointsOf = (s: Serie): Pt[] => [
    [x(0), y(0)],
    ...(s.points
      .map((p) => {
        const i = seasonIndex.get(p.season.slice(0, 4));
        return i === undefined ? null : ([x(i + 1), y(p.value)] as Pt);
      })
      .filter(Boolean) as Pt[]),
  ];

  /** Where a season sits along this series' line, 0..1. The index shift is the
   *  origin `pointsOf` prepends: `points[k]` is vertex `k + 1`. */
  const stepFractionOf = (s: Serie) => {
    const fr = arcFractions(pointsOf(s));
    return (step: string | number) => {
      const key = String(step).slice(0, 4);
      const idx = s.points.findIndex((p) => p.season.slice(0, 4) === key);
      return idx >= 0 ? fr[idx + 1] : null;
    };
  };

  /**
   * How much of a series is drawn, from `revealExtentAt` — a pure function of
   * the whole beats array and the clock.
   *
   * It used to be `progress / 0.68` of the CURRENT beat whenever the series was
   * active, which meant a chase (one entity, every beat) redrew its single line
   * from zero nine times. `isActive` is not a parameter any more precisely
   * because whether the line is moving is no longer a property of this frame's
   * beat.
   */
  const drawn = (s: Serie) => pathAt(pointsOf(s), revealExtentAt(beats, s.id, ms, stepFractionOf(s)));

  /**
   * The record line, in frame pixels — or null when there is no record.
   *
   * A pure function of the data and the scale, so it is identical in both
   * resolvers and identical on every frame. The x is the RIGHT-HAND END of
   * the line: `refline` ignores x and spans the plot anyway, and for an
   * `arrow` (which comes in from up-left) the far end is the one place on a
   * full-width line that no series head can be sitting on top of.
   */
  const recordAt = data.record ? { x: PLOT.x + PLOT.w, y: PLOT.y + y(data.record.value) } : null;

  /** Anchor -> pixels at the series' FINAL geometry. Camera stops are computed
   *  once for the whole timeline, so they must not depend on the animating head. */
  const resolveStatic: Resolve = (a: Anchor) => {
    if (a.record) return recordAt;
    const s = data.series.find((v) => v.id === a.entityId);
    if (!s) return null;
    const pts = pointsOf(s);
    const key = a.step === undefined ? null : String(a.step).slice(0, 4);
    const idx = key === null ? -1 : s.points.findIndex((p) => p.season.slice(0, 4) === key);
    const at = idx >= 0 ? pts[idx + 1] : pts[pts.length - 1];
    return at ? { x: PLOT.x + at[0], y: PLOT.y + at[1] } : null;
  };

  /** Data anchor -> frame pixels. The accent layer never computes geometry. */
  const resolve: Resolve = (a: Anchor) => {
    // Checked before the entity, because `record: true` means the line and
    // not a point on anybody's series — `entityId` is only there to say whose
    // chart it is. Null (no record on this chart) rather than a guess.
    if (a.record) return recordAt;
    const s = data.series.find((v) => v.id === a.entityId);
    if (!s) return null;
    const pts = pointsOf(s);
    if (a.step === undefined) {
      const head = drawn(s).head;
      return { x: PLOT.x + head[0], y: PLOT.y + head[1] };
    }
    const key = String(a.step).slice(0, 4);
    const idx = s.points.findIndex((p) => p.season.slice(0, 4) === key);
    const at = idx >= 0 ? pts[idx + 1] : pts[pts.length - 1];
    return at ? { x: PLOT.x + at[0], y: PLOT.y + at[1] } : null;
  };

  // `zoom` accents are the only kind the accent layer does not draw: they move
  // the camera, which only this chart can do because only it has the scales.
  // A zoom is a PUSH AND A RELEASE, not a state. Holding the zoom in meant the
  // first one was the only one anybody felt; releasing before the beat ends
  // makes each push its own visual event.
  const NEUTRAL_FOCUS = { x: V.W / 2, y: V.H / 2, zoom: 1 };
  const zoomStops: CameraStop[] = [];
  for (const b of beats) {
    for (const a of b.accents ?? []) {
      if (a.kind !== 'zoom') continue;
      const p = a.at ? resolveStatic(a.at) : null;
      const at = b.startMs + (b.endMs - b.startMs) * a.t;
      zoomStops.push({
        atMs: at,
        focus: p
          ? {
              x: clampFocus(p.x, V.W * 0.32, V.W * 0.68),
              y: clampFocus(p.y, PLOT.y + PLOT.h * 0.28, PLOT.y + PLOT.h * 0.72),
              zoom: 1.22,
            }
          : NEUTRAL_FOCUS,
      });
      if (p) zoomStops.push({ atMs: Math.min(b.endMs - 120, at + 2200), focus: NEUTRAL_FOCUS });
    }
  }
  zoomStops.sort((a, b) => a.atMs - b.atMs);

  return (
    <>
      <Camera stops={zoomStops} glideMs={620}>
      <PlotFrame
        yTicks={ticks.map((v) => ({ v, pos: y(v) }))}
        xTicks={(() => {
          // Every tick keeps its position; only the TYPE is sampled, because a
          // 23-season chase has 31px between ticks and 24 four-digit years do
          // not fit in 716. An empty label (not undefined) is what suppresses
          // it — PlotFrame falls back to the tick's own index otherwise.
          const keep = thinLabels(data.seasons.length, PLOT.w);
          return data.seasons.map((s, i) => ({ v: i, pos: x(i), label: keep[i] ? s : '' }));
        })()}
        yLabel={data.yLabel}
        format={fmt.int}
      >
        {/* Same treatment as the salary-cap thresholds in StackedColumn: the
            theme's capLine, dashed, full plot width. A record IS a threshold,
            so it uses the identity's existing threshold idiom rather than a
            second one invented here. */}
        {data.record && (
          <line
            x1={0} y1={y(data.record.value)} x2={PLOT.w} y2={y(data.record.value)}
            stroke={T.capLine} strokeWidth={4} strokeDasharray="16 12" opacity={0.85}
          />
        )}
        {data.series.map((s, i) => {
          const st = revealState(s.id, revealed, activeId);
          if (!st.shown) return null;
          const { path } = drawn(s);
          const d = path.map((p) => p.join(',')).join(' ');
          const color = ensureContrast(PALETTE[i % PALETTE.length], TH.ground);
          return (
            <g key={s.id} opacity={fadeIn(st.opacity, ms, beats, s.id, activeId)}>
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

      {data.record && (
        <div
          style={{
            position: 'absolute', right: 30, top: PLOT.y + y(data.record.value) - 26,
            ...type.axisTick, fontWeight: 700, color: T.ink, fontSize: 21,
            whiteSpace: 'nowrap', background: TH.plate, padding: '1px 6px',
          }}
        >
          {data.record.label}
        </div>
      )}

      {data.series.map((s, i) => {
        const st = revealState(s.id, revealed, activeId);
        if (!st.shown) return null;
        const { head } = drawn(s);
        const px = PLOT.x + head[0];
        const py = PLOT.y + head[1];
        const color = ensureContrast(PALETTE[i % PALETTE.length], TH.ground);
        const ring = TH.marker.ringFrom === 'ground' ? TH.ground : color;
        const clampX = (size: number) => Math.min(V.W - size / 2 - 10, px + 30);
        const op = fadeIn(st.opacity, ms, beats, s.id, activeId);

        if (st.active && progress > 0.7) {
          return <Headshot key={s.id} src={s.headshot} x={clampX(92)} y={py} size={92} ring={ring} />;
        }
        if (st.active) {
          return (
            <PortraitLabel
              key={s.id}
              src={s.headshot} first={s.first} last={s.last} color={color}
              x={Math.max(PLOT.x + 24, Math.min(px - 300, 600))}
              y={Math.max(PLOT.y + 16, Math.min(py - 340, PLOT.y + PLOT.h - 430))}
              opacity={easeOut(Math.min(1, progress / 0.12))}
            />
          );
        }
        return <Headshot key={s.id} src={s.headshot} x={clampX(72)} y={py} size={72} ring={ring} opacity={op} />;
      })}

      </Camera>
      <AccentLayer accents={active?.accents} progress={progress} resolve={resolve} />
    </>
  );
};

const clampFocus = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Ease a series between full and faded instead of snapping.
 *
 * A hard opacity switch at a beat boundary is a visible flicker; over ten
 * beats it reads as the whole chart twitching.
 */
function fadeIn(target: number, ms: number, beats: Beat[], id: string, activeId?: string): number {
  const mine = beats.find((b) => b.entityId === id);
  if (!mine) return target;
  const appear = interpolate(ms, [mine.startMs, mine.startMs + 220], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  if (id === activeId) return easeOut(appear);
  // leaving the spotlight: settle to the faded value over the same window
  const left = beats.find((b) => b.startMs > mine.startMs && b.entityId === activeId);
  if (!left) return target;
  const settle = interpolate(ms, [left.startMs, left.startMs + 260], [1, target], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return easeOut(appear) * (settle / Math.max(target, 0.001)) * target;
}
