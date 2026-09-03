/** Plain assertions, no framework. `npm test`. */
import assert from 'node:assert/strict';
import { seasonRows, cumulate } from '../src/espn';
import { scaleLinear, niceTicks, fitRows, binGrid, countRadius, ensureContrast, contrastRatio, pathAt, easeOut, rankPair, gridFit, waffleLayout, type Pt } from '../src/scale';
import teams from '../src/data/teams.json';
import { eventDensity, DENSITY_FLOOR, accentProgress, ACCENT_KINDS } from '../src/accent';
import { scrollOffsetAt, type ScrollStop } from '../src/motion';
import { detectMarkers, allowedNumbers, STYLE_RULES, type BriefEntity, type WriterBrief } from '../src/brief';
import { verifyDraft } from '../src/verify';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLedger, digestLines, isBurned, readLedger, slugify } from '../src/content/ledger';
import { nextAngle } from '../src/content/discover';
import { createSession } from '../src/content/sessions';
import { inferMeasure, judgeSameFormat } from '../src/content/gates';
import type { TavilyHit } from '../src/content/tavily';
import angles from '../content/angles.json';
import type { LedgerRecord } from '../src/content/types';
import { cacheKey, synthesize, type WorkerJob } from '../src/tts/chatterbox';
import { normaliseName, stripSuffix, aggregateBox, resolveName, ambiguous, type BoxRow, type PlayerTotals } from '../src/hoopr';

