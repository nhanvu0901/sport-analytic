/** Plain assertions, no framework. `npm test`. */
import assert from 'node:assert/strict';
import { seasonRows, cumulate } from '../src/espn';
import { scaleLinear, niceTicks, fitRows, binGrid, countRadius, ensureContrast, contrastRatio } from '../src/scale';
import teams from '../src/data/teams.json';

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

console.log(`\n${n} assertions passed.`);
