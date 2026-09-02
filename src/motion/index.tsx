import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing, Img } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { fmt, easeOut } from '../scale';
import { type Accent, type Resolve, accentProgress } from '../accent';

export type { Accent, Resolve } from '../accent';

/**
 * A beat is one narrated sentence bound to one entity, carrying the visual
 * accents that fire while it is spoken. Audio drives all of it.
 *
 * `accents` is what lifts the video off the 0.135 events/sec it used to sit at:
 * one beat used to mean one visual event, and the competitor audit puts the
 * winning band at 0.24–0.38.
 */
export type Beat = {
  entityId: string;
  startMs: number;
  endMs: number;
  accents?: Accent[];
};

export const useMs = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (frame / fps) * 1000;
};

/** Index of the beat currently being spoken, or the last one that was. */
export function useBeat(beats: Beat[]) {
  const ms = useMs();
  let idx = -1;
  for (let i = 0; i < beats.length; i++) if (ms >= beats[i].startMs) idx = i;
  const active = idx >= 0 ? beats[idx] : undefined;
  const revealed = new Set(beats.slice(0, idx + 1).map((b) => b.entityId));
  const progress = active
    ? interpolate(ms, [active.startMs, active.endMs], [0, 1], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })
    : 0;
  return { ms, idx, active, activeId: active?.entityId, revealed, progress };
}

/* ------------------------------------------------------------------- 1 camera
   Draw the chart at true size, then move the viewport to whatever is being
   narrated. This is how 1,620 cells or 450 rows fit a vertical frame.
   Like Scroll, the transform is a pure function of time. */
export type Focus = { x: number; y: number; zoom: number };
export type CameraStop = { atMs: number; focus: Focus };

const NEUTRAL: Focus = { x: V.W / 2, y: V.H / 2, zoom: 1 };

export const Camera: React.FC<{
  stops?: CameraStop[];
  glideMs?: number;
  children: React.ReactNode;
}> = ({ stops = [], glideMs = 800, children }) => {
  const ms = useMs();

  // Start NEUTRAL, not at stops[0]. Seeding from the first stop meant the
  // camera was already zoomed at frame 0 and then never appeared to move —
  // the transform was applied and completely invisible.
  let f: Focus = NEUTRAL;
  for (let i = 0; i < stops.length; i++) {
    if (ms < stops[i].atMs) break;
    const from = i === 0 ? NEUTRAL : stops[i - 1].focus;
    const to = stops[i].focus;
    const mix = (a: number, b: number) =>
      interpolate(ms, [stops[i].atMs, stops[i].atMs + glideMs], [a, b], {
        extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
      });
    f = { x: mix(from.x, to.x), y: mix(from.y, to.y), zoom: mix(from.zoom, to.zoom) };
  }

  return (
    <div
      style={{
        position: 'absolute', inset: 0,
        transform: `scale(${f.zoom})`,
        transformOrigin: `${f.x}px ${f.y}px`,
      }}
    >
      {children}
    </div>
  );
};

/* ------------------------------------------------------------------- 2 scroll
   A list longer than the frame settles on the row being spoken about, then
   glides to the next one. Every frame renders independently in Remotion, so
   the offset has to be a pure function of time — no component state. */
export type ScrollStop = { atMs: number; offset: number };

/**
 * The scroll offset at a given moment — pure, and the ONLY place this maths
 * lives. `Scroll` calls it to draw; a chart's `Resolve` calls the exact same
 * function to know where a scrolled row actually is on screen. Two copies of
 * this formula (one in `Scroll`, one hand-mirrored in a chart) drift the
 * moment either one changes, which defeats the entire point of pulling time
 * out of the charts and into this module.
 */
