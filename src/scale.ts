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
  // The branch above only tests the IDEAL row height. Shrinking rowH down to
  // `min` can still make the whole list fit — count * rowH <= height — and
  // that must be re-checked, or a list that fits gets wrapped in Scroll
  // anyway, which then applies a translateY for beat stops that were never
  // meant to move anything (measured: fitRows(30, 1120) reported 'scroll'
  // with rowH 37 and visible === count, i.e. everything was already on screen).
  if (count * rowH <= height) {
    return { mode: 'static' as const, rowH, visible: count };
  }
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


/* ────────────────────────────────────── continuous travel along a polyline */

export type Pt = readonly [number, number];

/**
 * The polyline drawn up to fraction `t`, plus the exact point at `t`.
 *
 * The old code sliced the point array — `pts.slice(0, ceil(n * t))` — which
 * grows the line one whole DATA POINT at a time. Over eight seasons that is
 * eight visible jumps, and the portrait riding the end teleported between
 * vertices. Interpolating by arc length makes both continuous.
 */
export function pathAt(points: readonly Pt[], t: number): { path: Pt[]; head: Pt } {
  if (points.length === 0) return { path: [], head: [0, 0] };
  if (points.length === 1) return { path: [points[0]], head: points[0] };

  const seg: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    seg.push(d);
    total += d;
  }
  const clamped = Math.max(0, Math.min(1, t));
  if (total === 0) return { path: [points[0]], head: points[0] };
  if (clamped >= 1) return { path: [...points], head: points[points.length - 1] };

  let want = total * clamped;
  const path: Pt[] = [points[0]];
  for (let i = 0; i < seg.length; i++) {
    if (want > seg[i]) {
      want -= seg[i];
      path.push(points[i + 1]);
      continue;
    }
    const f = seg[i] === 0 ? 0 : want / seg[i];
    const head: Pt = [
      points[i][0] + (points[i + 1][0] - points[i][0]) * f,
      points[i][1] + (points[i + 1][1] - points[i][1]) * f,
    ];
    path.push(head);
    return { path, head };
  }
  const last = points[points.length - 1];
  return { path, head: last };
}

/** Cubic ease-out, for anything that grows. Linear growth reads as mechanical. */
export const easeOut = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);


/* ───────────────────────────────────────────────────── 09 slope-pair ranking */

export type RankMove = { id: string; from: number; to: number | null; delta: number | null };

/**
 * Two orderings of the same entities: where each row started (`fromRank`,
 * e.g. its draft slot) versus where its `value` puts it now. A null value is
 * a legitimate outcome (a player with no NBA scoring record), not a zero —
 * it is excluded from ranking entirely rather than sinking to the bottom,
 * which would silently claim they scored fewer points than the players who
 * actually did score just very little.
 */
export function rankPair<T>(
  rows: T[],
  keyOf: (t: T) => string,
  fromRank: (t: T) => number,
  value: (t: T) => number | null
): RankMove[] {
  const withVal = rows.map((r) => ({ id: keyOf(r), from: fromRank(r), value: value(r) }));
  const ranked = withVal
    .filter((r): r is { id: string; from: number; value: number } => r.value !== null)
    // descending by value; ties go to whoever had the better (lower) original rank
    .sort((a, b) => b.value - a.value || a.from - b.from);
  const toRank = new Map<string, number>();
  ranked.forEach((r, i) => toRank.set(r.id, i + 1));
  return withVal.map((r) => {
    const to = toRank.get(r.id) ?? null;
    return { id: r.id, from: r.from, to, delta: to === null ? null : r.from - to };
  });
}


/* ───────────────────────────────────────────────── 10 image-cell-matrix grid */

/**
 * Largest square cell that fits a rows x cols grid inside w x h, plus the
 * offsets that centre it. A matrix and a waffle are the same layout problem —
 * pack N squares into a box — so both charts share this.
 */
export function gridFit(rows: number, cols: number, w: number, h: number, gap = 6) {
  const cellW = (w - gap * (cols - 1)) / cols;
  const cellH = (h - gap * (rows - 1)) / rows;
  const cell = Math.max(0, Math.min(cellW, cellH));
  const usedW = cols * cell + gap * (cols - 1);
  const usedH = rows * cell + gap * (rows - 1);
  return { cell, ox: Math.max(0, (w - usedW) / 2), oy: Math.max(0, (h - usedH) / 2), usedW, usedH };
}


/* ─────────────────────────────────────────────────────── 11 unit-waffle grid */

/**
 * One dot per `total/unitsTotal` points, grouped by part, in reading order.
 *
 * Plain `Math.round` per part would drift the sum away from `unitsTotal`
 * (round every share down and you're short; round every share up and you
 * overshoot). The largest-remainder method — floor everything, then hand the
 * leftover units to whoever was closest to rounding up — is the standard fix,
 * and a second pass guarantees a part that legitimately scored never rounds
 * all the way down to invisible.
 */
export function waffleLayout(
  parts: { key: string; points: number }[],
  cols: number,
  unitsTotal: number
): { key: string; index: number }[] {
  const total = parts.reduce((s, p) => s + p.points, 0);
  const raw = parts.map((p) => (total > 0 ? (p.points / total) * unitsTotal : 0));
  const counts = raw.map(Math.floor);
  let remaining = unitsTotal - counts.reduce((a, b) => a + b, 0);

  const byRemainder = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    counts[i]++;
    remaining--;
  }

  // Borrow one unit from whichever part has the most, rather than let a
  // real, non-zero share round down to zero and vanish from the picture.
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].points > 0 && counts[i] === 0) {
      const donor = counts.reduce((best, c, j) => (j !== i && c > counts[best] ? j : best), i);
      if (donor !== i) { counts[donor]--; counts[i]++; }
    }
  }

  const out: { key: string; index: number }[] = [];
  let idx = 0;
  parts.forEach((p, i) => { for (let k = 0; k < counts[i]; k++) out.push({ key: p.key, index: idx++ }); });
  return out;
}
