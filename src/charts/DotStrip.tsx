import React from 'react';
import { PLOT, T, TH, V, type } from '../theme';
import { scaleLinear, niceTicks, binGrid, countRadius, fmt } from '../scale';
import { PlotFrame } from '../chrome/PlotFrame';
import { AccentLayer, useBeat, type Beat } from '../motion';
import type { Anchor, Resolve } from '../accent';

export type Dot = { id: string; name: string; last: string; x: number; y: number; pos?: string };

/** Guard / Forward / Center. The hues come from the theme so they read against
 *  whichever ground is active — the same navy that works on light disappears
 *  on near-black. */
const POS_COLOR = TH.category as Record<string, string>;
const posOf = (d: Dot) => (d.pos ?? '').toUpperCase().slice(0, 1);

const WEIGHT_BIN = 5;   // lbs per cell — one dot per 5 lb x 1 inch square

/**
 * 08 — dot density.
 *
 * Both axes are discrete (whole inches, whole pounds), so 376 of the 550
 * players share a coordinate with somebody. Plain dots hide two thirds of the
 * league, and a beeswarm cannot rescue it either: 21 height rows over 964px
 * leaves 46px a row, while the densest window at 6'5" holds twenty players and
 * would need 260px of stacking. So bin instead, and let the AREA of each dot
 * carry the count — every player is represented and the pile-ups become the
 * shape of the chart.
 */
export const DotStrip: React.FC<{
  data: { rows: Dot[]; xLabel: string; yLabel: string };
  beats: Beat[];
  labelIds?: string[];
}> = ({ data, beats, labelIds = [] }) => {
  const { activeId, progress, active } = useBeat(beats);

  const xs = data.rows.map((r) => r.x);
  const xt = niceTicks(Math.min(...xs), Math.max(...xs), 6);
  const heights = [...new Set(data.rows.map((r) => r.y))].sort((a, b) => a - b);
  const x = scaleLinear([xt[0], xt.at(-1)!], [0, PLOT.w]);

  const rowH = PLOT.h / heights.length;
  const rowY = (h: number) => PLOT.h - (heights.indexOf(h) + 0.5) * rowH;

  const cells = binGrid(data.rows, (d) => d.x, (d) => d.y, { xStep: WEIGHT_BIN, yStep: 1 });
  const maxCount = Math.max(...cells.map((c) => c.count));
  const rMax = Math.min(rowH / 2 - 1, (x(WEIGHT_BIN) - x(0)) * 0.9);

  const dominant = (items: Dot[]) => {
    const tally: Record<string, number> = {};
    for (const it of items) tally[posOf(it)] = (tally[posOf(it)] ?? 0) + 1;
    return Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  };
  const cellOf = new Map<string, { cx: number; cy: number }>();
  for (const c of cells) for (const it of c.items) cellOf.set(it.id, { cx: c.cx, cy: c.cy });

  const resolve: Resolve = (a: Anchor) => {
    const c = cellOf.get(a.entityId);
    return c ? { x: PLOT.x + x(c.cx), y: PLOT.y + rowY(c.cy) } : null;
  };

  const show = new Set([...labelIds, activeId].filter(Boolean) as string[]);

  return (
    <>
      <PlotFrame
        yTicks={heights.map((h) => ({ v: h, pos: rowY(h) }))}
        xTicks={xt.map((v) => ({ v, pos: x(v) }))}
        yLabel={data.yLabel}
        xLabel={data.xLabel}
        format={fmt.height}
      >
        {heights.map((h, i) =>
          i % 2 === 0 ? (
            <rect key={`b${h}`} x={0} y={rowY(h) - rowH / 2} width={PLOT.w} height={rowH} fill={TH.name === "court" ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.045)"} />
          ) : null
        )}
        {cells.map((c) => {
          const holdsActive = activeId !== undefined && c.items.some((i) => i.id === activeId);
          const r = countRadius(c.count, maxCount, 4.5, rMax);
          return (
            <circle
              key={`${c.cx}|${c.cy}`}
              cx={x(c.cx)} cy={rowY(c.cy)} r={holdsActive ? r + 5 : r}
              fill={POS_COLOR[dominant(c.items)] ?? TH.category.none}
              opacity={holdsActive ? 1 : 0.8}
              // red would read as "Center", so the narrated cell gets a ring, not a recolour
              stroke={holdsActive ? T.ink : TH.hairline}
              strokeWidth={holdsActive ? 5 : 1.2}
            />
          );
        })}
      </PlotFrame>

      {(() => {
        // Two outliers can share a height band (Zikarsky and Edey both at 7'3"),
        // which printed one label over the other. Nudge each down until it clears.
        const taken: { x: number; y: number }[] = [];
        return data.rows
          .filter((r) => show.has(r.id))
          .map((r) => ({ r, c: cellOf.get(r.id) }))
          .filter((e): e is { r: Dot; c: { cx: number; cy: number } } => Boolean(e.c))
          .sort((a, b) => rowY(b.c.cy) - rowY(a.c.cy))
          .map(({ r, c }) => {
            const isActive = r.id === activeId;
            const cx = PLOT.x + x(c.cx);
            let cy = PLOT.y + rowY(c.cy);
            while (taken.some((t) => Math.abs(t.y - cy) < 34 && Math.abs(t.x - cx) < 300)) cy += 34;
            taken.push({ x: cx, y: cy });
            const right = cx < PLOT.x + PLOT.w * 0.68;
            return (
              <div
                key={r.id}
                style={{
                  position: 'absolute',
                  left: right ? cx + rMax + 10 : undefined,
                  right: right ? undefined : V.W - cx + rMax + 10,
                  top: cy - 17,
                  ...type.rowName,
                  fontSize: isActive ? 30 : 23, fontWeight: 700,
                  color: isActive ? T.bad : T.ink,
                  whiteSpace: 'nowrap', background: TH.plate, padding: '1px 7px',
                }}
              >
                {isActive ? r.name : r.last}
              </div>
            );
          });
      })()}

      <Key maxCount={maxCount} rMax={rMax} />
      <AccentLayer accents={active?.accents} progress={progress} resolve={resolve} />
    </>
  );
};

/** Legend: what a colour means, and what a big dot means. */
const Key: React.FC<{ maxCount: number; rMax: number }> = ({ maxCount, rMax }) => (
  <div
    style={{
      position: 'absolute', left: PLOT.x, top: PLOT.y + PLOT.h + 108,
      display: 'flex', gap: 20, alignItems: 'center',
      padding: '2px 0',
    }}
  >
    {([['G', 'Guards'], ['F', 'Forwards'], ['C', 'Centers']] as const).map(([k, label]) => (
      <span key={k} style={{ display: 'flex', gap: 7, alignItems: 'center', ...type.axisTick, fontSize: 20, fontWeight: 700, color: T.ink }}>
        <span style={{ width: 15, height: 15, borderRadius: 8, background: POS_COLOR[k], display: 'inline-block' }} />
        {label}
      </span>
    ))}
    <span style={{ display: 'flex', gap: 7, alignItems: 'center', ...type.axisTick, fontSize: 20, color: T.ink2, marginLeft: 4 }}>
      <span style={{ width: 11, height: 11, borderRadius: 6, background: T.ink3, display: 'inline-block' }} />
      <span style={{ width: rMax * 1.5, height: rMax * 1.5, borderRadius: rMax, background: T.ink3, display: 'inline-block' }} />
      = 1 … {maxCount}
    </span>
  </div>
);
