/**
 * The picture's half of a generated video: `src/data/video-<id>.json`.
 *
 * A session already produces two files the renderer reads —
 * `draft-<id>.json` (what is said, with the accents) and `timeline-<id>.json`
 * (when it is said, measured off the WAV). Neither of them carries the CHART:
 * the seasons, the series, the record line. That third file used to be
 * hand-written per video (`src/data/reboundsChase.json`) and hand-imported
 * into `src/Root.tsx`, which is why pressing "Generate video" on a session
 * nobody had hand-wired failed, and failed cryptically.
 *
 * `videoDataFrom` derives that third file from the brief the pipeline already
 * built. Nothing here is recomputed or re-fetched: every number comes out of
 * `WriterBrief`, which `src/candidateBrief.ts` assembled from ESPN/hoopR data
 * that has already passed `seriesVerdict` and the router. Pure and exported so
 * it is unit-testable without a network call.
 *
 * Node-safe on purpose — no React, no JSON imports, no bundler magic — because
 * `server/index.ts` writes these files and `src/Root.tsx` reads them.
 */
import type { WriterBrief } from './brief';

/**
 * The chart ids that genuinely support a written draft, i.e. the ones whose
 * component reads `beats` and puts each accent where the narration says it
 * goes. Today that is the cumulative family plus the salary-cap column.
 *
 * A chart NOT on this list gets no composition at all. Wiring one anyway
 * would produce a video whose picture ignores its own narration — a chart
 * animating on a syllable estimate under a voice saying something else — and
 * that silent wrongness is worse than a button that refuses with a reason.
 *
 * `src/Root.tsx` types its chart-id -> component map as
 * `Record<WiredChart, ...>`, so adding an id here without adding the
 * component is a compile error, and vice versa.
 */
export const WIRED_CHARTS = [
  'cumulative-multiline',
  'cumulative-record-chase',
  'stacked-column-thresholds',
] as const;
export type WiredChart = (typeof WIRED_CHARTS)[number];

export const isWired = (chart: string): chart is WiredChart =>
  (WIRED_CHARTS as readonly string[]).includes(chart);

/* ------------------------------------------ a stacked column's own vocabulary
   The threshold lines live HERE, in the node-safe module both halves import,
   and not in the chart: `src/brief.ts` has to publish the keys a writer may
   name (`visual.threshold_keys`) and `src/charts/StackedColumn.tsx` has to
   resolve them to pixels, so a list written twice is a list that drifts. */

/** The five published CBA levels a payroll column is judged against. */
export type ThresholdKey = 'cap' | 'floor' | 'tax' | 'apron1' | 'apron2';

export type Thresholds = Record<ThresholdKey, number> & { season: string };

/** One part of the stack — one contract. */
export type CapRow = { id: string; name: string; last: string; value: number; headshot: string };

/**
 * The levels in the order the chart draws them, top first, with the label it
 * prints beside each. Iterated rather than hardcoded per call site so the
 * brief's key list, the chart's lines and the Markdown all come from one
 * array.
 */
export const THRESHOLD_LINES: { key: ThresholdKey; label: string }[] = [
  { key: 'apron2', label: '2nd Apron' },
  { key: 'apron1', label: '1st Apron' },
  { key: 'tax', label: 'Luxury Tax' },
  { key: 'cap', label: 'Salary Cap' },
  { key: 'floor', label: 'Salary Floor' },
];

/**
 * The sixth anchorable place on this chart: the stack's OWN top.
 *
 * Not a CBA level — it is the sum of the parts, and the chart computes it — but
 * it is the same kind of place: a height on the one y axis, reachable by an
 * `Anchor.threshold`. It has to be anchorable because the sentence this chart
 * exists for measures FROM it: "over the cap, and still 5,279,102 under the
 * tax" is a span between the payroll's top and the tax line, and neither end
 * of that measurement is a player.
 */
export const PAYROLL_KEY = 'payroll';

/** One line on the chart. Same shape as `Serie` in charts/CumulativeLines. */
export type VideoSerie = {
  id: string;
  name: string;
  first: string;
  last: string;
  total: number;
  headshot: string;
  /**
   * `team` is ESPN's own per-season `teamSlug`, carried from the brief so the
   * chart can mark the seasons a career changed team WITHOUT fetching
   * anything at draw time. Optional: a dataset with no per-season team (the
   * C01 cumulative.json) simply has none, and the chart draws no marks.
   */
  points: { season: string; value: number; team?: string }[];
};