let n = 0;
const t = (name: string, fn: () => void) => {
  try { fn(); n++; console.log(`  ok   ${name}`); }
  catch (e: any) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

/* ------------------------------------------------ the mid-season trade bug */
const split = {
  categories: [{
    name: 'averages',
    labels: ['GP', 'PTS'],
    statistics: [
      { season: { displayName: '2024-25' }, teamSlug: 'brooklyn-nets', stats: ['33', '6.2'] },
      { season: { displayName: '2024-25' }, teamSlug: 'la-clippers', stats: ['18', '2.9'] },
      { season: { displayName: '2024-25' }, teamSlug: '2024-25 Totals', stats: ['51', '5.0'] },
      { season: { displayName: '2025-26' }, teamSlug: 'la-clippers', stats: ['70', '8.4'] },
    ],
  }],
};
t('averages use ESPN roll-up for a split season, never the sum', () => {
  const r = seasonRows(split, 'averages', 'PTS');
  assert.deepEqual(r, [{ season: '2024-25', value: 5.0 }, { season: '2025-26', value: 8.4 }]);
});

const noRollup = {
  categories: [{
    name: 'averages', labels: ['GP', 'PTS'],
    statistics: [
      { season: { displayName: '2025-26' }, teamSlug: 'a', stats: ['20', '10.0'] },
      { season: { displayName: '2025-26' }, teamSlug: 'b', stats: ['60', '20.0'] },
    ],
  }],
};
t('averages fall back to a games-weighted mean when no roll-up exists', () => {
  // (20*10 + 60*20) / 80 = 17.5, not 30
  assert.equal(seasonRows(noRollup, 'averages', 'PTS')[0].value, 17.5);
});

const totals = {
  categories: [{
    name: 'totals', labels: ['PTS'],
    statistics: [
      { season: { displayName: '2025-26' }, teamSlug: 'a', stats: ['540'] },
      { season: { displayName: '2025-26' }, teamSlug: 'b', stats: ['1,000'] },
    ],
  }],
};
t('totals do sum across a split season, and parse thousands separators', () => {
  assert.equal(seasonRows(totals, 'totals', 'PTS')[0].value, 1540);
});

t('a missing season leaves a gap rather than interpolating', () => {
  const zion = { categories: [{ name: 'totals', labels: ['PTS'], statistics: [
    { season: { displayName: '2020-21' }, teamSlug: 'nop', stats: ['1647'] },
    { season: { displayName: '2022-23' }, teamSlug: 'nop', stats: ['754'] },
  ] }] };
  const rows = seasonRows(zion, 'totals', 'PTS');
  assert.deepEqual(rows.map((r) => r.season), ['2020-21', '2022-23']);
  assert.deepEqual(cumulate(rows).map((r) => r.value), [1647, 2401]);
});

t('unknown label or category yields an empty series, not a throw', () => {
  assert.deepEqual(seasonRows(split, 'averages', 'NOPE'), []);
  assert.deepEqual(seasonRows(split, 'totals', 'PTS'), []);
});

/* ------------------------------------------------------------------ scales */
t('scaleLinear maps domain ends to range ends', () => {
  const s = scaleLinear([0, 9000], [1250, 0]);
  assert.equal(s(0), 1250);
  assert.equal(s(9000), 0);
  assert.equal(s(4500), 625);
});

t('scaleLinear on a zero-width domain does not divide by zero', () => {
  const s = scaleLinear([5, 5], [0, 100]);
  assert.equal(Number.isFinite(s(5)), true);
});

t('niceTicks matches the source video: 0 to 9,000 by 1,000', () => {
  const ticks = niceTicks(0, 8391, 9);
  assert.equal(ticks[0], 0);
  assert.equal(ticks.at(-1), 9000);
  assert.equal(ticks[1] - ticks[0], 1000);
});

t('niceTicks spans a signed domain through zero', () => {
  const ticks = niceTicks(-12, 11.1, 8);
  assert.ok(ticks.includes(0), `expected a zero tick, got ${ticks.join(',')}`);
  assert.ok(ticks[0] <= -12 && ticks.at(-1)! >= 11.1);
});

/* ----------------------------------------------- frame budget / row fitting */
t('fitRows keeps everything static when it fits the frame', () => {
  const f = fitRows(20, 1250);
  assert.equal(f.mode, 'static');
  assert.equal(f.visible, 20);
});

t('fitRows switches to scroll past the frame budget', () => {
  const f = fitRows(450, 1250);
  assert.equal(f.mode, 'scroll');
  assert.ok(f.visible < 450 && f.visible >= 20, `visible=${f.visible}`);
  assert.ok(f.rowH >= 26, `rowH=${f.rowH}`);
});

t('fitRows: a shrunk row height that still fits must report static, not scroll', () => {
  // 30 * 44 = 1320 > 1120 fails the ideal check, but the shrunk rowH (37)
  // fits 30 * 37 = 1110 <= 1120 — this must not be handed to Scroll.
  const f = fitRows(30, 1120);
  assert.equal(f.mode, 'static', `30 rows at rowH ${f.rowH} (${30 * f.rowH} <= 1120) must be static`);
  assert.equal(f.rowH, 37);
  assert.equal(f.visible, 30);
});

t('fitRows: a genuinely long list still scrolls after the re-check', () => {
  const f = fitRows(450, 1120);
  assert.equal(f.mode, 'scroll');
});

/* -------------------------------------------------------------------- binGrid */
t('binGrid accounts for every point exactly once', () => {
  const pts = Array.from({ length: 550 }, (_, i) => ({ id: i, w: 160 + (i % 90), h: 70 + (i % 21) }));
  const cells = binGrid(pts, (p) => p.w, (p) => p.h, { xStep: 5, yStep: 1 });
  assert.equal(cells.reduce((s, c) => s + c.count, 0), pts.length);
  assert.equal(new Set(cells.flatMap((c) => c.items.map((i) => i.id))).size, pts.length);
});

t('binGrid collapses points that share a cell', () => {
  const pts = [{ w: 200 }, { w: 201 }, { w: 202 }, { w: 240 }];
  const cells = binGrid(pts, (p) => p.w, () => 78, { xStep: 5, yStep: 1 });
  assert.equal(cells.length, 2);
  assert.equal(cells.find((c) => c.cx === 200)!.count, 3);
});

t('countRadius is area-proportional and bounded', () => {
  assert.equal(countRadius(0, 20, 4, 20), 4);
  assert.equal(countRadius(20, 20, 4, 20), 20);
  // four times the count is twice the radius, i.e. four times the ink
  const r1 = countRadius(1, 16, 0, 16);
  const r4 = countRadius(4, 16, 0, 16);
  assert.ok(Math.abs(r4 - 2 * r1) < 1e-9, `${r4} vs ${2 * r1}`);
});

/* -------------------------------------------------------------- ensureContrast */
t('ensureContrast leaves a colour alone when it already separates', () => {
  const c = ensureContrast('#FF5A5F', '#101319');
  assert.equal(c, '#FF5A5F');
});

t('ensureContrast lifts a near-black team colour off a near-black ground', () => {
  const ground = '#101319';
  const denver = '#0E2240';                       // real: Nuggets navy
  assert.ok(contrastRatio(denver, ground) < 2.6, 'fixture should start unreadable');
  const fixed = ensureContrast(denver, ground);
  assert.ok(contrastRatio(fixed, ground) >= 2.6, `got ratio ${contrastRatio(fixed, ground).toFixed(2)}`);
});

t('ensureContrast darkens instead, when the ground is light', () => {
  const ground = '#FFFFFF';
  const pale = '#FFF6C0';
  const fixed = ensureContrast(pale, ground);
  assert.ok(contrastRatio(fixed, ground) >= 2.6);
  assert.ok(fixed !== pale);
});

t('every team colour in the dataset is readable after the guard', () => {
  const ground = '#101319';
  const bad = (teams as { abbr: string; color: string }[])
    .map((x) => ({ abbr: x.abbr, r: contrastRatio(ensureContrast(x.color, ground), ground) }))
    .filter((x) => x.r < 2.55);
  assert.equal(bad.length, 0, `still unreadable: ${bad.map((b) => `${b.abbr}=${b.r.toFixed(2)}`).join(', ')}`);
});

/* --------------------------------------------------------------------- pathAt */
const LINE: Pt[] = [[0, 0], [10, 0], [10, 10], [20, 10]];   // total length 30

t('pathAt at 0 and 1 gives the ends exactly', () => {
  assert.deepEqual(pathAt(LINE, 0).head, [0, 0]);
  assert.deepEqual(pathAt(LINE, 1).head, [20, 10]);
  assert.equal(pathAt(LINE, 1).path.length, LINE.length);
});

t('pathAt lands MID-SEGMENT, not on the nearest vertex', () => {
  // 40% of length 30 = 12 -> 2 units into the second segment
  const { head, path } = pathAt(LINE, 0.4);
  assert.deepEqual(head, [10, 2]);
  assert.equal(path.length, 3, 'two vertices plus the interpolated head');
  assert.deepEqual(path[path.length - 1], head);
});

t('pathAt advances smoothly — no jump larger than the step implies', () => {
  let prev = pathAt(LINE, 0).head;
  let worst = 0;
  for (let i = 1; i <= 100; i++) {
    const h = pathAt(LINE, i / 100).head;
    worst = Math.max(worst, Math.hypot(h[0] - prev[0], h[1] - prev[1]));
    prev = h;
  }
  // 30 units over 100 steps = 0.3 a step; the old slice() jumped up to 10
  assert.ok(worst < 0.5, `biggest jump was ${worst.toFixed(2)}`);
});

t('pathAt survives degenerate input', () => {
  assert.deepEqual(pathAt([], 0.5).path, []);
  assert.deepEqual(pathAt([[5, 5]], 0.5).head, [5, 5]);
  assert.deepEqual(pathAt([[5, 5], [5, 5]], 0.5).head, [5, 5]);   // zero length
});

t('easeOut is monotonic, bounded, and starts fast', () => {
  assert.equal(easeOut(0), 0);
  assert.equal(easeOut(1), 1);
  assert.ok(easeOut(0.5) > 0.5, 'ease-OUT must be ahead of linear at the midpoint');
  let prev = -1;
  for (let i = 0; i <= 20; i++) { const v = easeOut(i / 20); assert.ok(v >= prev); prev = v; }
});

/* ------------------------------------------------------------------ rankPair */
type MoveRow = { id: string; pick: number; value: number | null };
const moveRows: MoveRow[] = [
  { id: 'a', pick: 1, value: 100 },   // ties b on value; better (lower) pick wins the tie
  { id: 'b', pick: 2, value: 100 },
  { id: 'c', pick: 3, value: 90 },
  { id: 'd', pick: 4, value: null },  // no NBA scoring data — must not rank
  { id: 'e', pick: 5, value: 80 },
];
const moves = rankPair(moveRows, (r) => r.id, (r) => r.pick, (r) => r.value);
const moveById = new Map(moves.map((m) => [m.id, m]));

t('rankPair excludes a null value from ranking', () => {
  const d = moveById.get('d')!;
  assert.equal(d.to, null);
  assert.equal(d.delta, null);
  // ranks stay contiguous 1..4 for the other rows — d does not consume a slot
  const ranks = moves.filter((m) => m.to !== null).map((m) => m.to).sort((x, y) => x! - y!);
  assert.deepEqual(ranks, [1, 2, 3, 4]);
});

t('rankPair breaks a tie toward the better original pick', () => {
  assert.equal(moveById.get('a')!.to, 1, 'pick 1 beats pick 2 on a value tie');
  assert.equal(moveById.get('b')!.to, 2);
});

t('rankPair delta is positive for a move up', () => {
  const e = moveById.get('e')!;
  assert.equal(e.from, 5);
  assert.equal(e.to, 4);
  assert.equal(e.delta, 1, 'moved from 5th to 4th: delta = from - to = +1');
});

/* -------------------------------------------------------------------- gridFit */
t('gridFit gives a square, fully-used cell on a square area', () => {
  const g = gridFit(6, 6, 606, 606, 6);
  assert.ok(Math.abs(g.usedW - g.usedH) < 1e-9);
  assert.equal(g.ox, 0);
  assert.equal(g.oy, 0);
  assert.ok(Math.abs(g.usedW - 606) < 1e-9);
});

t('gridFit fits 7x6 inside 700x1100 with non-negative centring offsets', () => {
  const g = gridFit(7, 6, 700, 1100, 6);
  assert.ok(6 * g.cell + 6 * 5 <= 700 + 1e-9, `cols overflow: ${g.usedW}`);
  assert.ok(7 * g.cell + 6 * 6 <= 1100 + 1e-9, `rows overflow: ${g.usedH}`);
  assert.ok(g.ox >= 0 && g.oy >= 0);
});

/* --------------------------------------------------------------- waffleLayout */
const waffleParts = [
  { key: 'A', points: 17_343 },
  { key: 'B', points: 8_921 },
  { key: 'C', points: 12_565 },
];
const units = waffleLayout(waffleParts, 20, 420);

t('waffleLayout sums to exactly unitsTotal on shares that do not divide evenly', () => {
  assert.equal(units.length, 420);
});

t('waffleLayout gives every non-zero part at least one unit', () => {
  for (const p of waffleParts) assert.ok(units.some((u) => u.key === p.key));
});

t('waffleLayout groups all of one part before the next in reading order', () => {
  const seenKeys: string[] = [];
  for (const u of units) if (seenKeys.at(-1) !== u.key) seenKeys.push(u.key);
  assert.deepEqual(seenKeys, ['A', 'B', 'C'], `parts interleaved: ${seenKeys.join(',')}`);
});

/* ------------------------------------------------------------- scrollOffsetAt */
const scrollStops: ScrollStop[] = [
  { atMs: 1000, offset: 500 },
  { atMs: 3000, offset: 5000 },   // beyond contentHeight-viewport: must clamp
];
const CONTENT_H = 4000, VIEWPORT = 1000, GLIDE = 700;

t('scrollOffsetAt is 0 before the first stop fires', () => {
  assert.equal(scrollOffsetAt(scrollStops, 0, CONTENT_H, VIEWPORT, GLIDE), 0);
  assert.equal(scrollOffsetAt(scrollStops, 999, CONTENT_H, VIEWPORT, GLIDE), 0);
});

t('scrollOffsetAt clamps to contentHeight - viewport', () => {
  const y = scrollOffsetAt(scrollStops, 3000 + GLIDE, CONTENT_H, VIEWPORT, GLIDE);
  assert.equal(y, CONTENT_H - VIEWPORT, `expected the clamped max, got ${y}`);
});

t('scrollOffsetAt is monotonic while gliding between two stops', () => {
  let prev = -1;
  for (let ms = 1000; ms <= 1000 + GLIDE; ms += 50) {
    const y = scrollOffsetAt(scrollStops, ms, CONTENT_H, VIEWPORT, GLIDE);
    assert.ok(y >= prev - 1e-9, `offset went backwards at ms=${ms}: ${y} < ${prev}`);
    prev = y;
  }
});

/* -------------------------------------------------------------- event density */
t('eventDensity counts a beat plus each of its accents', () => {
  const beats = [{ accents: [{ t: .3, kind: 'zoom' as const }, { t: .7, kind: 'callout' as const }] },
                 { accents: [{ t: .5, kind: 'arrow' as const }] },
                 {}];
  const d = eventDensity(beats, 10_000);
  assert.equal(d.events, 3 + 3);
  assert.equal(d.perSecond, 0.6);
});

t('eventDensity catches the shape the old pipeline shipped', () => {
  // ten beats, two annotations, 89.1 seconds — what C01F used to be
  const before = eventDensity([...Array(8).fill({}), { accents: [{ t: .3, kind: 'arrow' as const }] },
                               { accents: [{ t: .3, kind: 'refline' as const }] }], 89_100);
  assert.ok(before.perSecond < DENSITY_FLOOR, `${before.perSecond.toFixed(3)} should fail the floor`);
  assert.ok(Math.abs(before.perSecond - 0.135) < 0.005, before.perSecond.toFixed(3));
});

t('eventDensity survives a zero-length timeline', () => {
  assert.equal(eventDensity([{}], 0).perSecond, 0);
});

t('accentProgress is 0 before it fires and 1 once landed', () => {
  const a = { t: 0.5, kind: 'callout' as const };
  assert.equal(accentProgress(a, 0.0), 0);
  assert.equal(accentProgress(a, 0.5), 0);
  assert.ok(accentProgress(a, 0.62) > 0.9, 'lands within its span');
  assert.equal(accentProgress(a, 1.0), 1);
});

t('the accent kinds are a closed set the writer picks from', () => {
  assert.deepEqual(ACCENT_KINDS, ['zoom', 'refline', 'callout', 'arrow', 'spotlight']);
});

/* ---------------------------------------------------------------- brief.ts */
const entity = (over: Partial<BriefEntity>): BriefEntity => ({
  id: '', name: '', first: '', last: '', pick: 5, total: 0, rank: 5, seasons_played: 8,
  series: [], awards: [], ...over,
});

t('detectMarkers finds the missed season for a synthetic entity', () => {
  const seasons = ['2019-20', '2020-21', '2021-22', '2022-23'];
  const zion = entity({
    id: 'z', total: 40, rank: 1, seasons_played: 3,
    series: [{ step: '2019-20', value: 10 }, { step: '2020-21', value: 20 }, { step: '2022-23', value: 40 }],
  });
  const missed = detectMarkers([zion], seasons).filter((m) => m.kind === 'missed-season');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].step, '2021-22');
});

