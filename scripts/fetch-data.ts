/**
 * Pulls every dataset the eight compositions need and writes them to src/data/.
 * Run once; the .cache directory makes re-runs free and renders reproducible.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, get, pool, seasonRows, cumulate, findAthleteId, headshot, teamLogo } from '../src/espn';
import { careerPoints, nameCollisions, ambiguous } from '../src/hoopr';

const SEASON = 2026;                 // ESPN year 2026 == the 2025-26 season
const OUT = join(process.cwd(), 'src/data');
mkdirSync(OUT, { recursive: true });
const save = (name: string, data: unknown) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 1));
  console.log(`  wrote ${name}`);
};

/* ------------------------------------------------------------------ teams */
console.log('teams…');
const teamRefs = (await api.teams()).items as { $ref: string }[];
const teams = await pool(teamRefs, 8, async (r) => {
  const t = await api.team(r.$ref.split('/teams/')[1].split('?')[0]);
  return {
    id: String(t.id), abbr: t.abbreviation, name: t.displayName, short: t.name,
    color: '#' + (t.color || '444444'), alt: '#' + (t.alternateColor || 'cccccc'),
    logo: teamLogo(t.abbreviation),
  };
});
const teamById = new Map(teams.map((t) => [t.id, t]));
console.log(`  ${teams.length} teams`);

/* ----------------------------------------------------------- 08 dot-strip */
console.log('rosters (height / weight / salary for the whole league)…');
type P = {
  id: string; name: string; last: string; teamId: string; abbr: string;
  heightIn: number; weightLb: number; pos: string; age: number | null;
  salary: number | null; headshot: string;
};
const players: P[] = [];
for (const t of teams) {
  const r = await api.roster(t.id);
  for (const a of r.athletes ?? []) {
    const salary = (a.contracts ?? []).find((c: any) => c.season?.year === SEASON)?.salary ?? null;
    if (!a.height || !a.weight) continue;
    players.push({
      id: String(a.id), name: a.fullName, last: a.lastName,
      teamId: t.id, abbr: t.abbr,
      heightIn: Number(a.height), weightLb: Number(a.weight),
      pos: a.position?.abbreviation ?? '', age: a.age ?? null,
      salary, headshot: headshot(a.id),
    });
  }
}
console.log(`  ${players.length} players`);
save('dotStrip.json', {
  title: 'NBA Player Height & Weight',
  sub: `${SEASON - 1}–${String(SEASON).slice(2)} rosters`,
  xLabel: 'Weight (lbs)', yLabel: 'Height',
  rows: players.map((p) => ({ id: p.id, name: p.name, last: p.last, x: p.weightLb, y: p.heightIn, abbr: p.abbr, pos: p.pos })),
});

/* ----------------------------------------------- 04 diverging: point diff */
console.log('standings…');
const st = await api.standings(SEASON);
const entries = (st.children ?? []).flatMap((c: any) => c.standings?.entries ?? []);
const diff = entries.map((e: any) => {
  const g = (n: string) => e.stats.find((s: any) => s.name === n)?.value ?? 0;
  const t = teamById.get(String(e.team.id));
  return {
    id: String(e.team.id), name: e.team.shortDisplayName ?? e.team.name,
    abbr: t?.abbr ?? '', logo: t?.logo ?? '', color: t?.color ?? '#444',
    value: Number(g('differential').toFixed(1)),
    wins: g('wins'), losses: g('losses'),
  };
}).sort((a: any, b: any) => b.value - a.value);
save('divergingBar.json', {
  title: 'Point Differential', sub: `${SEASON - 1}–${String(SEASON).slice(2)} regular season`,
  unit: 'per game', rows: diff,
});
console.log(`  ${diff.length} teams, best ${diff[0]?.value}, worst ${diff.at(-1)?.value}`);

