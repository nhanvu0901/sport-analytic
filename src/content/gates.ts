/**
 * The YouTube coverage probe and g3 (data-available). g3 is a real gate: a
 * topic we cannot get data for is worse than no topic, because it fails
 * after the expensive steps.
 *
 * The coverage probe used to be g2, a gate ported straight from
 * comic-book-pipeline: there, a competitor already covering a question is a
 * real reason to skip — that market is small, and making the same video
 * means competing head-on for the same query. Basketball is the opposite:
 * thousands of channels cover the same topics, the source channel itself
 * made "Salary Cap Breakdown" forty times, and audiences happily watch the
 * same subject from several creators. Worse, this project exists to
 * reproduce a format that already works — a competitor having made it is
 * EVIDENCE the topic lands, not a reason to avoid it. The only overlap worth
 * blocking is with OUR OWN back catalogue (that's g0, `isBurned` against our
 * ledger — free, pure, reliable). So this probe no longer renders a verdict:
 * it just reports what it found, for a human to read.
 */
import { api, findAthleteId, seasonRows } from '../espn';
import { tokens } from './ledger';
import { searchSite, type TavilyHit } from './tavily';
import type { Coverage, GateVerdict } from './types';

/* ------------------------------------------------------- coverage (was g2) */

/** Pure scoring result: the best-matching hit (if any cleared the
 *  containment floor) and how many hits were searched. No verdict — that
 *  concept left with g2; this is reported, never judged. */
export type SameFormatScore = {
  checked: number;
  topTitle?: string;
  topUrl?: string;
  score?: number;
};

/** Tavily appends "<title> - YouTube" / "<title> | YouTube" to every hit;
 *  strip it before tokenising or it pads containment against every title. */
function stripYouTubeSuffix(title: string): string {
  return title.replace(/\s*[-|]\s*YouTube\s*$/i, '');
}

/**
 * Same containment rule as isBurned (ledger.ts) — >=60% of the shorter
 * side's tokens shared, and >=2 tokens — run against YouTube search hits
 * instead of our own produced-question digest. PURE: probeCoverage does the
 * search, this just scores it.
 *
 * NOT graded into a verdict anymore. It used to be — >=0.85 failed outright,
 * 0.60-0.85 was a "pending" collision for a human to eyeball, because a
 * single 0.6 cutoff turned out to treat a judgement call as a fact:
 * "2019 NBA Draft - Total Points Scored" scores exactly 0.600 against the
 * unrelated "He Scored 138 Points in ONE GAME... Why Did NO ONE Draft Him?"
 * because the three shared tokens (draft/points/scored) are domain filler
 * that shows up in nearly every NBA stats title. That banding mattered when
 * the score could block a candidate. Now that this is a pure information
 * line and nothing here ever blocks Accept, the banding has no job left to
 * do — the caller (probeCoverage) just reports the single highest-scoring
 * hit and its score, and a human reads the title. The token-containment
 * rule itself (>=2 shared tokens, >=60% of the shorter side) is unchanged
 * and still exactly isBurned's, because it is tested and it works.
 */
export function judgeSameFormat(question: string, hits: TavilyHit[]): SameFormatScore {
  if (hits.length === 0) return { checked: 0 };
  const qt = tokens(question);
  let best: { hit: TavilyHit; score: number } | null = null;
  for (const hit of hits) {
    const tt = tokens(stripYouTubeSuffix(hit.title));
    if (qt.size === 0 || tt.size === 0) continue;
    let shared = 0;
    for (const w of qt) if (tt.has(w)) shared++;
    if (shared < 2) continue;
    const score = shared / Math.min(qt.size, tt.size);
    if (!best || score > best.score) best = { hit, score };
  }
  if (!best) return { checked: hits.length };
  return { checked: hits.length, topTitle: best.hit.title, topUrl: best.hit.url, score: best.score };
}

/**
 * Entry point for the discovery pipeline: search YouTube, score the hits,
 * and hand back a human-readable note. NO VERDICT, NEVER BLOCKS — see the
 * module doc comment for why this stopped being a gate.
 */