t('detectMarkers flags leader for rank 1, undrafted for a null pick, short-career for 4 of 8 seasons', () => {
  const seasons = Array.from({ length: 8 }, (_, i) => `${2019 + i}-${String((20 + i) % 100).padStart(2, '0')}`);
  const leader = entity({ id: 'a', rank: 1, total: 500 });
  const undrafted = entity({ id: 'b', pick: null });
  const shortCareer = entity({ id: 'c', seasons_played: 4 });
  const markers = detectMarkers([leader, undrafted, shortCareer], seasons);
  assert.ok(markers.some((m) => m.entityId === 'a' && m.kind === 'leader'));
  assert.ok(markers.some((m) => m.entityId === 'b' && m.kind === 'undrafted'));
  assert.ok(markers.some((m) => m.entityId === 'c' && m.kind === 'short-career'));
  assert.ok(!markers.some((m) => m.entityId === 'a' && m.kind === 'undrafted'), 'a is drafted');
  assert.ok(!markers.some((m) => m.entityId === 'b' && m.kind === 'short-career'), 'b played all 8');
});

t('detectMarkers finds a jump at 3x the median delta, and none when deltas are flat', () => {
  const seasons = ['2019-20', '2020-21', '2021-22', '2022-23', '2023-24'];
  const jumpy = entity({
    id: 'j', total: 130, rank: 1, seasons_played: 5,
    series: [
      { step: '2019-20', value: 10 }, { step: '2020-21', value: 20 }, { step: '2021-22', value: 30 },
      { step: '2022-23', value: 60 },  // delta 30, 3x the median delta of 10
      { step: '2023-24', value: 70 },
    ],
  });
  const flat = entity({
    id: 'f', total: 50, rank: 2, seasons_played: 5,
    series: [
      { step: '2019-20', value: 10 }, { step: '2020-21', value: 20 }, { step: '2021-22', value: 30 },
      { step: '2022-23', value: 40 }, { step: '2023-24', value: 50 },
    ],
  });
  const markers = detectMarkers([jumpy, flat], seasons);
  const jump = markers.find((m) => m.entityId === 'j' && m.kind === 'jump');
  assert.ok(jump, 'expected a jump marker');
  assert.equal(jump!.step, '2022-23');
  assert.ok(!markers.some((m) => m.entityId === 'f' && m.kind === 'jump'), 'flat deltas should not jump');
});

