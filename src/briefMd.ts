/**
 * Renders a WriterBrief as Markdown built to be pasted into a chat box.
 *
 * Pure and deterministic: no I/O, no randomness, no network — the same brief
 * always renders to the same string, which is what makes the "verify fails,
 * fix it, paste again" loop reproducible.
 *
 * This file carries only the DATA for one video. The RULES (the seven style
 * rules, the accent contract, the schema explanation, the checklist) live in
 * prompts/WRITER_SKILL.md and are pasted once — nothing here restates them.
 */
import type { WriterBrief, BriefEntity } from './brief';
import { fmt } from './scale';

/** Markdown table cells break on a bare `|` in the data (never happens for a
 *  player name today, but a name is still untrusted external text). */
const esc = (s: string) => s.replace(/\|/g, '\\|');

/** Every 4-digit year hiding in a season label: "2019-20" -> 2020 (its own
 *  END year), "2019" -> 2019. Deliberately only the end year, not every year
 *  the way brief.ts's own `yearsIn` does for `allowedNumbers` — this module
 *  only ever needs one number per label, to order two labels in time. */
function seasonEndYear(label: string): number {
  const m = label.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return NaN;
  const y0 = Number(m[1]);
  return m[2] ? Math.floor(y0 / 100) * 100 + Number(m[2]) : y0;
}

/**
 * An award "predates" an entity's NBA debut when its own season sorts before
 * the entity's first NBA season. NBA-season awards (Rookie of the Year, MIP,
 * Sixth Man...) are always dated by the season's SECOND year — the year they
 * were announced, in that season's spring, e.g. "2020" for the 2019-20
 * season. College-era awards (AP All-American, Wooden, Naismith...) are
 * always dated by a single bare year that equals the debut season's own
 * START year, e.g. "2019" for a player who debuts in 2019-20. Comparing END
 * years therefore separates the two groups cleanly with no award allowlist:
 * 2019 < 2020 (college, dropped); 2020 < 2020 is false (rookie award, kept).
 */
function predatesDebut(awardSeason: string, entity: BriefEntity): boolean {
  const firstSeason = entity.series[0]?.step;
  if (!firstSeason) return false;   // no known debut season: don't silently drop
  return seasonEndYear(awardSeason) < seasonEndYear(firstSeason);
}

const nbaEraAwards = (e: BriefEntity) => e.awards.filter((a) => !predatesDebut(a.season, e));

