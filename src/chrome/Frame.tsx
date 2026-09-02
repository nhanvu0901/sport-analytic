import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { T, TH, V, TITLE, LOGO, PLOT, type } from '../theme';

/** Rough advance width for the condensed title face; enough to keep it on-frame. */
const measure = (s: string, size: number) => {
  let u = 0;
  for (const ch of s) u += /[iIl1.,'!|]/.test(ch) ? 0.30 : /[mMwW]/.test(ch) ? 0.86 : /[A-Z0-9]/.test(ch) ? 0.60 : 0.52;
  return u * size;
};

/**
 * Everything identical across every chart type: ground, eyebrow, title, rule,
 * mark, watermark.
 *
 * Subtitles are deliberately NOT drawn — they are burned in downstream, so the
 * render leaves the frame clean and `scripts/tts.ts` writes an .srt with the
 * exact word timings instead.
 */
export const Frame: React.FC<{
  title: string;
  sub?: string;
  logo?: string;
  children: React.ReactNode;
}> = ({ title, sub, logo, children }) => {
  const room = V.W - TITLE.x * 2;
  const base = TH.title.size;
  let size = base;
  while (size > 46 && measure(TH.title.upper ? title.toUpperCase() : title, size) > room) size -= 2;
  const lines = wrapTitle(TH.title.upper ? title.toUpperCase() : title, size, room);

  return (
    <AbsoluteFill style={{ background: T.bg }}>
      {children}

      {TH.title.eyebrow && (
        <div
          style={{
            position: 'absolute', left: TITLE.x, top: TITLE.capTop - size * 0.145 - 44,
            fontFamily: TH.tick.font, fontWeight: 500, fontSize: 22,
            letterSpacing: '0.22em', color: TH.ink3,
          }}
        >
          {TH.title.eyebrow}
        </div>
      )}

      {logo && TH.logoAt && (
        <Img src={logo} style={{ position: 'absolute', left: LOGO.x, top: LOGO.y, width: LOGO.w, height: LOGO.h, objectFit: 'contain' }} />
      )}

      <div
        style={{
          position: 'absolute', left: TITLE.x,
          // CSS `top` is the line box, not the cap
          top: TITLE.capTop - size * 0.145,
          ...type.title, fontSize: size, color: T.ink,
        }}
      >
        {lines.map((l, i) => <div key={i} style={{ lineHeight: 0.94 }}>{l}</div>)}
      </div>

      {TH.title.rule && (
        <div
          style={{
            position: 'absolute', left: TITLE.x,
            top: TITLE.capTop + size * 0.86 + (lines.length - 1) * size * 0.94 + 18,
            width: 148, height: 9, background: TH.title.rule,
          }}
        />
      )}

      {sub && (
        <div
          style={{
            position: 'absolute', left: PLOT.x, top: PLOT.y + PLOT.h + 78,
            ...type.sub, fontSize: 26, color: T.ink3,
          }}
        >
          {sub}
        </div>
      )}

      {TH.watermark.text && (
        <div
          style={{
            position: 'absolute', right: V.W - PLOT.x - PLOT.w + 10, top: PLOT.y + 12,
            ...type.axisTick, fontSize: 20, fontWeight: 500, color: TH.watermark.color,
          }}
        >
          {TH.watermark.text}
        </div>
      )}
    </AbsoluteFill>
  );
};

/** Break a long title onto two lines at the nearest space, once. */
function wrapTitle(text: string, size: number, room: number): string[] {
  if (measure(text, size) <= room) return [text];
  const words = text.split(' ');
  for (let i = Math.ceil(words.length / 2); i > 0; i--) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    if (measure(a, size) <= room && measure(b, size) <= room) return [a, b];
  }
  return [text];
}
