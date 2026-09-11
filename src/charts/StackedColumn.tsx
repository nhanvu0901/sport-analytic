import React from 'react';
import { Img } from 'remotion';
import { PLOT, T, TH, series as PALETTE, type } from '../theme';
import { scaleLinear, niceTicks, fmt, ensureContrast } from '../scale';
import { accentProgress, type Anchor, type Resolve } from '../accent';
import { PlotFrame } from '../chrome/PlotFrame';
import { AccentLayer, SpanBracket, useBeat, type Beat } from '../motion';
import { PAYROLL_KEY, THRESHOLD_LINES, type CapRow, type Thresholds } from '../videoData';

// Re-exported so the existing `salaryCap.json` call site and any chart reader
// can keep importing them from here; they LIVE in videoData.ts because the
// brief has to publish the same key list and a list written twice drifts.
export type { CapRow, Thresholds };

/**
 * 02 — one budget decomposed into people, judged against fixed thresholds.
 * The channel's most repeated format: ~40 videos, 126K–648K views each.
 *
 * DRAWN WHOLE, never revealed one segment at a time, and that is the rule in
 * TODO.md rather than a preference: reveal entities one at a time only when
 * each new one ADDS information; draw the whole thing and let the beat drive
 * emphasis when the information lives in the RELATIONS between them. A payroll
 * column is the second case twice over. A segment means nothing on its own —
 * 19,500,000 is only a story as a tenth of the column — and the height of the
 * whole against five fixed lines is the entire argument, so a column that
 * grows a contract at a time is a column whose thesis does not exist until the
 * last beat. (This is also the mistake this chart made once already, by
 * copying `CumulativeLines`; `SlopePair` then made it again.) So every segment
 * and every line is on screen from frame 0, and the only thing a beat changes
 * is which segment is at full opacity — plus the accents, which is where the
 * visual events come from on a chart that has nothing to draw in.
 */
