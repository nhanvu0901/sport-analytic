/** Plain assertions, no framework. `npm test`. */
import assert from 'node:assert/strict';
import { seasonRows, seasonTeams, cumulate } from '../src/espn';
import { scaleLinear, niceTicks, fitRows, binGrid, countRadius, ensureContrast, contrastRatio, pathAt, arcFractions, easeOut, rankPair, gridFit, waffleLayout, thinLabels, type Pt } from '../src/scale';
import teams from '../src/data/teams.json';
import { eventDensity, DENSITY_FLOOR, DENSITY_CEILING, accentProgress, accentSpan, ACCENT_KINDS, ACCENT_LAND_MS, MIN_ACCENT_GAP } from '../src/accent';
import { driftStats, matchAccent, parseSrt, snapDraft, spaceAccents, spanValue, stepYears, type Word } from '../src/sync';
import { scrollOffsetAt, revealExtentAt, type ScrollStop, type Beat } from '../src/motion';
import { detectMarkers, allowedNumbers, STYLE_RULES, assembleBrief, normaliseStep, computeAccentBudget, expressibleMarkers, EXPRESSIBLE_MARKERS, type BriefEntity, type BriefInput, type BriefRecord, type Marker, type WriterBrief } from '../src/brief';
import { CAREER_RECORDS, namesRecord, recordChaseFor, recordFor } from '../src/records';
import { deriveHookSeed, seasonUnion, seriesVerdict } from '../src/candidateBrief';
import { verifyDraft, parseDraftText, WORDS_PER_SECOND, type Draft } from '../src/verify';

import { renderBriefMd } from '../src/briefMd';
import { draftToScriptLines } from '../src/scripts';
import { asDraft, narratesDraft, separatorExample } from '../src/drafts';
import { asTimeline } from '../src/timeline';
import { compositionIdFor, isWired, videoDataFrom, WIRED_CHARTS } from '../src/videoData';
import { teamBySlug, teamChanges, teamSlug, teamsNamedIn } from '../src/teams';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendLedger, digestLines, isBurned, latestById, readLedger, slugify } from '../src/content/ledger';
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