export function renderBriefMd(b: WriterBrief): string {
  const byRank = [...b.facts.entities].sort((x, y) => x.rank - y.rank);
  const L: string[] = [];

  /* 1. header + compact fact line ---------------------------------------- */
  L.push(`# Brief — ${b.topic.question}`, '');
  L.push(
    `**Angle:** ${b.topic.angle} · **Lane:** ${b.topic.lane} · **Chart:** ${b.visual.chart} · ` +
    `**Camera:** ${b.visual.camera} · **Duration:** ${b.style.duration_s[0]}–${b.style.duration_s[1]}s · ` +
    `**Beats:** ${b.style.beats[0]}–${b.style.beats[1]}`,
    ''
  );

  /* 2. the tension --------------------------------------------------------*/
  L.push('## The tension', '');
  L.push(`> ${b.topic.hook_seed}`, '');
  if (b.topic.why_fans_argue) L.push(`**Why fans argue:** ${b.topic.why_fans_argue}`, '');
  if (b.topic.evidence?.length) {
    for (const url of b.topic.evidence) L.push(`- ${url}`);
    L.push('');
  }

  /* 3. the story the numbers are hiding ------------------------------------
   * Grouped by entity (rank order), award markers that predate the entity's
   * NBA debut dropped. This goes BEFORE the raw table on purpose: the
   * markers are what the script should be built on, and a writer reads
   * top-down. */
  L.push('## The story the numbers are hiding', '');
  const bullets: string[] = [];
  for (const e of byRank) {
    const markers = b.facts.markers.filter((m) =>
      m.entityId === e.id && (m.kind !== 'award' || !predatesDebut(m.step ?? '', e))
    );
    for (const m of markers) bullets.push(`- **${e.last}** · ${m.kind} · ${m.detail}`);
  }
  L.push(...(bullets.length ? bullets : ['_No machine-detected markers for this brief._']), '');

  /* 4. the numbers ---------------------------------------------------------*/
  L.push('## The numbers', '');
  L.push('| # | Player | Pick | Total | Seasons | Awards |');
  L.push('| ---: | --- | ---: | ---: | ---: | --- |');
  for (const e of byRank) {
    // `== null` deliberately catches both a confirmed undrafted (null) and
    // an unknown pick (undefined) — this table just needs a dash for
    // "nothing to show", it doesn't need to distinguish the two like
    // detectMarkers does.
    const pick = e.pick == null ? '—' : String(e.pick);
    const awards = nbaEraAwards(e).map((a) => a.name).join(', ') || '—';
    L.push(`| ${e.rank} | ${esc(e.name)} | ${pick} | ${fmt.int(e.total)} | ${e.seasons_played} | ${esc(awards)} |`);
  }
  L.push('');

  /* 5. season by season -----------------------------------------------------
   * Entities as rows, anchor_steps as columns. A dash is a missed season —
   * never a zero, which would read as "played and scored nothing". */
  L.push('## Season by season', '');
  L.push('_Cumulative totals. A dash means the entity has no data point for that season — a missed season, not a zero._', '');
  L.push(`| Player | ${b.visual.anchor_steps.join(' | ')} |`);
  L.push(`| --- | ${b.visual.anchor_steps.map(() => '---:').join(' | ')} |`);
  for (const e of byRank) {
    const cells = b.visual.anchor_steps.map((step) => {
      const pt = e.series.find((s) => s.step === step);
      return pt ? fmt.int(pt.value) : '—';
    });
    L.push(`| ${esc(e.name)} | ${cells.join(' | ')} |`);
  }
  L.push('');

  /* 6. what you may point at ------------------------------------------------*/
  L.push('## What you may point at', '');
  L.push(`Valid \`at.step\` values: ${b.visual.anchor_steps.map((s) => `\`${s}\``).join(', ')}`, '');
  L.push('| Player | id |', '| --- | --- |');
  for (const e of byRank) L.push(`| ${esc(e.name)} | ${e.id} |`);
  L.push('');

  /* 7. numbers you may use --------------------------------------------------*/
  L.push('## Numbers you may use', '');
  L.push('Any number in the script that is not in this list is rejected.', '');
  L.push('```');
  L.push(b.facts.allowed_numbers.map((n) => fmt.int(n)).join(', '));
  L.push('```', '');

  /* 8. return this shape -----------------------------------------------------
   * Hand-written and compact — the raw JSON Schema in output.schema is not
   * meant for a human to read. */
  L.push('## Return this shape', '');
  L.push('```json');
  L.push(JSON.stringify({
    title: 'string, <= 70 characters',
    beats: [
      {
        text: 'string, one sentence chaining 2-4 events',
        entityId: 'an id from facts.entities',
        accents: [
          { t: '0..1', kind: 'zoom | refline | callout | arrow | spotlight',
            at: { entityId: '...', step: 'optional — one of the anchor steps' }, text: 'optional label' },
        ],
        ending: 'thesis | hard-cut | open-question — last beat only',
      },
    ],
  }, null, 2));
  L.push('```', '');
  L.push('Example, shaped for this brief:', '');
  L.push('```json');
  L.push(JSON.stringify(b.output.example, null, 2));
  L.push('```', '');

  /* 9. closing pointer -------------------------------------------------------*/
  L.push('Rules are in WRITER_SKILL.md — paste that first if you have not.');

  return L.join('\n');
}