/* ------------------------------------------- 02 salary cap: one team stack */
// 2025-26 published CBA levels. Floor is 90% of the cap by rule.
// TODO before any real publish: re-verify these against the league's own figures each season.
const CAP = {
  season: '2025-26',
  cap: 154_647_000,
  floor: Math.round(154_647_000 * 0.9),
  tax: 187_895_000,
  apron1: 195_945_000,
  apron2: 207_824_000,
  source: 'NBA CBA published levels for 2025-26; floor derived as 90% of the cap',
};
const CAP_TEAM = 'Houston';   // the channel's highest-viewed salary-cap short
const capTeam = teams.find((t) => t.name.includes(CAP_TEAM))!;
const capRoster = players
  .filter((p) => p.teamId === capTeam.id && p.salary)
  .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0));
save('salaryCap.json', {
  title: 'Salary Cap', sub: capTeam.name, team: capTeam, thresholds: CAP,
  rows: capRoster.map((p) => ({ id: p.id, name: p.name, last: p.last, value: p.salary, headshot: p.headshot })),
});
console.log(`  ${capTeam.name}: ${capRoster.length} contracts, total $${capRoster.reduce((s, p) => s + (p.salary ?? 0), 0).toLocaleString()}`);

/* ------------------------------------- stats for the 60 highest-paid guys */
console.log('season stats for the 60 highest-paid players…');
const paid = [...players].filter((p) => p.salary).sort((a, b) => b.salary! - a.salary!).slice(0, 60);
const withStats = await pool(paid, 6, async (p) => {
  const s = await api.athleteStats(p.id);
  const avg = seasonRows(s, 'averages', 'PTS');
  const gp = seasonRows(s, 'averages', 'GP');
  const cur = avg.at(-1), prev = avg.at(-2);
  return { ...p, ppg: cur?.value ?? null, ppgPrev: prev?.value ?? null, gp: gp.at(-1)?.value ?? null };
});
const stats = withStats.filter((p) => p.ppg !== null);
console.log(`  ${stats.length}/60 resolved`);

/* -------------------------------------------------- 03 ranked bar: salary */
save('rankedBar.json', {
  title: "The NBA's Highest Paid", sub: `${CAP.season} cap hit`, unit: '$',
  rows: [...stats].sort((a, b) => b.salary! - a.salary!).slice(0, 26)
    .map((p) => ({ id: p.id, name: p.name, last: p.last, value: p.salary, abbr: p.abbr, headshot: p.headshot })),
});

/* ------------------------------------- 05 proportion bar: games available */
save('proportionBar.json', {
  title: 'Games Played', sub: 'Share of an 82-game season · 60 highest-paid players',
  rows: [...stats].filter((p) => p.gp !== null).sort((a, b) => b.gp! - a.gp!)
    .map((p) => ({ id: p.id, name: p.name, last: p.last, value: Math.min(1, p.gp! / 82), games: p.gp, abbr: p.abbr, headshot: p.headshot })),
});

/* ---------------------------------- 06 bar delta: this season vs the last */
const delta = stats.filter((p) => p.ppgPrev !== null && p.ppg !== null)
  .map((p) => ({
    id: p.id, name: p.name, last: p.last, abbr: p.abbr, headshot: p.headshot,
    base: p.ppgPrev!, now: p.ppg!, delta: Number((p.ppg! - p.ppgPrev!).toFixed(1)),
  }))
  .sort((a, b) => b.delta - a.delta);
save('barDelta.json', {
  title: 'Risers & Fallers', sub: 'Points per game, last season → this season',
  rows: delta,
});
console.log(`  delta: top riser +${delta[0]?.delta}, biggest faller ${delta.at(-1)?.delta}`);

/* ------------------------------------------ 07 scatter: salary vs scoring */
save('scatter.json', {
  title: 'Salary & Points per Game', sub: `${CAP.season} · 60 highest-paid players`,
  xLabel: 'Salary', yLabel: 'Points per Game',
  rows: stats.map((p) => ({
    id: p.id, name: p.name, last: p.last, x: p.salary, y: p.ppg,
    abbr: p.abbr, logo: teamById.get(p.teamId)?.logo, headshot: p.headshot,
  })),
});

