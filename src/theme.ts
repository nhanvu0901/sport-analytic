import { THEMES, type Theme } from './themes';
import active from './data/active-theme.json';

export const V = { W: 1080, H: 1920, FPS: 30 } as const;

/**
 * The active identity. Selected through a committed JSON file rather than an
 * env var so the bundler resolves it the same way every time — a render must
 * not depend on the shell it was launched from.
 *
 *   npx tsx scripts/set-theme.ts blueprint
 */
export const TH: Theme = THEMES[(active as { theme: string }).theme] ?? THEMES.court;

export const PLOT = TH.plot;
export const TITLE = { x: TH.titleAt.x, capTop: TH.titleAt.capTop } as const;
export const LOGO = TH.logoAt ?? { x: 0, y: 0, w: 0, h: 0 };
export const series = TH.series;

/** Names kept stable so charts read tokens, never a theme name. */
export const T = {
  bg: TH.ground,
  bgPaper: TH.ground,
  ink: TH.ink,
  ink2: TH.ink2,
  ink3: TH.ink3,
  grid: TH.grid.horizontal ?? 'transparent',
  gridStrong: TH.axis ?? TH.ink3,
  axis: TH.axis ?? 'transparent',
  halo: TH.line.halo ?? TH.ground,
  good: TH.good,
  bad: TH.bad,
  track: TH.track,
  highlight: TH.highlight,
  capLine: TH.capLine,
  watermark: TH.watermark.color,
} as const;

export const type = {
  title: {
    fontFamily: TH.title.font, fontWeight: TH.title.weight, fontSize: TH.title.size,
    letterSpacing: TH.title.tracking, lineHeight: 1,
  },
  sub: { fontFamily: TH.title.font, fontWeight: 700, fontSize: 32, color: TH.ink2 },
  axisTick: { fontFamily: TH.tick.font, fontWeight: TH.tick.weight, fontSize: TH.tick.size, color: TH.ink2 },
  axisTitle: { fontFamily: TH.tick.font, fontWeight: 700, fontSize: 24, color: TH.ink },
  rowName: { fontFamily: TH.label.font, fontWeight: 500, fontSize: 25, color: TH.ink },
  rowValue: { fontFamily: TH.tick.font, fontWeight: 700, fontSize: 24 },
  nameFirst: { fontFamily: TH.label.font, fontWeight: 600, fontSize: TH.label.firstSize },
  nameLast: { fontFamily: TH.label.font, fontWeight: TH.label.weight, fontSize: TH.label.lastSize },
  marker: { fontFamily: TH.annotation.font, fontWeight: 700, fontSize: 56 },
} as const;