t('allowedNumbers carries totals, series values, split years, and 1..12 — nothing invented', () => {
  const seasons = ['2019-20', '2020-21'];
  const e = entity({
    id: 'e', pick: 3, total: 999, rank: 1, seasons_played: 2,
    series: [{ step: '2019-20', value: 400 }, { step: '2020-21', value: 999 }],
    awards: [{ name: 'MVP', season: '2020-21' }],
  });
  const nums = new Set(allowedNumbers([e], seasons));
  assert.ok(nums.has(999) && nums.has(400) && nums.has(2019) && nums.has(2020));
  for (let i = 1; i <= 12; i++) assert.ok(nums.has(i), `missing ordinal ${i}`);
  assert.ok(!nums.has(999999), 'must not invent a number that appears nowhere');
});

t('STYLE_RULES is a fixed contract of exactly 7 rules', () => {
  assert.equal(STYLE_RULES.length, 7);
});

/* ---------------------------------------------------------------- verify.ts */
const miniBrief = {
  visual: {
    chart: 'cumulative-multiline', alternates: [], camera: 'static',
    accent_kinds: ACCENT_KINDS, anchor_steps: ['2019-20', '2020-21'],
    density: { floor: 0.3, ceiling: 1.0, target: 0.5 },
  },
  facts: {
    unit: 'points', as_of: '2020-21',
    entities: [
      entity({ id: 'p1', name: 'Alpha One', first: 'Alpha', last: 'One', total: 100 }),
      entity({ id: 'p2', name: 'Beta Two', first: 'Beta', last: 'Two', total: 50 }),
    ],
    markers: [], allowed_numbers: [50, 100, 200],
  },
  style: {
    voice: '', rules: STYLE_RULES, duration_s: [40, 95] as [number, number], beats: [2, 2] as [number, number],
    ending_variants: ['thesis', 'hard-cut', 'open-question'] as const,
    forbidden: [],
  },
} as unknown as WriterBrief;

