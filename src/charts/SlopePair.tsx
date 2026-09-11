import React from 'react';
import { interpolate } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { fitRows, rankPair, fmt } from '../scale';
import type { Anchor, Resolve } from '../accent';
import { AccentLayer, Camera, PortraitLabel, Scroll, scrollOffsetAt, useBeat, useMs, type Beat, type CameraStop, type ScrollStop } from '../motion';

export type RedraftRow = {
  id: string; name: string; last: string; actualPick: number;
  headshot: string; value: number | null; resolvedId: string | null; seasons: number;
  source: 'espn' | 'hoopr' | 'unresolved';
};

const COL_W = 300;

/**
 * 09 — slope-pair (re-draft). Two orderings of the same 30 picks, joined by a
 * connector whose direction and colour ARE the story: who a re-draft moved up,
 * who it dropped, and who never produced NBA data at all.
 *
 * The left column is fixed (actual draft order); the right column is ranked
 * by value at render time via `rankPair`, so a null value never claims a
 * player scored zero — it drops out of ranking and lands in a muted footer.
 */
export const SlopePair: React.FC<{
  data: { title: string; sub: string; rows: RedraftRow[]; unresolved: number };
  beats: Beat[];
}> = ({ data, beats }) => {
  const { activeId, revealed, progress, active, beatMs } = useBeat(beats);
  const ms = useMs();

  const moves = rankPair(data.rows, (r) => r.id, (r) => r.actualPick, (r) => r.value);
  const moveById = new Map(moves.map((m) => [m.id, m]));

  const leftOrder = data.rows; // already sorted by actualPick ascending
  const resolvedRight = data.rows
    .filter((r) => moveById.get(r.id)!.to !== null)
    .sort((a, b) => moveById.get(a.id)!.to! - moveById.get(b.id)!.to!);
  const unresolvedRight = data.rows.filter((r) => moveById.get(r.id)!.to === null);
  const rightOrder = [...resolvedRight, ...unresolvedRight];

  const leftIndex = new Map(leftOrder.map((r, i) => [r.id, i]));
  const rightIndex = new Map(rightOrder.map((r, i) => [r.id, i]));

  const fit = fitRows(data.rows.length, PLOT.h);
  const rowH = fit.rowH;
  const contentHeight = data.rows.length * rowH;
  const scrolling = fit.mode === 'scroll';

  const leftX = PLOT.x;
  const rightX = PLOT.x + PLOT.w - COL_W;
  const gutterX = leftX + COL_W;
  const gutterW = rightX - gutterX;

  // Scroll centres the RIGHT column, because that is where the payoff sits —
  // same reason Resolve() below anchors every accent to the right column.
  const scrollStops: ScrollStop[] = beats.map((b) => ({
    atMs: b.startMs,
    offset: (rightIndex.get(b.entityId) ?? 0) * rowH,
  }));

  /** Pixel position of an entity's right-column row at a given moment, via
   *  the SAME `scrollOffsetAt` that `<Scroll>` itself draws with — one
   *  formula, so a chart's annotations can never drift from what is on
   *  screen. `ms` is a parameter rather than always "now" so the zoom-stop
   *  precompute below can ask "where does this row settle for beat b",
   *  independent of the live animating frame. */
  const pixelAt = (entityId: string, atMs: number): { x: number; y: number } | null => {
    const idx = rightIndex.get(entityId);
    if (idx === undefined) return null;
    const offset = scrolling ? scrollOffsetAt(scrollStops, atMs, contentHeight, PLOT.h) : 0;
    return { x: rightX + COL_W / 2, y: PLOT.y + idx * rowH + rowH / 2 - offset };
  };

  /** Anchor -> the CENTRE of its right-column row: that is where the payoff is. */
  const resolve: Resolve = (a: Anchor) => pixelAt(a.entityId, ms);

  const NEUTRAL_FOCUS = { x: V.W / 2, y: V.H / 2, zoom: 1 };
  const clampFocus = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const zoomStops: CameraStop[] = [];
  for (const b of beats) {
    for (const a of b.accents ?? []) {
      if (a.kind !== 'zoom') continue;
      // Settled position for this beat: scroll has had its full 700ms glide
      // to arrive, so this is the row's resting spot, not a mid-glide one.
      const p = a.at ? pixelAt(a.at.entityId, b.startMs + 700) : null;
      const at = b.startMs + (b.endMs - b.startMs) * a.t;
      zoomStops.push({
        atMs: at,
        focus: p
          ? { x: clampFocus(p.x, V.W * 0.32, V.W * 0.68), y: clampFocus(p.y, PLOT.y + PLOT.h * 0.28, PLOT.y + PLOT.h * 0.72), zoom: 1.22 }
          : NEUTRAL_FOCUS,
      });
      if (p) zoomStops.push({ atMs: Math.min(b.endMs - 120, at + 2200), focus: NEUTRAL_FOCUS });
    }
  }
  zoomStops.sort((a, b) => a.atMs - b.atMs);

  const connectorColor = (id: string) => {
    const mv = moveById.get(id)!;
    if (mv.delta === null) return TH.hairline;
    if (mv.delta > 0) return T.good;
    if (mv.delta < 0) return T.bad;
    return T.ink3;
  };

  /**
   * The board IS the context: a re-draft's whole claim ("moved up 26 places")
   * is only legible against all 30 rows at once, so nothing here is ever
   * hidden — unlike CumulativeLines, where a hidden-until-narrated line is
   * the right call because each one adds a new competitor to a race. Same
   * fix already applied to StackedColumn for the same reason. Three states
   * instead of revealState's two: unnarrated rows still sit at the theme's
   * base fade so the fan of 30 connectors reads as a fan, not a blank board.
   */
  const emphasisOf = (id: string) => {
    if (id === activeId) return { opacity: 1, strokeWidth: 6 };
    if (revealed.has(id)) return { opacity: 0.75, strokeWidth: 3 };
    return { opacity: TH.line.fade, strokeWidth: 2 };
  };

  const canvas = (
    <div style={{ position: 'absolute', left: 0, top: 0, width: V.W, height: contentHeight }}>
      <svg width={V.W} height={contentHeight} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}>
        {data.rows.map((r) => {
          const em = emphasisOf(r.id);
          const li = leftIndex.get(r.id)!;
          const ri = rightIndex.get(r.id)!;
          const x1 = gutterX, y1 = li * rowH + rowH / 2;
          const x2 = rightX, y2 = ri * rowH + rowH / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={r.id}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={connectorColor(r.id)}
              strokeWidth={em.strokeWidth}
              opacity={em.opacity}
            />
          );
        })}
      </svg>

      {leftOrder.map((r, i) => {
        const em = emphasisOf(r.id);
        const isActive = r.id === activeId;
        return (
          <div
            key={`L${r.id}`}
            style={{
              position: 'absolute', left: leftX, top: i * rowH, width: COL_W, height: rowH,
              display: 'flex', alignItems: 'center', gap: 10, opacity: em.opacity,
            }}
          >
            <span style={{ ...type.rowValue, color: T.ink3, fontSize: Math.min(22, rowH * 0.46), width: 44 }}>
              {`#${r.actualPick}`}
            </span>
            <span
              style={{
                ...type.rowName, fontSize: Math.min(25, rowH * 0.52), whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
                background: isActive ? T.highlight : undefined,
                color: isActive ? TH.onHighlight : T.ink,
                padding: isActive ? '2px 8px' : undefined, fontWeight: isActive ? 700 : 500,
              }}
            >
              {r.last}
            </span>
            {r.value !== null && (
              <span style={{ ...type.rowValue, color: T.ink2, fontSize: Math.min(20, rowH * 0.4), marginLeft: 'auto' }}>
                {fmt.int(r.value)}
                {/* A number from a different source with a different cutoff
                    (hoopR stops at 2023) must be visibly marked — never let
                    a mixed-source total pass as one uniform figure. */}
                {r.source === 'hoopr' && (
                  <span style={{ color: TH.ink3, fontFamily: 'ui-monospace, monospace', marginLeft: 2 }}>†</span>
                )}
              </span>
            )}
          </div>
        );
      })}

      {rightOrder.map((r, j) => {
        const em = emphasisOf(r.id);
        const isActive = r.id === activeId;
        const mv = moveById.get(r.id)!;
        const unresolved = mv.to === null;
        return (
          <div
            key={`R${r.id}`}
            style={{
              position: 'absolute', left: rightX, top: j * rowH, width: COL_W, height: rowH,
              display: 'flex', alignItems: 'center', gap: 10,
              opacity: unresolved && !isActive ? Math.min(em.opacity, 0.62) : em.opacity,
            }}
          >
            <span style={{ ...type.rowValue, color: unresolved ? TH.hairline : T.ink3, fontSize: Math.min(22, rowH * 0.46), width: 44 }}>
              {unresolved ? '—' : `#${mv.to}`}
            </span>
            <span
              style={{
                ...type.rowName, fontSize: Math.min(25, rowH * 0.52), whiteSpace: 'nowrap',
                color: unresolved ? T.ink3 : isActive ? TH.onHighlight : T.ink,
                background: isActive ? T.highlight : undefined,
                padding: isActive ? '2px 8px' : undefined, fontWeight: isActive ? 700 : 500,
                fontStyle: unresolved ? 'italic' : 'normal',
              }}
            >
              {unresolved ? `${r.last} · no NBA data` : r.last}
            </span>
          </div>
        );
      })}

      {/* the active mover: a portrait in the gutter, plus a rank-change badge
          right where its right-column row sits */}
      {(() => {
        const r = data.rows.find((x) => x.id === activeId);
        if (!r) return null;
        const ri = rightIndex.get(r.id)!;
        const cy = ri * rowH + rowH / 2;
        const mv = moveById.get(r.id)!;
        const badge = mv.delta === null ? '—' : mv.delta > 0 ? `▲${mv.delta}` : mv.delta < 0 ? `▼${-mv.delta}` : '–';
        const badgeColor = mv.delta === null ? T.ink3 : mv.delta > 0 ? T.good : mv.delta < 0 ? T.bad : T.ink3;
        const portraitW = Math.min(110, Math.max(80, gutterW - 10));
        // The portrait (image + two-line name, ~portraitW*0.75 + 96px tall) must
        // clear the row above it, not sit centred on it — centring was landing
        // the giant name text directly on top of the row's own label and badge.
        const assemblyH = portraitW * 0.75 + 96;
        const portraitY = Math.max(0, cy - rowH / 2 - 24 - assemblyH);
        return (
          <React.Fragment key={`active-${r.id}`}>
            <PortraitLabel
              src={r.headshot} first={r.name.split(' ')[0]} last={r.last}
              color={badgeColor} x={gutterX + (gutterW - portraitW) / 2} y={portraitY}
              width={portraitW} opacity={interpolate(progress, [0, 0.15], [0, 1], { extrapolateRight: 'clamp' })}
            />
            <div
              style={{
                position: 'absolute', left: rightX - 78, top: cy - 20, width: 70, textAlign: 'right',
                ...type.marker, fontSize: 30, color: badgeColor,
                opacity: interpolate(progress, [0.1, 0.3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              }}
            >
              {badge}
            </div>
          </React.Fragment>
        );
      })()}
    </div>
  );

  const usesHoopr = data.rows.some((r) => r.source === 'hoopr');

  return (
    <>
      <Camera stops={zoomStops} glideMs={620}>
        <div style={{ position: 'absolute', left: 0, top: PLOT.y, width: V.W, height: PLOT.h, overflow: scrolling ? 'hidden' : 'visible' }}>
          {scrolling ? (
            <Scroll stops={scrollStops} contentHeight={contentHeight} viewport={PLOT.h}>{canvas}</Scroll>
          ) : canvas}
        </div>
      </Camera>
      <AccentLayer accents={active?.accents} progress={progress} beatMs={beatMs} resolve={resolve} />
      {/* Only shown when a row actually carries a hoopR-sourced number — an
          unmarked mixed-source total is the kind of quiet error that ends up
          in a video, so the footnote earns its place only when it applies. */}
      {usesHoopr && (
        <div style={{ position: 'absolute', left: PLOT.x, top: PLOT.y + PLOT.h + 16, ...type.axisTick, color: TH.ink3 }}>
          † career points through 2023 (hoopR)
        </div>
      )}
    </>
  );
};
