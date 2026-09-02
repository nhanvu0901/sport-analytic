import cumulative from './data/cumulative.json';
import redraft from './data/redraft.json';
import leaderMatrix from './data/leaderMatrix.json';
import waffle from './data/waffle.json';
import type { ScriptLine } from './script';

/**
 * The narration. One source of truth: the renderer builds a fallback timeline
 * from it, and scripts/tts.ts feeds the same lines to Chatterbox.
 */
const s = (name: string) => cumulative.series.find((x) => x.name === name)!;
const cumScript: ScriptLine[] = [
  { entityId: s('Zion Williamson').id, text: "Zion Williamson's career has been anything but consistent. He missed his third season entirely.",
    accents: [
      { t: 0.30, kind: 'arrow',   at: { entityId: s('Zion Williamson').id, step: '2022-23' }, text: 'A season missed entirely' },
      { t: 0.72, kind: 'callout', at: { entityId: s('Zion Williamson').id }, text: '6,581' },
    ] },
  { entityId: s('Ja Morant').id, text: 'The second pick, Ja Morant, started far more steadily, and sits just over seven thousand.',
    accents: [
      { t: 0.24, kind: 'zoom',    at: { entityId: s('Ja Morant').id } },
      { t: 0.58, kind: 'refline', at: { entityId: s('Ja Morant').id }, text: '7,331' },
    ] },
  { entityId: s('RJ Barrett').id, text: 'The third pick, RJ Barrett, was less flashy but steady as a rock. He leads this class.',
    accents: [
      { t: 0.28, kind: 'spotlight', at: { entityId: s('RJ Barrett').id } },
      { t: 0.70, kind: 'callout',   at: { entityId: s('RJ Barrett').id }, text: '8,391' },
    ] },
  { entityId: s('Jarrett Culver').id, text: 'The sixth pick, Jarrett Culver, lasted only four seasons in the league.',
    accents: [
      { t: 0.32, kind: 'arrow',   at: { entityId: s('Jarrett Culver').id }, text: 'Four seasons, then Japan' },
      { t: 0.74, kind: 'callout', at: { entityId: s('Jarrett Culver').id }, text: '934' },
    ] },
  { entityId: s('Nickeil Alexander-Walker').id, text: 'And at seventeen, Nickeil Alexander-Walker, the reigning Most Improved Player.',
    accents: [
      { t: 0.26, kind: 'zoom',      at: { entityId: s('Nickeil Alexander-Walker').id } },
      { t: 0.60, kind: 'spotlight', at: { entityId: s('Nickeil Alexander-Walker').id } },
    ] },
  { entityId: s('Darius Garland').id, text: 'Darius Garland has been just as consistent, and is now second from this class.',
    accents: [
      { t: 0.30, kind: 'refline', at: { entityId: s('Darius Garland').id }, text: '8,049' },
      { t: 0.72, kind: 'callout', at: { entityId: s('Darius Garland').id }, text: 'second' },
    ] },
  { entityId: s('Naz Reid').id, text: 'Naz Reid went undrafted, then won Sixth Man of the Year in twenty twenty four.',
    accents: [
      { t: 0.30, kind: 'arrow',   at: { entityId: s('Naz Reid').id }, text: 'Undrafted' },
      { t: 0.72, kind: 'callout', at: { entityId: s('Naz Reid').id }, text: '5,745' },
    ] },
  { entityId: s('Tyler Herro').id, text: 'Tyler Herro is third in scoring from this draft.',
    accents: [
      { t: 0.34, kind: 'spotlight', at: { entityId: s('Tyler Herro').id } },
      { t: 0.74, kind: 'callout',   at: { entityId: s('Tyler Herro').id }, text: '7,664' },
    ] },
  { entityId: s('Jordan Poole').id, text: 'Jordan Poole is fourth.',
    accents: [
      { t: 0.38, kind: 'callout',   at: { entityId: s('Jordan Poole').id }, text: '7,466' },
    ] },
  { entityId: s('Coby White').id, text: 'And Coby White is sixth. So, in retrospect, was this draft underwhelming?',
    accents: [
      { t: 0.24, kind: 'spotlight', at: { entityId: s('Coby White').id } },
      { t: 0.56, kind: 'callout',   at: { entityId: s('Coby White').id }, text: '7,273' },
      { t: 0.84, kind: 'zoom' },
    ] },
];

/**
 * The ORIGINAL video's narration, transcribed from its own auto-captions.
 *
 * Here for one reason: it is the only fair way to judge the voice. Feeding
 * Chatterbox the exact words a human podcast host already read lets the two be
 * compared on identical material instead of on two different scripts.
 *
 * NOTE one fact here is not in the ESPN data — "He played in Japan last year"
 * comes from Wikipedia. Kept because this is a verbatim reproduction for a
 * voice test, not a script the pipeline generated.
 */
