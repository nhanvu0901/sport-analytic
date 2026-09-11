/** Minimal ESPN adapter. Every endpoint here was verified by hand on 2026-09-02. */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const CACHE = join(process.cwd(), '.cache');

/**
 * The render pipeline must never hit ESPN. Everything goes through this cache,
 * so a run is reproducible and a dead endpoint cannot break a render.
 */
export async function get<T = any>(url: string): Promise<T> {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const key = join(CACHE, createHash('sha1').update(url).digest('hex') + '.json');
  if (existsSync(key)) return JSON.parse(readFileSync(key, 'utf8'));
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const json = await res.json();
  writeFileSync(key, JSON.stringify(json));
  return json as T;
}

export async function pool<I, O>(items: I[], n: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        try { out[i] = await fn(items[i]); } catch { out[i] = undefined as O; }
      }
    })
  );
  return out.filter((x) => x !== undefined);
}

const CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const WEB = 'https://site.web.api.espn.com/apis';

export const api = {
  teams:        () => get(`${CORE}/teams?limit=40`),
  team:         (id: string) => get(`${CORE}/teams/${id}`),
  roster:       (id: string) => get(`${WEB}/site/v2/sports/basketball/nba/teams/${id}/roster`),
  standings:    (season: number) => get(`${WEB}/v2/sports/basketball/nba/standings?season=${season}`),
  athlete:      (id: string) => get(`${CORE}/athletes/${id}`),
  athleteStats: (id: string) => get(`${WEB}/common/v3/sports/basketball/nba/athletes/${id}/stats`),
  athleteBio:   (id: string) => get(`${WEB}/common/v3/sports/basketball/nba/athletes/${id}/bio`),
  draftRounds:  (year: number) => get(`${CORE}/seasons/${year}/draft/rounds`),
  search:       (q: string) => get(`${WEB}/search/v2?limit=5&sport=basketball&query=${encodeURIComponent(q)}`),
};

export const headshot = (espnId: string | number) =>
  `https://a.espncdn.com/i/headshots/nba/players/full/${espnId}.png`;
export const teamLogo = (abbr: string) =>
  `https://a.espncdn.com/i/teamlogos/nba/500/${abbr.toLowerCase()}.png`;

export type SeasonRow = { season: string; value: number };

/**
 * Season totals/averages, one row per season.
 *
 * A player traded mid-season gets one ESPN row per team, plus a roll-up row
 * whose teamSlug contains "Totals". Summing those rows is only valid for
 * counting stats — doing it to an average produces nonsense (45.9 ppg). So:
 * prefer ESPN's own roll-up, else sum totals, else weight averages by games.
 */
export function seasonRows(
  stats: any,
  category: 'totals' | 'averages',
  label: string
): SeasonRow[] {
  const cat = stats?.categories?.find((c: any) => c.name === category);
  if (!cat) return [];
  const idx = cat.labels.indexOf(label);
  if (idx < 0) return [];
  const gpIdx = cat.labels.indexOf('GP');

  const groups = new Map<string, any[]>();
  for (const s of cat.statistics ?? []) {
    const season = s.season?.displayName;
    if (!season) continue;
    const list = groups.get(season);
    if (list) list.push(s);
    else groups.set(season, [s]);
  }

  const num = (row: any, i: number) => Number(String(row.stats[i]).replace(/,/g, ''));
  const out: SeasonRow[] = [];
  for (const [season, rows] of groups) {
    const rollup = rows.find((r) => String(r.teamSlug ?? '').includes('Totals'));
    let value: number;
    if (rollup) value = num(rollup, idx);
    else if (rows.length === 1) value = num(rows[0], idx);
    else if (category === 'totals') value = rows.reduce((s, r) => s + num(r, idx), 0);
    else {
      const w = rows.map((r) => (gpIdx >= 0 ? num(r, gpIdx) : 1));
      const total = w.reduce((a, b) => a + b, 0) || rows.length;
      value = rows.reduce((s, r, i) => s + num(r, idx) * w[i], 0) / total;
      value = Number(value.toFixed(1));
    }
    if (Number.isFinite(value)) out.push({ season, value });
  }
  return out.sort((a, b) => a.season.localeCompare(b.season));
}

/**
 * Which team each season was played for, from the same rows `seasonRows`
 * reads — `teamSlug` is already in the response, so this costs no request.
 *
 * A SEPARATE function rather than another field on `SeasonRow`, because the
 * two answer different questions: `seasonRows` is the measure being charted
 * and is summed, rolled up and weighted; a team is a label and none of those
 * operations mean anything on it. Keeping them apart also leaves every
 * existing caller of `seasonRows` untouched.
 *
 * A traded season has one row per team plus ESPN's "Totals" roll-up, whose
 * `teamSlug` is "2024-25 Totals" and names no team. The season is credited to
 * the team the player played the MOST games for, ties going to the later row
 * — the team they finished the season with.
 */
export function seasonTeams(stats: any, category: 'totals' | 'averages'): { season: string; team: string }[] {
  const cat = stats?.categories?.find((c: any) => c.name === category);
  if (!cat) return [];
  const gpIdx = cat.labels?.indexOf('GP') ?? -1;

  const groups = new Map<string, any[]>();
  for (const s of cat.statistics ?? []) {
    const season = s.season?.displayName;
    const slug = String(s.teamSlug ?? '');
    if (!season || !slug || slug.includes('Totals')) continue;
    const list = groups.get(season);
    if (list) list.push(s);
    else groups.set(season, [s]);
  }

  const out: { season: string; team: string }[] = [];
  for (const [season, rows] of groups) {
    let best = rows[0];
    if (rows.length > 1 && gpIdx >= 0) {
      for (const r of rows) {
        const gp = Number(String(r.stats[gpIdx]).replace(/,/g, ''));
        const bestGp = Number(String(best.stats[gpIdx]).replace(/,/g, ''));
        if (Number.isFinite(gp) && (!Number.isFinite(bestGp) || gp >= bestGp)) best = r;
      }
    }
    out.push({ season, team: String(best.teamSlug) });
  }
  return out.sort((a, b) => a.season.localeCompare(b.season));
}

export function cumulate(rows: { season: string; value: number }[]) {
  let acc = 0;
  return rows.map((r) => ({ ...r, value: (acc += r.value) }));
}

export const findAthleteId = async (name: string): Promise<string | null> => {
  const d = await api.search(name);
  for (const group of d.results ?? []) {
    if (group.type !== 'player') continue;
    for (const item of group.contents ?? []) {
      const web = item.link?.web ?? '';
      if (web.includes('/nba/player/')) return web.split('/id/')[1].split('/')[0];
    }
  }
  return null;
};