t('verifyDraft returns [] for a hand-built clean draft', () => {
  const draft = {
    title: 'test',
    beats: [
      { text: 'Alpha One leads the class, but Beta Two trails by only 50 points.', entityId: 'p1',
        accents: [{ t: 0.3, kind: 'spotlight' as const, at: { entityId: 'p1' } },
                  { t: 0.7, kind: 'callout' as const, at: { entityId: 'p1' }, text: '100' }] },
      { text: 'Then Beta Two closes the gap, and finishes at 200 points.', entityId: 'p2',
        accents: [{ t: 0.4, kind: 'zoom' as const, at: { entityId: 'p2' } },
                  { t: 0.8, kind: 'refline' as const, at: { entityId: 'p2', step: '2020-21' }, text: '200' }],
        ending: 'open-question' as const },
    ],
  };
  assert.deepEqual(verifyDraft(draft, miniBrief), []);
});

t('verifyDraft flags fabricated numbers, unknown entities, bad accent kinds, a nameless hook, a missing ending, and run-ons', () => {
  const beat = (over: any) => ({
    text: 'Alpha One scored 50 points, and it mattered.', entityId: 'p1',
    accents: [{ t: 0.3, kind: 'spotlight' as const }, { t: 0.7, kind: 'callout' as const }],
    ending: 'thesis' as const, ...over,
  });
  const draft = (over: any) => ({ title: 't', beats: [beat(over)] });

  assert.ok(verifyDraft(draft({ text: 'Alpha One scored 999999 points, and it was huge.' }), miniBrief)
    .some((v) => v.rule === 'fabricated-number'));
  assert.ok(verifyDraft(draft({ entityId: 'nope' }), miniBrief).some((v) => v.rule === 'unknown-entity'));
  assert.ok(verifyDraft(draft({ accents: [{ t: 0.3, kind: 'explode' as any }, { t: 0.7, kind: 'callout' as const }] }), miniBrief)
    .some((v) => v.rule === 'accent-kind'));
  assert.ok(verifyDraft(draft({ text: 'Nobody here scored 50 points, and it mattered.' }), miniBrief)
    .some((v) => v.rule === 'hook'));
  assert.ok(verifyDraft(draft({ ending: undefined }), miniBrief).some((v) => v.rule === 'ending'));
  assert.ok(verifyDraft(draft({ text: 'Alpha One scored 50 points. And it mattered.' }), miniBrief)
    .some((v) => v.rule === 'one-sentence'));
});

/* --------------------------------------------------- content/ledger.ts, discover.ts */

t('isBurned flags a re-skin (youcom_scout.py is_burned docstring example)', () => {
  // The docstring's own paraphrase ("hulk pure fistfight") shares only "hulk"
  // with the question — 1 of 3 tokens, short of the 60% floor either way. It
  // was always illustrative prose, not a literal computed example (nothing
  // in comic-book-pipeline actually asserts on it). Restoring the words the
  // paraphrase dropped reproduces the same re-skin it describes.
  assert.notEqual(isBurned('Who beat the Hulk barehanded', ['Who beat the Hulk in a pure fistfight']), null);
});

t('isBurned does not flag a sibling', () => {
  assert.equal(isBurned('who lifted Mjolnir', ['who shattered Mjolnir']), null);
});

t('isBurned uses the SHORTER side for containment (ported 2026-08-05 miss)', () => {
  assert.notEqual(
    isBurned(
      "Which Spider-Man villains or symbiotes have bypassed or been immune to Spider-Man's spider-sense?",
      ["What has gotten past Spider-Man's spider-sense?"]
    ),
    null
  );
});

t('slugify lowercases, dashes punctuation, and caps length', () => {
  assert.equal(slugify('Is Jaylen Brown actually worth his contract?'), 'is-jaylen-brown-actually-worth-his-contract');
});

// CONTENT_ROOT stands in for the whole content/ directory, not just
// sessions/ — so a test pointing at a tmp dir needs its own copy of the
// static policy files too (angles.json here), same as the real content/.
const withTmpContentRoot = (fn: () => void) => {
  const tmp = mkdtempSync(join(tmpdir(), 'sport-analytic-content-'));
  writeFileSync(join(tmp, 'angles.json'), JSON.stringify(angles));
  const prev = process.env.CONTENT_ROOT;
  process.env.CONTENT_ROOT = tmp;
  try {
    fn();
  } finally {
    process.env.CONTENT_ROOT = prev;
    rmSync(tmp, { recursive: true, force: true });
  }
};

t('nextAngle rotates by the count of sessions already on disk', () => {
  withTmpContentRoot(() => {
    assert.equal(nextAngle('evergreen'), angles.evergreen[0]);
    createSession({ lanes: ['evergreen'] });
    assert.equal(nextAngle('evergreen'), angles.evergreen[1]);
    createSession({ lanes: ['evergreen'] });
    assert.equal(nextAngle('evergreen'), angles.evergreen[2]);
  });
});