/* --------------------------------- 01 cumulative: the 2019 draft class */
console.log('2019 draft class cumulative points…');
const CLASS_2019 = [
  'RJ Barrett', 'Darius Garland', 'Tyler Herro', 'Jordan Poole', 'Ja Morant',
  'Coby White', 'Zion Williamson', 'Naz Reid', 'Nickeil Alexander-Walker', 'Jarrett Culver',
];
const series = await pool(CLASS_2019, 4, async (name) => {
  const id = await findAthleteId(name);
  if (!id) return undefined as any;
  const [stats, detail] = await Promise.all([api.athleteStats(id), api.athlete(id)]);
  const pts = cumulate(seasonRows(stats, 'totals', 'PTS'));
  if (!pts.length) return undefined as any;
  return {
    id, name,
    last: name.split(' ').slice(1).join(' '), first: name.split(' ')[0],
    total: pts.at(-1)!.value,
    points: pts,
    headshot: headshot(id),
    pick: detail.draft?.selection ?? null,
  };
});
const ordered = series.filter(Boolean).sort((a, b) => b.total - a.total);
save('cumulative.json', {
  title: '2019 NBA Draft', sub: 'Total Points Scored',
  yLabel: 'Total Points', seasons: ['2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026'],
  series: ordered,
});
for (const s of ordered) console.log(`  ${s.name.padEnd(26)} pick ${String(s.pick ?? '–').padStart(2)}  ${s.total.toLocaleString()}`);

/* ------------------------------------------------- 09 slope-pair: re-draft */
// Three-tier resolution, in order, each row tagged with which one won:
//   1. 'espn'   — findAthleteId() search -> athleteStats -> seasonRows totals PTS.
//                 Fails for players ESPN's own search index drops (they left
//                 the league), even when their /stats endpoint still answers.
//   2. 'hoopr'  — src/hoopr.ts's per-season parquet bridge, keyed by name.
//                 hoopR's athlete_id IS the ESPN id, reached through a door
//                 ESPN's own search does not drop players from. This is what
//                 recovers 2011's Vesely/Fredette/Faried/Cole.
//   3. 'unresolved' — neither tier produced usable points; degrades to "no
//                 NBA data" rather than dropping the pick from the chart.
async function buildRedraft(year: number, filename: string) {
  console.log(`${year} NBA re-draft (round 1, ranked by career points)…`);
  const draftData = await api.draftRounds(year);
  const round1 = (draftData.items[0].picks ?? []) as any[];
  const redraftRows = await pool(round1, 6, async (pick) => {
    const draftAthlete = await get(pick.athlete.$ref);
    const name: string = draftAthlete.displayName;
    const last = name.split(' ').slice(1).join(' ') || name;

    let value: number | null = null;
    let seasons = 0;
    let resolvedId: string | null = null;
    let source: 'espn' | 'hoopr' | 'unresolved' = 'unresolved';

    // Tier 1: ESPN search. draftAthlete.id is a COLLEGE id, a different
    // space from the NBA id, hence the re-resolve through findAthleteId().
    // A pick is a miss here as soon as EITHER step fails to produce usable
    // points — search returning nothing, or (measured live: pick 28, Norris
    // Cole, 2011) search returning an id whose /stats endpoint itself 404s.
    // Either way this must degrade, not throw: pool() swallows a thrown
    // error into a silently missing row, which would drop an actual draft
    // pick from the chart instead of falling through to tier 2.
    const searchId = await findAthleteId(name);
    if (searchId) {
      try {
        const stats = await api.athleteStats(searchId);
        const pts = seasonRows(stats, 'totals', 'PTS');
        if (pts.length) {
          value = pts.reduce((s, r) => s + r.value, 0);
          seasons = pts.length;
          resolvedId = searchId;
          source = 'espn';
        }
      } catch { /* leave resolvedId null: tier 1 did not pay off, try tier 2 */ }
    }

    // Tier 2: hoopR bridge, only attempted once tier 1 has failed.
    if (resolvedId === null) {
      const bridged = await careerPoints(name);
      if (bridged) {
        value = bridged.points;
        seasons = bridged.seasons.length;
        resolvedId = bridged.id;
        source = 'hoopr';
      }
    }

    return {
      id: resolvedId ?? `draft-${pick.overall}`,
      name, last,
      actualPick: pick.overall as number,
      // Best-effort image for an unresolved pick: the college id is a different
      // namespace so this can 404, but there is no other picture to show for a
      // player neither tier resolved.
      headshot: headshot(resolvedId ?? draftAthlete.id),
      value, resolvedId, seasons, source,
    };
  });
  redraftRows.sort((a, b) => a.actualPick - b.actualPick);

  const sources = { espn: 0, hoopr: 0, unresolved: 0 };
  for (const r of redraftRows) sources[r.source]++;
  save(filename, {
    title: `${year} NBA Re-Draft`, sub: 'Ranked by career points',
    year, unit: 'points',
    rows: redraftRows, unresolved: sources.unresolved, sources,
  });
  console.log(`  ${redraftRows.length - sources.unresolved}/${redraftRows.length} resolved to an NBA id ` +
    `(espn ${sources.espn}, hoopr ${sources.hoopr}, unresolved ${sources.unresolved})`);
  console.log(`  unresolved: ${redraftRows.filter((r) => r.source === 'unresolved').map((r) => r.name).join(', ') || 'none'}`);
  return sources;
}