const cumScriptVerbatim: ScriptLine[] = [
  { entityId: s('Zion Williamson').id,
    text: "Zion Williamson's career in the NBA has been anything but consistent. He completely missed his third season and has played sporadically since. Now, having been in the league for seven seasons, he's amassed over 6,000 points.",
    accents: [
      { t: 0.22, kind: 'zoom',    at: { entityId: s('Zion Williamson').id } },
      { t: 0.48, kind: 'arrow',   at: { entityId: s('Zion Williamson').id, step: '2022-23' }, text: 'Sporadically since' },
      { t: 0.82, kind: 'callout', at: { entityId: s('Zion Williamson').id }, text: '6,581' },
    ] },
  { entityId: s('Ja Morant').id,
    text: "But the second pick in the 2019 draft, Ja Morant, started his career much more consistently. His later seasons, though, have been plagued by injuries and suspensions. He's now at over 7,000 points.",
    accents: [
      { t: 0.20, kind: 'zoom',    at: { entityId: s('Ja Morant').id } },
      { t: 0.52, kind: 'refline', at: { entityId: s('Ja Morant').id }, text: '7,331' },
      { t: 0.84, kind: 'callout', at: { entityId: s('Ja Morant').id }, text: 'still second' },
    ] },
  { entityId: s('RJ Barrett').id,
    text: 'The third pick, RJ Barrett, has been the polar opposite of those two. Less flashy, but steady as a rock. He now leads this draft class in total points.',
    accents: [
      { t: 0.26, kind: 'spotlight', at: { entityId: s('RJ Barrett').id } },
      { t: 0.62, kind: 'callout',   at: { entityId: s('RJ Barrett').id }, text: '8,391' },
      { t: 0.86, kind: 'zoom',      at: { entityId: s('RJ Barrett').id } },
    ] },
  { entityId: s('Jarrett Culver').id,
    text: "And then skipping down to the sixth pick, here's Jarrett Culver. He only lasted four seasons in the NBA. He played in Japan last year.",
    accents: [
      { t: 0.30, kind: 'arrow',   at: { entityId: s('Jarrett Culver').id }, text: 'Four seasons' },
      { t: 0.74, kind: 'callout', at: { entityId: s('Jarrett Culver').id }, text: '934' },
    ] },
  { entityId: s('Nickeil Alexander-Walker').id,
    text: "And then jumping all the way down to the 17th pick, here's Nickeil Alexander-Walker. He's the reigning Most Improved Player of the Year, and you can see why. In his seventh season, he scored twice as much as any of his previous seasons.",
    accents: [
      { t: 0.20, kind: 'zoom',      at: { entityId: s('Nickeil Alexander-Walker').id } },
      { t: 0.54, kind: 'spotlight', at: { entityId: s('Nickeil Alexander-Walker').id } },
      { t: 0.86, kind: 'callout',   at: { entityId: s('Nickeil Alexander-Walker').id }, text: '4,882' },
    ] },
  { entityId: s('Darius Garland').id,
    text: "And then here's the fifth pick, Darius Garland. Like Barrett, he's been pretty consistent throughout his career, but he has had some seasons impacted by injuries. He's now second from this class in points.",
    accents: [
      { t: 0.28, kind: 'refline', at: { entityId: s('Darius Garland').id }, text: '8,049' },
      { t: 0.78, kind: 'callout', at: { entityId: s('Darius Garland').id }, text: 'second' },
    ] },
  { entityId: s('Naz Reid').id,
    text: 'And then how about an undrafted player from 2019, Naz Reid. Like Alexander-Walker, it took Reid a couple seasons to establish himself, but eventually he settled into a consistent role off the bench for Minnesota, winning Sixth Man of the Year in 2024.',
    accents: [
      { t: 0.18, kind: 'arrow',     at: { entityId: s('Naz Reid').id }, text: 'Undrafted' },
      { t: 0.56, kind: 'spotlight', at: { entityId: s('Naz Reid').id } },
      { t: 0.86, kind: 'callout',   at: { entityId: s('Naz Reid').id }, text: '5,745' },
    ] },
  { entityId: s('Tyler Herro').id,
    text: "And then finally, here's three more players, Tyler Herro, Jordan Poole, and Coby White.",
    accents: [
      { t: 0.34, kind: 'spotlight', at: { entityId: s('Tyler Herro').id } },
      { t: 0.76, kind: 'callout',   at: { entityId: s('Tyler Herro').id }, text: '7,664' },
    ] },
  { entityId: s('Jordan Poole').id,
    text: "They're third, fourth, and sixth in scoring from this class.",
    accents: [
      { t: 0.30, kind: 'callout',   at: { entityId: s('Jordan Poole').id }, text: '7,466' },
      { t: 0.72, kind: 'spotlight', at: { entityId: s('Coby White').id } },
    ] },
  { entityId: s('Coby White').id,
    text: 'So, in retrospect, what do you think about the 2019 NBA draft? Is it kind of underwhelming?',
    accents: [
      { t: 0.26, kind: 'callout', at: { entityId: s('Coby White').id }, text: '7,273' },
      { t: 0.70, kind: 'zoom' },
    ] },
];

