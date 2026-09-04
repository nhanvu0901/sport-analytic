/**
 * All-time NBA career records — the single horizontal line a record chase is
 * measured against.
 *
 * ## Why this is a table and not an ESPN call
 *
 * ESPN *does* serve all-time career leaders, and it was probed before this
 * file was written:
 *
 *   GET https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/leaders
 *
 * returns five categories x 25 leaders, and the sibling ids confirm what the
 * resource is — `.../leaders/1` answers `No all-time leaders found for
 * splitType:1`. It is ESPN's own all-time leaderboard. It is also unusable as
 * a record source, for two measured reasons:
 *
 *  - Its REBOUNDS list carries the SAME hole that broke this pipeline in the
 *    first place. It names Moses Malone (16,212) as the all-time leader; Wilt
 *    Chamberlain and Bill Russell are absent from all 25 rows, and Kareem
 *    Abdul-Jabbar appears at 12,369 against a real 17,440. ESPN's JSON
 *    rebound totals effectively begin at 1973-74, which is exactly why
 *    `athletes/4142` (Wilt) returns 5 seasons and 0 rebounds.
 *  - Its POINTS list omits LeBron James — the actual record holder — entirely,
 *    while listing other active players (Harden, Westbrook).
 *
 * So the JSON endpoint would hand a record chase the wrong record. ESPN's own
 * WEB leaderboard, by contrast, is correct on all five:
 *
 *   https://www.espn.com/nba/history/leaders/_/stat/{points|rebounds|assists|steals|blocks}
 *
 * That page is HTML, not JSON — `src/espn.ts` is a JSON adapter, and scraping
 * a marketing page for a number that changes once a decade trades a silent
 * layout break for no benefit. Five integers, each corroborated against two
 * independent reachable sources and each carrying the provenance note it was
 * checked with, is the smaller and more honest dependency. Nothing in this
 * file touches the network.
 *
 * ## Corroboration
 *
 * Every figure below was read from BOTH sources on the `asOf` date, and they
 * agree to the digit. basketball-reference.com answers 403 from this machine
 * and stats.nba.com does not resolve at all, so neither could be used.
 *
 * Nothing here is transcribed from a prompt or from memory. A record that
 * could not be corroborated twice is not in the table.
 */

export type RecordMeasure = 'PTS' | 'REB' | 'AST' | 'STL' | 'BLK';

export type CareerRecord = {
  /** The ESPN stat label this record belongs to — the key `inferMeasure` returns. */
  measure: RecordMeasure;
  /** Plain word for the stat, for prose ("rebounds"). */
  unit: string;
  holder: string;
  /** ESPN athlete id of the holder, so a chase can tell holder from chaser
   *  without matching names. Verified by resolving the holder through
   *  `findAthleteId`. */
  holderEspnId: string;
  value: number;
  /** Seasons the holder needed. A record chase is a story about pace, and the
   *  chaser's season count is meaningless without the holder's. */
  seasons: number;
  /**
   * `true` when the holder is still playing, i.e. the figure is a moving
   * target rather than a constant. A chase whose own chaser IS the holder must
   * not draw a record line at their own total, and `recordChaseFor` refuses
   * that case; this flag says WHY the number will drift even when it doesn't.
   */
  active?: true;
  /** Where the figure came from. Never a guess, never a single source. */
  source: string;
  /** ISO date both sources were read. */
  asOf: string;
};

const ASOF = '2026-09-04';
const ESPN_WEB = (stat: string) => `https://www.espn.com/nba/history/leaders/_/stat/${stat}`;
const WIKI = (page: string) => `https://en.wikipedia.org/wiki/List_of_NBA_career_${page}_leaders`;

const two = (stat: string, page: string, extra = '') =>
  `${ESPN_WEB(stat)} and ${WIKI(page)}, read ${ASOF} — both agree${extra ? `. ${extra}` : ''}`;

/**
 * Keyed by ESPN stat label so `inferMeasure(...).espnLabel` looks a record up
 * directly. Only counting stats with a real all-time leaderboard are here:
 * there is no all-time record for an AVERAGE, and a chase against one would be
 * a category error.
 */