await buildRedraft(2011, 'redraft.json');
// A second, older class to prove the hoopR bridge earns its keep on a class
// ESPN's search index does even worse on.
await buildRedraft(2005, 'redraft2005.json');
// Real, unavoidable namesakes only now (see hoopr.ts's SUFFIX BUG note):
// same exact spelling, two different athlete ids, no suffix involved.
if (nameCollisions.length) {
  console.log(`  hoopR name collisions (${nameCollisions.length}):`);
  for (const c of nameCollisions) console.log(`    "${c.name}": kept ${c.kept}, dropped ${c.dropped}`);
} else {
  console.log('  hoopR name collisions: none');
}
// Queries refused rather than guessed: a suffix-stripped fallback that hit
// two or more distinct athletes. Reporting the count matters as much as the
// resolution counts above — this is how many names the bridge declined to
// answer instead of silently answering wrong.
if (ambiguous.length) {
  console.log(`  hoopR refused ${ambiguous.length} ambiguous name(s) rather than guess:`);
  for (const a of ambiguous) {
    console.log(`    "${a.query}" -> ${a.candidates.map((c) => `${c.name} (id ${c.id}, ${c.games}g)`).join(' vs ')}`);
  }
} else {
  console.log('  hoopR ambiguous refusals: none');
}

/* -------------------------------------------------- 10 image-cell-matrix: leaders */
console.log('league leaders by season and category…');
// 7 most recently COMPLETE seasons. 2026 (2025-26) has not tipped off yet —
// the endpoint answers for it anyway, but on stale/partial data — so the
// window ends at 2025 rather than the "current" season year fetch-data.ts
// otherwise uses.
const MATRIX_SEASONS = [2025, 2024, 2023, 2022, 2021, 2020, 2019];
const MATRIX_CATS: [string, string][] = [
  ['pointsPerGame', 'PTS'], ['reboundsPerGame', 'REB'], ['assistsPerGame', 'AST'],
  ['stealsPerGame', 'STL'], ['blocksPerGame', 'BLK'], ['3PointsMadePerGame', '3PM'],
];
const seasonLeaders = await pool(MATRIX_SEASONS, 4, async (y) => ({
  y, data: await get<any>(`https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${y}/types/2/leaders?limit=3`),
}));
const leadersByYear = new Map(seasonLeaders.map((s) => [s.y, s.data]));

type CellSlot = { row: number; col: number; espnCat: string; year: number };
const slots: CellSlot[] = [];
MATRIX_SEASONS.forEach((y, row) => MATRIX_CATS.forEach(([espnCat], col) => slots.push({ row, col, espnCat, year: y })));

const cells = (
  await pool(slots, 6, async (slot) => {
    const data = leadersByYear.get(slot.year);
    const cat = data?.categories?.find((c: any) => c.name === slot.espnCat);
    const leader = cat?.leaders?.[0];
    if (!leader) return undefined as any;
    const id = leader.athlete.$ref.split('/athletes/')[1].split('?')[0];
    const a = await get(leader.athlete.$ref);
    return {
      row: slot.row, col: slot.col, entityId: id,
      name: a.displayName, last: a.lastName,
      headshot: headshot(id), value: Number(leader.value.toFixed(1)),
    };
  })
).filter(Boolean);