t('ledger append/read round-trips a record; digestLines includes accepted, excludes candidate', () => {
  withTmpContentRoot(() => {
    const gates = {
      g0_burned: 'pass', g1_real_question: 'pass',
      g3_data_available: 'pending', g4_chart_fit: 'pending',
    } as const;
    const accepted: LedgerRecord = {
      id: 'a1', question: 'Is this accepted question real?', status: 'accepted', lane: 'evergreen',
      angle: 'chase', entities: [], evidence: [], gates, session: 's1',
      at: new Date().toISOString(), note: '', recheck_after: null,
    };
    appendLedger(accepted);
    assert.deepEqual(readLedger(), [accepted]);

    const candidate: LedgerRecord = { ...accepted, id: 'c1', question: 'Is this a candidate question?', status: 'candidate' };
    appendLedger(candidate);
    const lines = digestLines();
    assert.ok(lines.includes(accepted.question));
    assert.ok(!lines.includes(candidate.question));
  });
});

/* ------------------------------------------------------------- content/gates.ts */

const hit = (title: string, url = 'https://youtube.com/watch?v=x'): TavilyHit => ({ title, url });

t('judgeSameFormat reports the real case: containment 1.00 — no verdict, just the score and hit', () => {
  const r = judgeSameFormat('2019 NBA Draft - Total Points Scored', [hit('2019 NBA Draft - Total Points Scored - YouTube')]);
  assert.equal((r as any).verdict, undefined);
  assert.equal(r.topTitle, '2019 NBA Draft - Total Points Scored - YouTube');
  assert.ok(r.score !== undefined && Math.abs(r.score - 1) < 1e-9, `score=${r.score}`);
});

t('judgeSameFormat scores a domain-filler collision at exactly 0.60 — reported, not banded', () => {
  // shared tokens are draft/points/scored — filler in nearly every NBA stats
  // title, not evidence this is the SAME video. Since this is informational
  // only now (never blocks Accept), there is no band to misfire: the score
  // and title are just reported for a human to read.
  const r = judgeSameFormat('2019 NBA Draft - Total Points Scored', [
    hit('He Scored 138 Points in ONE GAME... Why Did NO ONE Draft Him?'),
  ]);
  assert.ok(r.score !== undefined && Math.abs(r.score - 0.6) < 1e-9, `score=${r.score}`);
  assert.equal(r.topTitle, 'He Scored 138 Points in ONE GAME... Why Did NO ONE Draft Him?');
});

t('judgeSameFormat still reports a hit at a modest containment (0.40) — no pass/fail floor anymore', () => {
  const r = judgeSameFormat('2019 NBA Draft - Total Points Scored', [
    hit('NBA Draft 2019: Draft Grades, Winners, Losers & Complete Results'),
  ]);
  assert.ok(r.score !== undefined && Math.abs(r.score - 0.4) < 1e-9, `score=${r.score}`);
  assert.equal(r.topTitle, 'NBA Draft 2019: Draft Grades, Winners, Losers & Complete Results');
});

t('judgeSameFormat returns no hit on zero results', () => {
  const r = judgeSameFormat('anything', []);
  assert.equal(r.checked, 0);
  assert.equal(r.topTitle, undefined);
  assert.equal(r.score, undefined);
});

t('judgeSameFormat strips both " - YouTube" and " | YouTube" before scoring', () => {
  const q = '2019 NBA Draft - Total Points Scored';
  const a = judgeSameFormat(q, [hit('2019 NBA Draft - Total Points Scored - YouTube')]);
  const b = judgeSameFormat(q, [hit('2019 NBA Draft - Total Points Scored | YouTube')]);
  assert.ok(a.score !== undefined && Math.abs(a.score - 1) < 1e-9, `score=${a.score}`);
  assert.ok(b.score !== undefined && Math.abs(b.score - 1) < 1e-9, `score=${b.score}`);
});

t('inferMeasure: totals vs per-game phrasing, and the advanced-measure miss', () => {
  assert.deepEqual(inferMeasure('One chart of total career points'), { label: 'PTS', espnLabel: 'PTS', category: 'totals' });
  assert.deepEqual(inferMeasure('compare their points per game'), { label: 'PTS', espnLabel: 'PTS', category: 'averages' });
  assert.equal(inferMeasure('blocks and rim deterrence').espnLabel, 'BLK');
  assert.deepEqual(inferMeasure('games played as a share of 82'), { label: 'GP', espnLabel: 'GP', category: 'averages' });
  assert.equal(inferMeasure('on/off net rating and usage rate, true shooting').espnLabel, null);
});

t('inferMeasure is first-match-wins and case-insensitive', () => {
  // "points" is checked before "rebound" — a question naming both settles on PTS.
  assert.equal(inferMeasure('POINTS AND REBOUNDS, who wins?').espnLabel, 'PTS');
  assert.equal(inferMeasure('Rebounds and Assists').espnLabel, 'REB');
});

/* --------------------------------------------- tts/chatterbox.ts: seed + cache */

/** 24kHz mono 16-bit RIFF wav, just long enough for wavDurationSec to read back. */
const tinyWav = (path: string, sec: number, sr = 24000) => {
  const dataSize = Math.round(sec * sr) * 2;   // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  writeFileSync(path, buf);
};

t('cacheKey changes when text changes', () => {
  assert.notEqual(cacheKey({ text: 'hello', seed: 1 }, {}), cacheKey({ text: 'goodbye', seed: 1 }, {}));
});

