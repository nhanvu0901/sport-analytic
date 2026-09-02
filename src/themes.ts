import { FF } from './fonts';

/**
 * Visual identity.
 *
 * The original geometry in this project was measured off NBA Recap Pod's own
 * frames — correct for proving the format, wrong to ship. A theme owns every
 * decision that makes a channel recognisable: ground, grid, stroke weight,
 * marker shape, type treatment, annotation voice. Changing the identity is
 * changing one entry here, not editing eight charts.
 */
export type Theme = {
  name: string;
  blurb: string;

  ground: string;
  ink: string;
  ink2: string;
  ink3: string;

  /** Grid: a channel is recognisable by what it DOESN'T draw. */
  grid: {
    horizontal: string | null;
    vertical: string | null;
    dash: string | null;      // e.g. '1 7' for dotted
    width: number;
  };
  axis: string | null;
  baselineWidth: number;

  series: string[];
  line: { width: number; halo: string | null; cap: 'round' | 'butt'; fade: number };

  marker: { shape: 'circle' | 'squircle'; ring: number; ringFrom: 'series' | 'ground' | null };

  title: {
    font: string; weight: number; size: number; tracking: string;
    upper: boolean; rule: string | null; eyebrow: string | null;
  };
  tick: { font: string; size: number; weight: number };
  label: { font: string; firstSize: number; lastSize: number; weight: number };
  annotation: { voice: 'marker' | 'precise'; font: string; width: number };

  track: string;
  good: string;
  bad: string;
  highlight: string;
  /** Text ON the highlight — a near-white ink over yellow is unreadable. */
  onHighlight: string;
  capLine: string;
  /** Translucent ground, for label plates that must sit over the chart. */
  plate: string;
  /** Hairline over the ground, for separating marks from each other. */
  hairline: string;
  /** Panels that float above the chart (inset charts, tooltips). */
  panel: { bg: string; border: string; shadow: string };
  /** Position / category colours, which must read against THIS ground. */
  category: { G: string; F: string; C: string; none: string };
  /** Team logos are authored for white. On a dark ground they need a plate. */
  logoPlate: string | null;

  plot: { x: number; y: number; w: number; h: number };
  titleAt: { x: number; capTop: number };
  logoAt: { x: number; y: number; w: number; h: number } | null;
  watermark: { text: string; color: string };
};

const MONO = '"IBM Plex Mono", ui-monospace, monospace';

/* ──────────────────────────────────────────────────────── A — Court (dark) */
export const court: Theme = {
  name: 'court',
  blurb: 'Near-black ground, horizontal rules only, bright strokes, mono ticks.',
  ground: '#101319',
  ink: '#F4F6FA', ink2: '#A7AEBC', ink3: '#6B7383',
  grid: { horizontal: 'rgba(255,255,255,0.085)', vertical: null, dash: null, width: 2 },
  axis: 'rgba(255,255,255,0.30)',
  baselineWidth: 3,
  series: ['#FF5A5F', '#4CC9F0', '#FFD166', '#7BE495', '#C77DFF',
           '#F77F00', '#4895EF', '#F72585', '#90BE6D', '#B5179E'],
  line: { width: 8, halo: null, cap: 'round', fade: 0.44 },
  marker: { shape: 'circle', ring: 4, ringFrom: 'series' },
  title: {
    font: FF.cond, weight: 700, size: 92, tracking: '0.005em',
    upper: true, rule: '#FF5A5F', eyebrow: 'NBA · 2025-26',
  },
  tick: { font: MONO, size: 20, weight: 400 },
  label: { font: FF.cond, firstSize: 30, lastSize: 60, weight: 700 },
  annotation: { voice: 'precise', font: MONO, width: 3 },
  track: 'rgba(255,255,255,0.10)',
  good: '#7BE495', bad: '#FF5A5F', highlight: '#FFD166',
  onHighlight: '#101319',
  capLine: 'rgba(255,255,255,0.72)',
  plate: 'rgba(16,19,25,0.86)',
  hairline: 'rgba(255,255,255,0.22)',
  panel: { bg: '#1A1E27', border: 'rgba(255,255,255,0.22)', shadow: '0 18px 44px rgba(0,0,0,0.65)' },
  category: { G: '#4CC9F0', F: '#7BE495', C: '#FF5A5F', none: '#6B7383' },
  logoPlate: 'rgba(255,255,255,0.90)',
  plot: { x: 176, y: 512, w: 716, h: 1120 },
  titleAt: { x: 62, capTop: 306 },
  logoAt: null,
  watermark: { text: '', color: 'rgba(255,255,255,0.16)' },
};

