import cumulative from './data/cumulative.json';
import type { ScriptLine } from './script';

/**
 * The narration. One source of truth: the renderer builds a fallback timeline
 * from it, and scripts/tts.ts feeds the same lines to Chatterbox.
 */
const s = (name: string) => cumulative.series.find((x) => x.name === name)!;
const cumScript: ScriptLine[] = [
  { entityId: s('Zion Williamson').id, text: "Zion Williamson's career has been anything but consistent. He missed his third season entirely.",
    annotation: { kind: 'arrow', from: [430, 980], to: [700, 1180], label: 'Missed a whole season' } },
  { entityId: s('Ja Morant').id, text: 'The second pick, Ja Morant, started far more steadily, and sits just over seven thousand.',
    annotation: { kind: 'refline', y: 0, label: '7,331' } },
  { entityId: s('RJ Barrett').id, text: 'The third pick, RJ Barrett, was less flashy but steady as a rock. He leads this class.' },
  { entityId: s('Jarrett Culver').id, text: 'The sixth pick, Jarrett Culver, lasted only four seasons in the league.' },
  { entityId: s('Nickeil Alexander-Walker').id, text: 'And at seventeen, Nickeil Alexander-Walker, the reigning Most Improved Player.' },
  { entityId: s('Darius Garland').id, text: 'Darius Garland has been just as consistent, and is now second from this class.' },
  { entityId: s('Naz Reid').id, text: 'Naz Reid went undrafted, then won Sixth Man of the Year in twenty twenty four.' },
  { entityId: s('Tyler Herro').id, text: 'Tyler Herro is third in scoring from this draft.' },
  { entityId: s('Jordan Poole').id, text: 'Jordan Poole is fourth.' },
  { entityId: s('Coby White').id, text: 'And Coby White is sixth. So, in retrospect, was this draft underwhelming?' },
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
    annotation: { kind: 'arrow', from: [430, 980], to: [700, 1180], label: 'Sporadically since' } },
  { entityId: s('Ja Morant').id,
    text: "But the second pick in the 2019 draft, Ja Morant, started his career much more consistently. His later seasons, though, have been plagued by injuries and suspensions. He's now at over 7,000 points.",
    annotation: { kind: 'refline', y: 0, label: '7,331' } },
  { entityId: s('RJ Barrett').id,
    text: 'The third pick, RJ Barrett, has been the polar opposite of those two. Less flashy, but steady as a rock. He now leads this draft class in total points.' },
  { entityId: s('Jarrett Culver').id,
    text: "And then skipping down to the sixth pick, here's Jarrett Culver. He only lasted four seasons in the NBA. He played in Japan last year." },
  { entityId: s('Nickeil Alexander-Walker').id,
    text: "And then jumping all the way down to the 17th pick, here's Nickeil Alexander-Walker. He's the reigning Most Improved Player of the Year, and you can see why. In his seventh season, he scored twice as much as any of his previous seasons." },
  { entityId: s('Darius Garland').id,
    text: "And then here's the fifth pick, Darius Garland. Like Barrett, he's been pretty consistent throughout his career, but he has had some seasons impacted by injuries. He's now second from this class in points." },
  { entityId: s('Naz Reid').id,
    text: 'And then how about an undrafted player from 2019, Naz Reid. Like Alexander-Walker, it took Reid a couple seasons to establish himself, but eventually he settled into a consistent role off the bench for Minnesota, winning Sixth Man of the Year in 2024.' },
  { entityId: s('Tyler Herro').id,
    text: "And then finally, here's three more players, Tyler Herro, Jordan Poole, and Coby White." },
  { entityId: s('Jordan Poole').id,
    text: "They're third, fourth, and sixth in scoring from this class." },
  { entityId: s('Coby White').id,
    text: 'So, in retrospect, what do you think about the 2019 NBA draft? Is it kind of underwhelming?' },
];

export const SCRIPTS: Record<string, ScriptLine[]> = {
  C01: cumScript,
  C01F: cumScriptVerbatim,   // the source video's own words, for the voice A/B
};