t('cacheKey changes when seed changes', () => {
  assert.notEqual(cacheKey({ text: 'hello', seed: 1 }, {}), cacheKey({ text: 'hello', seed: 2 }, {}));
});

t('cacheKey changes when exaggeration changes', () => {
  assert.notEqual(
    cacheKey({ text: 'hello', seed: 1 }, { exaggeration: 0.5 }),
    cacheKey({ text: 'hello', seed: 1 }, { exaggeration: 0.9 }),
  );
});

t('cacheKey depends only on its own inputs, never on chunk position', () => {
  const a = cacheKey({ text: 'hello', seed: 7 }, { exaggeration: 0.6 });
  const b = cacheKey({ text: 'hello', seed: 7 }, { exaggeration: 0.6 });
  assert.equal(a, b);
});

t('cacheKey changes with the voice file CONTENT, not its path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tts-voice-'));
  try {
    const voiceA = join(dir, 'a.wav');
    const voiceB = join(dir, 'b.wav');
    const voiceACopy = join(dir, 'a-copy.wav');
    writeFileSync(voiceA, Buffer.from([1, 2, 3, 4]));
    writeFileSync(voiceB, Buffer.from([9, 9, 9, 9]));
    writeFileSync(voiceACopy, Buffer.from([1, 2, 3, 4]));   // same bytes, different path
    const kA = cacheKey({ text: 'hi', seed: 1 }, { voiceWav: voiceA });
    const kB = cacheKey({ text: 'hi', seed: 1 }, { voiceWav: voiceB });
    const kACopy = cacheKey({ text: 'hi', seed: 1 }, { voiceWav: voiceACopy });
    assert.notEqual(kA, kB, 'different voice bytes must change the key');
    assert.equal(kA, kACopy, 'same voice bytes at a different path must not change the key');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const at = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); n++; console.log(`  ok   ${name}`); }
  catch (e: any) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const withTmpCache = async (fn: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(join(tmpdir(), 'tts-cache-'));
  const prev = process.env.TTS_CACHE_DIR;
  process.env.TTS_CACHE_DIR = dir;
  try { await fn(dir); }
  finally { process.env.TTS_CACHE_DIR = prev; rmSync(dir, { recursive: true, force: true }); }
};

await at('synthesize never calls the worker when every chunk is already cached', async () => {
  await withTmpCache(async (dir) => {
    const chunks = [
      { text: 'First sentence.', beatIndex: 0 },
      { text: 'Second sentence.', beatIndex: 0 },
    ];
    chunks.forEach((c, i) => {
      const key = cacheKey({ text: c.text, seed: 1000 + i }, {});
      tinyWav(join(dir, `${key}.wav`), 0.5);
    });
    let called = false;
    const res = await synthesize(chunks, { runWorker: async () => { called = true; } });
    assert.equal(called, false, 'worker must not be spawned on an all-hit cache');
    assert.ok(res.perChunk.every((c) => c.cached), 'every chunk should be reported cached');
  });
});

await at('synthesize calls the worker with exactly the missing chunk', async () => {
  await withTmpCache(async (dir) => {
    const chunks = [
      { text: 'Already cached.', beatIndex: 0 },
      { text: 'Needs synthesis.', beatIndex: 0 },
    ];
    const key0 = cacheKey({ text: chunks[0].text, seed: 1000 }, {});
    tinyWav(join(dir, `${key0}.wav`), 0.4);
    let job!: WorkerJob;   // definite-assignment: set by the stub below before we read it
    await synthesize(chunks, {
      runWorker: async (j) => {
        job = j;
        // stand in for the python worker: it always mkdir -p's out_dir itself
        mkdirSync(j.out_dir, { recursive: true });
        tinyWav(join(j.out_dir, `${j.chunks[0].key}.wav`), 0.3);
      },
    });
    assert.ok(job, 'worker should have been called');
    assert.equal(job.chunks.length, 1, 'only the missing chunk should be sent to the worker');
    assert.equal(job.chunks[0].key, cacheKey({ text: chunks[1].text, seed: 1001 }, {}));
  });
});

/* ------------------------------------------------------------------ hoopr.ts */

t('normaliseName collides an accent: "Jan Veselý" and "Jan Vesely"', () => {
  assert.equal(normaliseName('Jan Veselý'), normaliseName('Jan Vesely'));
});

t('normaliseName does NOT collide a generation suffix any more — "Kelly Oubre Jr." and "Kelly Oubre" are DIFFERENT keys', () => {
  // Reversed from the original spec: dropping the suffix on the INDEX side
  // is exactly the bug that let "Tim Hardaway" resolve to the son's total
  // and "Gary Payton II" resolve to the father's. The source data already
  // distinguishes these two people; normaliseName must not erase that.
  assert.notEqual(normaliseName('Kelly Oubre Jr.'), normaliseName('Kelly Oubre'));
});

t('normaliseName does NOT collide a generation suffix any more — "Gary Payton II" and "Gary Payton" are DIFFERENT keys', () => {
  assert.notEqual(normaliseName('Gary Payton II'), normaliseName('Gary Payton'));
});

t('normaliseName does NOT collide "Jaren Jackson Jr." and "Jaren Jackson Sr." — father and son must stay distinct keys', () => {
  assert.notEqual(normaliseName('Jaren Jackson Jr.'), normaliseName('Jaren Jackson Sr.'));
});

t('normaliseName does not collide two genuinely different names', () => {
  assert.notEqual(normaliseName('LeBron James'), normaliseName('Kevin Durant'));
  assert.notEqual(normaliseName('Jan Vesely'), normaliseName('Jimmer Fredette'));
});

