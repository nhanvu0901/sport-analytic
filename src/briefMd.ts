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
import { prefixTotals, type WriterBrief, type BriefEntity } from './brief';
import { fmt } from './scale';
import { teamBySlug, teamChanges } from './teams';
import { PAYROLL_KEY } from './videoData';
import { LENGTH_TOLERANCE } from './verify';

/**
 * The contiguous runs of one team in a series — the ERAS, not 23 rows of slug.
 *
 * A writer cannot use "2013-14: miami-heat" twenty-three times; it can use
 * "Miami 2010-11 .. 2013-14". The boundaries come from `teamChanges`, the same
 * function the chart uses to place its logos, so the Markdown and the picture
 * can never disagree about where an era ends.
 *
 * A run whose first season carries no team (or a slug no longer in
 * data/teams.json — a relocated franchise) is dropped rather than guessed:
 * the section is an aid, and a wrong era is worse than a missing one.
 */
function teamEras(e: BriefEntity): { team: string; from: string; to: string }[] {
  const cuts = [0, ...teamChanges(e.series), e.series.length];
  const out: { team: string; from: string; to: string }[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) {
    const first = e.series[cuts[k]];
    const last = e.series[cuts[k + 1] - 1];
    const mark = teamBySlug(first?.team);
    if (!mark || !first || !last) continue;
    out.push({ team: mark.name, from: first.step, to: last.step });
  }
  return out;
}

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
  const bud = b.facts.budget;
  // `?? []` for the same reason verifyDraft does it: a brief serialised (or
  // hand-built as a fixture) before threshold lines existed has no such field,
  // and a brief with no named lines is the honest empty case anyway.
  const thresholdKeys = b.visual.threshold_keys ?? [];
  const L: string[] = [];

  // The beat count is DERIVED from this brief's narrative units, so it is
  // normally one number stated twice ([7, 7]). "7–7" reads as a range a
  // writer may pick inside; "exactly 7" reads as the instruction it is.
  const exactBeats = b.style.beats[0] === b.style.beats[1];
  const beatsLabel = exactBeats ? String(b.style.beats[0]) : `${b.style.beats[0]}–${b.style.beats[1]}`;

  /* 1. header + compact fact line ---------------------------------------- */
  L.push(`# Brief — ${b.topic.question}`, '');
  L.push(
    `**Angle:** ${b.topic.angle} · **Lane:** ${b.topic.lane} · **Chart:** ${b.visual.chart} · ` +
    `**Camera:** ${b.visual.camera} · **Beats:** ${exactBeats ? `exactly ${beatsLabel}` : beatsLabel}`,
    ''
  );
  // Length as ONE number, not the legal range. The range is what a Short may
  // be; the target is what this script must be, and it has to appear as a
  // countable word figure because that is the only unit a writer can hit on
  // purpose — a draft written to the short end of a 40–95s range measures its
  // accents against a 43s denominator and fails density for being brief.
  const pct = Math.round(LENGTH_TOLERANCE * 100);
  const lo = Math.round(b.style.target_words * (1 - LENGTH_TOLERANCE));
  const hi = Math.round(b.style.target_words * (1 + LENGTH_TOLERANCE));
  L.push(
    `**Write ${b.style.target_words} words** — that is this video's target length ` +
    `(≈ ${b.style.target_seconds}s spoken). Accepted: ${lo}–${hi} words (±${pct}%). ` +
    `Legal outer bound ${b.style.duration_s[0]}–${b.style.duration_s[1]}s, but do not aim there.`,
    ''
  );
  L.push(
    `**Accent budget:** ${b.visual.accent_budget.total_min}–${b.visual.accent_budget.total_max} accents total ` +
    `across all ${beatsLabel} beats — ${b.visual.accent_budget.per_beat_hint}`,
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
    // A budget's two kinds are facts about the WHOLE, not about the player
    // whose segment they are pinned to (`Marker.entityId` is required, and the
    // top of the stack is where the total is drawn). Labelling them "Barnes"
    // would invite a sentence that credits one contract with the payroll.
    for (const m of markers) {
      const who = bud && (m.kind === 'threshold-gap' || m.kind === 'top-heavy') ? bud.subject : e.last;
      bullets.push(`- **${esc(who)}** · ${m.kind} · ${m.detail}`);
    }
  }
  L.push(...(bullets.length ? bullets : ['_No machine-detected markers for this brief._']), '');

  /* 3b. the record, when this is a chase ------------------------------------
   * Placed before the table because it is the CEILING every number in that
   * table is measured against — a reader who meets the totals first has
   * already formed the wrong impression of how big they are. */
  const rec = b.facts.record;
  if (rec) {
    L.push('## The record being chased', '');
    L.push(
      `**${esc(rec.holder)} — ${fmt.int(rec.value)} ${esc(rec.unit)}** in ${rec.seasons} seasons. ` +
      'This is a single horizontal line on the chart, not a second series: ' +
      "the holder's season-by-season data is not part of this video.",
      ''
    );
    for (const g of rec.gap) {
      const e = b.facts.entities.find((x) => x.id === g.entityId);
      if (!e) continue;
      L.push(g.short > 0
        ? `- **${esc(e.last)}** is ${fmt.int(g.short)} short, on ${fmt.int(e.total)} after ${e.seasons_played} seasons.`
        : `- **${esc(e.last)}** is already past it, on ${fmt.int(e.total)}.`);
    }
    L.push('');
    const anyId = b.facts.entities[0]?.id ?? '...';
    L.push(
      'To point an accent at the line itself, anchor it with `record`: ' +
      `\`{ "entityId": "${anyId}", "record": true }\`. ` +
      '`entityId` stays required and names whose chart it is; `refline` and `arrow` are the two kinds that read well on it.',
      ''
    );
    // The gap is the number this whole video is about, and until `span`
    // existed there was no way to DRAW it — the writer wrote it into an
    // arrow's text instead, which puts the sentence's words on the chart
    // rather than the measurement.
    L.push(
      'To draw the gap itself rather than name it, use a `span` — two anchors, and the number between them ' +
      `is measured for you: \`{ "t": 0.7, "kind": "span", "at": { "entityId": "${anyId}" }, "to": { "entityId": "${anyId}", "record": true } }\`. ` +
      'Write no `text` on it: the label is computed from the two anchors, which is why it cannot be a wrong number.',
      ''
    );
    L.push(`_Source: ${esc(rec.source)}_`, '');
  }

  /* 3c. the budget, when this is one ---------------------------------------
   * The counterpart of 3b, and in the same place for the same reason: these
   * five levels are what every figure in the table below is measured against,
   * and a reader who meets the contracts first has already formed an opinion
   * about how big they are. */
  if (bud) {
    L.push('## The budget and the lines it is judged against', '');
    L.push(
      `**${esc(bud.subject)} — ${fmt.money(bud.total)} committed for ${bud.season}**, `
      + `across ${b.facts.entities.length} contracts. `
      + 'The column is the whole of it; the dashed lines are fixed and do not move.',
      ''
    );
    L.push('| Line | Level | The payroll is |', '| --- | ---: | --- |');
    for (const l of bud.lines) {
      L.push(`| ${esc(l.label)} | ${fmt.money(l.value)} | ${l.over > 0
        ? `**${fmt.money(l.over)} OVER** it`
        : `${fmt.money(-l.over)} under it`} |`);
    }
    L.push('');

    // Concentration, as the prefix table. Every row of this is in
    // allowed_numbers, so any grouping the script wants to make is sayable —
    // "the top four are 75% of it" as readily as the top three.
    L.push('### How top-heavy it is', '');
    L.push('| Top | Contracts | Subtotal | Share of the payroll |', '| ---: | --- | ---: | ---: |');
    const parts = [...b.facts.entities].sort((x, y) => y.total - x.total);
    for (const p of prefixTotals(b.facts.entities)) {
      if (p.count > 6) break;
      L.push(`| ${p.count} | ${esc(parts.slice(0, p.count).map((e) => e.last).join(', '))} `
        + `| ${fmt.money(p.subtotal)} | ${Math.round(p.share * 100)}% |`);
    }
    L.push('');

    /* Anchoring, and the one thing this chart does differently ------------- */
    const anyId = b.facts.entities[0]?.id ?? '...';
    L.push('### Pointing at a line', '');
    L.push(
      'The lines are not entities, so they have no `entityId` of their own and no `step`. '
      + 'Name one with `threshold`:',
      ''
    );
    L.push('```json');
    L.push(JSON.stringify({ t: 0.5, kind: 'refline', at: { entityId: anyId, threshold: 'tax' }, text: 'Luxury Tax' }, null, 2));
    L.push('```', '');
    L.push(`Valid \`threshold\` values: ${thresholdKeys.map((k) => `\`${k}\``).join(', ')} — `
      + `where \`${PAYROLL_KEY}\` is the top of the column itself (${fmt.money(bud.total)}), not a CBA level. `
      + '`entityId` stays required and names whose chart it is.', '');
    L.push(
      '**The span is the shot this video is built on.** Two anchors, and the number between them is '
      + 'measured for you — the distance from the top of the column to a line is the whole argument:',
      ''
    );
    L.push('```json');
    L.push(JSON.stringify({
      t: 0.7, kind: 'span',
      at: { entityId: anyId, threshold: PAYROLL_KEY },
      to: { entityId: anyId, threshold: 'tax' },
    }, null, 2));
    L.push('```', '');
    L.push('Write no `text` on it: the label is computed from the two anchors, which is why it cannot be a wrong number.', '');
    L.push(
      'A `zoom` accent is NOT available on this chart — it has no camera, because a push-in on one contract '
      + 'hides the lines and the lines are the argument. '
      + `The kinds you may use here are ${b.visual.accent_kinds.map((k) => `\`${k}\``).join(', ')}.`,
      ''
    );
    L.push(
      '**There is no time axis.** Every contract is one number for one season, so an `at.step` buys nothing — '
      + 'omit it. A `spotlight` or `callout` anchored at an `entityId` lands in the middle of that contract\'s '
      + 'band, where the portrait and the figure already are.',
      ''
    );
    L.push(
      '**How to write money.** Write every dollar figure in full, with thousands separators and no `$`, '
      + `exactly as this brief writes it: \`${bud.total.toLocaleString('en-US')}\`, not "183 million" and not `
      + '"182.6M". The chart prints each contract and the total the same way, so the voice and the picture '
      + 'say one thing — and a rounded figure is a number that is not in `allowed_numbers`.',
      ''
    );
    L.push(`_Source: ${esc(bud.source)}_`, '');
  }

  /* 4. the numbers ---------------------------------------------------------*/
  L.push('## The numbers', '');
  if (bud) {
    // A budget's parts have no pick, no season count and no awards that mean
    // anything here — a "Seasons: 1" column on a payroll table is noise that
    // reads like a fact. Cap hit and share are what there is.
    L.push('| # | Player | Cap hit | Share |', '| ---: | --- | ---: | ---: |');
    for (const e of byRank) {
      L.push(`| ${e.rank} | ${esc(e.name)} | ${fmt.money(e.total)} `
        + `| ${bud.total > 0 ? Math.round((e.total / bud.total) * 100) : 0}% |`);
    }
    L.push(`| | **Total** | **${fmt.money(bud.total)}** | **100%** |`);
    L.push('');
  } else {
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

    /* 5. season by season ---------------------------------------------------
     * Entities as rows, anchor_steps as columns. A dash is a missed season —
     * never a zero, which would read as "played and scored nothing".
     *
     * Inside the else on purpose: a budget column has ONE step, so this table
     * would be a second copy of the one above with a season label on top of
     * it — and the eras below it would be a heading with no rows. */
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

    /* 5b. which team, which seasons -----------------------------------------
     * The eras, immediately under the season table they index, because a beat
     * that anchors a step is choosing an era whether or not it knows it. The
     * whole section is skipped when no entity carries a team — a source that
     * has none (C01) should not grow an empty heading. */
    const eras = byRank.map((e) => ({ e, runs: teamEras(e) })).filter((x) => x.runs.length > 0);
    if (eras.length) {
      L.push('## Which team, which seasons', '');
      L.push(
        'The chart draws that team\'s logo at every change, so the picture states the era whether or not ' +
        'the voice does. A beat that names a team its anchored `at.step` contradicts is rejected with `team-era`.',
        ''
      );
      L.push('| Player | Team | Seasons |', '| --- | --- | ---: |');
      for (const { e, runs } of eras) {
        for (const r of runs) {
          L.push(`| ${esc(e.name)} | ${esc(r.team)} | ${r.from} .. ${r.to} |`);
        }
      }
      L.push('');
    }
  }

  /* 6. what you may point at ------------------------------------------------*/
  L.push('## What you may point at', '');
  if (bud) {
    L.push(
      `Anchor at an \`entityId\` for a contract, or \`threshold\` for a line: `
      + `${thresholdKeys.map((k) => `\`${k}\``).join(', ')}. `
      + `The one \`at.step\` this chart has is \`${b.visual.anchor_steps.join('`, `')}\` — the season the `
      + 'payroll is a payroll OF, which you may SAY; there is no second step to choose between, so omit it '
      + 'from your anchors.',
      ''
    );
  } else {
    L.push(`Valid \`at.step\` values: ${b.visual.anchor_steps.map((s) => `\`${s}\``).join(', ')}`, '');
  }
  if (b.facts.record) {
    L.push('', `Or \`at: { "entityId": "...", "record": true }\` for the ${fmt.int(b.facts.record.value)} record line.`, '');
  }
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
          // The kinds come from the brief's own `visual.accent_kinds` rather
          // than a list typed out here: a kind added to ACCENT_KINDS and not
          // to this line would be legal for the verifier and invisible to the
          // writer, which is the same as not existing.
          { t: '0..1', kind: b.visual.accent_kinds.join(' | '),
            at: {
              entityId: '...',
              ...(bud
                ? {}
                : { step: 'optional — one of the anchor steps' }),
              ...(b.facts.record ? { record: 'optional — true to point at the record line instead of a step' } : {}),
              ...(thresholdKeys.length
                ? { threshold: `optional — one of ${thresholdKeys.join(' | ')}, a line instead of a part` }
                : {}),
            },
            to: 'span ONLY — the second anchor, same shape as at; the span measures between them',
            text: 'optional label — never on a span, whose number is computed' },
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
