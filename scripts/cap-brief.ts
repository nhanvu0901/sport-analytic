/**
 * `npx tsx scripts/cap-brief.ts <teamId> <sessionId>`
 *
 * A writer brief for one team's salary-cap breakdown — the
 * `stacked-column-thresholds` shape — built through `assembleBrief` like every
 * other brief, and writing the same three files any session downstream needs:
 *
 *   out/brief-<id>.json     what src/writer.ts verifies a draft against
 *   out/brief-<id>.md       what agy is handed
 *   src/data/video-<id>.json  the picture, from `videoDataFrom`
 *
 * WHY THIS IS A SCRIPT AND NOT A DISCOVER SESSION. `src/candidateBrief.ts`
 * bridges an accepted Discover candidate into a brief, and everything it does
 * is career-shaped: it resolves free-text player names, asks ESPN for a stat
 * column, and cumulates the seasons. A cap breakdown starts from a TEAM, has
 * one number per player and no time axis at all, so it shares nothing with
 * that path except `assembleBrief` — which is exactly the thing it does share,
 * so the rank, marker, router, allowed-number, length and schema logic here is
 * the same code every other brief runs through.
 *
 * The numbers are ESPN's own. `api.roster` returns each athlete's `contracts`
 * array and the render pipeline never hits the network — `src/espn.ts` caches
 * every response to `.cache/` — so this is reproducible and a dead endpoint
 * cannot change the brief under a draft that was verified against it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { api } from '../src/espn';
import { assembleBrief, type BriefEntity } from '../src/brief';
import { renderBriefMd } from '../src/briefMd';
import { videoDataFrom, THRESHOLD_LINES } from '../src/videoData';
import { fmt } from '../src/scale';

/**
 * ESPN's season YEAR, which is the later of the two calendar years: 2026 is the
 * 2025-26 season. The same constant `scripts/fetch-data.ts` uses, and the same
 * one the published CBA levels below belong to — a mismatch between the two
 * would judge one season's payroll against another season's cap.
 */
const SEASON_YEAR = 2026;
const SEASON = '2025-26';

/**
 * The 2025-26 published CBA levels, carried verbatim from
 * `scripts/fetch-data.ts` so the demo `salaryCap.json` and every generated cap
 * video are judged against one set of lines. The floor is 90% of the cap by
 * rule, not by measurement.
 *
 * TODO.md item 10 stands: these are hardcoded for one season and must be
 * re-verified per season or derived. `source` travels into the brief so a
 * reader is told which numbers did not come from a data source.
 */
const LEVELS: Record<string, number> = {
  cap: 154_647_000,
  floor: Math.round(154_647_000 * 0.9),
  tax: 187_895_000,
  apron1: 195_945_000,
  apron2: 207_824_000,
};
const LEVELS_SOURCE = 'NBA CBA published levels for 2025-26; floor derived as 90% of the cap';

const teamId = process.argv[2];
const sessionId = process.argv[3];
if (!teamId || !sessionId) {
  console.error('usage: npx tsx scripts/cap-brief.ts <espnTeamId> <sessionId>');
  process.exit(1);
}

const roster: any = await api.roster(teamId);
const teamName: string = roster.team?.displayName ?? `team ${teamId}`;

/**
 * One entity per player who actually carries a contract for this season.
 *
 * A roster row with no matching contract is dropped, not zeroed: a two-way or
 * unsigned player is absent from the payroll, and a zero-height segment would
 * claim they are on it for nothing. 14 of Toronto's 20 rows survive, and the
 * brief says so.
 */
const contracted = (roster.athletes ?? [])
  .map((a: any) => ({
    id: String(a.id),
    name: String(a.fullName),
    first: String(a.firstName ?? a.fullName),
    last: String(a.lastName ?? a.fullName),
    value: (a.contracts ?? []).find((c: any) => c.season?.year === SEASON_YEAR)?.salary ?? null,
  }))
  .filter((p: any) => typeof p.value === 'number' && p.value > 0)
  .sort((a: any, b: any) => b.value - a.value);

if (!contracted.length) {
  console.error(`no ${SEASON} contracts on ${teamName}'s roster — nothing to chart`);
  process.exit(1);
}

