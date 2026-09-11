/**
 * Bridges an accepted Discover candidate into a WriterBrief — the missing
 * link between clicking Accept and having something pasteable into Gemini.
 * Every real capability this needs already exists elsewhere (inferMeasure,
 * findAthleteId, careerPoints, athleteStats/seasonRows/cumulate, athleteBio,
 * assembleBrief, route, renderBriefMd); this module only SEQUENCES those
 * calls and supplies the small bit of glue (name splitting, a unit word,
 * hook_seed selection) that has no other home.
 */
import type { Candidate } from './content/types';
import { inferMeasure } from './content/gates';
import { api, cumulate, findAthleteId, seasonRows, seasonTeams, type SeasonRow } from './espn';
import { careerPoints } from './hoopr';
import { assembleBrief, detectMarkers, normaliseStep, type Angle, type BriefEntity, type BriefInput, type Marker, type WriterBrief } from './brief';
import { recordChaseFor, type CareerRecord } from './records';
import { renderBriefMd } from './briefMd';
import { videoDataFrom, type VideoData } from './videoData';

export type ResolvedEntity = { name: string; id: string | null; source: 'espn' | 'hoopr' | 'unresolved' };

export type CandidateBriefResult =
  | {
      ok: true; brief: WriterBrief; md: string; resolved: ResolvedEntity[]; warnings: string[];
      /**
       * The picture's half of the brief — the seasons, the series and the
       * record line, in the shape `src/Root.tsx` draws. Built HERE, where the
       * data is already in hand, rather than recomputed downstream; the
       * caller writes it to `src/data/video-<id>.json`, which is the only
       * thing a new session needs before it has a composition.
       */
      video: VideoData;
    }
  | { ok: false; reason: string; resolved: ResolvedEntity[] };

const seasonKey = (label: string) => Number(label.slice(0, 4));

/**
 * inferMeasure only ever returns an ESPN short code (PTS, REB, AST…) — there
 * is no full-word form upstream, and the bridge list this module was scoped
 * to does not include one either. This lookup is display formatting only:
 * facts.unit is never read by verify.ts or briefMd.ts, so an unmapped code
 * just falls back to its own lowercase spelling rather than blocking anything.
 */
const UNIT_WORD: Record<string, string> = {
  PTS: 'points', REB: 'rebounds', AST: 'assists', BLK: 'blocks', STL: 'steals',
  '3PT': 'made threes', FT: 'free throws made', FG: 'field goals made',
  MIN: 'minutes', GP: 'games played', TO: 'turnovers', PF: 'fouls',
};

/**
 * "LeBron James" -> { first: "LeBron", last: "James" }. A candidate's
 * entities arrive as one display-name string with no structured fields, so
 * splitting on the final space is the only option available without adding
 * a name-parsing service — good enough for the NBA names this pipeline
 * handles, and it never invents a name that was not already in c.entities.
 */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts.slice(0, -1).join(' ') || parts[0], last: parts.at(-1) ?? name };
}

/**
 * The union of every entity's own season labels, ascending by the leading
 * 4-digit year. An entity missing a step contributes nothing for that step —
 * it is never backfilled, so a gap in one entity's series stays visible.
 * Exported and pure so the ordering rule is unit-testable without resolving
 * anything over the network.
 */
export function seasonUnion(entities: { series: { step: string }[] }[]): string[] {
  return [...new Set(entities.flatMap((e) => e.series.map((p) => p.step)))].sort((a, b) => seasonKey(a) - seasonKey(b));
}

/**
 * Whether an entity's series for the REQUESTED measure is actually usable.
 * Measured live: Wilt Chamberlain's rebounds came back as 5 seasons of
 * straight zeros (ESPN's pre-1980s totals rows silently drop REB), and
 * nothing downstream rejected that — his brief said "most in the class:
 * 12095" about LeBron James in a video about the rebounds record Wilt holds.
 * Pure and exported so the three outcomes are unit-testable without a
 * network call: `pointsTotal` is the SAME athlete's career PTS, probed
 * separately, to tell a genuine zero (points are also 0 — e.g. a player who
 * never got off the bench) apart from a data hole (points are fine, this
 * other stat just isn't in ESPN's old rows).
 */
