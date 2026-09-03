/**
 * hoopR per-season player-box parquet, used ONLY to bridge ESPN athlete ids
 * for players ESPN's own search endpoint drops.
 *
 * The problem this exists to solve: `findAthleteId()` in src/espn.ts goes
 * through ESPN's search index, and that index drops players who left the
 * league (measured on the 2011 re-draft: Vesely, Fredette, Faried, Cole all
 * miss, diacritics/surname retries do not help). ESPN's own historical
 * roster endpoints do not help either — seasons/{y}/athletes and the
 * league-wide athlete index both return the identical ~627 CURRENT players
 * regardless of which year is asked for; there is no fuller ESPN athlete
 * index to fall back on.
 *
 * hoopR-data publishes per-season NBA player box scores built on ESPN's own
 * data, so its `athlete_id` IS the ESPN athlete id — just reachable through
 * a different door. This module downloads and aggregates those box scores
 * (2002-2023, ~14.8 MB, cached under .cache/hoopr/) into a name -> totals
 * index, keyed on a normalised name because the draft object's own athlete
 * ref points at a college record in a different id space entirely.
 *
 * HONEST LIMIT: hoopR's box scores stop at the 2023 season. A total pulled
 * from this module is therefore missing 2024, 2025 and 2026. That is an
 * acceptable division of labour — ESPN's search resolves players still in
 * the league, and this module only exists to fill in players who left
 * BEFORE 2024 — but a player who left in 2024 or 2025 will still be short
 * by a season or two of career points. This is not papered over: any row
 * resolved through this module must be marked at the call site (source:
 * 'hoopr') so a downstream chart can flag it rather than silently mixing
 * cutoffs.
 *
 * SUFFIX BUG, FOUND AND FIXED: an earlier version of normaliseName() dropped
 * jr/sr/ii/iii/iv from the INDEX key, meaning "Tim Hardaway" and "Tim
 * Hardaway Jr." (two different, real people — father and son, both NBA
 * players) collapsed onto one key, and whichever had more games inside
 * 2002-2023 silently won the lookup for BOTH names. That is a confident
 * wrong number, which is worse than the honest "no NBA data" state this
 * whole bridge exists to avoid. The fix is a two-stage lookup instead:
 * normaliseName() no longer drops suffixes, so distinct spellings stay
 * distinct keys; stripSuffix() is used only as a second-chance LOOKUP path
 * when the exact key misses, and only returns a result when exactly one
 * candidate matches the stripped key — two or more candidates means refuse
 * and record the ambiguity (see `ambiguous` below), never guess.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parquetReadObjects } from 'hyparquet';

const CACHE_DIR = join(process.cwd(), '.cache/hoopr');
const FIRST_SEASON = 2002;
const LAST_SEASON = 2023;
const ALL_SEASONS = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, i) => FIRST_SEASON + i);

// Bump to invalidate .cache/hoopr/index.json (e.g. after changing the
// aggregation logic below) without having to delete the cache by hand.
// v2: normaliseName() stopped dropping suffixes (see the SUFFIX BUG note
// above) — the keys themselves changed, so a v1 cache must not be reused.
const INDEX_VERSION = 2;

const COLUMNS = ['season', 'season_type', 'athlete_id', 'athlete_display_name', 'points'] as const;

export type PlayerTotals = { id: string; name: string; points: number; games: number; seasons: number[] };

/** One row of the shape aggregateBox() reduces — the five columns pulled from the parquet. */
export type BoxRow = {
  athlete_id: number | string;
  athlete_display_name: string;
  points: number | null;
  season: number;
  season_type: number;
};

/**
 * Populated as a side effect of loadPlayerIndex(): when two DIFFERENT
 * athlete ids normalise to the exact same name key (genuine namesakes with
 * identical spelling -- e.g. two unrelated players both named "Marcus
 * Williams" -- not a suffix artefact any more), the one with fewer games is
 * dropped rather than silently overwritten. The fetch script logs this list
 * so a collision is visible, not hidden inside a cache file. This is an
 * accepted, narrow limitation: name alone cannot disambiguate two people
 * who share one, and there is no other identifying field to fall back on.
 */
export const nameCollisions: { name: string; kept: string; dropped: string }[] = [];

/**
 * Populated as a side effect of careerPoints(): a query whose exact
 * normalised name misses, and whose SUFFIX-STRIPPED key matches two or more
 * distinct athletes, is refused rather than resolved by "whoever has more
 * games" -- that guess is exactly the bug this list exists to catch (it
 * silently returned Tim Hardaway Jr.'s total for a query for the father,
 * and vice versa for Gary Payton / Gary Payton II, depending only on who
 * played more games inside 2002-2023).
 */