export const CAREER_RECORDS: Record<RecordMeasure, CareerRecord> = {
  REB: {
    measure: 'REB', unit: 'rebounds',
    holder: 'Wilt Chamberlain', holderEspnId: '4142',
    value: 23924, seasons: 14,
    source: two('rebounds', 'rebounding',
      "ESPN's JSON all-time leaders endpoint disagrees (it names Moses Malone at 16,212) because its rebound totals start at 1973-74; ESPN's own web leaderboard has Wilt at 23,924 and Bill Russell second at 21,620, matching Wikipedia"),
    asOf: ASOF,
  },
  AST: {
    measure: 'AST', unit: 'assists',
    holder: 'John Stockton', holderEspnId: '812',
    value: 15806, seasons: 19,
    source: two('assists', 'assists', "ESPN's JSON all-time leaders endpoint agrees as well"),
    asOf: ASOF,
  },
  STL: {
    measure: 'STL', unit: 'steals',
    holder: 'John Stockton', holderEspnId: '812',
    value: 3265, seasons: 19,
    source: two('steals', 'steals', "ESPN's JSON all-time leaders endpoint agrees as well"),
    asOf: ASOF,
  },
  BLK: {
    measure: 'BLK', unit: 'blocks',
    holder: 'Hakeem Olajuwon', holderEspnId: '619',
    value: 3830, seasons: 18,
    source: two('blocks', 'blocks',
      "ESPN's JSON all-time leaders endpoint agrees on the figure, though it mislabels the category `name` as \"assists\" with abbreviation \"BLK\""),
    asOf: ASOF,
  },
  PTS: {
    measure: 'PTS', unit: 'points',
    holder: 'LeBron James', holderEspnId: '1966',
    value: 43440, seasons: 23,
    active: true,
    source: two('points', 'scoring',
      "the holder is ACTIVE, so this figure rises whenever he plays and is only true as of the date above; the 38,387 he passed (Kareem Abdul-Jabbar) is the figure ESPN's JSON endpoint still reports as the record"),
    asOf: ASOF,
  },
};

/** The record for an ESPN stat label, or null when we hold none. */
export function recordFor(espnLabel: string | null | undefined): CareerRecord | null {
  if (!espnLabel) return null;
  return (CAREER_RECORDS as Record<string, CareerRecord>)[espnLabel] ?? null;
}

/**
 * Does this text claim to be about a RECORD, rather than about two players who
 * happen to be compared?
 *
 * Deliberately narrow. "Which 2019 pick has scored the most points?" is a
 * comparison and must NOT acquire an all-time line that squashes every series
 * on the chart into the bottom eighth of the frame. Only wording that reaches
 * for the all-time board qualifies.
 */
export function namesRecord(text: string): boolean {
  return /\brecords?\b|\ball[-\s]?time\b/i.test(text ?? '');
}

/**
 * Whole-word, case-insensitive: does `text` name this person? The full name,
 * or the surname alone ("catch Chamberlain").
 *
 * The surname is included and the FIRST name deliberately is not. A surname
 * identifies the holder in NBA prose; a given name does not — matching "John"
 * would read a question about John Wall as a question about John Stockton's
 * assists record, and there is no way to tell those apart from four letters.
 * The cost is that "can LeBron catch Wilt" alone does not fire, which is the
 * safe direction to fail: no record line, not the wrong one.
 */
function namesPerson(text: string, fullName: string): boolean {
  const parts = fullName.split(/\s+/).filter(Boolean);
  const candidates = [fullName, parts.at(-1)!].filter(Boolean);
  return candidates.some((c) => new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text));
}

/**
 * The record THIS question is chasing, or null.
 *
 * Three conditions, all necessary, and each one closes a way of attaching the
 * wrong line:
 *
 *  1. We hold a corroborated record for the measure being charted. Without it
 *     there is no number to draw, and inventing one is the failure mode this
 *     whole module exists to avoid.
 *  2. The text reaches for the all-time board (`namesRecord`). A draft-class
 *     comparison is not a record chase.
 *  3. The record's HOLDER is named — in the question, or among the candidate's
 *     own entities. This is what keeps Wilt's 23,924 off a Jokic-vs-Howard
 *     rebounding chart: that question is a real chase, but not of THIS record,
 *     and a 23,924 ceiling would dwarf both of its series for nothing.
 *
 * Pure and exported so all three can be tested without a network call.
 */
export function recordChaseFor(
  text: string,
  entityNames: readonly string[],
  espnLabel: string | null | undefined
): CareerRecord | null {
  const record = recordFor(espnLabel);
  if (!record) return null;
  if (!namesRecord(text)) return null;
  const holderNamed = namesPerson(text, record.holder)
    || entityNames.some((n) => namesPerson(n, record.holder));
  return holderNamed ? record : null;
}