export function scrollOffsetAt(
  stops: ScrollStop[],
  ms: number,
  contentHeight: number,
  viewport: number,
  glideMs = 700
): number {
  const max = Math.max(0, contentHeight - viewport);
  const clamp = (o: number) => Math.max(0, Math.min(max, o - viewport * 0.42));

  // Same bug as Camera had: seeding from stops[0] starts the list already
  // scrolled, so the first glide is invisible.
  let y = 0;
  for (let i = 0; i < stops.length; i++) {
    if (ms < stops[i].atMs) break;
    const from = i === 0 ? 0 : clamp(stops[i - 1].offset);
    const to = clamp(stops[i].offset);
    y = interpolate(ms, [stops[i].atMs, stops[i].atMs + glideMs], [from, to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
  }
  return y;
}

export const Scroll: React.FC<{
  stops: ScrollStop[];
  contentHeight: number;
  viewport: number;
  glideMs?: number;
  children: React.ReactNode;
}> = ({ stops, contentHeight, viewport, glideMs = 700, children }) => {
  const ms = useMs();
  const y = scrollOffsetAt(stops, ms, contentHeight, viewport, glideMs);

  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: V.W, height: viewport, overflow: 'hidden' }}>
      <div style={{ transform: `translateY(${-y}px)` }}>{children}</div>
    </div>
  );
};

/* ------------------------------------------------------------------- 3 reveal
   Series appear one at a time in narration order, and stay faded afterwards. */
export function revealState(id: string, revealed: Set<string>, activeId?: string) {
  if (id === activeId) return { shown: true, opacity: 1, active: true };
  if (revealed.has(id)) return { shown: true, opacity: TH.line.fade, active: false };
  return { shown: false, opacity: 0, active: false };
}

/* --------------------------------------------------------------- 4 accents
   Marker overlays, resolved from DATA anchors by the chart that owns the
   scales. Several can fire inside one beat — that is the point. */
export const AccentLayer: React.FC<{
  accents?: Accent[];
  progress: number;
  resolve: Resolve;
}> = ({ accents, progress, resolve }) => {
  if (!accents?.length) return null;
  return (
    <>
      {accents.map((a, i) => (
        <One key={i} accent={a} p={accentProgress(a, progress)} resolve={resolve} />
      ))}
    </>
  );
};

const One: React.FC<{ accent: Accent; p: number; resolve: Resolve }> = ({ accent, p, resolve }) => {
  if (p <= 0) return null;
  const pt = accent.at ? resolve(accent.at) : null;

  if (accent.kind === 'refline') {
    if (!pt) return null;
    const y = pt.y - PLOT.y;
    return (
      <>
        <svg style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, overflow: 'visible' }} width={PLOT.w} height={PLOT.h}>
          <line
            x1={0} y1={y} x2={PLOT.w * p} y2={y}
            stroke={T.capLine} strokeWidth={TH.annotation.width + 2}
            strokeDasharray={TH.annotation.voice === 'marker' ? '26 18' : '14 10'}
          />
        </svg>
        {accent.text && (
          <div
            style={{
              position: 'absolute', left: PLOT.x + 8, top: PLOT.y + y + 12,
              ...type.marker, color: T.capLine, opacity: p,
              transform: TH.annotation.voice === 'marker' ? 'rotate(-7deg)' : 'none',
            }}
          >
            {accent.text}
          </div>
        )}
      </>
    );
  }

  if (accent.kind === 'callout') {
    if (!pt) return null;
    return (
      <div
        style={{
          position: 'absolute', left: pt.x, top: pt.y - 96,
          ...type.marker, color: T.bad, opacity: p,
          transform: `translate(-50%,0) scale(${0.9 + 0.1 * p})`, whiteSpace: 'nowrap',
        }}
      >
        {accent.text}
      </div>
    );
  }

  if (accent.kind === 'spotlight') {
    if (!pt) return null;
    const rx = 78, ry = 52;
    const circ = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
    return (
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={V.W} height={V.H}>
        <ellipse
          cx={pt.x} cy={pt.y} rx={rx} ry={ry}
          fill="none" stroke={T.capLine} strokeWidth={TH.annotation.width}
          transform={`rotate(-12 ${pt.x} ${pt.y})`}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - p)}
        />
      </svg>
    );
  }

  if (accent.kind === 'arrow') {
    if (!pt) return null;
    // The arrow comes IN to the anchor from up-left, so it never needs
    // hand-placed endpoints and never points at nothing.
    const len = 210;
    const x1 = pt.x - len * 0.78, y1 = pt.y - len * 0.62;
    const mx = x1 + (pt.x - x1) * p, my = y1 + (pt.y - y1) * p;
    const ang = (Math.atan2(pt.y - y1, pt.x - x1) * 180) / Math.PI;
    return (
      <>
        <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={V.W} height={V.H}>
          <line
            x1={x1} y1={y1} x2={mx} y2={my} stroke={T.capLine}
            strokeWidth={TH.annotation.width}
            strokeDasharray={TH.annotation.voice === 'marker' ? '24 16' : undefined}
            strokeLinecap="round"
          />
          {p > 0.9 && (
            <polygon points="0,-13 26,0 0,13" fill={T.capLine} transform={`translate(${pt.x},${pt.y}) rotate(${ang})`} />
          )}
        </svg>
        {accent.text && (
          <div
            style={{
              position: 'absolute', left: x1, top: y1 - 72, ...type.marker,
              color: T.ink2, opacity: p, transform: 'translateX(-46%)',
              textAlign: 'center', width: 460, lineHeight: 1.05,
            }}
          >
            {accent.text}
          </div>
        )}
      </>
    );
  }

  // zoom and fade are handled by the chart (camera / series opacity), not drawn
  return null;
};