export const StackedColumn: React.FC<{
  data: { rows: CapRow[]; thresholds: Thresholds };
  beats: Beat[];
}> = ({ data, beats }) => {
  const { rows, thresholds } = data;
  const { activeId, progress, active, beatMs } = useBeat(beats);

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

  const lines = THRESHOLD_LINES.map((l) => ({ ...l, value: thresholds[l.key] }));

  /**
   * The VALUE an anchor stands on, in data space — the two cases this chart
   * has, and the pair `resolve` below mirrors in pixels.
   *
   * `PAYROLL_KEY` is the stack's own top, which is `total`: computed here from
   * the same segments that are drawn, so the number a `span` labels itself with
   * cannot be a number anybody typed. That is the whole point of the kind, and
   * it is why the payroll shares the threshold namespace with the CBA levels
   * rather than getting a field of its own — on this chart they are the same
   * sort of thing, a height on the one y axis that belongs to no segment.
   */
  const levelOf = (key: string): number | null =>
    key === PAYROLL_KEY ? total : lines.find((l) => l.key === key)?.value ?? null;

  const valueOf = (a: Anchor): number | null =>
    a.threshold !== undefined
      ? levelOf(a.threshold)
      : segs.find((s) => s.r.id === a.entityId)?.r.value ?? null;

  /**
   * Where a threshold ANCHOR sits horizontally.
   *
   * Inside the plot but clear of the column, whose right edge is at
   * `colX + colW` (0.72 of the plot). `CumulativeLines` puts the record anchor
   * at the plot's far right because no line head can be there; here the far
   * right is where the lines' own labels are, and 40px inside it is the widest
   * gap on the chart — which is what a `span` needs, because `SpanBracket`
   * sets its stem 56px left of the rightmost anchor and hangs 26px arms off
   * it. At 0.72 the arms would cross the column they are measuring.
   */
  const LEVEL_X = PLOT.x + PLOT.w - 40;

  /**
   * Data anchor -> frame pixels. Two cases, and no third:
   *
   *  - `threshold` is one of the five drawn levels or the stack's own top.
   *  - otherwise the anchor names a SEGMENT, and resolves to the middle of it
   *    — where the portrait and the figure already are, so a `spotlight`
   *    lassoes the thing the sentence is about.
   *
   * `a.step` is IGNORED, deliberately, and it is the one anchor field this
   * chart has no meaning for: its x axis is people, not time, and the column
   * is one instant. Ignoring rather than failing is safe here precisely
   * because there IS only one instant — the brief's `anchor_steps` carries the
   * single season the payroll is a payroll OF, so `{ entityId, step:
   * "2025-26" }` and `{ entityId }` name the same segment and the writer
   * cannot be wrong by writing either. (Rejecting it instead would also cost
   * the script the ability to SAY "2025-26", since `verifyDraft` checks spoken
   * season labels against that same list.) A step that is not that season is
   * rejected by `verifyDraft` before it reaches here.
   */
  const resolve: Resolve = (a: Anchor) => {
    if (a.threshold !== undefined) {
      const v = levelOf(a.threshold);
      return v === null ? null : { x: LEVEL_X, y: PLOT.y + y(v) };
    }
    const s = segs.find((g) => g.r.id === a.entityId);
    return s ? { x: PLOT.x + colX + colW / 2, y: PLOT.y + (y(s.y0) + y(s.y1)) / 2 } : null;
  };

  return (
    <>
      <PlotFrame yTicks={ticks.map((v) => ({ v, pos: y(v) }))} format={fmt.moneyShort}>
        {lines.map((l) => (
          <line
            key={l.key}
            x1={0} y1={y(l.value)} x2={PLOT.w} y2={y(l.value)}
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

      {lines.map((l) => (
        <div
          key={l.key}
          style={{
            position: 'absolute', right: 30, top: PLOT.y + y(l.value) - 26,
            ...type.axisTick, fontWeight: 700, color: T.ink, fontSize: 21,
            whiteSpace: 'nowrap', background: TH.plate, padding: '1px 6px',
          }}
        >
          {l.label}
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

      {/* Wired exactly as `CumulativeLines` wires it, `beatMs` included: the
          landing span is wall-clock (ACCENT_LAND_MS) and only the beat's own
          duration converts it into the fraction `t` lives in. There is no
          `Camera` here — the router answers `static` for this chart, because a
          push-in on one segment hides the threshold lines and the lines are the
          argument — so `zoom` is not offered to the writer at all rather than
          accepted and silently dropped (see `accent_kinds` in src/brief.ts).
          Every transform below is a pure function of the clock. */}
      <AccentLayer accents={active?.accents} progress={progress} beatMs={beatMs} resolve={resolve} />

      {/* `span` is the one kind the accent layer cannot draw: it measures
          BETWEEN two anchors, so it needs both resolved AND the values they
          stand on, and only this component has either. On this chart it is the
          most important kind there is — "over the cap and still under the tax
          by 5,279,102" is a distance between two heights, neither of which is
          a player. */}
      {(active?.accents ?? []).map((a, i) => {
        if (a.kind !== 'span' || !a.at || !a.to) return null;
        const p = accentProgress(a, progress, beatMs);
        if (p <= 0) return null;
        const pa = resolve(a.at);
        const pb = resolve(a.to);
        const va = valueOf(a.at);
        const vb = valueOf(a.to);
        // An unresolvable anchor draws nothing rather than a bracket of
        // unknown length — `verifyDraft` rejects the draft that would.
        if (!pa || !pb || va === null || vb === null) return null;
        // `SpanBracket` hangs its label 58px BEYOND the travelling end, so the
        // end that travels has to be the LOWER of the two or the number lands
        // inside the column it is measuring — measured on this chart: a
        // payroll-to-tax span written the other way round puts $5,279,102
        // across the top contract's portrait. Ordering the two anchors by
        // height here, instead of trusting the order the writer happened to
        // write them in, puts it in the empty plot above the stack every time.
        // The label is |va - vb| either way, so nothing about the measurement
        // depends on this.
        const [from, to] = pa.y <= pb.y ? [pa, pb] : [pb, pa];
        return (
          <SpanBracket key={`span-${i}`} from={from} to={to} p={p} label={fmt.money(Math.abs(va - vb))} />
        );
      })}
    </>
  );
};