/* ─────────────────────────────────────────── B — Blueprint (light, technical) */
export const blueprint: Theme = {
  name: 'blueprint',
  blurb: 'Cool light ground, dotted grid both ways, thin strokes, square markers.',
  ground: '#EDF0F3',
  ink: '#131922', ink2: '#455060', ink3: '#7C8798',
  grid: { horizontal: 'rgba(19,25,34,0.34)', vertical: 'rgba(19,25,34,0.22)', dash: '2 9', width: 2.5 },
  axis: 'rgba(19,25,34,0.55)',
  baselineWidth: 2,
  series: ['#1D3557', '#C1121F', '#457B9D', '#2A9D8F', '#8A6D3B',
           '#6D597A', '#0F6E5C', '#9E2A2B', '#3D5A80', '#5F7161'],
  line: { width: 6, halo: null, cap: 'butt', fade: 0.46 },
  marker: { shape: 'squircle', ring: 3, ringFrom: 'series' },
  title: {
    font: FF.cond, weight: 700, size: 84, tracking: '-0.01em',
    upper: false, rule: null, eyebrow: 'TOTAL POINTS · CAREER TO DATE',
  },
  tick: { font: MONO, size: 20, weight: 400 },
  label: { font: FF.body, firstSize: 26, lastSize: 48, weight: 700 },
  annotation: { voice: 'precise', font: MONO, width: 2 },
  track: 'rgba(19,25,34,0.10)',
  good: '#2A9D8F', bad: '#C1121F', highlight: '#E9C46A',
  onHighlight: '#131922',
  capLine: 'rgba(19,25,34,0.75)',
  plate: 'rgba(237,240,243,0.90)',
  hairline: 'rgba(19,25,34,0.16)',
  panel: { bg: '#F7F9FB', border: 'rgba(19,25,34,0.26)', shadow: '0 18px 40px rgba(19,25,34,0.20)' },
  category: { G: '#1D3557', F: '#2A9D8F', C: '#C1121F', none: '#7C8798' },
  logoPlate: null,
  plot: { x: 196, y: 486, w: 700, h: 1090 },
  titleAt: { x: 66, capTop: 300 },
  logoAt: null,
  watermark: { text: '', color: 'rgba(19,25,34,0.16)' },
};

/* ──────────────────────────────── C — Headline (white, bold editorial) */
export const headline: Theme = {
  name: 'headline',
  blurb: 'White, no grid, very heavy oversized type, thick strokes, big markers.',
  ground: '#FFFFFF',
  ink: '#0A0A0A', ink2: '#3A3A3A', ink3: '#8A8A8A',
  grid: { horizontal: 'rgba(0,0,0,0.07)', vertical: null, dash: null, width: 2 },
  axis: null,
  baselineWidth: 5,
  series: ['#E63946', '#1D3557', '#F4A261', '#2A9D8F', '#6A4C93',
           '#EF476F', '#118AB2', '#B08900', '#073B4C', '#06A77D'],
  line: { width: 13, halo: '#FFFFFF', cap: 'round', fade: 0.40 },
  marker: { shape: 'circle', ring: 7, ringFrom: 'ground' },
  title: {
    font: FF.cond, weight: 700, size: 112, tracking: '-0.022em',
    upper: true, rule: null, eyebrow: null,
  },
  tick: { font: FF.body, size: 24, weight: 700 },
  label: { font: FF.cond, firstSize: 32, lastSize: 76, weight: 700 },
  annotation: { voice: 'precise', font: FF.cond, width: 6 },
  track: 'rgba(0,0,0,0.09)',
  good: '#06A77D', bad: '#E63946', highlight: '#FFD166',
  onHighlight: '#0A0A0A',
  capLine: '#0A0A0A',
  plate: 'rgba(255,255,255,0.92)',
  hairline: 'rgba(0,0,0,0.14)',
  panel: { bg: '#FFFFFF', border: 'rgba(0,0,0,0.24)', shadow: '0 18px 40px rgba(0,0,0,0.18)' },
  category: { G: '#1D3557', F: '#2A9D8F', C: '#E63946', none: '#8A8A8A' },
  logoPlate: null,
  plot: { x: 150, y: 520, w: 780, h: 1130 },
  titleAt: { x: 60, capTop: 268 },
  logoAt: null,
  watermark: { text: '', color: 'rgba(0,0,0,0.13)' },
};

export const THEMES: Record<string, Theme> = { court, blueprint, headline };