t('thinLabels keeps every label when they fit, and samples them when they do not', () => {
  // C01: 8 season ticks across the court theme's 716px plot — 102px apart, all fit.
  assert.deepEqual(thinLabels(8, 716), new Array(8).fill(true));
  // A 23-season career chase: 24 ticks, 31px apart. Every third, and the last.
  const mask = thinLabels(24, 716);
  assert.equal(mask.length, 24);
  assert.equal(mask[0], true);
  assert.equal(mask[23], true, 'the right end carries the career total and must stay labelled');
  assert.equal(mask[1], false);
  assert.equal(mask[21], false, 'the stride label two ticks from the end would crowd it');
  assert.ok(mask.filter(Boolean).length <= 8, `${mask.filter(Boolean).length} labels is still too many`);
  assert.deepEqual(thinLabels(1, 716), [true]);
  assert.deepEqual(thinLabels(0, 716), []);
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

/* --------------------------------------------- arcFractions / revealExtentAt */

t('arcFractions is the inverse of pathAt: every vertex sits at its own fraction', () => {
  const pts: Pt[] = [[0, 0], [100, 0], [100, 300], [140, 300]];
  const fr = arcFractions(pts);
  assert.equal(fr[0], 0);
  assert.equal(fr[fr.length - 1], 1);
  pts.forEach((p, i) => {
    const head = pathAt(pts, fr[i]).head;
    assert.ok(Math.hypot(head[0] - p[0], head[1] - p[1]) < 1e-9,
      `vertex ${i} resolved to ${head} not ${p}`);
  });
  // arc length, not vertex index: the 300px leg is most of the line
  assert.ok(fr[2] > 0.8, `expected the long leg to dominate, got ${fr[2]}`);
});

/**
 * A record chase: ONE entity carries every beat. This is the shape that broke —
 * the reveal used progress within the current beat, so the single line redrew
 * itself from zero at all eight beat boundaries.
 */
const stepAt = (s: string | number) =>
  ({ A: 0.25, B: 0.5, C: 0.75, D: 1 } as Record<string, number>)[String(s)] ?? null;
const call = (step?: string, record?: true) => [{
  t: 0.5, kind: 'callout' as const,
  at: { entityId: 'lbj', ...(step ? { step } : {}), ...(record ? { record } : {}) },
  text: 'x',
}];
const chase: Beat[] = [
  { entityId: 'lbj', startMs: 0, endMs: 1000, accents: call('A') },
  { entityId: 'lbj', startMs: 1000, endMs: 2000, accents: call(undefined, true) },
  { entityId: 'lbj', startMs: 2000, endMs: 3000, accents: call('B') },
  { entityId: 'lbj', startMs: 3000, endMs: 4000, accents: call('A') },
  { entityId: 'lbj', startMs: 4000, endMs: 5000, accents: call('C') },
];
const chaseAt = (ms: number) => revealExtentAt(chase, 'lbj', ms, stepAt);

t('revealExtentAt draws a chase up to the step its accents anchor', () => {
  assert.equal(chaseAt(0), 0, 'nothing drawn at the first frame');
  assert.ok(Math.abs(chaseAt(680) - 0.25) < 1e-9, `expected 0.25 by the end of the ramp, got ${chaseAt(680)}`);
  assert.ok(Math.abs(chaseAt(999) - 0.25) < 1e-9, 'and it RESTS there for the rest of the beat');
  assert.ok(Math.abs(chaseAt(2999) - 0.5) < 1e-9, `beat 3 anchors B, got ${chaseAt(2999)}`);
});

t('revealExtentAt holds the extent through a beat that anchors no step', () => {
  // beat 2 carries only a `record: true` anchor — the record LINE, which says
  // nothing about how far the series has got.
  for (let ms = 1000; ms < 2000; ms += 50) {
    assert.ok(Math.abs(chaseAt(ms) - 0.25) < 1e-9, `beat 2 moved the line at ms=${ms}: ${chaseAt(ms)}`);
  }
});

t('revealExtentAt never travels backwards, even when a later beat anchors an earlier step', () => {
  // beat 4 anchors A again, behind B
  assert.ok(Math.abs(chaseAt(3999) - 0.5) < 1e-9, `expected the running maximum, got ${chaseAt(3999)}`);
  let prev = -1;
  for (let ms = 0; ms <= 5200; ms += 25) {
    const e = chaseAt(ms);
    assert.ok(e >= prev - 1e-9, `the line redrew itself at ms=${ms}: ${e} < ${prev}`);
    prev = e;
  }
});

t('revealExtentAt completes the line on the last beat of a run', () => {
  assert.equal(chaseAt(4999), 1, 'the narration must not walk away from a half-drawn career');
  assert.equal(chaseAt(9999), 1, 'and it stays complete past the end');
});

/** A race: each beat introduces a DIFFERENT entity. This behaviour must not
 *  change — each series sweeps in once, in its own beat. */
const race: Beat[] = [
  { entityId: 'a', startMs: 0, endMs: 1000, accents: [{ t: 0.5, kind: 'callout', at: { entityId: 'a', step: 'A' }, text: '1' }] },
  { entityId: 'b', startMs: 1000, endMs: 2000, accents: [{ t: 0.5, kind: 'callout', at: { entityId: 'b', step: 'A' }, text: '2' }] },
  { entityId: 'a', startMs: 2000, endMs: 3000, accents: [{ t: 0.5, kind: 'callout', at: { entityId: 'a', step: 'B' }, text: '3' }] },
];

t('revealExtentAt sweeps a race entity to its full career inside its own beat', () => {
  assert.equal(revealExtentAt(race, 'a', 0, stepAt), 0);
  assert.ok(revealExtentAt(race, 'a', 340, stepAt) > 0.4, 'and it is visibly moving while it does');
  assert.equal(revealExtentAt(race, 'a', 680, stepAt), 1, 'full by the end of the ramp, as before');
  assert.equal(revealExtentAt(race, 'b', 1680, stepAt), 1);
  assert.equal(revealExtentAt(race, 'b', 500, stepAt), 0, 'and nothing is drawn before its beat');
});

t('revealExtentAt does not restart a series that becomes active a second time', () => {
  for (let ms = 2000; ms <= 3000; ms += 50) {
    assert.equal(revealExtentAt(race, 'a', ms, stepAt), 1, `series a redrew itself at ms=${ms}`);
  }
});

t('revealExtentAt grows linearly when no beat anchors a step at all', () => {
  const bare: Beat[] = [0, 1, 2, 3].map((i) => ({
    entityId: 'lbj', startMs: i * 1000, endMs: i * 1000 + 1000,
    accents: [{ t: 0.5, kind: 'zoom' as const, at: { entityId: 'lbj' } }],
  }));
  const at = (ms: number) => revealExtentAt(bare, 'lbj', ms, stepAt);
  assert.ok(Math.abs(at(999) - 0.25) < 1e-9, `expected a quarter after beat 1, got ${at(999)}`);
  assert.ok(Math.abs(at(1999) - 0.5) < 1e-9, `expected a half after beat 2, got ${at(1999)}`);
  assert.ok(Math.abs(at(2999) - 0.75) < 1e-9, `expected three quarters after beat 3, got ${at(2999)}`);
  assert.equal(at(3999), 1);
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
  assert.equal(accentProgress(a, 0.0, 8000), 0);
  assert.equal(accentProgress(a, 0.5, 8000), 0);
  assert.ok(accentProgress(a, 0.62, 8000) > 0.9, 'lands within its span');
  assert.equal(accentProgress(a, 1.0, 8000), 1);
});

/**
 * Bug B: the landing span used to be 0.22 of the BEAT, so in this video's
 * 7.1-10.2s beats an accent took 1.56-2.25s to become visible and was still
 * fading up long after its word had been spoken.
 */
t('the accent landing span is wall-clock, not a share of the beat', () => {
  const a = { t: 0.5, kind: 'callout' as const };
  // the ms at which the accent is fully landed, measured through the function
  const landedMs = (beatMs: number) => {
    for (let ms = 0; ms <= beatMs; ms++) {
      if (accentProgress(a, ms / beatMs, beatMs) >= 1) return ms;
    }
    return Infinity;
  };
  for (const beatMs of [7080, 8360, 10240]) {
    const took = landedMs(beatMs) - 0.5 * beatMs;
    assert.ok(Math.abs(took - ACCENT_LAND_MS) <= 2,
      `a ${beatMs}ms beat took ${took}ms to land, expected ${ACCENT_LAND_MS}ms`);
    // what it used to be, for the record
    assert.ok(0.22 * beatMs > 1500, 'the old beat-relative span really was over 1.5s');
  }
  assert.ok(Math.abs(accentSpan(7000) - 0.05) < 1e-9, 'and the beat fraction comes from the beat');
  assert.equal(accentSpan(0), 1, 'a zero-length beat cannot crawl');
});

t('an accent snapped to the last word of a beat still lands', () => {
  // t + span > 1: interpolate needs a strictly increasing range, so this used
  // to be a crash waiting for a late accent.
  const a = { t: 1, kind: 'callout' as const };
  assert.equal(accentProgress(a, 0.99, 8000), 0);
  assert.equal(accentProgress(a, 1, 8000), 1);
});

t('the accent kinds are a closed set the writer picks from', () => {
  assert.deepEqual(ACCENT_KINDS, ['zoom', 'refline', 'callout', 'arrow', 'spotlight', 'span']);
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

t('STYLE_RULES is a fixed contract of exactly 7 rules, and the accent rule defers to the budget', () => {
  assert.equal(STYLE_RULES.length, 7);
  const accentRule = STYLE_RULES.find((r) => r.includes('accent_budget'));
  assert.ok(accentRule, 'one rule must point at visual.accent_budget');
  // "2 or 3 accents" is arithmetically impossible at the top of the beat
  // range (12 beats x 2 = 36 events at the 70s target, 0.514/s), so the
  // contract must not state a fixed per-beat count at all.
  assert.ok(!/2 or 3/.test(accentRule!), `rule must not restate a fixed per-beat count: ${accentRule}`);
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

/* A season label is ONE token, not two numbers. The tokeniser used to split
 * "2021-22" into "2021" (allowed, it is a season year) and "22" (not
 * allowed), and rejected a valid draft for a number it never wrote. The fix
 * must not soften the real check, so the same beat also carries a genuine
 * fabrication: exactly one violation, and it names the fabrication. */
const seasonBrief = {
  ...miniBrief,
  visual: { ...miniBrief.visual, anchor_steps: ['2019-20', '2020-21', '2021-22'] },
} as unknown as WriterBrief;

t('a season label is one token: "2021-22" passes while a fabricated "9,999" beside it still fires exactly once', () => {
  const draft = {
    title: 'test',
    beats: [
      { text: 'Alpha One leads the class in 2021-22, but Beta Two trails by only 9,999 points.', entityId: 'p1',
        accents: [{ t: 0.3, kind: 'spotlight' as const, at: { entityId: 'p1' } },
                  { t: 0.7, kind: 'callout' as const, at: { entityId: 'p1' }, text: '100' }] },
      { text: 'Then Beta Two closes the gap, and finishes at 200 points.', entityId: 'p2',
        accents: [{ t: 0.4, kind: 'zoom' as const, at: { entityId: 'p2' } },
                  { t: 0.8, kind: 'refline' as const, at: { entityId: 'p2', step: '2020-21' }, text: '200' }],
        ending: 'open-question' as const },
    ],
  };
  const v = verifyDraft(draft, seasonBrief);
  assert.equal(v.length, 1, `expected exactly one violation, got ${JSON.stringify(v)}`);
  assert.equal(v[0].rule, 'fabricated-number');
  assert.ok(v[0].detail.includes('9,999'), `the violation must name the fabricated number, got: ${v[0].detail}`);
  // And a season the brief does not carry is still caught as a season.
  const bogus = verifyDraft({ ...draft, beats: [{ ...draft.beats[0], text: 'Alpha One leads the class in 1996-97, and Beta Two trails.' }, draft.beats[1]] }, seasonBrief);
  assert.ok(bogus.some((x) => x.rule === 'fabricated-number' && x.detail.includes('1996-97')),
    `an unknown season label must still be rejected, got ${JSON.stringify(bogus)}`);
});

/* ------------------------------------------------ verify.ts: team-era
 * The chart draws a team logo at every season the team changes, so an
 * anchored step states an era whether the sentence agrees with it or not. A
 * real draft said "Cleveland" over an anchored 2013-14 that the picture drew
 * as Miami; these pin the rule that now rejects that. */
const eraBrief = {
  ...miniBrief,
  facts: {
    ...miniBrief.facts,
    entities: [
      entity({
        id: 'p1', name: 'Alpha One', first: 'Alpha', last: 'One', total: 100,
        series: [{ step: '2019-20', value: 50, team: 'cleveland-cavaliers' },
                 { step: '2020-21', value: 100, team: 'miami-heat' }],
      }),
      entity({ id: 'p2', name: 'Beta Two', first: 'Beta', last: 'Two', total: 50 }),
    ],
  },
} as unknown as WriterBrief;

/** One beat, one accent — every case below differs only in what the sentence
 *  says and which season it anchors. Violations are filtered to `team-era`
 *  because a single beat also trips `beat-count` against miniBrief's [2,2]. */
const eraViolations = (text: string, step: string | undefined, brief = eraBrief) =>
  verifyDraft({
    title: 't',
    beats: [{
      text, entityId: 'p1', ending: 'thesis' as const,
      accents: [{ t: 0.5, kind: 'spotlight' as const, at: { entityId: 'p1', ...(step ? { step } : {}) } }],
    }],
  }, brief).filter((v) => v.rule === 'team-era');

t('teamsNamedIn resolves a city, a nickname and a short form to the same slug', () => {
  assert.deepEqual(teamsNamedIn('Alpha One arrives in Cleveland'), ['cleveland-cavaliers']);
  assert.deepEqual(teamsNamedIn('Alpha One arrives with the Cavaliers'), ['cleveland-cavaliers']);
  assert.deepEqual(teamsNamedIn('Alpha One arrives with the Cavs'), ['cleveland-cavaliers']);
  assert.deepEqual(teamsNamedIn('nothing in this sentence names a franchise'), []);
  // ESPN spells one LA team "LA Clippers" and the other "Los Angeles Lakers",
  // so both spellings name both teams — safe, because the rule passes on ANY
  // match and a Lakers beat must not be convicted of naming the Clippers.
  assert.ok(teamsNamedIn('Alpha One moves to LA').includes('los-angeles-lakers'));
});

t('team-era catches a beat that names one team while anchoring another team\'s season', () => {
  const v = eraViolations('Alpha One thrives in Cleveland, and the total keeps climbing.', '2020-21');
  assert.equal(v.length, 1, `expected one team-era violation, got ${JSON.stringify(v)}`);
  assert.ok(v[0].detail.includes('Cleveland Cavaliers'), `must name the team said: ${v[0].detail}`);
  assert.ok(v[0].detail.includes('2020-21'), `must name the anchored season: ${v[0].detail}`);
  assert.ok(v[0].detail.includes('Miami Heat'), `must name the team that season was: ${v[0].detail}`);
  // The nickname and the short form are the same claim as the city.
  assert.equal(eraViolations('Alpha One thrives with the Cavaliers, and the total climbs.', '2020-21').length, 1);
  assert.equal(eraViolations('Alpha One thrives with the Cavs, and the total climbs.', '2020-21').length, 1);
});

t('team-era passes a transition sentence naming both teams, and any correct naming', () => {
  assert.deepEqual(eraViolations('Alpha One leaves Cleveland for Miami, and the line keeps climbing.', '2020-21'), []);
  assert.deepEqual(eraViolations('Alpha One leaves Cleveland for Miami, and the line keeps climbing.', '2019-20'), []);
  assert.deepEqual(eraViolations('Alpha One starts in Cleveland, and the line begins to climb.', '2019-20'), []);
  assert.deepEqual(eraViolations('Alpha One starts with the Cavs, and the line begins to climb.', '2019-20'), []);
});

t('team-era skips a beat with no anchored step, and a beat naming no team', () => {
  assert.deepEqual(eraViolations('Alpha One thrives in Cleveland, and the total keeps climbing.', undefined), []);
  assert.deepEqual(eraViolations('Alpha One thrives everywhere, and the total keeps climbing.', '2020-21'), []);
});

t('team-era is skipped entirely for a brief that carries no per-season team', () => {
  // miniBrief's entities have empty series: an older brief, or a source (C01)
  // that never carried a team, must not start failing.
  assert.deepEqual(eraViolations('Alpha One thrives in Cleveland, and the total keeps climbing.', '2020-21', miniBrief), []);
});

/* --------------------------------------------------------------- briefMd.ts */

const mdBrief = {
  topic: {
    id: 't1', question: 'Who scored the most?', angle: 'cohort-fate', lane: 'evergreen',
    hook_seed: 'The favourite is not the leader.', why_fans_argue: 'People remember the pick, not the totals.',
    evidence: ['https://example.com/one'],
  },
  visual: {
    chart: 'cumulative-multiline', alternates: ['slope-pair'], camera: 'zoom-to-beat',
    accent_kinds: ACCENT_KINDS, anchor_steps: ['2019-20', '2020-21', '2021-22'],
    density: { floor: 0.22, ceiling: 0.45, target: 0.3 },
    accent_budget: { total_min: 15, total_max: 30, per_beat_hint: '2 per beat, 3 on at most 2 beats' },
  },
  facts: {
    unit: 'points', as_of: '2021-22',
    entities: [
      entity({
        id: 'p1', name: 'Alpha One', first: 'Alpha', last: 'One', pick: 3, total: 500, rank: 1, seasons_played: 2,
        // 2020-21 is skipped on purpose: a missed season must render as a
        // dash in the season-by-season table, never a zero.
        series: [{ step: '2019-20', value: 100 }, { step: '2021-22', value: 500 }],
        awards: [
          { name: 'Old College Honor', season: '2018' },   // predates the 2019-20 debut: must be dropped
          { name: 'Third Team All-NBA', season: '2022' },  // after debut: must survive
        ],
      }),
      entity({
        id: 'p2', name: 'Beta Two', first: 'Beta', last: 'Two', pick: null, total: 200, rank: 2, seasons_played: 2,
        series: [{ step: '2019-20', value: 80 }, { step: '2020-21', value: 200 }],
        awards: [],
      }),
    ],
    markers: [
      { entityId: 'p1', kind: 'leader', detail: 'most in the class: 500', value: 500 },
      { entityId: 'p1', kind: 'award', step: '2018', detail: 'Old College Honor (2018)' },
      { entityId: 'p1', kind: 'award', step: '2022', detail: 'Third Team All-NBA (2022)' },
      { entityId: 'p2', kind: 'undrafted', detail: 'went undrafted' },
    ],
    allowed_numbers: [1, 2, 3, 80, 100, 200, 500, 2018, 2019, 2020, 2021, 2022],
  },
  style: {
    voice: '', rules: STYLE_RULES, duration_s: [40, 95] as [number, number],
    target_seconds: 70, target_words: 203,
    beats: [2, 3] as [number, number],
    ending_variants: ['thesis', 'hard-cut', 'open-question'] as const,
    forbidden: [],
  },
  output: {
    format: 'json',
    schema: {},
    example: { title: 'Who scored the most?', beats: [{ text: 'Alpha One leads, but Beta Two is close.', entityId: 'p1', accents: [] }] },
  },
} as unknown as WriterBrief;

const md = renderBriefMd(mdBrief);

t('renderBriefMd contains every section heading', () => {
  for (const h of ['# Brief — Who scored the most?', '## The tension', '## The story the numbers are hiding',
                    '## The numbers', '## Season by season', '## What you may point at',
                    '## Numbers you may use', '## Return this shape']) {
    assert.ok(md.includes(h), `missing heading: ${h}`);
  }
});

t('renderBriefMd renders a missed season as a dash, never a zero', () => {
  assert.ok(md.includes('| Alpha One | 100 | — | 500 |'), 'expected a dash for the skipped 2020-21 column');
});

t('renderBriefMd drops an award that predates the entity\'s first NBA season, keeps a later one', () => {
  assert.ok(!md.includes('Old College Honor'), 'a 2018 award for a 2019-20 debut must be omitted');
  assert.ok(md.includes('Third Team All-NBA'), 'a 2022 award for a 2019-20 debut must survive');
});

t('renderBriefMd lists every entity in the id table', () => {
  assert.ok(md.includes('| Alpha One | p1 |'));
  assert.ok(md.includes('| Beta Two | p2 |'));
});

t('renderBriefMd states the word target and the accent budget as numbers, not ranges to interpret', () => {
  // The word target must be a single countable figure. A brief that only
  // showed "Duration: 40–95s" let a writer aim at 43s, where its own accent
  // count measured 0.557 events/s and was rejected as too dense when it was
  // in fact too short.
  assert.ok(md.includes('**Write 203 words**'), 'expected the word target as one concrete number');
  assert.ok(md.includes('173–233 words'), 'expected the accepted word window, derived from the tolerance');
  assert.ok(md.includes('**Accent budget:** 15–30 accents total'), 'expected the total to appear as a concrete number');
  assert.ok(!md.includes('**Duration:** 40–95s'), 'the outer legal range must not be offered as the thing to aim at');
});

/* The eras. A writer handed 23 rows of `teamSlug` cannot use them; handed the
 * contiguous runs it can write "he left Cleveland for Miami". The runs come
 * from the same `teamChanges` the chart places its logos with, so the
 * Markdown and the picture cannot disagree about where an era ends. */
const eraMdBrief = {
  ...mdBrief,
  visual: { ...mdBrief.visual, anchor_steps: ['2019-20', '2020-21', '2021-22', '2022-23'] },
  facts: {
    ...mdBrief.facts,
    entities: [
      entity({
        id: 'p1', name: 'Alpha One', first: 'Alpha', last: 'One', pick: 3, total: 500, rank: 1, seasons_played: 4,
        series: [
          { step: '2019-20', value: 100, team: 'cleveland-cavaliers' },
          { step: '2020-21', value: 200, team: 'cleveland-cavaliers' },
          { step: '2021-22', value: 400, team: 'miami-heat' },
          { step: '2022-23', value: 500, team: 'cleveland-cavaliers' },
        ],
      }),
    ],
  },
} as unknown as WriterBrief;

t('renderBriefMd prints the team ERAS as contiguous runs under their human names', () => {
  const eraMd = renderBriefMd(eraMdBrief);
  assert.ok(eraMd.includes('## Which team, which seasons'), 'the eras section is missing');
  assert.ok(eraMd.includes('| Cleveland Cavaliers | 2019-20 .. 2020-21 |'), eraMd);
  assert.ok(eraMd.includes('| Miami Heat | 2021-22 .. 2021-22 |'), eraMd);
  // A return to a team already left is its OWN era, not a merge with the first.
  assert.ok(eraMd.includes('| Cleveland Cavaliers | 2022-23 .. 2022-23 |'), eraMd);
  // Human names, never the ESPN slug the JSON carries.
  assert.ok(!eraMd.includes('cleveland-cavaliers'), 'the slug leaked into the Markdown');
  const section = eraMd.slice(eraMd.indexOf('## Which team'), eraMd.indexOf('## What you may point at'));
  assert.equal(section.split('\n').filter((l) => l.startsWith('| Alpha One |')).length, 3,
    'three runs across four seasons, not four rows');
});

t('renderBriefMd omits the eras section entirely when no entity carries a team', () => {
  assert.ok(!md.includes('Which team, which seasons'),
    'a brief with no per-season team must not grow an empty eras heading');
});

/* --------------------------------------------------------- verify.ts: parseDraftText */

t('parseDraftText parses a bare object', () => {
  const r = parseDraftText('{"title":"t","beats":[]}');
  assert.equal(r.ok, true);
  assert.equal((r as any).draft.title, 't');
});

t('parseDraftText strips a whole-reply ```json fence', () => {
  const r = parseDraftText('```json\n{"title":"t","beats":[]}\n```');
  assert.equal(r.ok, true);
  assert.equal((r as any).draft.title, 't');
});

t('parseDraftText strips prose before the JSON ("Here is the script:")', () => {
  const r = parseDraftText('Here is the script:\n{"title":"t","beats":[]}');
  assert.equal(r.ok, true);
  assert.equal((r as any).draft.title, 't');
});

t('parseDraftText tolerates a trailing comma', () => {
  const r = parseDraftText('{"title":"t","beats":[1,2,],}');
  assert.equal(r.ok, true);
});

t('parseDraftText returns ok:false with a non-empty error on garbage', () => {
  const r = parseDraftText('this is not json at all, sorry');
  assert.equal(r.ok, false);
  assert.ok((r as any).error.length > 0);
});

/* --------------------------------------------------------- scripts.ts: draftToScriptLines */

t('draftToScriptLines preserves beat order, entityId, and accents', () => {
  const draft: Draft = {
    title: 't',
    beats: [
      { text: 'First beat, and it starts strong.', entityId: 'p1',
        accents: [{ t: 0.3, kind: 'zoom' }, { t: 0.7, kind: 'callout', text: '500' }] },
      { text: 'Second beat, then it closes.', entityId: 'p2',
        accents: [{ t: 0.4, kind: 'spotlight' }], ending: 'hard-cut' },
    ],
  };
  const lines = draftToScriptLines(draft);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.entityId), ['p1', 'p2']);
  assert.deepEqual(lines.map((l) => l.text), draft.beats.map((b) => b.text));
  assert.deepEqual(lines[0].accents, draft.beats[0].accents);
  assert.deepEqual(lines[1].accents, draft.beats[1].accents);
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

t('latestById collapses three records for one topic down to the newest', () => {
  const gates = {
    g0_burned: 'pass', g1_real_question: 'pass',
    g3_data_available: 'pending', g4_chart_fit: 'pending',
  } as const;
  const base: LedgerRecord = {
    id: 'topic-1', question: 'Did this ship?', status: 'accepted', lane: 'evergreen',
    angle: 'chase', entities: [], evidence: [], gates, session: 's1',
    at: '2026-09-01T00:00:00.000Z', note: '', recheck_after: null,
  };
  const narrated: LedgerRecord = { ...base, status: 'narrated', at: '2026-09-02T00:00:00.000Z' };
  const produced: LedgerRecord = { ...base, status: 'produced', at: '2026-09-03T00:00:00.000Z' };

  // Fed out of chronological order on purpose — latestById must pick the
  // newest `at`, not just the last one it happens to see.
  const collapsed = latestById([narrated, base, produced]);
  assert.equal(collapsed.length, 1, 'three records for one id must collapse to one row');
  assert.equal(collapsed[0].status, 'produced');
  assert.equal(collapsed[0].at, produced.at);

  // A second, unrelated topic must survive alongside it untouched.
  const other: LedgerRecord = { ...base, id: 'topic-2', status: 'candidate', at: '2026-09-01T12:00:00.000Z' };
  const both = latestById([base, narrated, produced, other]);
  assert.equal(both.length, 2);
  assert.ok(both.some((r) => r.id === 'topic-2' && r.status === 'candidate'));
});

t('isBurned (via digestLines) treats narrated as burned, same as accepted/produced', () => {
  withTmpContentRoot(() => {
    const gates = {
      g0_burned: 'pass', g1_real_question: 'pass',
      g3_data_available: 'pending', g4_chart_fit: 'pending',
    } as const;
    const narrated: LedgerRecord = {
      id: 'n1', question: 'Is this narrated question burned?', status: 'narrated', lane: 'evergreen',
      angle: 'chase', entities: [], evidence: [], gates, session: 's2',
      at: new Date().toISOString(), note: '', recheck_after: null,
    };
    appendLedger(narrated);
    const lines = digestLines();
    assert.ok(lines.includes(narrated.question), 'narrated must feed the burned digest, or discovery would re-suggest it');
    assert.notEqual(isBurned(narrated.question, lines), null);
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

/* ---------------------------------------------------- brief.ts: assembleBrief */

const briefEntity = (over: Partial<BriefEntity>): BriefEntity => ({
  id: '', name: '', first: '', last: '', pick: null, total: 0, rank: 0, seasons_played: 0,
  series: [], awards: [], ...over,
});

const assembleInput: BriefInput = {
  topic: { id: 't1', question: 'Who leads?', angle: 'cohort-fate', lane: 'evergreen', hook_seed: 'seed' },
  unit: 'points',
  seasons: ['2019-20', '2020-21', '2021-22'],
  cumulative: true,
  entities: [
    // Given in a-b-c order on purpose: rank must come from `total`, not from
    // array position, and the returned array must keep THIS order (matching
    // buildBrief's own contract of never reordering facts.entities).
    briefEntity({ id: 'a', name: 'A One', first: 'A', last: 'One', pick: 5, total: 300, seasons_played: 3,
      series: [{ step: '2019-20', value: 100 }, { step: '2020-21', value: 200 }, { step: '2021-22', value: 300 }] }),
    briefEntity({ id: 'b', name: 'B Two', first: 'B', last: 'Two', pick: 1, total: 500, seasons_played: 3,
      series: [{ step: '2019-20', value: 150 }, { step: '2020-21', value: 400 }, { step: '2021-22', value: 500 }] }),
    // Missing '2020-21' on purpose: the gap between two of C's own points.
    briefEntity({ id: 'c', name: 'C Three', first: 'C', last: 'Three', pick: 10, total: 200, seasons_played: 2,
      series: [{ step: '2019-20', value: 50 }, { step: '2021-22', value: 200 }] }),
  ],
};

const assembled = assembleBrief(assembleInput);

t('assembleBrief ranks by total, not by input order (b=1st, a=2nd, c=3rd)', () => {
  const byId = new Map(assembled.facts.entities.map((e) => [e.id, e]));
  assert.equal(byId.get('b')!.rank, 1);
  assert.equal(byId.get('a')!.rank, 2);
  assert.equal(byId.get('c')!.rank, 3);
  // facts.entities itself keeps the CALLER's order (a, b, c) — only the rank
  // field changes, the array is never re-sorted underneath the caller.
  assert.deepEqual(assembled.facts.entities.map((e) => e.id), ['a', 'b', 'c']);
});

t('assembleBrief detects the missed-season gap for the entity with a hole', () => {
  const missed = assembled.facts.markers.filter((m) => m.kind === 'missed-season');
  assert.equal(missed.length, 1);
  assert.equal(missed[0].entityId, 'c');
  assert.equal(missed[0].step, '2020-21');
});

t('assembleBrief allowed_numbers contains every series value', () => {
  const allowed = new Set(assembled.facts.allowed_numbers);
  for (const v of [100, 200, 300, 150, 400, 500, 50]) assert.ok(allowed.has(v), `missing series value ${v}`);
});

t('assembleBrief is pure: the same input twice yields deep-equal output (generated timestamp aside)', () => {
  const { generated: g1, ...rest1 } = assembleBrief(assembleInput);
  const { generated: g2, ...rest2 } = assembleBrief(assembleInput);
  assert.deepEqual(rest1, rest2);
});

/* -------------------------------------------------- brief.ts: accent budget
 *
 * A per-beat accent COUNT cannot know how long a script will run once
 * spoken; only an absolute total, sized to the brief's own target length,
 * can. `computeAccentBudget` is that translation — and it has to subtract
 * the beats, because `eventDensity` counts `beats.length + accents`: every
 * beat is itself a visual event, spent before a single accent fires. The
 * earlier version budgeted ceil(FLOOR*s)..floor(CEILING*s) accents and never
 * subtracted them, handing out up to 31 accents on top of 8-12 beats at the
 * 70s target: 39-43 events, 0.56-0.61 events/s, all of them rejected by the
 * verifier that issued the budget. */

t('computeAccentBudget pays for the beats first — the measured budget table', () => {
  // seconds, beats, total_min, total_max. A degenerate [k, k] range pins an
  // exact beat count, which is what each row of the table describes.
  const table: [number, number, number, number][] = [
    [70, 8, 8, 23],
    [70, 10, 10, 21],
    [70, 12, 12, 19],
    [43.1, 8, 8, 11],
  ];
  for (const [seconds, beats, total_min, total_max] of table) {
    const b = computeAccentBudget(seconds, [beats, beats]);
    assert.equal(b.total_min, total_min, `${seconds}s / ${beats} beats: total_min`);
    assert.equal(b.total_max, total_max, `${seconds}s / ${beats} beats: total_max`);
  }
  // The row that kills the old rule of thumb: at 70s with 12 beats, "2
  // accents per beat" is 24 — over the 19 the budget allows. So the hint has
  // to be derived from the budget, never state a fixed 2-or-3.
  const twelve = computeAccentBudget(70, [12, 12]);
  assert.ok(2 * 12 > twelve.total_max, 'a flat 2-per-beat must exceed the 12-beat budget at 70s');
  assert.ok(!/2 or 3|2 per beat|3 per beat/.test(twelve.per_beat_hint),
    `per_beat_hint must be derived, not a fixed per-beat count: ${twelve.per_beat_hint}`);
  // Derived from the budget: 19 total - 12 beats = 7 accents left to spend
  // beyond the one-per-beat floor.
  assert.ok(twelve.per_beat_hint.includes('7 more'),
    `hint must derive the spare from the budget and beat count: ${twelve.per_beat_hint}`);
});

t('computeAccentBudget over the whole 8-12 beat range is the envelope that stays legal at both ends', () => {
  const b = computeAccentBudget(70, [8, 12]);
  assert.equal(b.total_min, 12);   // max(12 beats x 1, ceil(0.22*70) - 8)
  assert.equal(b.total_max, 19);   // floor(0.45*70) - 12
  // The whole point of an envelope: every corner it permits must still land
  // inside the density band verifyDraft applies to the finished draft.
  const corners: [number, number][] = [
    [8, b.total_min], [8, b.total_max], [12, b.total_min], [12, b.total_max],
  ];
  for (const [beatCount, accentCount] of corners) {
    const perSecond: number = (beatCount + accentCount) / 70;
    assert.ok(perSecond >= DENSITY_FLOOR && perSecond <= DENSITY_CEILING,
      `${beatCount} beats + ${accentCount} accents = ${perSecond.toFixed(3)} events/s, outside the band`);
  }
});

t('assembleBrief pins ONE target length and sizes the accent budget from it, not from duration_s', () => {
  assert.deepEqual(assembled.style.duration_s, [40, 95]);   // outer LEGAL bound, unchanged
  assert.deepEqual(assembled.style.beats, [8, 12]);
  assert.equal(assembled.style.target_seconds, 70);
  // Derived from the shared constant, never hardcoded: 70 * 2.9 = 203.
  assert.equal(assembled.style.target_words, Math.round(70 * WORDS_PER_SECOND));
  assert.equal(assembled.style.target_words, 203);
  assert.equal(assembled.visual.accent_budget.total_min, 12);
  assert.equal(assembled.visual.accent_budget.total_max, 19);
});

// verifyDraft's real density formula (src/verify.ts) counts each BEAT as an
// event too, on top of its accents — `events = beats.length + totalAccents`.
// A fixed "3 accents on every beat" rule ignores that beat-count term
// entirely, which is exactly how a script that looks correct beat-by-beat
// still overshoots the ceiling. The fixture below holds word count (and so
// spoken seconds) fixed and varies only the accent count, at a duration
// inside the brief's own [40,95]s target band, to demonstrate the real
// (not the simplified "accents alone" rule-of-thumb) verdict: 3-per-beat
// violates, 2-per-beat does not.
const densityBrief = {
  visual: {
    chart: 'x', alternates: [], camera: 'static',
    accent_kinds: ACCENT_KINDS, anchor_steps: [],
    density: { floor: DENSITY_FLOOR, ceiling: DENSITY_CEILING, target: 0.30 },
  },
  facts: {
    unit: 'points', as_of: '2025',
    entities: [entity({ id: 'p1' })],
    markers: [], allowed_numbers: [],
  },
  style: {
    voice: '', rules: STYLE_RULES, duration_s: [40, 95] as [number, number],
    target_seconds: 70, target_words: 203,
    beats: [8, 12] as [number, number],
    ending_variants: ['thesis', 'hard-cut', 'open-question'] as const,
    forbidden: [],
  },
} as unknown as WriterBrief;

// 22 words/beat x 10 beats = 220 words -> 220 / WORDS_PER_SECOND ~= 75.9s,
// inside the brief's own [40,95]s target range.
const wordBeat = (words: number, accents: number) => ({
  text: Array.from({ length: words }, () => 'w').join(' '),
  entityId: 'p1',
  accents: Array.from({ length: accents }, (_, i) => ({ t: Number((i * 0.12).toFixed(2)), kind: 'zoom' as const })),
});

t('3 accents on every one of 10 beats overshoots the density ceiling, even though each beat is individually "2 or 3"', () => {
  const beats = Array.from({ length: 10 }, () => wordBeat(22, 3));
  const violations = verifyDraft({ title: 't', beats }, densityBrief);
  assert.ok(violations.some((v) => v.rule === 'density'), 'expected a density violation at 3 accents/beat');
});

t('the identical script (same word count) at 2 accents on every beat stays inside the density band', () => {
  const beats = Array.from({ length: 10 }, () => wordBeat(22, 2));
  const violations = verifyDraft({ title: 't', beats }, densityBrief);
  assert.ok(!violations.some((v) => v.rule === 'density'), 'did not expect a density violation at 2 accents/beat');
});

/* ------------------------------------------------------- verify.ts: length
 *
 * Density is a RATIO, so a script that is simply too short shows up in it as
 * "too many accents". The measured case: 8 beats, 125 words, 16 accents — 24
 * events over 43.1 spoken seconds, 0.557/s, rejected. The identical 16
 * accents over the 203-word target measure 0.343/s and pass. Nothing was
 * wrong with the accents; the script was 78 words short, and reporting that
 * as `density` sends a reader hunting for accents to delete. */

t('a 125-word draft is diagnosed as `length`, naming both counts — not as density alone', () => {
  const beats = Array.from({ length: 8 }, (_, i) => wordBeat(i === 0 ? 20 : 15, 2));   // 20 + 7*15 = 125
  const total = beats.reduce((n, b) => n + b.text.split(' ').length, 0);
  assert.equal(total, 125, 'fixture must reproduce the measured 125-word draft');
  const v = verifyDraft({ title: 't', beats }, densityBrief);
  const len = v.find((x) => x.rule === 'length');
  assert.ok(len, `expected a length violation against the 203-word target, got ${JSON.stringify(v.map((x) => x.rule))}`);
  assert.ok(len!.detail.includes('125'), `must name the actual word count: ${len!.detail}`);
  assert.ok(len!.detail.includes('203'), `must name the target word count: ${len!.detail}`);
  assert.ok(len!.detail.includes('too short'), `must say which direction it is wrong in: ${len!.detail}`);
});

t('the same 8 beats and 16 accents at the 203-word target trip neither length nor density', () => {
  const beats = Array.from({ length: 8 }, (_, i) => wordBeat(i === 0 ? 28 : 25, 2));   // 28 + 7*25 = 203
  const total = beats.reduce((n, b) => n + b.text.split(' ').length, 0);
  const accents = beats.reduce((n, b) => n + b.accents.length, 0);
  assert.equal(total, 203);
  assert.equal(accents, 16, 'the accent count is unchanged from the rejected draft — only the length is');
  const v = verifyDraft({ title: 't', beats }, densityBrief);
  assert.deepEqual(v.filter((x) => x.rule === 'length' || x.rule === 'density'), []);
});

/* ------------------------------------------------------------- drafts.ts
 *
 * A draft's accents may only be laid over a measured timeline's spans when
 * the audio actually narrates that draft. Beat COUNT cannot decide it:
 * out/draft-C01F.json and the source-video transcript in SCRIPTS.C01F are
 * both ten beats long, so counting would put every arrow on the wrong
 * sentence at exactly the moment it looked like it had worked. */

const chunk = (text: string, beatIndex: number) => ({ text, beatIndex });
const twoBeatDraft: Draft = {
  title: 't',
  beats: [
    { text: 'Barrett leads at 8,391, but Zion finishes behind.', entityId: 'a' },
    { text: 'Morant opens like the answer, then plateaus.', entityId: 'b' },
  ],
};

t('narratesDraft: true when every beat\'s sentences re-join to that beat\'s text', () => {
  // Two sentences in beat 0, as toSentences would split them.
  const draft: Draft = {
    title: 't',
    beats: [
      { text: 'Barrett leads at 8,391. Zion finishes behind.', entityId: 'a' },
      { text: 'Morant opens like the answer, then plateaus.', entityId: 'b' },
    ],
  };
  assert.equal(narratesDraft({ chunks: [
    chunk('Barrett leads at 8,391.', 0),
    chunk('Zion finishes behind.', 0),
    chunk('Morant opens like the answer, then plateaus.', 1),
  ] }, draft), true);
});

t('narratesDraft: false when the beat count matches but the words do not', () => {
  assert.equal(narratesDraft({ chunks: [
    chunk('Zion Williamson missed his third season entirely.', 0),
    chunk('The second pick started far more steadily.', 1),
  ] }, twoBeatDraft), false, 'same shape, different script — the accents must not be overlaid');
});

t('narratesDraft: false for a timeline written before chunks were persisted', () => {
  assert.equal(narratesDraft({}, twoBeatDraft), false);
  assert.equal(narratesDraft({ chunks: [] }, twoBeatDraft), false);
});

t('narratesDraft: whitespace differences do not count as a different script', () => {
  assert.equal(narratesDraft({ chunks: [
    chunk('  Barrett leads at 8,391,\n  but Zion finishes behind. ', 0),
    chunk('Morant opens like the answer, then plateaus.', 1),
  ] }, twoBeatDraft), true);
});

/* ---------------------------------------------- candidateBrief.ts: pure parts */

const marker = (kind: Marker['kind']): Marker => ({ entityId: 'x', kind, detail: 'x' });

t('deriveHookSeed: leader beats undrafted beats missed-season', () => {
  assert.equal(deriveHookSeed([marker('leader'), marker('undrafted')], 'fallback text.'),
    'The name everyone expects is not the one on top.');
  assert.equal(deriveHookSeed([marker('undrafted'), marker('missed-season')], 'fallback text.'),
    'One of them was not drafted at all.');
  assert.equal(deriveHookSeed([marker('missed-season')], 'fallback text.'),
    'One of them lost a whole season.');
});

t('deriveHookSeed falls back to the first sentence of why_fans_argue when no marker matches', () => {
  assert.equal(
    deriveHookSeed([marker('award')], 'Fans argue this because the gap looks closer than it is. Second sentence.'),
    'Fans argue this because the gap looks closer than it is.'
  );
});

t('seasonUnion merges two entities\' steps ascending by leading year', () => {
  const e1 = { series: [{ step: '2020-21' }, { step: '2022-23' }] };
  const e2 = { series: [{ step: '2019-20' }, { step: '2020-21' }] };
  assert.deepEqual(seasonUnion([e1, e2]), ['2019-20', '2020-21', '2022-23']);
});

/* --------------------------- Fix 1: undrafted must never fire on an unknown pick */

t('detectMarkers: undrafted fires for pick:null, never for pick:undefined, and never for a numbered pick', () => {
  const seasons = ['2019-20', '2020-21'];
  const known = entity({ id: 'known', pick: null });
  const unknown = entity({ id: 'unknown', pick: undefined });
  const numbered = entity({ id: 'numbered', pick: 7 });
  const markers = detectMarkers([known, unknown, numbered], seasons);
  assert.ok(markers.some((m) => m.entityId === 'known' && m.kind === 'undrafted'));
  assert.ok(!markers.some((m) => m.entityId === 'unknown' && m.kind === 'undrafted'),
    'an unknown pick must never be reported as a fact of undraftedness');
  assert.ok(!markers.some((m) => m.entityId === 'numbered' && m.kind === 'undrafted'));
});

/* -------------------- Fix 2: refuse an entity whose measure is empty/all-zero */

t('seriesVerdict: empty series -> empty', () => {
  assert.equal(seriesVerdict([], 5985).reason, 'empty');
  assert.equal(seriesVerdict([], 5985).usable, false);
});

t('seriesVerdict: all zeros with a non-zero points total -> all-zero-data-hole (Wilt\'s rebounds)', () => {
  const series = [{ step: '1969', value: 0 }, { step: '1970', value: 0 }];
  const v = seriesVerdict(series, 5985);
  assert.equal(v.reason, 'all-zero-data-hole');
  assert.equal(v.usable, false);
});

t('seriesVerdict: all zeros with a zero points total -> all-zero-genuine', () => {
  const series = [{ step: '2019-20', value: 0 }, { step: '2020-21', value: 0 }];
  const v = seriesVerdict(series, 0);
  assert.equal(v.reason, 'all-zero-genuine');
  assert.equal(v.usable, false);
});

t('seriesVerdict: mixed values -> ok', () => {
  const series = [{ step: '2019-20', value: 0 }, { step: '2020-21', value: 12 }];
  const v = seriesVerdict(series, 12);
  assert.equal(v.reason, 'ok');
  assert.equal(v.usable, true);
});

/* --------------------------------------- Fix 4: one season-step format */

t('normaliseStep: bare years become hyphenated seasons, hyphenated steps pass through', () => {
  assert.equal(normaliseStep('1969'), '1968-69');
  assert.equal(normaliseStep('2003-04'), '2003-04');
  assert.equal(normaliseStep('2000'), '1999-00');   // zero-padding: "00", not "0"
});

t('a season union of bare years and hyphenated labels normalises and sorts correctly', () => {
  const mixed = ['1969', '2003-04'].map(normaliseStep);
  assert.deepEqual(mixed, ['1968-69', '2003-04']);
  const e1 = { series: [{ step: normaliseStep('1969') }] };
  const e2 = { series: [{ step: normaliseStep('2003-04') }] };
  assert.deepEqual(seasonUnion([e1, e2]), ['1968-69', '2003-04']);
});

/* ------------------- deriveHookSeed must not read an unknown pick as a fact */

t('deriveHookSeed falls through to why_fans_argue when the only undrafted-shaped markers came from unknown picks', () => {
  // Build the fixture the way the real bug happened: an entity with
  // pick: undefined must never produce an 'undrafted' marker in the first
  // place, so deriveHookSeed here never even sees one to prefer.
  const lebron = entity({ id: 'lebron', pick: undefined, rank: 2 });
  const wilt = entity({ id: 'wilt', pick: undefined, rank: 1 });
  const markers = detectMarkers([lebron, wilt], ['1968-69', '2003-04']);
  assert.ok(!markers.some((m) => m.kind === 'undrafted'), 'unknown picks must not synthesize an undrafted marker');
  assert.equal(
    deriveHookSeed(markers, 'Fans argue Wilt\'s record is unbreakable. Second sentence.'),
    'The name everyone expects is not the one on top.'   // rank:1 leader marker still fires for wilt — that's a real fact
  );
  // Isolate the undrafted precedence itself: strip the leader marker so
  // nothing BUT an (absent) undrafted marker could win, and confirm the
  // fallback to why_fans_argue actually happens.
  const withoutLeader = markers.filter((m) => m.kind !== 'leader');
  assert.equal(
    deriveHookSeed(withoutLeader, 'Fans argue Wilt\'s record is unbreakable. Second sentence.'),
    'Fans argue Wilt\'s record is unbreakable.'
  );
});

/* ------------------------------------------- write.ts: separatorExample */

t('separatorExample takes the brief\'s own largest separated number, never a foreign one', () => {
  // The old code hardcoded 8,391 — a C01F figure — into the prompt of EVERY
  // brief, which is the direction a fabricated number travels.
  assert.equal(separatorExample([1, 2, 8391, 12095, 47]), '12,095');
  assert.equal(separatorExample(['8,391', '43,440']), '43,440');
  assert.equal(separatorExample([1, 2, 7, 226]), '8,391');   // nothing >= 1000: documented fallback
  assert.equal(separatorExample([]), '8,391');
});

/* ------------------------------------------------------- records.ts + chase
 *
 * A record chase is one cumulative series plus ONE absolute number, and the
 * whole point is that the record holder's season-by-season data is never
 * needed: ESPN returns 5 of Wilt Chamberlain's 14 seasons and zero rebounds,
 * so he cannot be a second series — and a chase never asked him to be one.
 * Everything below is pure; no network. */

t('every career record carries a value, a holder id, and two-source provenance', () => {
  for (const [key, r] of Object.entries(CAREER_RECORDS)) {
    assert.equal(r.measure, key, `${key} keyed by its own measure`);
    assert.ok(r.value > 0 && Number.isInteger(r.value), `${key} value`);
    assert.ok(r.seasons > 0, `${key} seasons`);
    assert.ok(/^\d+$/.test(r.holderEspnId), `${key} holder needs an ESPN id, got "${r.holderEspnId}"`);
    // Provenance is not decoration: this is the one number on the chart that
    // does not come from the data source, so it must name where it came from
    // and it must name more than one place.
    assert.ok(r.source.includes('espn.com') && r.source.includes('wikipedia.org'),
      `${key} must cite both sources it was corroborated against: ${r.source}`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r.asOf), `${key} asOf`);
  }
});

t('recordFor: the rebounds record is Wilt\'s 23,924 in 14 seasons, and an unknown measure has none', () => {
  const reb = recordFor('REB');
  assert.equal(reb!.value, 23924);
  assert.equal(reb!.holder, 'Wilt Chamberlain');
  assert.equal(reb!.seasons, 14);
  assert.equal(reb!.holderEspnId, '4142');
  // ESPN's own JSON all-time leaders endpoint answers 16,212 (Moses Malone)
  // here, because its rebound totals start at 1973-74. That is the same hole
  // that returns 0 rebounds for Wilt, and is exactly why this is a table.
  assert.notEqual(reb!.value, 16212);
  assert.equal(recordFor('GP'), null);
  assert.equal(recordFor(null), null);
});

t('namesRecord fires on record / all-time wording, not on a plain comparison', () => {
  assert.ok(namesRecord("Can LeBron James realistically catch Wilt Chamberlain's career rebounds record?"));
  assert.ok(namesRecord('the all-time rebounding list'));
  assert.ok(namesRecord('all time leaders'));
  assert.ok(!namesRecord('Which 2019 draft pick has grabbed the most rebounds?'));
});

t('recordChaseFor needs a held record, record wording, AND the holder named', () => {
  const session = "Can LeBron James realistically catch Wilt Chamberlain's career rebounds record? "
    + "one-number comparison: LeBron's career rebounds vs Wilt Chamberlain's 23,924";
  assert.equal(recordChaseFor(session, ['LeBron James', 'Wilt Chamberlain'], 'REB')!.value, 23924);

  // Holder named only in the entities list, not the question — still a chase.
  assert.equal(recordChaseFor('Can he catch the all-time record?', ['Wilt Chamberlain'], 'REB')!.value, 23924);

  // A real chase of a DIFFERENT benchmark. Wilt is not named, and a 23,924
  // ceiling would dwarf both of its series for nothing.
  assert.equal(
    recordChaseFor('Which active player is the most realistic next rebound milestone chaser after Dwight Howard, on the all-time list?',
      ['Nikola Jokic', 'Andre Drummond', 'Dwight Howard'], 'REB'),
    null
  );
  // A draft-class comparison is not a record chase even though the holder of
  // the all-time mark exists.
  assert.equal(recordChaseFor('Which 2019 draft pick has grabbed the most rebounds?', ['RJ Barrett'], 'REB'), null);
  // No record held for this measure.
  assert.equal(recordChaseFor("Can he catch the all-time games played record of Robert Parish?", ['Robert Parish'], 'GP'), null);
  // A first name alone is not identification — "John" cannot separate John
  // Stockton from John Wall, so it must not fire.
  assert.equal(recordChaseFor('Can John break the all-time assists record?', ['John Wall'], 'AST'), null);
});

/* ------------------------------------------------- brief.ts: the record path */

const chaseRecord: BriefRecord = {
  measure: 'REB', unit: 'rebounds', holder: 'Wilt Chamberlain',
  value: 23924, seasons: 14, label: 'Wilt Chamberlain · 23,924',
  gap: [{ entityId: 'lebron', short: 11829 }],
  source: 'test', as_of: '2026-09-04',
};

t('allowedNumbers adds the record, the gap and the holder\'s season count — the three a chase must say', () => {
  const seasons = ['2003-04', '2025-26'];
  const lebron = entity({ id: 'lebron', total: 12095, rank: 1, seasons_played: 23,
    series: [{ step: '2003-04', value: 432 }, { step: '2025-26', value: 12095 }] });
  const plain = new Set(allowedNumbers([lebron], seasons));
  assert.ok(!plain.has(23924), 'no record supplied: the record must not appear');
  assert.ok(!plain.has(11829), 'no record supplied: the gap must not appear');

  const withRecord = new Set(allowedNumbers([lebron], seasons, chaseRecord));
  assert.ok(withRecord.has(23924), 'the record itself');
  assert.ok(withRecord.has(11829), 'the gap — the answer to the question the title asked');
  assert.ok(withRecord.has(14), "the holder's season count, and 14 is not in 1..12");
  assert.ok(withRecord.has(12095) && withRecord.has(23), 'the chaser\'s own numbers survive');
});

t('detectMarkers: a record produces a record-gap marker, and rank 1 of 1 is not a leader', () => {
  const lebron = entity({ id: 'lebron', last: 'James', total: 12095, rank: 1, seasons_played: 23 });
  const alone = detectMarkers([lebron], ['2025-26'], chaseRecord);
  const gap = alone.find((m) => m.kind === 'record-gap');
  assert.ok(gap, 'expected a record-gap marker');
  assert.equal(gap!.value, 11829);
  assert.ok(gap!.detail.includes('11829') && gap!.detail.includes('23924') && gap!.detail.includes('14'),
    `the marker must carry both numbers and the holder's pace: ${gap!.detail}`);
  // "most in the class: 12095" about the only entity on the chart is a claim
  // the writer can only turn into a falsehood — there is no class.
  assert.ok(!alone.some((m) => m.kind === 'leader'), 'rank 1 of 1 is not a fact about anybody');

  // Two or more entities: the ordering is real again and `leader` fires.
  const second = entity({ id: 'other', total: 8000, rank: 2, seasons_played: 12 });
  const pair = detectMarkers([lebron, second], ['2025-26']);
  assert.ok(pair.some((m) => m.entityId === 'lebron' && m.kind === 'leader'));
});

t('assembleBrief with a record routes to cumulative-record-chase and exposes the line', () => {
  const input: BriefInput = {
    topic: { id: 'chase', question: "Can LeBron catch Wilt's rebounds record?", angle: 'chase',
      lane: 'evergreen', hook_seed: 'The gap is not closing.' },
    unit: 'rebounds',
    seasons: ['2003-04', '2025-26'],
    entities: [entity({ id: 'lebron', name: 'LeBron James', first: 'LeBron', last: 'James',
      total: 12095, seasons_played: 23,
      series: [{ step: '2003-04', value: 432 }, { step: '2025-26', value: 12095 }] })],
    cumulative: true,
    record: recordFor('REB')!,
  };
  const b = assembleBrief(input);
  assert.equal(b.visual.chart, 'cumulative-record-chase');
  assert.ok(b.visual.alternates.includes('cumulative-multiline'),
    'the plain race must stay a legal alternate, or style.forbidden bans the fallback');
  assert.equal(b.facts.record!.value, 23924);
  assert.equal(b.facts.record!.label, 'Wilt Chamberlain · 23,924');
  assert.deepEqual(b.facts.record!.gap, [{ entityId: 'lebron', short: 11829 }]);
  assert.ok(b.facts.allowed_numbers.includes(23924) && b.facts.allowed_numbers.includes(11829));

  // The same input without the record is the ordinary race, and carries no
  // record anywhere — the two paths must not leak into each other.
  const plain = assembleBrief({ ...input, record: undefined });
  assert.equal(plain.visual.chart, 'cumulative-multiline');
  assert.equal(plain.facts.record, undefined);
  assert.ok(!plain.facts.allowed_numbers.includes(23924));
});

t('renderBriefMd states the record, the gap, and how to anchor an accent at it', () => {
  const b = assembleBrief({
    topic: { id: 'chase', question: "Can LeBron catch Wilt's rebounds record?", angle: 'chase',
      lane: 'evergreen', hook_seed: 'The gap is not closing.' },
    unit: 'rebounds', seasons: ['2003-04', '2025-26'],
    entities: [entity({ id: 'lebron', name: 'LeBron James', first: 'LeBron', last: 'James',
      total: 12095, seasons_played: 23,
      series: [{ step: '2003-04', value: 432 }, { step: '2025-26', value: 12095 }] })],
    cumulative: true, record: recordFor('REB')!,
  });
  const out = renderBriefMd(b);
  assert.ok(out.includes('## The record being chased'));
  assert.ok(out.includes('23,924'), 'the record, formatted');
  assert.ok(out.includes('11,829'), 'the gap, formatted');
  assert.ok(out.includes('"record": true'), 'the writer must be shown the anchor form');
});

/* --------------------------------------------- verify.ts: the record anchor */

const recordBrief = {
  ...miniBrief,
  facts: { ...miniBrief.facts, record: chaseRecord },
} as unknown as WriterBrief;

t('verifyDraft accepts at.record on a chase brief and rejects it on one with no record', () => {
  const beat = {
    text: 'Alpha One sits at 100, but the record is still 50 clear.', entityId: 'p1',
    accents: [{ t: 0.3, kind: 'refline' as const, at: { entityId: 'p1', record: true as const }, text: '23,924' }],
    ending: 'thesis' as const,
  };
  const draft = { title: 't', beats: [beat] };
  assert.ok(!verifyDraft(draft, recordBrief).some((v) => v.rule === 'accent-anchor'),
    'a record anchor is legal when the brief has a record');
  const bad = verifyDraft(draft, miniBrief).filter((v) => v.rule === 'accent-anchor');
  assert.equal(bad.length, 1, 'a record anchor on a brief with no record must be caught');
  assert.ok(bad[0].detail.includes('facts.record'), bad[0].detail);
});

/* ------------------------------------------- the picture of a generated video

   src/data/video-<id>.json is the third file the renderer reads, next to
   draft-<id>.json and timeline-<id>.json, and the one that used to be
   hand-written per video. These lock the derivation down, because
   src/Root.tsx now DISCOVERS compositions from these files: a wrong axis or a
   missing record silently draws the wrong picture instead of failing. */

const chaseVideoBrief = assembleBrief({
  topic: { id: 'chase', question: "Can LeBron James realistically catch Wilt Chamberlain's career rebounds record?",
    angle: 'chase', lane: 'evergreen', hook_seed: 'The gap is not closing.' },
  unit: 'rebounds',
  seasons: ['2003-04', '2004-05', '2005-06'],
  entities: [entity({ id: '1966', name: 'LeBron James', first: 'LeBron', last: 'James',
    total: 1576, seasons_played: 3,
    series: [{ step: '2003-04', value: 432 }, { step: '2004-05', value: 1020 }, { step: '2005-06', value: 1576 }] })],
  cumulative: true, record: recordFor('REB')!,
});

t('videoDataFrom puts the chase on the axis CumulativeLines actually draws', () => {
  const v = videoDataFrom('371e3032', chaseVideoBrief);
  // One axis entry MORE than there are points: the chart prepends an origin at
  // x(0) and puts season k at x(k+1), so without the trailing year the final
  // season lands short of the right-hand edge.
  assert.deepEqual(v.seasons, ['2003', '2004', '2005', '2006']);
  assert.equal(v.series.length, 1, 'a chase is one series — the holder is a line, not a second series');
  assert.deepEqual(v.series[0].points, [
    { season: '2003-04', value: 432 }, { season: '2004-05', value: 1020 }, { season: '2005-06', value: 1576 },
  ]);
  assert.equal(v.series[0].headshot, 'https://a.espncdn.com/i/headshots/nba/players/full/1966.png');
  assert.deepEqual(v.record, { value: 23924, label: 'Wilt Chamberlain · 23,924' });
  assert.equal(v.sub, 'Career Rebounds vs the All-Time Record');
  assert.equal(v.yLabel, 'Total Rebounds');
  assert.equal(v.title, chaseVideoBrief.topic.question, 'the question is the title until a draft renames it');
});

t('videoDataFrom omits the record line entirely when the brief has none', () => {
  const race = assembleBrief({
    topic: { id: 'race', question: 'Who scored more?', angle: 'chase', lane: 'evergreen', hook_seed: 'x' },
    unit: 'points', seasons: ['2019-20', '2020-21'],
    entities: [
      entity({ id: 'a', name: 'A One', first: 'A', last: 'One', total: 20, seasons_played: 2,
        series: [{ step: '2019-20', value: 10 }, { step: '2020-21', value: 20 }] }),
      entity({ id: 'b', name: 'B Two', first: 'B', last: 'Two', total: 30, seasons_played: 2,
        series: [{ step: '2019-20', value: 15 }, { step: '2020-21', value: 30 }] }),
    ],
    cumulative: true,
  });
  const v = videoDataFrom('deadbeef', race);
  assert.equal('record' in v, false, 'an absent record must not become record: undefined on the chart');
  assert.equal(v.sub, 'Total Points');
  assert.equal(v.series.length, 2);
});

t('the composition id of a generated video is <session>-<chart>, unchanged for 371e3032', () => {
  const v = videoDataFrom('371e3032', chaseVideoBrief);
  assert.equal(v.chart, 'cumulative-record-chase');
  assert.equal(compositionIdFor(v), '371e3032-cumulative-record-chase',
    'the existing mp4, the README and out/ all carry this exact id');
});

t('only the cumulative family is wired — every other chart gets no composition', () => {
  assert.deepEqual([...WIRED_CHARTS], ['cumulative-multiline', 'cumulative-record-chase']);
  assert.ok(isWired('cumulative-multiline'));
  assert.ok(isWired('cumulative-record-chase'));
  // These charts do not read a draft's beats. A composition for one would
  // render a picture that ignores its own narration.
  for (const chart of ['ranked-bar', 'slope-pair', 'unit-waffle', 'scatter-image', 'heatmap-matrix']) {
    assert.equal(isWired(chart), false, `${chart} must not be wired`);
  }
});

t('an empty placeholder and a missing file are the same answer to the renderer', () => {
  // src/videos.ts globs src/data/, so either blob can be absent — and
  // draft-C01.json really is `{}` on disk.
  assert.equal(asDraft(undefined), null);
  assert.equal(asDraft({}), null);
  assert.equal(asDraft({ title: 't', beats: [] }), null);
  assert.equal(asTimeline(undefined), null);
  assert.equal(asTimeline({ beats: [] }), null);
  const tl = asTimeline({ beats: [{ entityId: 'a', startMs: 0, endMs: 10 }], durationMs: 10, audio: 'v.wav' });
  assert.equal(tl?.durationMs, 10);
  assert.equal(tl?.audio, 'v.wav');
  assert.deepEqual(tl?.captions, [], 'a timeline with no captions is still a timeline');
});


/* ============================================================== src/sync.ts
   Snapping a draft onto the audio that was actually recorded. Every `t` a
   writer authors is a guess made before the WAV existed; these fixtures are
   the measured half of the contract. */

t('parseSrt reads the word-level file tts.ts writes', () => {
  const words = parseSrt(
    '1\n00:00:00,000 --> 00:00:00,445\nLeBron\n\n'
    + '2\n00:00:00,445 --> 00:00:00,890\nJames\n\n'
    + '3\n00:01:06,415 --> 00:01:06,760\n11,829\n');
  assert.equal(words.length, 3);
  assert.deepEqual(words[0], { text: 'LeBron', startMs: 0, endMs: 445 });
  assert.deepEqual(words[2], { text: '11,829', startMs: 66_415, endMs: 66_760 });
  assert.equal(parseSrt('1\r\n00:00:01,500 --> 00:00:02,000\r\nJames\r\n')[0].startMs, 1500,
    'CRLF is the same file');
  assert.deepEqual(parseSrt('not an srt at all'), [], 'and junk is no words, not a crash');
});

t('stepYears is how a season is SPOKEN, end year first', () => {
  assert.deepEqual(stepYears('2012-13'), ['2013', '2012']);
  assert.deepEqual(stepYears('1999-00'), ['2000', '1999'], 'not 1900');
  assert.deepEqual(stepYears(2013), ['2013']);
});

const w = (text: string, startMs: number, endMs: number): Word => ({ text, startMs, endMs });
const B0 = [w('LeBron', 0, 500), w('James', 500, 1000), w('reached', 1000, 1500),
            w('11,829', 7000, 7500), w('rebounds', 7500, 8000)];
const B1 = [w('Wilt', 10_000, 10_500), w("Chamberlain's", 10_500, 11_000), w('record', 11_000, 11_500),
            w('of', 11_500, 12_000), w('23,924', 12_500, 13_000), w('came', 13_000, 13_500),
            w('in', 13_500, 14_000), w('2018.', 14_000, 14_500)];
const SYNC_FACTS = {
  entities: [{
    id: 'lbj', first: 'LeBron', last: 'James',
    series: [{ step: '2016-17', value: 7706 }, { step: '2017-18', value: 11_829 }],
  }],
  record: { holder: 'Wilt Chamberlain' },
};
const acc = (t: number, kind: any, at?: any, text?: string) => ({ t, kind, ...(at ? { at } : {}), ...(text ? { text } : {}) });

t('matchAccent: a number in the accent text beats every other rule', () => {
  const m = matchAccent(acc(0.2, 'callout', { entityId: 'lbj', step: '2017-18' }, '11,829 short'), B0, SYNC_FACTS);
  assert.equal(m.rule, 'digits');
  assert.equal(m.word?.startMs, 7000, 'commas and the trailing word are stripped on both sides');
  const dot = matchAccent(acc(0.2, 'callout', undefined, '2018'), B1, SYNC_FACTS);
  assert.equal(dot.word?.text, '2018.', 'and so is a full stop');
});

t('matchAccent: the record line goes to the holder’s surname, then to the word "record"', () => {
  const holder = matchAccent(acc(0.5, 'arrow', { entityId: 'lbj', record: true }), B1, SYNC_FACTS);
  assert.equal(holder.rule, 'record');
  assert.equal(holder.word?.text, "Chamberlain's", 'possessive and all');
  const noHolder = matchAccent(acc(0.5, 'arrow', { entityId: 'lbj', record: true }), B1, {});
  assert.equal(noHolder.word?.text, 'record', 'with no brief, the word itself');
});

t('matchAccent: a step goes to its year, and only a stepless anchor to the surname', () => {
  // B0 says "James" but no year at all, so the surname is all there is
  const surname = matchAccent(acc(0.9, 'zoom', { entityId: 'lbj', step: '2017-18' }), B0, SYNC_FACTS);
  assert.equal(surname.rule, 'entity');
  assert.equal(surname.word?.startMs, 500);
  // same anchor, a beat that never says "James": the step's year carries it
  const year = matchAccent(acc(0.8, 'spotlight', { entityId: 'lbj', step: '2017-18' }), B1, SYNC_FACTS);
  assert.equal(year.rule, 'step');
  assert.equal(year.word?.text, '2018.');
  // THE PRECEDENCE, pinned: a beat saying both. An accent on {entity, step}
  // points at that POINT — the year names the point, the surname only says
  // whose chart it is — so the year wins. Ranking the surname first put the
  // spotlight on LeBron's 2023-24 point 6.7s after the line reached it.
  const both = [w('James', 0, 400), w('reached', 400, 800), w('11,185', 1000, 1400),
                w('in', 1400, 1800), w('2018,', 1800, 2200)];
  const beats = matchAccent(acc(0.5, 'spotlight', { entityId: 'lbj', step: '2017-18' }), both, SYNC_FACTS);
  assert.equal(beats.rule, 'step');
  assert.equal(beats.word?.startMs, 1800, 'the year, not the surname at 0ms');
});

t('matchAccent: no word means no match, and no invented position', () => {
  const miss = matchAccent(acc(0.42, 'callout', { entityId: 'nobody' }, '9,999'), B0, SYNC_FACTS);
  assert.equal(miss.rule, 'none');
  assert.equal(miss.word, null);
});

t('matchAccent prefers a word an earlier accent has not already claimed', () => {
  const twice = [w('James', 0, 400), w('James', 5000, 5400)];
  const a = acc(0.1, 'zoom', { entityId: 'lbj' });
  const first = matchAccent(a, twice, SYNC_FACTS);
  const second = matchAccent(a, twice, SYNC_FACTS, new Set([first.word!]));
  assert.equal(first.word?.startMs, 0);
  assert.equal(second.word?.startMs, 5000);
});

t('spaceAccents pushes a too-close pair apart around its midpoint', () => {
  const { ts, moved } = spaceAccents([0.50, 0.52]);
  assert.deepEqual(moved, [true, true], 'neither is privileged and neither is dropped');
  assert.ok(Math.abs(ts[1] - ts[0] - MIN_ACCENT_GAP) < 1e-9);
  assert.ok(Math.abs((ts[0] + ts[1]) / 2 - 0.51) < 1e-9, 'the midpoint is preserved');
  const far = spaceAccents([0.2, 0.5, 0.9]);
  assert.deepEqual(far.moved, [false, false, false], 'and a legal beat is left alone');
});

t('spaceAccents keeps the whole run inside [0,1]', () => {
  const low = spaceAccents([0.0, 0.01]);
  assert.equal(low.ts[0], 0);
  assert.ok(Math.abs(low.ts[1] - MIN_ACCENT_GAP) < 1e-9);
  const high = spaceAccents([0.99, 1.0, 1.0]);
  assert.ok(high.ts.every((x) => x >= 0 && x <= 1), high.ts.join(', '));
  assert.ok(Math.abs(high.ts[2] - 1) < 1e-9);
  for (let i = 1; i < 3; i++) {
    assert.ok(high.ts[i] - high.ts[i - 1] >= MIN_ACCENT_GAP - 1e-9, high.ts.join(', '));
  }
});

const syncDraft: Draft = {
  title: 'chase',
  beats: [
    { text: 'LeBron James reached 11,829 rebounds.', entityId: 'lbj', accents: [
      acc(0.2, 'callout', { entityId: 'lbj', step: '2017-18' }, '11,829 short'),
      acc(0.9, 'zoom', { entityId: 'lbj', step: '2017-18' }),
    ] as any },
    { text: "Wilt Chamberlain's record of 23,924 came in 2018.", entityId: 'lbj', accents: [
      acc(0.1, 'refline', { entityId: 'lbj', record: true }, '23,924'),
      acc(0.5, 'arrow', { entityId: 'lbj', record: true }),
      acc(0.8, 'spotlight', { entityId: 'lbj', step: '2017-18' }),
    ] as any },
  ],
};
const syncBeats = [{ startMs: 0, endMs: 10_000 }, { startMs: 10_000, endMs: 20_000 }];
const snapped = snapDraft(syncDraft, syncBeats, [...B0, ...B1], SYNC_FACTS);

t('snapDraft finishes each accent’s ease-in exactly as its word begins', () => {
  const fire = (b: number, k: number) => syncBeats[b].startMs + snapped.draft.beats[b].accents![k].t * 10_000;
  assert.ok(Math.abs(fire(0, 0) - (7000 - ACCENT_LAND_MS)) < 1, `beat 0 callout fired at ${fire(0, 0)}`);
  assert.ok(Math.abs(fire(0, 1) - (500 - ACCENT_LAND_MS)) < 1);
  assert.ok(Math.abs(fire(1, 0) - (12_500 - ACCENT_LAND_MS)) < 1);
  assert.ok(Math.abs(fire(1, 2) - (14_000 - ACCENT_LAND_MS)) < 1);
  // and the report says which rule placed each of them
  assert.deepEqual(snapped.report.accents.map((a) => a.rule),
    ['digits', 'entity', 'digits', 'record', 'step']);
  assert.equal(snapped.report.matched, 5);
  assert.equal(snapped.report.unmatched, 0);
});

t('snapDraft does not mutate the draft it was given', () => {
  assert.equal(syncDraft.beats[0].accents![0].t, 0.2, 'the authored t is still authored');
  assert.equal(syncDraft.beats[1].accents![2].t, 0.8);
  assert.notEqual(snapped.draft.beats[0].accents, syncDraft.beats[0].accents);
  assert.equal(snapped.draft.beats[0].text, syncDraft.beats[0].text, 'and the script is untouched');
});

t('snapDraft keeps the authored t when no word matches, and says so', () => {
  const orphan: Draft = {
    title: 'x',
    beats: [{ text: 'nothing measurable here.', entityId: 'lbj', accents: [acc(0.42, 'zoom', { entityId: 'nobody' })] as any }],
  };
  const r = snapDraft(orphan, [{ startMs: 0, endMs: 10_000 }], B0, SYNC_FACTS);
  assert.equal(r.draft.beats[0].accents![0].t, 0.42);
  assert.equal(r.report.accents[0].rule, 'none');
  assert.equal(r.report.accents[0].snappedDriftMs, null, 'there is no drift to report against no word');
  assert.equal(r.report.unmatched, 1);
});

t('snapDraft restores the 0.12 spacing when two words are too close together', () => {
  const tight: Draft = {
    title: 'x',
    beats: [{ text: 'James reached 11,829 rebounds.', entityId: 'lbj', accents: [
      acc(0.1, 'callout', { entityId: 'lbj' }, '11,829'),
      acc(0.9, 'zoom', { entityId: 'lbj' }, 'rebounds 11,829'),
    ] as any }],
  };
  // both accents name the same number, so both snap onto words 500ms apart
  const r = snapDraft(tight, [{ startMs: 0, endMs: 10_000 }], B0, SYNC_FACTS);
  const [a, b] = r.draft.beats[0].accents!.map((x) => x.t);
  assert.ok(Math.abs(b - a) >= MIN_ACCENT_GAP - 1e-9, `${a} and ${b} are still too close`);
  assert.deepEqual(r.report.spacedBeats, [0]);
  assert.ok(r.report.accents.every((x) => x.spaced), 'and the report marks the accents it moved');
});

t('snapDraft measures when each beat’s anchored NUMBER is spoken', () => {
  // beat 0 anchors 2017-18, whose series value is 11,829 — spoken at 7.0s,
  // not at the 0.68-of-the-beat ramp's 6.8s
  assert.equal(snapped.draft.beats[0].arriveMs, 7000);
  assert.equal(snapped.report.arrivals[0].value, 11_829);
  assert.equal(snapped.report.arrivals[0].rampArriveMs, 6800);
  assert.equal(snapped.report.arrivals[0].rampDriftMs, -200);
  // beat 1 anchors the same step but never says the number: no arrival, and
  // the ramp stays in charge rather than a guess being invented
  assert.equal(snapped.draft.beats[1].arriveMs, undefined);
  assert.equal(snapped.report.arrivals[1].arriveMs, null);
});

t('driftStats is the median of the ABSOLUTE drift, with the over-half-second count', () => {
  const s1 = driftStats([-1930, 3810, null, 120]);
  assert.equal(s1.n, 3);
  assert.equal(s1.median, 1930);
  assert.equal(s1.worst, 3810);
  assert.equal(s1.over500, 2);
  assert.deepEqual(driftStats([null, null]), { n: 0, median: 0, worst: 0, over500: 0 });
});

/* ------------------------- the line arriving on the word, not on a fraction */

const arriveChase: Beat[] = chase.map((b, i) => (i === 0 ? { ...b, arriveMs: 900 } : b));

t('revealExtentAt eases the line to its target at arriveMs, not at 0.68 of the beat', () => {
  const at = (ms: number) => revealExtentAt(arriveChase, 'lbj', ms, stepAt);
  assert.ok(at(680) < 0.25 - 1e-6, `the ramp used to be finished here: ${at(680)}`);
  assert.ok(Math.abs(at(900) - 0.25) < 1e-9, `expected the target at arriveMs, got ${at(900)}`);
  assert.ok(Math.abs(at(999) - 0.25) < 1e-9, 'and it rests there for the rest of the beat');
  let prev = -1;
  for (let ms = 0; ms <= 5200; ms += 25) {
    const e = at(ms);
    assert.ok(e >= prev - 1e-9, `the line went backwards at ms=${ms}`);
    prev = e;
  }
});

t('revealExtentAt keeps the ramp for a beat with no measured arrival', () => {
  // the other four beats of the same fixture carry no arriveMs at all
  assert.ok(Math.abs(revealExtentAt(arriveChase, 'lbj', 2680, stepAt) - 0.5) < 1e-9);
  assert.ok(Math.abs(revealExtentAt(chase, 'lbj', 680, stepAt) - 0.25) < 1e-9, 'unchanged without one');
});

t('revealExtentAt ignores an arriveMs belonging to another series', () => {
  // beat 2 narrates 'b' and carries its arrival; series 'a' is not what that
  // word timed, so 'a' falls back to its own ramp.
  const mixed: Beat[] = race.map((b, i) => (i === 1 ? { ...b, arriveMs: 1100 } : b));
  assert.equal(revealExtentAt(mixed, 'b', 1100, stepAt), 1, 'b arrives on its word');
  assert.ok(Math.abs(revealExtentAt(mixed, 'a', 680, stepAt) - 1) < 1e-9, 'a keeps its own ramp');
});


/* --------------------------------------------------- accent.ts / verify.ts:
   the `span` — an accent about the DISTANCE between two anchors.

   It exists because seven of the nine beats of out/draft-371e3032.json made a
   claim the picture could not draw, and two of them gave the game away by
   writing the relation into an arrow's TEXT ("11,829 short", "14 seasons").
   A label is not a measurement. These pin the three properties that make a
   span different from every other accent: two anchors, a computed number, and
   no authored text. */

const spanBrief = {
  ...miniBrief,
  facts: { ...miniBrief.facts, record: chaseRecord },
} as unknown as WriterBrief;

const spanBeat = (accents: any[]) => ({
  title: 't',
  beats: [{
    text: 'Alpha One sits at 100, but the record is still 50 clear.', entityId: 'p1',
    accents, ending: 'thesis' as const,
  }],
});

t('verifyDraft accepts a span with two resolvable anchors', () => {
  // `beat-count` is dropped throughout this block: miniBrief pins a 2-beat
  // script and these fixtures are one beat, which is not what they test.
  const v = verifyDraft(spanBeat([
    { t: 0.4, kind: 'span' as const, at: { entityId: 'p1' }, to: { entityId: 'p1', record: true as const } },
  ]), spanBrief).filter((x) => x.rule !== 'beat-count');
  assert.deepEqual(v, [], `a legal span must pass cleanly, got ${JSON.stringify(v)}`);
});

t('verifyDraft rejects a span whose second anchor is missing or unresolvable', () => {
  const missing = verifyDraft(spanBeat([{ t: 0.4, kind: 'span' as const, at: { entityId: 'p1' } }]), spanBrief)
    .filter((v) => v.rule === 'accent-anchor');
  assert.equal(missing.length, 1, 'a span with no `to` measures nothing');
  assert.ok(missing[0].detail.includes('no to'), missing[0].detail);

  // Unresolvable the three ways an `at` can be: unknown entity, unknown step,
  // and the record line on a brief that has no record.
  const unknownEntity = verifyDraft(spanBeat([
    { t: 0.4, kind: 'span' as const, at: { entityId: 'p1' }, to: { entityId: 'ghost' } },
  ]), spanBrief).filter((v) => v.rule === 'accent-anchor');
  assert.equal(unknownEntity.length, 1);
  assert.ok(unknownEntity[0].detail.includes('to points at unknown entityId'), unknownEntity[0].detail);

  const unknownStep = verifyDraft(spanBeat([
    { t: 0.4, kind: 'span' as const, at: { entityId: 'p1' }, to: { entityId: 'p1', step: '1996-97' } },
  ]), spanBrief).filter((v) => v.rule === 'accent-anchor');
  assert.equal(unknownStep.length, 1);
  assert.ok(unknownStep[0].detail.includes('1996-97'), unknownStep[0].detail);

  // Same rule that already guards `at.record`, now reachable through `to`:
  // miniBrief has no facts.record, so the chart would resolve nothing.
  const noRecord = verifyDraft(spanBeat([
    { t: 0.4, kind: 'span' as const, at: { entityId: 'p1' }, to: { entityId: 'p1', record: true as const } },
  ]), miniBrief).filter((v) => v.rule === 'accent-anchor');
  assert.equal(noRecord.length, 1);
  assert.ok(noRecord[0].detail.includes('to.record'), noRecord[0].detail);
});

t('verifyDraft rejects an authored label on a span, because the number is computed', () => {
  const v = verifyDraft(spanBeat([
    { t: 0.4, kind: 'span' as const, at: { entityId: 'p1' }, to: { entityId: 'p1', record: true as const }, text: '11,829' },
  ]), spanBrief).filter((x) => x.rule !== 'beat-count');
  assert.equal(v.length, 1, JSON.stringify(v));
  assert.equal(v[0].rule, 'accent-text');
  assert.ok(v[0].detail.includes('computed'), v[0].detail);
});

t('verifyDraft rejects a second anchor on any kind that is not a span', () => {
  const v = verifyDraft(spanBeat([
    { t: 0.4, kind: 'arrow' as const, at: { entityId: 'p1' }, to: { entityId: 'p1' }, text: 'up' },
  ]), spanBrief).filter((x) => x.rule === 'accent-anchor');
  assert.equal(v.length, 1);
  assert.ok(v[0].detail.includes('only a span'), v[0].detail);
});

/* ------------------------------- sync.ts: a span snaps on its OWN number ---
   Every other accent is matched on digits it carries in `text`. A span
   carries none by design, so the snap derives the same number the chart
   draws and matches the word that says it. Without this a span would be the
   one accent that could not land on its word. */

const SPAN_FACTS = {
  entities: [{
    id: 'lbj', first: 'LeBron', last: 'James',
    series: [{ step: '2024-25', value: 11_829 }, { step: '2025-26', value: 12_095 }],
  }],
  record: { holder: 'Wilt Chamberlain', value: 23_924 },
};
const SPAN_WORDS = [w('He', 0, 400), w('still', 400, 800), w('trails', 800, 1200),
                    w('Chamberlain', 1200, 1800), w('by', 1800, 2100),
                    w('11,829', 4000, 4600), w('rebounds.', 4600, 5000)];
const headToRecord = { t: 0.5, kind: 'span' as const, at: { entityId: 'lbj' }, to: { entityId: 'lbj', record: true as const } };

t('spanValue is the gap between the two anchors — 23,924 − 12,095', () => {
  assert.equal(spanValue(headToRecord, SPAN_FACTS), 11_829);
  // a step-less anchor is the series' final point, the same reading the chart
  // gives it; two steps measure between those two points
  assert.equal(spanValue({ ...headToRecord, at: { entityId: 'lbj', step: '2024-25' }, to: { entityId: 'lbj', step: '2025-26' } }, SPAN_FACTS), 266);
  // and nothing is invented when an anchor resolves to no value at all
  assert.equal(spanValue(headToRecord, { entities: SPAN_FACTS.entities, record: { holder: 'Wilt Chamberlain' } }), null);
  assert.equal(spanValue({ ...headToRecord, to: { entityId: 'ghost' } }, SPAN_FACTS), null);
  assert.equal(spanValue({ t: 0.5, kind: 'callout' as const, at: { entityId: 'lbj' }, text: '12,095' }, SPAN_FACTS), null,
    'only a span has a span number');
});

t('matchAccent lands a span on the word that says its computed number', () => {
  const m = matchAccent(headToRecord, SPAN_WORDS, SPAN_FACTS);
  assert.equal(m.rule, 'digits', 'the derived number is matched by the same digits-first rule as an authored one');
  assert.equal(m.word?.text, '11,829');
  // With no record value there is no number to derive. The span then falls
  // through every remaining rule — its own anchor names no year and no
  // surname the voice said — and keeps its authored t rather than being
  // placed on a word that means something else.
  const noValue = matchAccent(headToRecord, SPAN_WORDS, { entities: SPAN_FACTS.entities, record: { holder: 'Wilt Chamberlain' } });
  assert.equal(noValue.rule, 'none');
  assert.equal(noValue.word, null);
});

t('snapDraft finishes a span’s ease-in as its number is spoken, and reports that number', () => {
  const draft: Draft = {
    title: 'gap',
    beats: [{ text: 'He still trails Chamberlain by 11,829 rebounds.', entityId: 'lbj', accents: [headToRecord] }],
  };
  const r = snapDraft(draft, [{ startMs: 0, endMs: 10_000 }], SPAN_WORDS, SPAN_FACTS);
  const fire = r.draft.beats[0].accents![0].t * 10_000;
  assert.ok(Math.abs(fire - (4000 - ACCENT_LAND_MS)) < 1, `the span fired at ${fire}`);
  assert.equal(r.report.accents[0].rule, 'digits');
  assert.equal(r.report.accents[0].label, 'span 11829', 'the report shows the number the bracket draws');
  assert.equal(r.report.accents[0].snappedDriftMs, -ACCENT_LAND_MS);
});

/* ------------------------------------ brief.ts: markers a chart can DRAW ---
   detectMarkers answers "what is interesting in this data". That is not the
   same question as "what can this picture show", and the difference is
   measurable: the 371e3032 brief carried 42 award markers for a rebounds
   chart, and two of the nine beats it produced talked about MVPs and
   championships — claims the chart has no means to answer. */

const markerFixture: Marker[] = [
  { entityId: 'p1', kind: 'award', detail: 'Most Valuable Player (2013)', step: '2012-13' },
  { entityId: 'p1', kind: 'undrafted', detail: 'went undrafted' },
  { entityId: 'p1', kind: 'jump', detail: '900 in 2013-14, 2.1x their usual', step: '2013-14' },
  { entityId: 'p1', kind: 'missed-season', detail: 'no games in 2014-15', step: '2014-15' },
  { entityId: 'p1', kind: 'record-gap', detail: '11829 rebounds short', value: 11_829 },
];

t('a brief only offers markers the chosen chart can draw', () => {
  const chase = expressibleMarkers(markerFixture, 'cumulative-record-chase').map((m) => m.kind);
  assert.deepEqual(chase, ['jump', 'missed-season', 'record-gap'],
    'no award and no draft position on a chart that draws neither');

  const race = expressibleMarkers(markerFixture, 'cumulative-multiline').map((m) => m.kind);
  assert.deepEqual(race, ['jump', 'missed-season'],
    'and a chart with no record line cannot draw a record gap either');

  // A chart nobody has wired keeps every marker: silence is not a claim that
  // it can draw none of them.
  assert.equal(expressibleMarkers(markerFixture, 'ranked-bar').length, markerFixture.length);
  assert.deepEqual(Object.keys(EXPRESSIBLE_MARKERS).sort(), [...WIRED_CHARTS].sort(),
    'only the wired charts declare a set');
});

t('assembleBrief filters the markers it detected, so 42 awards never reach the writer', () => {
  const awards = Array.from({ length: 4 }, (_, k) => ({ name: 'Most Valuable Player', season: `201${k}-1${k + 1}` }));
  const b = assembleBrief({
    topic: { id: 'chase', question: 'Can he catch it?', angle: 'chase', lane: 'evergreen', hook_seed: 'x' },
    unit: 'rebounds',
    seasons: ['2003-04', '2004-05', '2005-06'],
    entities: [entity({ id: '1966', name: 'LeBron James', first: 'LeBron', last: 'James', total: 1576, seasons_played: 3,
      series: [{ step: '2003-04', value: 432 }, { step: '2004-05', value: 1020 }, { step: '2005-06', value: 1576 }],
      awards })],
    cumulative: true, record: recordFor('REB')!,
  });
  assert.equal(b.visual.chart, 'cumulative-record-chase');
  assert.equal(b.facts.markers.filter((m) => m.kind === 'award').length, 0,
    'the chart has no way to show an award, so the brief does not offer one');
  assert.ok(b.facts.markers.some((m) => m.kind === 'record-gap'), 'and the gap it CAN draw survives');
  // The detector itself is untouched — another chart may want awards later.
  assert.equal(detectMarkers(b.facts.entities, b.visual.anchor_steps, b.facts.record)
    .filter((m) => m.kind === 'award').length, 4);
});

/* ------------------------------------------- espn.ts / teams.ts: the career
   changed team three times and the picture said so nowhere.

   The per-season team is already in the response `seasonRows` reads, so it
   costs nothing; a per-season PHOTO exists at no reachable URL, so the jersey
   in the portrait cannot change. Marks on the line at the seasons it changed,
   and a portrait ring in the current team's colour, are what the data we do
   have can honestly draw. */

const traded = {
  categories: [{
    name: 'totals', labels: ['GP', 'REB'],
    statistics: [
      { season: { displayName: '2024-25' }, teamSlug: 'brooklyn-nets', stats: ['33', '300'] },
      { season: { displayName: '2024-25' }, teamSlug: 'la-clippers', stats: ['18', '150'] },
      { season: { displayName: '2024-25' }, teamSlug: '2024-25 Totals', stats: ['51', '450'] },
      { season: { displayName: '2025-26' }, teamSlug: 'la-clippers', stats: ['70', '700'] },
    ],
  }],
};

t('seasonTeams credits a traded season to the team with the most games, never to the roll-up row', () => {
  assert.deepEqual(seasonTeams(traded, 'totals'), [
    { season: '2024-25', team: 'brooklyn-nets' },
    { season: '2025-26', team: 'la-clippers' },
  ]);
  assert.deepEqual(seasonTeams(traded, 'averages'), [], 'and an absent category is no teams, not a crash');
  // The values it reads alongside are unchanged — two separate questions.
  assert.deepEqual(seasonRows(traded, 'totals', 'REB').map((r) => r.value), [450, 700]);
});

t('teamBySlug resolves ESPN’s own slugs, and an unknown one degrades to null', () => {
  assert.equal(teamSlug('Los Angeles Lakers'), 'los-angeles-lakers');
  assert.equal(teamSlug('LA Clippers'), 'la-clippers');
  assert.equal(teamSlug('Philadelphia 76ers'), 'philadelphia-76ers');
  assert.equal(teamBySlug('cleveland-cavaliers')?.abbr, 'CLE');
  assert.equal(teamBySlug('miami-heat')?.abbr, 'MIA');
  assert.equal(teamBySlug('los-angeles-lakers')?.logo, 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png');
  assert.equal(teamBySlug('seattle-supersonics'), null);
  assert.equal(teamBySlug(undefined), null);
});

t('teamChanges marks the seasons a career TURNS, not every season it has', () => {
  // LeBron James, 23 seasons: Cleveland, Miami from 2010-11, Cleveland again
  // from 2014-15, Los Angeles from 2018-19. Three marks, not twenty-three.
  const career = [
    ...Array.from({ length: 7 }, () => ({ team: 'cleveland-cavaliers' })),
    ...Array.from({ length: 4 }, () => ({ team: 'miami-heat' })),
    ...Array.from({ length: 4 }, () => ({ team: 'cleveland-cavaliers' })),
    ...Array.from({ length: 8 }, () => ({ team: 'los-angeles-lakers' })),
  ];
  assert.equal(career.length, 23);
  assert.deepEqual(teamChanges(career), [7, 11, 15]);
  assert.deepEqual(teamChanges([{ team: 'miami-heat' }]), [], 'one team is no turns');
  assert.deepEqual(teamChanges([{}, {}]), [], 'and a series with no team data is no turns either');
});

t('every team colour survives this ground — the ring is readable or it is not a ring', () => {
  const ground = '#101319';
  for (const slug of ['cleveland-cavaliers', 'miami-heat', 'los-angeles-lakers', 'san-antonio-spurs', 'brooklyn-nets']) {
    const raw = teamBySlug(slug)!.color;
    const lifted = ensureContrast(raw, ground);
    assert.ok(contrastRatio(lifted, ground) >= 2.6,
      `${slug}: ${raw} -> ${lifted} is still ${contrastRatio(lifted, ground).toFixed(2)}:1 on the ground`);
  }
  // Cleveland's wine and Miami's red genuinely need it — this is not a no-op.
  assert.ok(contrastRatio(teamBySlug('cleveland-cavaliers')!.color, ground) < 2.6);
  assert.ok(contrastRatio(teamBySlug('miami-heat')!.color, ground) < 2.6);
});


console.log(`\n${n} assertions passed.`);