export async function probeCoverage(question: string): Promise<Coverage> {
  let hits: TavilyHit[];
  try {
    hits = await searchSite(question, ['youtube.com'], 6);
  } catch (e) {
    // A dead search is a missing data point, not a verdict — checked: 0 says so.
    return { checked: 0, note: `coverage check failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = judgeSameFormat(question, hits);
  if (r.topTitle && r.score !== undefined) {
    return { ...r, note: `${r.checked} similar videos on YouTube; closest (${r.score.toFixed(2)}): ${r.topTitle}` };
  }
  return { checked: r.checked, note: `no similar video in ${r.checked} results` };
}

/* --------------------------------------------------------- g3: data available */

export type MeasureProbe = { label: string; espnLabel: string | null; category: 'totals' | 'averages' | null };

type MeasureRule = { words: string[]; codes: string[]; espnLabel: string; forceCategory?: 'averages' };

// First-match-wins, in the order the design specifies. `words` match as a
// plain substring (so "blocks" still hits "block"); `codes` are short
// abbreviations (ppg, ft, gp…) matched on a word boundary instead, since a
// bare substring check on 2-3 letters collides with ordinary words (e.g.
// "ft" inside "draft") far too easily to trust unguarded.
const MEASURE_RULES: MeasureRule[] = [
  { words: ['points', 'scoring'], codes: ['ppg'], espnLabel: 'PTS' },
  { words: ['rebound'], codes: ['rpg'], espnLabel: 'REB' },
  { words: ['assist'], codes: ['apg'], espnLabel: 'AST' },
  { words: ['block'], codes: ['bpg'], espnLabel: 'BLK' },
  { words: ['steal'], codes: ['spg'], espnLabel: 'STL' },
  { words: ['three', '3-point'], codes: ['3pt'], espnLabel: '3PT' },
  { words: ['free throw'], codes: ['ft'], espnLabel: 'FT' },
  { words: ['field goal'], codes: ['fg'], espnLabel: 'FG' },
  { words: ['minute'], codes: ['mpg'], espnLabel: 'MIN' },
  { words: ['game played', 'games'], codes: ['gp'], espnLabel: 'GP', forceCategory: 'averages' }, // GP only exists in averages
  { words: ['turnover'], codes: [], espnLabel: 'TO' },
  { words: ['foul'], codes: [], espnLabel: 'PF' },
];

const AVERAGING_PHRASE = /per game|ppg|average/;

export function inferMeasure(measurableAs: string): MeasureProbe {
  const text = (measurableAs || '').toLowerCase();
  for (const rule of MEASURE_RULES) {
    const wordHit = rule.words.some((w) => text.includes(w));
    const codeHit = rule.codes.some((c) => new RegExp(`\\b${c}\\b`).test(text));
    if (wordHit || codeHit) {
      const category = rule.forceCategory ?? (AVERAGING_PHRASE.test(text) ? 'averages' : 'totals');
      return { label: rule.espnLabel, espnLabel: rule.espnLabel, category };
    }
  }
  // Advanced/derived measures (on-off, rim deterrence, net rating…) have no
  // ESPN column at all — that's a fail in gateDataAvailable, not a crash here.
  return { label: measurableAs.trim().slice(0, 80), espnLabel: null, category: null };
}

export type DataAvailableResult = {
  verdict: GateVerdict;
  resolved: { name: string; id: string | null }[];
  measure: MeasureProbe;
  note: string;
  // What was actually checked, so the UI can show it rather than take the
  // verdict on faith. `rows`/`sum` are 0 for an entity ESPN has nothing for.
  probed: { name: string; id: string | null; rows: number; sum: number }[];
};

export async function gateDataAvailable(c: { entities: string[]; measurable_as: string }): Promise<DataAvailableResult> {
  const measure = inferMeasure(c.measurable_as);
  if (measure.espnLabel === null) {
    return {
      verdict: 'fail',
      resolved: [],
      measure,
      note: `no ESPN stat matches "${measure.label}" — advanced/derived measures (on-off, rim deterrence, net rating) are not in our sources`,
      probed: [],
    };
  }

  const names = c.entities.slice(0, 4);
  try {
    // Sequential: findAthleteId is disk-cached, so a burst here buys nothing.
    const resolved: { name: string; id: string | null }[] = [];
    for (const name of names) resolved.push({ name, id: await findAthleteId(name) });

    const found = resolved.filter((r) => r.id);
    if (found.length === 0) {
      return { verdict: 'fail', resolved, measure, note: `could not resolve any of: ${names.join(', ')}`, probed: [] };
    }

    // Probe EVERY resolved entity (up to 4), not just the first — checking
    // only entity #1 is exactly how a candidate about Wilt Chamberlain's
    // rebounds record passed g3 on LeBron James's data alone, while Wilt's
    // own rebounds (the actual subject) came back 5 seasons of zeros.
    const probed: { name: string; id: string | null; rows: number; sum: number }[] = [];
    for (const r of found) {
      const stats = await api.athleteStats(r.id!);
      const rows = seasonRows(stats, measure.category!, measure.espnLabel);
      const sum = rows.reduce((s, x) => s + x.value, 0);
      probed.push({ name: r.name, id: r.id, rows: rows.length, sum });
    }

    const usable = probed.filter((p) => p.rows > 0 && p.sum !== 0);
    if (usable.length >= 2) {
      return {
        verdict: 'pass',
        resolved,
        measure,
        probed,
        note: `${usable.length}/${probed.length} probed entities have usable ${measure.espnLabel} data`,
      };
    }

    const empty = probed.filter((p) => p.rows === 0).map((p) => p.name);
    const zero = probed.filter((p) => p.rows > 0 && p.sum === 0).map((p) => p.name);
    const detail = [
      empty.length ? `no ${measure.espnLabel} rows for ${empty.join(', ')}` : null,
      zero.length ? `${measure.espnLabel} is zero for ${zero.join(', ')}` : null,
    ].filter(Boolean).join('; ');
    return {
      verdict: 'fail',
      resolved,
      measure,
      probed,
      note: `only ${usable.length}/${probed.length} probed entities have usable ${measure.espnLabel} data — ${detail}`,
    };
  } catch (e) {
    // A dead endpoint is not a verdict about the topic.
    return { verdict: 'pending', resolved: [], measure, note: e instanceof Error ? e.message : String(e), probed: [] };
  }
}
