/**
 * Reject a draft before it ever reaches the renderer. Pure: no network, no
 * LLM — just the brief's own facts checked against the draft's own claims.
 * Every rule below maps to one line in `brief.style.rules` or `forbidden`.
 */
import type { Accent } from './accent';
import type { WriterBrief, EndingVariant } from './brief';

export type Draft = {
  title: string;
  beats: { text: string; entityId: string; accents?: Accent[]; ending?: EndingVariant }[];
};

export type Violation = { beat: number | null; rule: string; detail: string };

/**
 * A chat box never returns clean JSON. Strip what it reliably adds — a
 * ```json fence around the whole reply, "Here is the script:" before it,
 * chatter after it, a trailing comma Gemini likes to leave — before parsing.
 * Pure: no I/O, so the CLI and the tests can share it.
 */
export function parseDraftText(raw: string): { ok: true; draft: Draft } | { ok: false; error: string } {
  let text = raw.trim();

  // A whole-reply fence: ```json ... ``` or ``` ... ```.
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }

  // Prose before the first { and after the last } — "Here is the script:"
  // preambles, trailing chatter. Slicing on brace position also mops up a
  // fence that survived the step above (e.g. one with no closing newline).
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    return { ok: false, error: `no JSON object found in the input. First 200 characters received:\n${raw.slice(0, 200)}` };
  }
  text = text.slice(first, last + 1);

  // A trailing comma before a closing ] or }.
  text = text.replace(/,(\s*[}\]])/g, '$1');

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as any).beats)) {
      return { ok: false, error: `parsed JSON has no "beats" array. First 200 characters received:\n${raw.slice(0, 200)}` };
    }
    return { ok: true, draft: parsed as Draft };
  } catch (e: any) {
    return { ok: false, error: `${e.message}\nFirst 200 characters received:\n${raw.slice(0, 200)}` };
  }
}

const CONNECTORS = /\b(and|but|then|while)\b/i;
const SENTENCE_END = /[.!?](?:\s|$)/g;

export function verifyDraft(draft: Draft, brief: WriterBrief, wordsPerSecond = 2.9): Violation[] {
  const out: Violation[] = [];
  const entityIds = new Set(brief.facts.entities.map((e) => e.id));
  const allowed = new Set(brief.facts.allowed_numbers);
  const accentKinds = new Set(brief.visual.accent_kinds);
  const anchorSteps = new Set(brief.visual.anchor_steps);
  const endingVariants = new Set(brief.style.ending_variants);

  if (draft.beats.length < brief.style.beats[0] || draft.beats.length > brief.style.beats[1]) {
    out.push({
      beat: null, rule: 'beat-count',
      detail: `${draft.beats.length} beats, expected between ${brief.style.beats[0]} and ${brief.style.beats[1]}`,
    });
  }

  draft.beats.forEach((beat, i) => {
    if (!entityIds.has(beat.entityId)) {
      out.push({ beat: i, rule: 'unknown-entity', detail: `entityId "${beat.entityId}" is not in facts.entities` });
    }

    for (const m of beat.text.match(/\d[\d,]*/g) ?? []) {
      const n = Number(m.replace(/,/g, ''));
      if (!allowed.has(n)) {
        out.push({ beat: i, rule: 'fabricated-number', detail: `"${m}" is not in facts.allowed_numbers` });
      }
    }

    const accents = beat.accents ?? [];
    for (const a of accents) {
      if (!accentKinds.has(a.kind)) {
        out.push({ beat: i, rule: 'accent-kind', detail: `kind "${a.kind}" is not in visual.accent_kinds` });
      }
      if (a.at) {
        if (!entityIds.has(a.at.entityId)) {
          out.push({ beat: i, rule: 'accent-anchor', detail: `accent points at unknown entityId "${a.at.entityId}"` });
        } else if (a.at.step !== undefined && !anchorSteps.has(String(a.at.step))) {
          out.push({ beat: i, rule: 'accent-anchor', detail: `accent step "${a.at.step}" is not in visual.anchor_steps` });
        }
      }
      if (a.t < 0 || a.t > 1) {
        out.push({ beat: i, rule: 'accent-t', detail: `t=${a.t} is outside [0,1]` });
      }
    }
    for (let x = 0; x < accents.length; x++) {
      for (let y = x + 1; y < accents.length; y++) {
        if (Math.abs(accents[x].t - accents[y].t) < 0.12) {
          out.push({ beat: i, rule: 'accent-t', detail: `accents at t=${accents[x].t} and t=${accents[y].t} are closer than 0.12` });
        }
      }
    }
    if (accents.length > 3 || accents.length < 2) {
      out.push({ beat: i, rule: 'accents-per-beat', detail: `${accents.length} accents, expected 2 to 3` });
    }

    if (i === 0) {
      const named = brief.facts.entities.some((e) =>
        beat.text.toLowerCase().includes(e.first.toLowerCase()) || beat.text.toLowerCase().includes(e.last.toLowerCase())
      );
      if (!named) out.push({ beat: i, rule: 'hook', detail: 'first beat names no entity by first or last name' });
    }

    const isLast = i === draft.beats.length - 1;
    if (isLast) {
      if (!beat.ending || !endingVariants.has(beat.ending)) {
        out.push({ beat: i, rule: 'ending', detail: `last beat's ending "${beat.ending ?? ''}" is not one of ${[...endingVariants].join(', ')}` });
      }
    } else if (beat.ending) {
      out.push({ beat: i, rule: 'ending', detail: `beat ${i} carries an ending, but only the last beat may` });
    }

    const sentences = beat.text.match(SENTENCE_END)?.length ?? 0;
    if (sentences > 1) {
      out.push({ beat: i, rule: 'one-sentence', detail: `${sentences} sentence terminators, expected 1` });
    }

    if (!CONNECTORS.test(beat.text)) {
      out.push({ beat: i, rule: 'chain', detail: 'no and/but/then/while connecting multiple events' });
    }
  });

  const totalWords = draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const totalAccents = draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);
  const seconds = totalWords / wordsPerSecond;
  const events = draft.beats.length + totalAccents;
  const perSecond = seconds > 0 ? events / seconds : 0;
  if (seconds > 0 && (perSecond < brief.visual.density.floor || perSecond > brief.visual.density.ceiling)) {
    out.push({
      beat: null, rule: 'density',
      detail: `${perSecond.toFixed(3)} events/s, expected between ${brief.visual.density.floor} and ${brief.visual.density.ceiling}`,
    });
  }

  return out;
}