save('leaderMatrix.json', {
  title: 'League Leaders', sub: 'Every season, every category',
  rowDim: { name: 'season', steps: MATRIX_SEASONS.map(String) },
  colDim: { name: 'category', steps: MATRIX_CATS.map(([, short]) => short) },
  cells,
});
console.log(`  ${cells.length}/${slots.length} cells resolved`);

/* ------------------------------------------------------- 11 unit-waffle: LeBron */
console.log("LeBron James career point decomposition (2PT / 3PT / FT)…");
const LEBRON_ID = '1966';
const lebronStats = await api.athleteStats(LEBRON_ID);
const totalsCat = lebronStats.categories.find((c: any) => c.name === 'totals');
const labelIndex = (label: string) => totalsCat.labels.indexOf(label);
const [iFG, i3PT, iFT, iPTS] = [labelIndex('FG'), labelIndex('3PT'), labelIndex('FT'), labelIndex('PTS')];
const madeOf = (row: any, i: number) => Number(String(row.stats[i]).split('-')[0].replace(/,/g, ''));
const plainOf = (row: any, i: number) => Number(String(row.stats[i]).replace(/,/g, ''));

const seasonGroups = new Map<string, any[]>();
for (const row of totalsCat.statistics) {
  const season = row.season?.displayName;
  if (!season) continue;
  const list = seasonGroups.get(season);
  if (list) list.push(row); else seasonGroups.set(season, [row]);
}

let totalTwos = 0, totalThrees = 0, totalFrees = 0, totalPts = 0;
const bySeason: { season: string; points: number }[] = [];
for (const [season, rows] of seasonGroups) {
  // Same mid-season-trade convention as seasonRows(): prefer ESPN's own
  // roll-up row over summing the per-team splits ourselves.
  const rollup = rows.find((r) => String(r.teamSlug ?? '').includes('Totals'));
  const use = rollup ? [rollup] : rows;
  const fgMade = use.reduce((s, r) => s + madeOf(r, iFG), 0);
  const tpMade = use.reduce((s, r) => s + madeOf(r, i3PT), 0);
  const ftMade = use.reduce((s, r) => s + madeOf(r, iFT), 0);
  const pts = use.reduce((s, r) => s + plainOf(r, iPTS), 0);
  const threes = tpMade, twos = fgMade - threes, frees = ftMade;
  const computed = 2 * twos + 3 * threes + frees;
  if (computed !== pts) {
    console.log(`  ! ${season}: 2*${twos}+3*${threes}+${frees}=${computed} but ESPN PTS=${pts} (diff ${computed - pts}) — reporting, not fixing`);
  }
  totalTwos += twos; totalThrees += threes; totalFrees += frees; totalPts += pts;
  bySeason.push({ season, points: pts });
}
bySeason.sort((a, b) => a.season.localeCompare(b.season));

const waffleParts = [
  { key: '2PT', label: 'Two-Point Field Goals', points: totalTwos * 2 },
  { key: '3PT', label: 'Three-Pointers', points: totalThrees * 3 },
  { key: 'FT', label: 'Free Throws', points: totalFrees },
].map((p) => ({ ...p, share: Number((p.points / totalPts).toFixed(4)) }));

save('waffle.json', {
  title: `${totalPts.toLocaleString()} Points`, sub: 'Every point LeBron James has scored',
  entityId: LEBRON_ID, name: 'LeBron James', headshot: headshot(LEBRON_ID), total: totalPts,
  parts: waffleParts, bySeason,
});
console.log(`  ${totalPts.toLocaleString()} total across ${bySeason.length} seasons: ` +
  waffleParts.map((p) => `${p.key} ${p.points.toLocaleString()} (${Math.round(p.share * 100)}%)`).join(', '));

save('teams.json', teams);
console.log('\ndone.');
