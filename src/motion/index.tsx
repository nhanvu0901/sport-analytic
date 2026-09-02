import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig, Easing, Img } from 'remotion';
import { PLOT, T, TH, V, type } from '../theme';
import { fmt } from '../scale';

/** A beat is one narrated sentence bound to one entity. Audio drives all of it. */
export type Beat = {
  entityId: string;
  startMs: number;
  endMs: number;
  annotation?: Annotation;
};

export type Annotation =
  | { kind: 'arrow'; from: [number, number]; to: [number, number]; label?: string }
  | { kind: 'lasso'; at: [number, number]; rx?: number; ry?: number }
  | { kind: 'callout'; at: [number, number]; text: string }
  | { kind: 'refline'; y: number; label: string; width?: number };

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

  let f: Focus = stops.length ? stops[0].focus : NEUTRAL;
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

export const Scroll: React.FC<{
  stops: ScrollStop[];
  contentHeight: number;
  viewport: number;
  glideMs?: number;
  children: React.ReactNode;
}> = ({ stops, contentHeight, viewport, glideMs = 700, children }) => {
  const ms = useMs();
  const max = Math.max(0, contentHeight - viewport);
  const clamp = (o: number) => Math.max(0, Math.min(max, o - viewport * 0.42));

  let y = stops.length ? clamp(stops[0].offset) : 0;
  for (let i = 0; i < stops.length; i++) {
    if (ms < stops[i].atMs) break;
    const from = i === 0 ? clamp(stops[0].offset) : clamp(stops[i - 1].offset);
    const to = clamp(stops[i].offset);
    y = interpolate(ms, [stops[i].atMs, stops[i].atMs + glideMs], [from, to], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
      easing: Easing.inOut(Easing.cubic),
    });
  }

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

/* --------------------------------------------------------------- 4 annotation
   Marker-pen overlays. One per beat at most, drawn on as the line is spoken. */
export const AnnotationLayer: React.FC<{ ann?: Annotation; progress: number }> = ({ ann, progress }) => {
  if (!ann) return null;
  const p = interpolate(progress, [0, 0.35], [0, 1], { extrapolateRight: 'clamp' });

  if (ann.kind === 'refline') {
    const w = (ann.width ?? PLOT.w) * p;
    return (
      <>
        <svg style={{ position: 'absolute', left: PLOT.x, top: PLOT.y, overflow: 'visible' }} width={PLOT.w} height={PLOT.h}>
          <line x1={0} y1={ann.y} x2={w} y2={ann.y} stroke={T.capLine}
            strokeWidth={TH.annotation.width + 2}
            strokeDasharray={TH.annotation.voice === 'marker' ? '26 18' : '14 10'} strokeLinecap="butt" />
        </svg>
        <div
          style={{
            position: 'absolute', left: PLOT.x + 6, top: PLOT.y + ann.y + 12,
            ...type.marker, color: T.capLine, opacity: p,
            // 'marker' tilts like a pen; 'precise' sits square, like an analyst's note
            transform: TH.annotation.voice === 'marker' ? 'rotate(-7deg)' : 'none',
            letterSpacing: TH.annotation.voice === 'precise' ? '0.02em' : undefined,
          }}
        >
          {ann.label}
        </div>
      </>
    );
  }

  if (ann.kind === 'callout') {
    return (
      <div
        style={{
          position: 'absolute', left: ann.at[0], top: ann.at[1],
          ...type.marker, color: T.bad, opacity: p, transform: `translate(-50%,-50%) scale(${0.9 + 0.1 * p})`,
        }}
      >
        {ann.text}
      </div>
    );
  }

  if (ann.kind === 'lasso') {
    const rx = ann.rx ?? 62, ry = ann.ry ?? 40;
    const circ = 2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2);
    return (
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={V.W} height={V.H}>
        <ellipse
          cx={ann.at[0]} cy={ann.at[1]} rx={rx} ry={ry}
          fill="none" stroke={T.ink2} strokeWidth={7} strokeLinecap="round"
          transform={`rotate(-12 ${ann.at[0]} ${ann.at[1]})`}
          strokeDasharray={circ} strokeDashoffset={circ * (1 - p)}
        />
      </svg>
    );
  }

  // arrow
  const [x1, y1] = ann.from;
  const [x2, y2] = ann.to;
  const mx = x1 + (x2 - x1) * p, my = y1 + (y2 - y1) * p;
  const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
  return (
    <>
      <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }} width={V.W} height={V.H}>
        <line x1={x1} y1={y1} x2={mx} y2={my} stroke={T.capLine}
          strokeWidth={TH.annotation.width}
          strokeDasharray={TH.annotation.voice === 'marker' ? '24 16' : undefined} />
        {p > 0.85 && (
          <polygon
            points="0,-13 26,0 0,13"
            fill={T.capLine}
            transform={`translate(${x2},${y2}) rotate(${ang})`}
          />
        )}
      </svg>
      {ann.label && (
        <div
          style={{
            position: 'absolute', left: x1, top: y1 - 96, ...type.marker,
            color: T.ink2, opacity: p, transform: 'translateX(-50%)', textAlign: 'center', width: 420,
          }}
        >
          {ann.label}
        </div>
      )}
    </>
  );
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