const entities: BriefEntity[] = contracted.map((p: any) => ({
  id: p.id, name: p.name, first: p.first, last: p.last,
  // Unknown, not "confirmed undrafted": a roster row carries no draft record
  // and `BriefEntity.pick` distinguishes the two for exactly this reason.
  pick: undefined,
  total: p.value,
  rank: 0,                 // assembleBrief recomputes it from `total`
  // One season of one number. `series` is the shape every brief carries and
  // the shape `src/sync.ts` reads to turn an anchor into a spoken figure, so a
  // contract is a one-point series rather than a special case.
  seasons_played: 1,
  series: [{ step: SEASON, value: p.value }],
  awards: [],
}));

const total = entities.reduce((s, e) => s + e.total, 0);
const overCap = total > LEVELS.cap;
const underTax = total < LEVELS.tax;

const brief = assembleBrief({
  topic: {
    id: `salary-cap-${teamId}-${SEASON}`,
    question: `Salary Cap Breakdown — ${teamName}`,
    // The angle this shape IS: a roster read as what it costs.
    angle: 'hidden-cost',
    lane: 'evergreen',
    // Selected from the data, never composed from it — the same rule
    // `deriveHookSeed` follows in src/candidateBrief.ts. Two fixed strings and
    // a measured condition decide which.
    hook_seed: overCap && underTax
      ? 'The payroll is already over the cap and still under the tax.'
      : 'One roster, one column, and five lines it is measured against.',
  },
  unit: 'dollars',
  // The one season this instant is an instant OF. It is not an axis — the
  // shape assembleBrief builds for a budget has no time dimension at all —
  // but it is a fact the script may say, so it travels as the single anchor
  // step. See the `dims: []` comment in src/brief.ts.
  seasons: [SEASON],
  entities,
  cumulative: false,
  budget: {
    subject: teamName,
    season: SEASON,
    lines: THRESHOLD_LINES.map((l) => ({ key: l.key, label: l.label, value: LEVELS[l.key] })),
    source: LEVELS_SOURCE,
  },
});

const OUT = join(process.cwd(), 'out');
mkdirSync(OUT, { recursive: true });
const jsonPath = join(OUT, `brief-${sessionId}.json`);
const mdPath = join(OUT, `brief-${sessionId}.md`);
const videoPath = join(process.cwd(), 'src/data', `video-${sessionId}.json`);
writeFileSync(jsonPath, JSON.stringify(brief, null, 2));
writeFileSync(mdPath, renderBriefMd(brief));
writeFileSync(videoPath, JSON.stringify(videoDataFrom(sessionId, brief), null, 1));

const tally = new Map<string, number>();
for (const m of brief.facts.markers) tally.set(m.kind, (tally.get(m.kind) ?? 0) + 1);

console.log(`team:            ${teamName} (espn ${teamId})`);
console.log(`contracts:       ${entities.length} of ${(roster.athletes ?? []).length} roster rows, ${SEASON}`);
console.log(`payroll:         ${fmt.money(total)}`);
for (const l of brief.facts.budget!.lines) {
  console.log(`  ${l.label.padEnd(12)} ${fmt.money(l.value).padStart(14)}  ${l.over > 0 ? 'OVER by ' : 'under by'} ${fmt.money(Math.abs(l.over))}`);
}
console.log(`chart:           ${brief.visual.chart}  (camera ${brief.visual.camera})`);
console.log(`accent kinds:    ${brief.visual.accent_kinds.join(', ')}`);
console.log(`threshold keys:  ${brief.visual.threshold_keys.join(', ')}`);
console.log(`markers:         ${brief.facts.markers.length} (${[...tally].map(([k, n]) => `${k}=${n}`).join(', ')})`);
console.log(`allowed_numbers: ${brief.facts.allowed_numbers.length}`);
console.log(`length:          ${brief.style.beats[0]}-${brief.style.beats[1]} beats, ${brief.style.target_words} words, ${brief.style.target_seconds}s`);
console.log(`accent budget:   ${brief.visual.accent_budget.total_min}-${brief.visual.accent_budget.total_max}`);
console.log(`wrote:           ${jsonPath}`);
console.log(`wrote:           ${mdPath}`);
console.log(`wrote:           ${videoPath}`);
console.log(`next:            npx tsx scripts/write.ts ${sessionId}`);