/* ---------------------------------------------------------------- 5 spotlight
   Row / cell emphasis: a yellow name tag, and dimming of everything else. */
export const RowTag: React.FC<{ text: string; left: number; top: number }> = ({ text, left, top }) => (
  <div
    style={{
      position: 'absolute', left, top, background: T.highlight,
      padding: '3px 12px 5px', ...type.rowName, fontWeight: 700, color: TH.onHighlight,
      boxShadow: TH.panel.shadow, whiteSpace: 'nowrap',
    }}
  >
    {text}
  </div>
);

/* -------------------------------------------------------------- 6 inset panel
   A second, smaller chart drops in over the main one, then leaves. */
export const InsetPanel: React.FC<{
  title: string;
  visible: boolean;
  progress: number;
  children: React.ReactNode;
}> = ({ title, visible, progress, children }) => {
  if (!visible) return null;
  const p = interpolate(progress, [0, 0.18, 0.85, 1], [0, 1, 1, 0], { extrapolateRight: 'clamp' });
  return (
    <div
      style={{
        position: 'absolute', left: 110, top: 780, width: 700,
        background: TH.panel.bg, border: `2px solid ${TH.panel.border}`,
        boxShadow: TH.panel.shadow, padding: '18px 22px 24px',
        opacity: p, transform: `translateY(${(1 - p) * 40}px) rotate(${-1.5 * (1 - p)}deg)`,
      }}
    >
      <div style={{ ...type.sub, fontSize: 30, marginBottom: 12, color: T.ink }}>{title}</div>
      {children}
    </div>
  );
};

/** Portrait cut-out riding a data point, sized by how many are on screen. */
export const Headshot: React.FC<{
  src: string; x: number; y: number; size: number; ring?: string; opacity?: number;
}> = ({ src, x, y, size, ring, opacity = 1 }) => (
  <div
    style={{
      position: 'absolute', left: x - size / 2, top: y - size / 2, width: size, height: size,
      opacity, overflow: 'hidden',
      borderRadius: TH.marker.shape === 'circle' ? '50%' : size * 0.24,
      border: ring && TH.marker.ring ? `${TH.marker.ring}px solid ${ring}` : undefined,
      background: TH.ground,
      filter: `drop-shadow(0 3px 8px ${TH.panel.shadow.includes('0.65') ? 'rgba(0,0,0,.7)' : 'rgba(0,0,0,.22)'})`,
    }}
  >
    <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top center' }} />
  </div>
);

/** Big free-standing portrait with the name block under it, as in the source. */
export const PortraitLabel: React.FC<{
  src: string; first: string; last: string; color: string;
  x: number; y: number; width?: number; opacity?: number;
}> = ({ src, first, last, color, x, y, width = 340, opacity = 1 }) => (
  <div style={{ position: 'absolute', left: x, top: y, width, opacity }}>
    <Img src={src} style={{ width, filter: 'drop-shadow(0 6px 12px rgba(0,0,0,.28))' }} />
    <div style={{ marginTop: 4, marginLeft: 22 }}>
      <div style={{ ...type.nameFirst, color, lineHeight: 1 }}>{first}</div>
      <div style={{ ...type.nameLast, color, lineHeight: 1 }}>{last}</div>
    </div>
  </div>
);

export { fmt };