export const ambiguous: { query: string; candidates: { id: string; name: string; games: number }[] }[] = [];

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/**
 * lowercase -> strip diacritics (NFD, drop combining marks) -> drop anything
 * outside [a-z0-9 ] -> collapse whitespace. Deliberately does NOT drop a
 * generation suffix any more: "Tim Hardaway" and "Tim Hardaway Jr." must
 * stay two different index keys, because the source data already
 * distinguishes them and collapsing that distinction is how one player's
 * career got attributed to another. An accent still collides on purpose
 * (an accented spelling from the draft object must still match hoopR's
 * plain-ASCII one) -- that is the only intentional collision left in this
 * function. Suffix-insensitive matching is handled separately by
 * stripSuffix(), used only as a second-chance LOOKUP with an ambiguity
 * guard (see careerPoints).
 */
export function normaliseName(name: string): string {
  const noAccents = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cleaned = noAccents.toLowerCase().replace(/[^a-z0-9 ]/g, '');
  const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
  return words.join(' ');
}

/**
 * Drops a trailing standalone jr/sr/ii/iii/iv from an already-normalised
 * name, for use as a fallback LOOKUP key only -- never as the index's
 * primary key (that was the bug). Leaves a bare suffix alone (nothing to
 * strip it down to) and leaves names with no suffix unchanged.
 */
export function stripSuffix(normalised: string): string {
  const words = normalised.split(' ').filter(Boolean);
  if (words.length > 1 && SUFFIXES.has(words[words.length - 1])) {
    return words.slice(0, -1).join(' ');
  }
  return normalised;
}

/**
 * Pure per-row reduction, kept separate from the network/cache plumbing so
 * it can be unit tested without touching the filesystem: regular season
 * only (season_type === 2), null points count as 0, games counts ROWS not
 * distinct seasons (a mid-season trade is two rows), the most frequent
 * display-name spelling wins, and the returned seasons list is sorted.
 * Keyed by athlete_id (a string) — name collisions are handled one layer up
 * in loadPlayerIndex, once totals across every season are already settled.
 */
export function aggregateBox(rows: BoxRow[]): Map<string, PlayerTotals> {
  type Acc = { points: number; games: number; seasons: Set<number>; spellings: Map<string, number> };
  const acc = new Map<string, Acc>();
  for (const row of rows) {
    if (row.season_type !== 2) continue;
    // Measured: player_box_2013.parquet carries exactly one all-null row
    // (athlete_id, name and points all null) — a stray footer/placeholder
    // row, not a real player. Skip anything with no id or no name rather
    // than aggregating a bogus "null" athlete.
    if (row.athlete_id == null || row.athlete_display_name == null) continue;
    const id = String(row.athlete_id);
    let a = acc.get(id);
    if (!a) { a = { points: 0, games: 0, seasons: new Set(), spellings: new Map() }; acc.set(id, a); }
    a.points += row.points ?? 0;
    a.games += 1;
    a.seasons.add(row.season);
    a.spellings.set(row.athlete_display_name, (a.spellings.get(row.athlete_display_name) ?? 0) + 1);
  }
  const out = new Map<string, PlayerTotals>();
  for (const [id, a] of acc) {
    let bestName = '', bestCount = -1;
    for (const [name, count] of a.spellings) {
      if (count > bestCount) { bestCount = count; bestName = name; }
    }
    out.set(id, { id, name: bestName, points: a.points, games: a.games, seasons: [...a.seasons].sort((x, y) => x - y) });
  }
  return out;
}

const parquetPath = (season: number) => join(CACHE_DIR, `player_box_${season}.parquet`);
const HOOPR_URL = (season: number) =>
  `https://raw.githubusercontent.com/sportsdataverse/hoopR-data/main/nba/player_box/parquet/player_box_${season}.parquet`;

async function ensureDownloaded(season: number): Promise<string> {
  const path = parquetPath(season);
  if (existsSync(path)) return path;
  mkdirSync(CACHE_DIR, { recursive: true });
  const res = await fetch(HOOPR_URL(season));
  if (!res.ok) throw new Error(`${res.status} fetching hoopR player_box_${season}.parquet`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path, buf);
  return path;
}

/**
 * hyparquet's AsyncBuffer.slice must return an ArrayBuffer, not a Uint8Array
 * view — measured: a Buffer's own .slice() returns a view sharing the
 * underlying ArrayBuffer, and handing that to hyparquet throws
 * "First argument to DataView constructor must be an ArrayBuffer". Buffer's
 * .buffer is the full underlying allocation (often larger than the Buffer
 * itself), so the offset has to be added back in by hand.
 */
