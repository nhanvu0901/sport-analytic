import React from 'react';
import { Img } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { scaleLinear, fitRows, ensureContrast } from '../scale';
import { Scroll, revealState, useBeat, type Beat, type ScrollStop } from '../motion';

export type Row = { id: string; name: string; last: string; value: number; abbr?: string; headshot?: string };

/**
 * 03 — ranked horizontal bar. Also the base for 04 (diverging) and
 * 05 (proportion): same row engine, different bar geometry.
 */
export const RankedBar: React.FC<{
  rows: Row[];
  beats: Beat[];
  format: (v: number) => string;
  variant?: 'ranked' | 'diverging' | 'proportion';
  color?: (r: Row, i: number) => string;
  logoOf?: (r: Row) => string | undefined;
  note?: (r: Row) => string | undefined;
}> = ({ rows, beats, format, variant = 'ranked', color, logoOf, note }) => {
  const { activeId, revealed, progress } = useBeat(beats);
  const fit = fitRows(rows.length, PLOT.h);
  const labelW = 300;
  const barX = PLOT.x + labelW;
  const barW = PLOT.w - labelW - 130;

  const values = rows.map((r) => r.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const zeroFrac = variant === 'diverging' ? (0 - lo) / (hi - lo) : 0;
  const x =
    variant === 'proportion'
      ? scaleLinear([0, 1], [0, barW])
      : scaleLinear([lo, hi], [0, barW]);

  const stops: ScrollStop[] = beats.map((b) => ({
    atMs: b.startMs,
    offset: rows.findIndex((r) => r.id === b.entityId) * fit.rowH,
  }));

  const body = (
    <div style={{ position: 'absolute', left: 0, top: 0, width: V.W }}>
      {rows.map((r, i) => {
        const top = i * fit.rowH;
        const isActive = r.id === activeId;
        const dim = revealed.size > 0 && !isActive ? 0.55 : 1;
        // team colours are drawn for white paper; lift them off this ground
        const c = ensureContrast(color ? color(r, i) : T.ink, TH.ground);
        const grow = isActive ? Math.min(1, progress / 0.35) : 1;

        let left = 0, width = 0;
        if (variant === 'diverging') {
          const zx = zeroFrac * barW;
          const vx = x(r.value);
          left = Math.min(zx, vx);
          width = Math.abs(vx - zx) * grow;
        } else {
          width = x(r.value) * grow;
        }

        return (
          <div key={r.id} style={{ position: 'absolute', top, left: 0, height: fit.rowH, width: V.W, opacity: dim }}>
            <div
              style={{
                position: 'absolute', left: PLOT.x, width: labelW - 16, top: fit.rowH / 2 - 17,
                textAlign: 'right', ...type.rowName, fontSize: Math.min(26, fit.rowH * 0.58),
                whiteSpace: 'nowrap', overflow: 'hidden',
              }}
            >
              <span
                style={
                  isActive
                    ? { background: T.highlight, color: TH.onHighlight, padding: '2px 9px 4px', fontWeight: 700, boxDecorationBreak: 'clone' }
                    : undefined
                }
              >
                {r.name}
              </span>
            </div>
            {variant === 'proportion' && (
              <div style={{ position: 'absolute', left: barX, top: fit.rowH * 0.18, width: barW, height: fit.rowH * 0.64, background: T.track, border: `1px solid ${TH.hairline}` }} />
            )}
            <div
              style={{
                position: 'absolute', left: barX + left, top: fit.rowH * 0.18,
                width, height: fit.rowH * 0.64, background: c,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: variant === 'proportion' ? barX + barW + 14 : barX + left + width + 12,
                top: fit.rowH / 2 - 16,
                ...type.rowValue, color: T.ink, fontSize: Math.min(24, Math.max(18, fit.rowH * 0.52)),
                whiteSpace: 'nowrap',
              }}
            >
              {format(r.value)}
              {note?.(r) ? <span style={{ color: T.ink3, fontWeight: 400 }}>{'  ' + note(r)}</span> : null}
            </div>
            {logoOf?.(r) && (
              <div
                style={{
                  position: 'absolute', left: PLOT.x - 54, top: fit.rowH / 2 - 22,
                  width: 44, height: 44, borderRadius: 22,
                  // NBA marks are authored for white; a light plate keeps the
                  // white-heavy ones (Nets, Spurs) from vanishing on dark
                  background: TH.logoPlate ?? undefined,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                <Img src={logoOf(r)!} style={{ width: 36, height: 36, objectFit: 'contain' }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ position: 'absolute', left: 0, top: PLOT.y, width: V.W, height: PLOT.h }}>
      {fit.mode === 'scroll' ? (
        <Scroll stops={stops} contentHeight={rows.length * fit.rowH} viewport={PLOT.h}>
          {body}
        </Scroll>
      ) : (
        body
      )}
      {variant === 'diverging' && (
        <div style={{ position: 'absolute', left: barX + zeroFrac * barW, top: 0, width: 3, height: PLOT.h, background: T.axis }} />
      )}
    </div>
  );
};