export type VideoData = {
  /** The SESSION id — `brief.topic.id` is a slug of the question, not this. */
  id: string;
  /** `brief.visual.chart`. Half of the composition id; see `compositionIdFor`. */
  chart: string;
  title: string;
  sub: string;
  yLabel: string;
  /** The measure in words ("rebounds"), for a fallback line before a draft exists. */
  unit: string;
  seasons: string[];
  series: VideoSerie[];
  /** Present only for a record chase — one absolute mark, not a second series. */
  record?: { value: number; label: string };
  /**
   * A budget column's parts, biggest first, and the levels it is judged
   * against. Present only for `stacked-column-thresholds`, and when they are
   * present `seasons` and `series` are EMPTY: this chart has no time axis and
   * no lines, so a season list would be an axis nothing draws.
   */
  rows?: CapRow[];
  thresholds?: Thresholds;
};

/**
 * `<session>-<chart>`, and this string is load-bearing: the render route, the
 * ledger's `produced` line, `out/<id>.mp4` and the composition all use it.
 * `371e3032` + `cumulative-record-chase` reproduces the id the existing mp4
 * and README already carry, which is why the generic path could replace that
 * composition's hand-wiring without an alias.
 */
export const compositionIdFor = (v: { id: string; chart: string }) => `${v.id}-${v.chart}`;

/** "rebounds" -> "Rebounds". Display only. */
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The x axis, as `CumulativeLines` wants it.
 *
 * The chart places a point for season `2003-04` at x index `seasonIndex('2003') + 1`
 * — index 0 is the origin it prepends at zero. So the axis is the brief's own
 * season labels reduced to their leading year, plus ONE more year at the end,
 * or the final season's point would land short of the right-hand edge. That is
 * exactly the 24-entries-for-23-points shape the hand-written
 * `reboundsChase.json` had.
 */
function axisYears(steps: string[]): string[] {
  if (steps.length === 0) return [];
  const years = steps.map((s) => s.slice(0, 4));
  return [...years, String(Number(years[years.length - 1]) + 1)];
}

/** ESPN's own headshot path, keyed by the athlete id the brief resolved. An
 *  entity that only resolved through hoopR has no ESPN id and its portrait will
 *  404 — visible, and better than a placeholder that hides which entity came
 *  from where. */
const headshotFor = (id: string) =>
  `https://a.espncdn.com/i/headshots/nba/players/full/${id}.png`;

export function videoDataFrom(sessionId: string, brief: WriterBrief): VideoData {
  const unit = brief.facts.unit;
  const measure = titleCase(unit);
  const record = brief.facts.record;
  const budget = brief.facts.budget;

  // A budget column is a different chart in the strict sense: its x axis is
  // PEOPLE, not time, so none of the axis derivation below applies. Returned
  // early rather than folded in with empty-array special cases, because the
  // two shapes share only the four header strings.
  if (budget) {
    return {
      id: sessionId,
      chart: brief.visual.chart,
      title: brief.topic.question,
      sub: `${budget.subject} · ${budget.season}`,
      yLabel: `Committed ${unit}`,
      unit,
      seasons: [],
      series: [],
      // Biggest contract first, which is the order `StackedColumn` stacks in
      // (it reverses this to build from the floor upward) and the order the
      // brief's own tables and `facts.budget.concentration` are in.
      rows: [...brief.facts.entities]
        .sort((a, b) => b.total - a.total)
        .map((e) => ({ id: e.id, name: e.name, last: e.last, value: e.total, headshot: headshotFor(e.id) })),
      thresholds: {
        season: budget.season,
        ...(Object.fromEntries(budget.lines.map((l) => [l.key, l.value])) as Record<ThresholdKey, number>),
      },
    };
  }

  return {
    id: sessionId,
    chart: brief.visual.chart,
    // The question IS the title — the same string the brief was built to
    // answer, so the picture and the ledger row cannot drift apart. A written
    // draft overrides it later (`stageFor` prefers `draft.title`); this is
    // what shows before one exists.
    title: brief.topic.question,
    sub: record ? `Career ${measure} vs the All-Time Record` : `Total ${measure}`,
    yLabel: `Total ${measure}`,
    unit,
    seasons: axisYears(brief.visual.anchor_steps),
    series: brief.facts.entities.map((e) => ({
      id: e.id,
      name: e.name,
      first: e.first,
      last: e.last,
      total: e.total,
      headshot: headshotFor(e.id),
      points: e.series.map((p) => ({ season: p.step, value: p.value, ...(p.team ? { team: p.team } : {}) })),
    })),
    ...(record ? { record: { value: record.value, label: record.label } } : {}),
  };
}
