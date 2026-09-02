/**
 * Pulls every dataset the eight compositions need and writes them to src/data/.
 * Run once; the .cache directory makes re-runs free and renders reproducible.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, pool, seasonRows, cumulate, findAthleteId, headshot, teamLogo } from '../src/espn';

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

save('teams.json', teams);
console.log('\ndone.');