t('stripSuffix maps "Kelly Oubre Jr." and "Kelly Oubre" to the SAME stripped key', () => {
  // This is where suffix-insensitivity now lives: a fallback LOOKUP key,
  // never the index's own key.
  assert.equal(stripSuffix(normaliseName('Kelly Oubre Jr.')), stripSuffix(normaliseName('Kelly Oubre')));
});

t('stripSuffix maps "Gary Payton II" and "Gary Payton" to the same stripped key, and leaves a no-suffix name unchanged', () => {
  assert.equal(stripSuffix(normaliseName('Gary Payton II')), stripSuffix(normaliseName('Gary Payton')));
  assert.equal(stripSuffix(normaliseName('Kevin Durant')), normaliseName('Kevin Durant'));
});

const mkTotals = (id: string, name: string, games: number): PlayerTotals => ({ id, name, points: games * 10, games, seasons: [2013] });

t('resolveName returns an exact key hit directly, without touching the stripped fallback', () => {
  const index = new Map([[normaliseName('Tim Hardaway'), mkTotals('301', 'Tim Hardaway', 87)],
                          [normaliseName('Tim Hardaway Jr.'), mkTotals('2528210', 'Tim Hardaway Jr.', 686)]]);
  assert.equal(resolveName('Tim Hardaway', index)!.id, '301');
  assert.equal(resolveName('Tim Hardaway Jr.', index)!.id, '2528210');
});

t('resolveName falls back to the stripped key when exactly one candidate matches (a genuine spelling gap)', () => {
  const index = new Map([[normaliseName('Kelly Oubre Jr.'), mkTotals('3133603', 'Kelly Oubre Jr.', 574)]]);
  // Query has no suffix at all, and the index only knows the Jr. spelling —
  // exactly the "Kelly Oubre Jr." vs "Kelly Oubre" gap this fallback exists for.
  const r = resolveName('Kelly Oubre', index);
  assert.equal(r!.id, '3133603');
});

t('resolveName REFUSES (returns null) and records an ambiguous entry when the stripped key has two candidates — never guesses by games', () => {
  ambiguous.length = 0;
  const index = new Map([[normaliseName('Gary Payton'), mkTotals('640', 'Gary Payton', 491)],
                          [normaliseName('Gary Payton II'), mkTotals('3134903', 'Gary Payton II', 192)]]);
  // Neither exact spelling in the index — "Gary Payton Sr." strips to "gary
  // payton", which matches BOTH the father's and the son's stripped keys.
  // This is the exact failure mode reported live: the old code silently
  // returned the father's (higher-games) total for a query like this.
  const ambiguousQuery = 'Gary Payton Sr.';
  const r = resolveName(ambiguousQuery, index);
  assert.equal(r, null, 'must refuse rather than pick the one with more games');
  assert.equal(ambiguous.length, 1);
  assert.equal(ambiguous[0].query, ambiguousQuery);
  assert.equal(ambiguous[0].candidates.length, 2);
  assert.deepEqual(new Set(ambiguous[0].candidates.map((c) => c.id)), new Set(['640', '3134903']));
});

const boxRow = (over: Partial<BoxRow>): BoxRow => ({
  athlete_id: 1, athlete_display_name: 'Test Player', points: 10, season: 2013, season_type: 2, ...over,
});

t('aggregateBox excludes postseason rows (season_type !== 2)', () => {
  const rows = [boxRow({ points: 10, season_type: 2 }), boxRow({ points: 999, season_type: 3 })];
  const out = aggregateBox(rows);
  assert.equal(out.get('1')!.points, 10);
  assert.equal(out.get('1')!.games, 1);
});

t('aggregateBox counts a null points row as 0, not a skip', () => {
  const rows = [boxRow({ points: 10 }), boxRow({ points: null })];
  const out = aggregateBox(rows);
  assert.equal(out.get('1')!.points, 10);
  assert.equal(out.get('1')!.games, 2, 'a null-points row still counts as a game played');
});

t('aggregateBox games counts ROWS, not distinct seasons (a mid-season trade is two rows in one season)', () => {
  const rows = [
    boxRow({ season: 2013, points: 5 }),
    boxRow({ season: 2013, points: 7 }),   // same season, second team after a trade
    boxRow({ season: 2014, points: 3 }),
  ];
  const out = aggregateBox(rows);
  assert.equal(out.get('1')!.games, 3, 'three rows, even though only two distinct seasons');
  assert.equal(out.get('1')!.points, 15);
});

t('aggregateBox keeps the most frequent display-name spelling', () => {
  const rows = [
    boxRow({ athlete_display_name: 'Jimmer Fredette' }),
    boxRow({ athlete_display_name: 'Jimmer Fredette' }),
    boxRow({ athlete_display_name: 'Jimmer Fredete' }),   // one-off typo, must lose
  ];
  const out = aggregateBox(rows);
  assert.equal(out.get('1')!.name, 'Jimmer Fredette');
});

t('aggregateBox returns a sorted, deduplicated seasons list', () => {
  const rows = [
    boxRow({ season: 2015 }), boxRow({ season: 2013 }),
    boxRow({ season: 2014 }), boxRow({ season: 2013 }),   // 2013 twice (trade), must not duplicate
  ];
  const out = aggregateBox(rows);
  assert.deepEqual(out.get('1')!.seasons, [2013, 2014, 2015]);
});

t('aggregateBox keeps different athlete ids separate', () => {
  const rows = [boxRow({ athlete_id: 1, points: 10 }), boxRow({ athlete_id: 2, points: 20 })];
  const out = aggregateBox(rows);
  assert.equal(out.size, 2);
  assert.equal(out.get('1')!.points, 10);
  assert.equal(out.get('2')!.points, 20);
});

console.log(`\n${n} assertions passed.`);