function asyncBufferFromBuffer(buf: Buffer) {
  return {
    byteLength: buf.byteLength,
    slice: (start: number, end?: number) =>
      buf.buffer.slice(buf.byteOffset + start, buf.byteOffset + (end ?? buf.byteLength)) as ArrayBuffer,
  };
}

async function readSeasonRows(season: number): Promise<BoxRow[]> {
  const path = await ensureDownloaded(season);
  const buf = readFileSync(path);
  const file = asyncBufferFromBuffer(buf);
  return (await parquetReadObjects({ file, columns: [...COLUMNS] })) as unknown as BoxRow[];
}

const sameSeasons = (a: number[], b: number[]) => a.length === b.length && a.every((y, i) => y === b[i]);

/**
 * Builds (or loads from .cache/hoopr/index.json) the name -> career-totals
 * index. Only the full default season range is cached — a caller that asks
 * for a subset gets a fresh, uncached build, since caching every possible
 * subset is not worth the complexity here.
 */
export async function loadPlayerIndex(seasons: number[] = ALL_SEASONS): Promise<Map<string, PlayerTotals>> {
  const cacheFile = join(CACHE_DIR, 'index.json');
  const cacheable = sameSeasons(seasons, ALL_SEASONS);

  if (cacheable && existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (cached.version === INDEX_VERSION && sameSeasons(cached.seasons, seasons)) {
      nameCollisions.length = 0;
      nameCollisions.push(...cached.nameCollisions);
      return new Map(cached.entries);
    }
  }

  const rows: BoxRow[] = [];
  for (const y of seasons) rows.push(...(await readSeasonRows(y)));
  const byId = aggregateBox(rows);

  const byName = new Map<string, PlayerTotals>();
  nameCollisions.length = 0;
  for (const totals of byId.values()) {
    const key = normaliseName(totals.name);
    const existing = byName.get(key);
    if (!existing) { byName.set(key, totals); continue; }
    // Keep whichever id has more games; record the loser rather than
    // silently overwriting — that silent overwrite is exactly the bug this
    // whole collision-tracking exists to prevent (one player's career
    // getting attributed to another under a shared name key).
    if (totals.games > existing.games) {
      nameCollisions.push({ name: key, kept: totals.id, dropped: existing.id });
      byName.set(key, totals);
    } else {
      nameCollisions.push({ name: key, kept: existing.id, dropped: totals.id });
    }
  }

  if (cacheable) {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ version: INDEX_VERSION, seasons, entries: [...byName], nameCollisions }));
  }
  return byName;
}

/**
 * Groups a name index by its suffix-stripped form, purely as a fallback
 * LOOKUP table — never used to build the primary index. Cheap enough (a few
 * thousand entries) to rebuild on demand rather than maintain as separate
 * persisted state alongside byName.
 */
export function buildStrippedIndex(byName: Map<string, PlayerTotals>): Map<string, PlayerTotals[]> {
  const out = new Map<string, PlayerTotals[]>();
  for (const [key, totals] of byName) {
    const stripped = stripSuffix(key);
    const list = out.get(stripped);
    if (list) list.push(totals); else out.set(stripped, [totals]);
  }
  return out;
}

/**
 * Pure two-stage lookup against an already-built index — split out from
 * careerPoints() so the ambiguity guard can be unit tested against a
 * synthetic index with no network or cache involved:
 *   1. Exact normalised-name key hit -> return it directly.
 *   2. Miss -> fall back to the suffix-stripped key. Exactly one candidate
 *      there -> return it (this is the legitimate case: a spelling
 *      difference between the draft object and the box scores, e.g. "Kelly
 *      Oubre Jr." vs "Kelly Oubre", where only one real athlete exists
 *      either way). Two or more candidates -> refuse (return null) and
 *      record the ambiguity — this is the case that used to silently
 *      return whichever candidate had more games, which is a wrong number
 *      wearing a confident face.
 */
export function resolveName(name: string, index: Map<string, PlayerTotals>): PlayerTotals | null {
  const key = normaliseName(name);
  const exact = index.get(key);
  if (exact) return exact;

  const stripped = stripSuffix(key);
  const candidates = buildStrippedIndex(index).get(stripped);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  ambiguous.push({
    query: name,
    candidates: candidates.map((c) => ({ id: c.id, name: c.name, games: c.games })),
  });
  return null;
}

/** Convenience single-name lookup against the full (cached) index. */
export async function careerPoints(name: string): Promise<PlayerTotals | null> {
  return resolveName(name, await loadPlayerIndex());
}