/**
 * 09 — slope-pair placeholder script: pick #1 plus the four biggest movers by
 * |delta|, so the connector direction and colour both get exercised.
 */
const rr = (id: string) => (redraft.rows as any[]).find((r) => r.id === id)!;
const redraftScript: ScriptLine[] = [
  { entityId: rr('6442').id, text: "Kyrie Irving went first overall in 2011, and fourteen seasons later he's still the best scorer this class produced.",
    accents: [
      { t: 0.28, kind: 'zoom',    at: { entityId: rr('6442').id } },
      { t: 0.74, kind: 'callout', at: { entityId: rr('6442').id }, text: '18,433' },
    ] },
  { entityId: rr('6430').id, text: 'Jimmy Butler went thirtieth, the very last pick of the round, and this re-draft has him at fourth.',
    accents: [
      { t: 0.30, kind: 'spotlight', at: { entityId: rr('6430').id } },
      { t: 0.72, kind: 'callout',   at: { entityId: rr('6430').id }, text: '▲26' },
    ] },
  { entityId: rr('6480').id, text: 'Derrick Williams went second overall, but a seven-season career only ranks him nineteenth here.',
    accents: [
      { t: 0.40, kind: 'arrow', at: { entityId: rr('6480').id }, text: 'The 2nd pick' },
    ] },
  { entityId: rr('6443').id, text: 'Reggie Jackson slipped to pick twenty four, then climbed all the way up to ninth in this re-draft.',
    accents: [
      { t: 0.40, kind: 'spotlight', at: { entityId: rr('6443').id } },
    ] },
  { entityId: rr('6478').id, text: 'Nikola Vucevic went sixteenth, and this re-draft would take him second overall, right behind Kyrie.',
    accents: [
      { t: 0.40, kind: 'refline', at: { entityId: rr('6478').id }, text: '2nd here' },
    ] },
];

/**
 * 10 — image-cell-matrix placeholder script: the two players who lead the
 * most cells, one narrated with a column spotlight (highlightCol), one with
 * the plain per-entity spotlight.
 */
const CURRY_ID = '3975', HARDEN_ID = '3992';
const leaderMatrixScript: ScriptLine[] = [
  { entityId: CURRY_ID, text: 'Stephen Curry all but owns the three-point column, leading it five different seasons.',
    accents: [
      { t: 0.40, kind: 'spotlight', at: { entityId: CURRY_ID, step: '3PM' } },
    ] },
  { entityId: HARDEN_ID, text: 'James Harden shows up four times, across scoring, assists, and threes between 2019 and 2023.',
    accents: [
      // Not 'callout' or 'refline': both print `type.marker` text (56px) —
      // taller than one grid row's own pitch (~100px, most of it already
      // taken by the headshot) — so ANY row it resolves to bleeds into a
      // neighbour no matter where the text is nudged; a refline's line also
      // cuts across the whole row. 'spotlight' draws only a ring, and the
      // number itself is already spoken in the line, so no text is lost.
      { t: 0.40, kind: 'spotlight', at: { entityId: HARDEN_ID } },
    ] },
];

/** 11 — unit-waffle placeholder script: the three part keys, largest first. */
const waffleScript: ScriptLine[] = [
  { entityId: '2PT', text: "Most of LeBron's points, twenty-six thousand six hundred fifty, came from two-point range.",
    accents: [
      { t: 0.40, kind: 'spotlight', at: { entityId: '2PT' } },
    ] },
  { entityId: 'FT', text: 'Free throws add eight thousand eight hundred eighty-two more, about a fifth of the total.',
    accents: [
      { t: 0.40, kind: 'spotlight', at: { entityId: 'FT' } },
    ] },
  { entityId: '3PT', text: 'The rest, seven thousand nine hundred eight points, came from three-point range.',
    accents: [
      { t: 0.40, kind: 'spotlight', at: { entityId: '3PT' } },
    ] },
];

export const SCRIPTS: Record<string, ScriptLine[]> = {
  C01: cumScript,
  C01F: cumScriptVerbatim,   // the source video's own words, for the voice A/B
  C09: redraftScript,
  C10: leaderMatrixScript,
  C11: waffleScript,
};
