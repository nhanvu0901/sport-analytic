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

/**
 * The extra names a script actually SAYS, beyond the city and the nickname
 * that `teamAliases` derives from the row itself.
 *
 * Two kinds of entry, and both are here because a narration writes them:
 * the clipped nickname ("Cavs", "Sixers", "Blazers"), and the city a row
 * spells differently from the way it is spoken — ESPN writes "LA Clippers"
 * and "Los Angeles Lakers", so BOTH spellings are listed under BOTH LA teams.
 * That deliberate overlap is safe because the caller passes if ANY named team
 * matches: "he moved to LA" must not convict a Lakers beat of naming the
 * Clippers.
 *
 * Deliberately short. An alias is only worth adding when a writer would
 * plausibly use it instead of the full name, and every alias added is another
 * chance for a false match.
 */
const EXTRA_ALIASES: Record<string, readonly string[]> = {
  'cleveland-cavaliers': ['Cavs'],
  'los-angeles-lakers': ['LA', 'L.A'],
  'la-clippers': ['Los Angeles', 'L.A'],
  'philadelphia-76ers': ['Sixers', 'Philly'],
  'portland-trail-blazers': ['Blazers'],
  'minnesota-timberwolves': ['Wolves', 'T-Wolves'],
  'oklahoma-city-thunder': ['OKC'],
  'golden-state-warriors': ['Dubs'],
  'new-orleans-pelicans': ['Pels'],
};

/**
 * Every way this team can be named in prose: its city, its nickname, and any
 * extras above.
 *
 * The city is the name with the nickname suffix removed — "Cleveland
 * Cavaliers" minus "Cavaliers" — which holds for all 30 rows including the
 * two-word ones ("Portland" + "Trail Blazers", "Oklahoma City" + "Thunder").
 */
export function teamAliases(t: TeamMark): string[] {
  const city = t.name.slice(0, t.name.length - t.short.length).trim();
  return [city, t.short, ...(EXTRA_ALIASES[teamSlug(t.name)] ?? [])];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One matcher per alias, built once. The lookarounds are `\b` that also
 *  survive an alias ending in punctuation ("L.A"), and the match is
 *  case-insensitive because a writer's casing is not a fact we control. */
const ALIAS_PATTERNS: { re: RegExp; slug: string }[] = (teams as TeamMark[]).flatMap((t) => {
  const slug = teamSlug(t.name);
  return teamAliases(t).map((a) => ({
    re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(a)}(?![A-Za-z0-9])`, 'i'),
    slug,
  }));
});

/**
 * Every team slug named anywhere in `text` — "Cleveland", "Cavaliers" and
 * "Cavs" all resolve to `cleveland-cavaliers`.
 *
 * A nickname that is also an ordinary English word ("Heat", "Magic",
 * "Thunder") can match prose that meant the word. That is tolerable only
 * because the one caller — `verifyDraft`'s `team-era` rule — passes a beat
 * when ANY named team matches: a stray word adds a candidate, it never
 * removes the right one.
 */
export function teamsNamedIn(text: string): string[] {
  const out = new Set<string>();
  for (const { re, slug } of ALIAS_PATTERNS) if (re.test(text)) out.add(slug);
  return [...out];
}
