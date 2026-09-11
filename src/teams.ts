/**
 * ESPN's per-season `teamSlug` -> that team's mark and colour.
 *
 * A career line is one stroke, but a career is not: LeBron James's 23 seasons
 * are Cleveland, Miami, Cleveland, Los Angeles, and the chart used to say so
 * nowhere — one portrait in one jersey for the whole video. The per-season
 * team is free (it is already in the `athleteStats` response `seasonRows`
 * reads); what is NOT available anywhere we can reach is a per-season PHOTO,
 * so the portrait cannot change. Small team logos at the seasons the team
 * changes, and a portrait ring in the current team's colour, are what can be
 * drawn from data we actually have.
 *
 * Lookup by slug, because that is the shape ESPN hands back. The slug is the
 * team's own name lower-cased with non-alphanumerics collapsed to hyphens —
 * verified for all 30 rows of `data/teams.json` against ESPN's own slugs
 * ("la-clippers", "brooklyn-nets", "los-angeles-lakers").
 *
 * No network at draw time: `data/teams.json` is bundled, the same way every
 * other chart's data is.
 */
import teams from './data/teams.json';

export type TeamMark = {
  id: string;
  abbr: string;
  name: string;
  short: string;
  /** The team's primary colour, AS AUTHORED — for white paper. Anything
   *  drawing it on this project's near-black ground must put it through
   *  `ensureContrast` first; Cleveland's #860038 and Miami's #98002e both
   *  fail against #101319 otherwise. */
  color: string;
  alt: string;
  logo: string;
};

export const teamSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const BY_SLUG = new Map<string, TeamMark>((teams as TeamMark[]).map((t) => [teamSlug(t.name), t]));

/** Null for an unknown slug — a relocated or defunct franchise, say. Every
 *  caller has to degrade to "no logo, theme ring" rather than guess. */
export const teamBySlug = (slug?: string | null): TeamMark | null =>
  (slug && BY_SLUG.get(slug)) || null;

/**
 * The indices at which a series CHANGES team — never index 0.
 *
 * Three marks for LeBron (2010-11 Miami, 2014-15 Cleveland, 2018-19 Lakers),
 * not twenty-three, because the first season is where the career starts, not
 * where it turns. Pure, so the count is testable without a render.
 */
export function teamChanges<T extends { team?: string }>(points: readonly T[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].team;
    const now = points[i].team;
    if (now && prev && now !== prev) out.push(i);
  }
  return out;
}
