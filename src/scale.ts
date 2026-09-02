/** The only maths in the project. Kept pure so it can be tested. */

export type Scale = (v: number) => number;

export const scaleLinear = ([d0, d1]: [number, number], [r0, r1]: [number, number]): Scale => {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v) => r0 + ((v - d0) / span) * (r1 - r0);
};

/** Axis ticks on a 1/2/5×10^n step, extended outward to cover the domain. */
export function niceTicks(min: number, max: number, target = 8): number[] {
  if (max === min) { max = min + 1; }
  const raw = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out: number[] = [];
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Number(v.toFixed(decimals)));
  return out;
}

/**
 * The 9:16 frame is the real constraint, not the data. Rows get a comfortable
 * height while they fit; past that the list scrolls at a readable minimum.
 */
export function fitRows(count: number, height: number, ideal = 44, min = 34) {
  if (count * ideal <= height) {
    return { mode: 'static' as const, rowH: ideal, visible: count };
  }
  const rowH = Math.max(min, Math.min(ideal, Math.floor(height / count)));
  return { mode: 'scroll' as const, rowH, visible: Math.floor(height / rowH) };
}

export const fmt = {
  int: (v: number) => Math.round(v).toLocaleString('en-US'),
  money: (v: number) => '$' + Math.round(v).toLocaleString('en-US'),
  moneyShort: (v: number) =>
    v >= 1e6 ? '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M' : '$' + Math.round(v / 1e3) + 'K',
  signed: (v: number, d = 1) => (v > 0 ? '+' : '') + v.toFixed(d),
  pct: (v: number) => Math.round(v * 100) + '%',
  height: (inches: number) => `${Math.floor(inches / 12)}' ${inches % 12}"`,
};

/**
 * Bin a 2-D point cloud onto a grid and count each cell.
 *
 * Used instead of a beeswarm because a beeswarm cannot fit this frame: height
 * is whole inches (21 rows over 964px, so 46px a row) and the densest window at
 * 6'5" holds twenty players, which would need 260px of stacking. Measured, not
 * assumed. Encoding the count as area keeps every player represented and makes
 * the pile-ups the shape of the chart rather than a smear.
 */
export type Cell<T> = { cx: number; cy: number; count: number; items: T[] };

export function binGrid<T>(
  items: T[],
  getX: (t: T) => number,
  getY: (t: T) => number,
  opts: { xStep: number; yStep: number }
): Cell<T>[] {
  const cells = new Map<string, Cell<T>>();
  for (const it of items) {
    const cx = Math.round(getX(it) / opts.xStep) * opts.xStep;
    const cy = Math.round(getY(it) / opts.yStep) * opts.yStep;
    const key = `${cx}|${cy}`;
    const cell = cells.get(key);
    if (cell) { cell.count += 1; cell.items.push(it); }
    else cells.set(key, { cx, cy, count: 1, items: [it] });
  }
  return [...cells.values()];
}

/** Area-proportional radius: doubling the count doubles the ink, not the width. */
export const countRadius = (count: number, max: number, rMin: number, rMax: number) =>
  rMin + (rMax - rMin) * Math.sqrt(count / Math.max(1, max));


/* ───────────────────────────────────────────────── colour, against a ground */

const hex = (c: string) => {
  const h = c.replace('#', '');
  const n = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)] as const;
};
const toHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** WCAG relative luminance. */
export function luminance(color: string): number {
  const [r, g, b] = hex(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrastRatio = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * Nudge a colour until it separates from the ground.
 *
 * Team colours are authored against white paper. Denver's #0E2240 and San
 * Antonio's near-black simply disappear on a #101319 ground — the bar is there
 * and nobody can see it. Mixing toward white (or black, on a light ground)
 * keeps the hue recognisable while making the mark visible.
 */
export function ensureContrast(color: string, ground: string, minRatio = 2.6): string {
  if (contrastRatio(color, ground) >= minRatio) return color;
  const toward = luminance(ground) < 0.2 ? 255 : 0;
  let [r, g, b] = hex(color);
  for (let step = 0; step < 22; step++) {
    r += (toward - r) * 0.12;
    g += (toward - g) * 0.12;
    b += (toward - b) * 0.12;
    const next = toHex(r, g, b);
    if (contrastRatio(next, ground) >= minRatio) return next;
  }
  return toHex(r, g, b);
}