export function seriesVerdict(
  series: { step: string; value: number }[],
  pointsTotal: number
): { usable: boolean; reason: 'ok' | 'empty' | 'all-zero-data-hole' | 'all-zero-genuine' } {
  if (series.length === 0) return { usable: false, reason: 'empty' };
  if (series.some((p) => p.value !== 0)) return { usable: true, reason: 'ok' };
  return pointsTotal > 0
    ? { usable: false, reason: 'all-zero-data-hole' }
    : { usable: false, reason: 'all-zero-genuine' };
}

/**
 * Pure and exported on purpose: the hook_seed precedence is unit-testable
 * with a synthetic markers array and no network. Fixed strings only — this
 * module is not the writer, so it never composes new prose from the
 * candidate's own facts, only selects among four pre-written options.
 */
export function deriveHookSeed(markers: Marker[], whyFansArgue: string): string {
  const has = (kind: Marker['kind']) => markers.some((m) => m.kind === kind);
  if (has('leader')) return 'The name everyone expects is not the one on top.';
  if (has('undrafted')) return 'One of them was not drafted at all.';
  if (has('missed-season')) return 'One of them lost a whole season.';
  return whyFansArgue.split(/(?<=[.!?])\s+/)[0] || whyFansArgue;
}

export async function briefFromCandidate(
  c: Candidate,
  opts?: { log?: (line: string) => void; sessionId?: string }
): Promise<CandidateBriefResult> {
  const log = opts?.log ?? (() => {});

  // 1. Same judgement g3 already made when this candidate was scored: a
  // measure with no ESPN column must fail HERE too, through the identical
  // rule — not a looser one reachable by skipping straight to a brief.
  const measure = inferMeasure(c.measurable_as);
  log(`measure "${c.measurable_as}" -> ${measure.espnLabel ?? 'no ESPN column'}`);
  if (measure.espnLabel === null) {
    return {
      ok: false,
      resolved: [],
      reason: `"${measure.label}" has no ESPN stat column — our data sources (ESPN, hoopR) do not carry this measure`,
    };
  }

  // 1b. Is this a RECORD CHASE?
  //
  // Decided from the question's own wording plus the measure, before a single
  // entity is resolved, because it changes what "enough data" means. A chase
  // needs the chaser's series and ONE number; the record holder's
  // season-by-season data is not part of the chart at all. That is the whole
  // reason this session was refusable: ESPN returns 5 of Wilt Chamberlain's
  // 14 seasons and zero rebounds, so he can never be a second series — and a
  // chase never asked him to be one.
  //
  // `recordChaseFor` refuses unless we hold a corroborated record for the
  // measure, the text reaches for the all-time board, AND the holder is
  // actually named. See src/records.ts for why all three are necessary.
  const chase = recordChaseFor(`${c.question} ${c.measurable_as}`, c.entities, measure.espnLabel);
  if (chase) {
    log(`record chase: ${chase.holder}'s ${chase.value} ${chase.unit} in ${chase.seasons} seasons (${chase.asOf})`);
  }

  // 2. Resolve entities. Sequential: findAthleteId and careerPoints are both
  // disk-cached, so a burst here would only add complexity, not speed.
  const names = c.entities.slice(0, 10);
  const resolved: ResolvedEntity[] = [];
  for (const name of names) {
    log(`resolving ${name}…`);
    const espnId = await findAthleteId(name);
    if (espnId) {
      resolved.push({ name, id: espnId, source: 'espn' });
      log(`  ${name} -> espn:${espnId}`);
      continue;
    }
    const hoopr = await careerPoints(name);
    if (hoopr) {
      resolved.push({ name, id: hoopr.id, source: 'hoopr' });
      log(`  ${name} -> hoopr:${hoopr.id} (career totals stop at 2023)`);
    } else {
      resolved.push({ name, id: null, source: 'unresolved' });
      log(`  ${name} -> not found in ESPN or hoopR`);
    }
  }

  const found = resolved.filter((r) => r.id);
  if (found.length === 0) {
    return { ok: false, resolved, reason: `could not resolve any of: ${names.join(', ')} in ESPN or hoopR` };
  }

  // 3. Per-entity series. Whether it accumulates is a property of the
  // MEASURE (a counting stat sums, an average does not) — decided once from
  // measure.category, never per entity.
  const cumulativeMeasure = measure.category === 'totals';
  const entities: BriefEntity[] = [];
  // Entities resolved fine but whose SERIES for this measure turned out
  // unusable (Fix 2) — collected so the eventual ok:false (or a warning) can
  // name names instead of just a count.
  const dropped: { name: string; detail: string }[] = [];
  for (const r of found) {
    try {
      const stats = await api.athleteStats(r.id!);
      const rows: SeasonRow[] = seasonRows(stats, measure.category!, measure.espnLabel!);
      const series = cumulativeMeasure ? cumulate(rows) : rows;
      // Which team each of those seasons was played for. Same response, no
      // extra request — and the only way the chart can mark the seasons a
      // career changed team, since it never fetches anything itself.
      const teamOf = new Map(seasonTeams(stats, measure.category!).map((t) => [t.season, t.team]));

      // An empty or flat-zero series for THIS measure is not real data —
      // ESPN's pre-1980s totals rows can be silently missing a whole column
      // (Wilt Chamberlain: 5 seasons, 0 rebounds). `pointsTotal` — the same
      // athlete's career PTS, always present when they have ANY totals row —
      // is what tells a genuine zero apart from a hole in ESPN's coverage.
      const ptsRows = seasonRows(stats, 'totals', 'PTS');
      const pointsTotal = ptsRows.reduce((sum, x) => sum + x.value, 0);
      const verdict = seriesVerdict(series.map((p) => ({ step: p.season, value: p.value })), pointsTotal);
      if (!verdict.usable) {
        const detail = verdict.reason === 'empty'
          ? `no ${measure.espnLabel} rows returned`
          : verdict.reason === 'all-zero-data-hole'
          ? `${measure.espnLabel} is zero across ${rows.length} season${rows.length === 1 ? '' : 's'} while career points total ${pointsTotal} — an ESPN data hole, not a real zero`
          : `${measure.espnLabel} is genuinely zero across ${rows.length} season${rows.length === 1 ? '' : 's'} (career points total is also 0)`;
        dropped.push({ name: r.name, detail });
        log(`WARN ${r.name}: ${detail} — dropped`);
        continue;
      }

      // 5. Awards via athleteBio, tolerating failure — decoration, not the point.
      let awards: { name: string; season: string }[] = [];
      try {
        const bio = await api.athleteBio(r.id!);
        awards = (bio?.awards ?? []).flatMap((a: { name: string; seasons: string[] }) =>
          (a.seasons ?? []).map((season: string) => ({ name: a.name, season }))
        );
      } catch { awards = []; }

      const { first, last } = splitName(r.name);
      entities.push({
        id: r.id!, name: r.name, first, last,
        // `undefined`, not `null`: a candidate's entities are free-text names
        // with no draft-pick lookup in this bridge's tool list at all — we
        // simply don't know, which is a different fact than "known undrafted"
        // (BriefEntity.pick in src/brief.ts explains why the two must differ).
        pick: undefined,
        total: series.at(-1)?.value ?? 0,
        rank: 0, // assembleBrief recomputes the real rank from `total`
        seasons_played: rows.length,
        series: series.map((p) => {
          const team = teamOf.get(p.season);
          return { step: normaliseStep(p.season), value: p.value, ...(team ? { team } : {}) };
        }),
        awards,
      });
      log(`  ${r.name}: ${rows.length} seasons of ${measure.espnLabel}`);
    } catch (e) {
      log(`WARN ${r.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (entities.length === 0) {
    const reason = dropped.length
      ? `no usable ${measure.espnLabel} data for any resolved entity: ${dropped.map((d) => `${d.name} (${d.detail})`).join('; ')}`
      : `${measure.espnLabel} not returned by ESPN for any resolved entity`;
    return { ok: false, resolved, reason };
  }
  // The record only goes on the chart when the holder is NOT one of the
  // series being drawn. A line at a charted player's own total is a line on
  // top of their own head — and for an active holder (LeBron James and the
  // points record) it would be a chase against himself.
  const record: CareerRecord | undefined =
    chase && !entities.some((e) => e.id === chase.holderEspnId) ? chase : undefined;

  // A single surviving entity is fatal for a two-series question and fine for
  // a chase: the second series was never the chart. The guard itself is
  // untouched — `seriesVerdict` still dropped the entity, `dropped` still
  // names it and its reason, and a question with no record still refuses here
  // exactly as before.
  if (dropped.length > 0 && entities.length < 2 && !record) {
    return {
      ok: false,
      resolved,
      reason: `only ${entities.length} entity left with usable ${measure.espnLabel} data after dropping ${dropped.map((d) => `${d.name} (${d.detail})`).join('; ')}`,
    };
  }

  // 4. Season union, ascending. An entity missing a step keeps the gap —
  // never filled with zero.
  const seasons = seasonUnion(entities);

  const markers = detectMarkers(entities, seasons);
  const hookSeed = deriveHookSeed(markers, c.why_fans_argue);

  const input: BriefInput = {
    topic: {
      id: c.id,
      question: c.question,
      // Candidate.angle also allows 'newsy' (a lane leaking into the angle
      // field upstream); WriterBrief's own Angle type predates that value.
      // Carried through as-is rather than remapped, so the brief never
      // claims an angle the candidate didn't actually have.
      angle: c.angle as Angle,
      lane: c.lane,
      hook_seed: hookSeed,
      why_fans_argue: c.why_fans_argue,
      evidence: c.evidence_urls,
    },
    unit: UNIT_WORD[measure.espnLabel] ?? measure.espnLabel.toLowerCase(),
    seasons,
    entities,
    cumulative: cumulativeMeasure,
    record,
  };
  const brief = assembleBrief(input);
  const md = renderBriefMd(brief);

  // 8. Warnings — exactly the three the spec calls for, nothing more.
  const warnings: string[] = [];
  for (const r of resolved) {
    if (r.source === 'unresolved') warnings.push(`"${r.name}" could not be resolved in ESPN or hoopR — left out of the brief`);
  }
  if (resolved.some((r) => r.source === 'hoopr')) {
    warnings.push('one or more entities resolved through hoopR, whose data stops at the 2023 season — totals may be missing 2024-2026');
  }
  if (record) {
    // The provenance travels with the brief rather than living only in a
    // source file: this number is the one thing on the chart that did not
    // come from the data source, so whoever reads the brief is told where it
    // did come from.
    warnings.push(
      `the ${record.value} ${record.unit} reference line is ${record.holder}'s all-time record, not ESPN series data — `
      + `${record.source}`
    );
    if (dropped.length) {
      warnings.push(
        `${dropped.map((d) => d.name).join(', ')} left out of the chart (${dropped.map((d) => d.detail).join('; ')}) — `
        + 'a record chase does not need the holder\'s season-by-season data, only the record itself'
      );
    }
  } else if (entities.length < 3) {
    warnings.push(`only ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'} resolved — a chart of two lines is thin`);
  }
  // Fix 4: a warning, not a block — the entity might still be fine for a
  // recent-era measure. Measured figures spelled out verbatim (a vague
  // warning gets ignored): Wilt Chamberlain's athletes/4142 returns 5 of his
  // 14 seasons and 0 rebounds.
  const earliestYear = Math.min(...entities.flatMap((e) => e.series.map((p) => Number(p.step.slice(0, 4)))));
  if (Number.isFinite(earliestYear) && earliestYear < 1985) {
    const oldest = entities.find((e) => e.series.some((p) => Number(p.step.slice(0, 4)) === earliestYear));
    warnings.push(
      `ESPN's historical totals are unreliable before the mid-1980s — Wilt Chamberlain returns 5 of his 14 seasons and zero rebounds. Check ${oldest?.name ?? 'this entity'}'s numbers against another source before publishing.`
    );
  }

  log(`brief assembled: ${entities.length} entities, chart ${brief.visual.chart}`);
  // `sessionId` only names the file and the composition; it is not a fact
  // about the topic, so it defaults to the candidate's own id when a caller
  // has no session (scripts/brief.ts).
  const video = videoDataFrom(opts?.sessionId ?? c.id, brief);
  return { ok: true, brief, md, resolved, warnings, video };
}
