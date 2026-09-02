/**
 * The writer brief — everything Gemini needs to write a script, and nothing
 * it could hallucinate past. Facts, machine-detected story markers, the
 * numbers it is allowed to say, and the router's chart choice all travel in
 * one JSON document; `verify.ts` rejects any draft that steps outside it.
 */
import cumulative from './data/cumulative.json';
import { api } from './espn';
import { route, type DataShape } from '../router/shape';
import { ACCENT_KINDS, DENSITY_FLOOR, DENSITY_CEILING } from './accent';

export type Angle = 'verdict-revisited' | 'chase' | 'cohort-fate' | 'rank-inversion' | 'hidden-cost';
export type Lane = 'evergreen' | 'newsy';
export type MarkerKind = 'missed-season' | 'jump' | 'plateau' | 'rank-flip' | 'award' | 'undrafted' | 'short-career' | 'leader';
export type EndingVariant = 'thesis' | 'hard-cut' | 'open-question';

export type Marker = { entityId: string; kind: MarkerKind; step?: string; detail: string; value?: number };

export type BriefEntity = {
  id: string; name: string; first: string; last: string;
  pick: number | null; total: number; rank: number; seasons_played: number;
  series: { step: string; value: number }[];       // cumulative, as in the dataset
  awards: { name: string; season: string }[];
};

export type WriterBrief = {
  version: 1;
  generated: string;                                  // ISO date
  topic: { id: string; question: string; angle: Angle; lane: Lane; hook_seed: string; why_fans_argue?: string; evidence?: string[] };
  visual: {
    chart: string; alternates: string[]; camera: string;
    accent_kinds: readonly string[];                  // = ACCENT_KINDS
    anchor_steps: string[];                           // valid Anchor.step values = the season labels
    density: { floor: number; ceiling: number; target: number };
  };
  facts: { unit: string; as_of: string; entities: BriefEntity[]; markers: Marker[]; allowed_numbers: number[] };
  style: { voice: string; rules: string[]; duration_s: [number, number]; beats: [number, number]; ending_variants: EndingVariant[]; forbidden: string[] };
  output: { format: 'json'; schema: unknown; example: unknown };
};

const seasonKey = (label: string) => Number(label.slice(0, 4));

/**
 * Median of a numeric array. Not exported: only `detectMarkers` needs it, and
 * only for its own deltas.
 */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Story markers, detected from shape alone — never chosen by the writer.
 * Deterministic and pure so it can be unit-tested against synthetic data.
 */
export function detectMarkers(entities: BriefEntity[], seasons: string[]): Marker[] {
  const out: Marker[] = [];
  const sortedSeasons = [...seasons].sort((a, b) => seasonKey(a) - seasonKey(b));

  for (const e of entities) {
    if (e.rank === 1) out.push({ entityId: e.id, kind: 'leader', detail: `most in the class: ${e.total}`, value: e.total });
    if (e.pick === null) out.push({ entityId: e.id, kind: 'undrafted', detail: 'went undrafted' });
    if (e.seasons_played <= 4 && e.seasons_played < seasons.length - 2) {
      out.push({ entityId: e.id, kind: 'short-career', detail: `only ${e.seasons_played} seasons` });
    }

    // missed-season: any season label strictly between two consecutive steps
    // the entity actually has, that the entity's own series does not carry.
    const have = new Set(e.series.map((p) => p.step));
    for (let i = 0; i < e.series.length - 1; i++) {
      const lo = seasonKey(e.series[i].step);
      const hi = seasonKey(e.series[i + 1].step);
      for (const s of sortedSeasons) {
        const k = seasonKey(s);
        if (k > lo && k < hi && !have.has(s)) {
          out.push({ entityId: e.id, kind: 'missed-season', step: s, detail: `no games in ${s}` });
        }
      }
    }

    // jump / plateau: per-season deltas against their own median.
    if (e.series.length >= 3) {
      const deltas = e.series.map((p, i) => (i === 0 ? p.value : p.value - e.series[i - 1].value));
      const med = median(deltas);
      if (med > 0) {
        for (let i = 0; i < e.series.length; i++) {
          const d = deltas[i];
          const step = e.series[i].step;
          if (d >= 1.8 * med) {
            const ratio = Number((d / med).toFixed(1));
            out.push({ entityId: e.id, kind: 'jump', step, value: d, detail: `${d} points in ${step}, ${ratio}x their usual` });
          } else if (d > 0 && d <= 0.3 * med) {
            out.push({ entityId: e.id, kind: 'plateau', step, value: d, detail: `only ${d} in ${step}` });
          }
        }
      }
    }

    for (const a of e.awards) {
      out.push({ entityId: e.id, kind: 'award', step: a.season, detail: `${a.name} (${a.season})` });
    }
  }

  out.sort((a, b) => a.entityId === b.entityId ? (a.step ?? '').localeCompare(b.step ?? '') : a.entityId.localeCompare(b.entityId));
  return out;
}

/** Every 4-digit year hiding in a season label ("2019-20" -> 2019, 2020) or a bare year ("2024" -> 2024). */
function yearsIn(label: string): number[] {
  const out: number[] = [];
  const m = label.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!m) return out;
  const y0 = Number(m[1]);
  out.push(y0);
  if (m[2]) out.push(Math.floor(y0 / 100) * 100 + Number(m[2]));
  return out;
}

/** Every number a script is allowed to say — nothing else survives verify.ts. */
export function allowedNumbers(entities: BriefEntity[], seasons: string[]): number[] {
  const nums = new Set<number>();
  for (let i = 1; i <= 12; i++) nums.add(i);
  for (const s of seasons) for (const y of yearsIn(s)) nums.add(y);

  for (const e of entities) {
    nums.add(e.total);
    nums.add(e.rank);
    nums.add(e.seasons_played);
    if (e.pick !== null) nums.add(e.pick);
    let prev = 0;
    for (const p of e.series) {
      nums.add(p.value);
      nums.add(p.value - prev);
      prev = p.value;
    }
    for (const a of e.awards) for (const y of yearsIn(a.season)) nums.add(y);
  }

  return [...nums].sort((a, b) => a - b);
}

/** A measured contract — the seven rules the density audit and the format demand. Do not paraphrase. */
export const STYLE_RULES: string[] = [
  'Hook mirrors the title: the first sentence names the subject and states the tension the question carries.',
  'One beat is ONE sentence carrying 2 to 4 events joined by and / but / then / while. Never one event per sentence.',
  'Present tense, third person, documentary register, B2 vocabulary, no hype slang.',
  "Specific numbers, never vague ones: 7,331 — not 'over 7,000'. Every number must appear in facts.allowed_numbers.",
  'The flip — the moment the expectation breaks — lands between 40% and 70% of the runtime, never in the last beat.',
  'The last beat uses exactly one ending variant: thesis, hard-cut, or open-question.',
  'Each beat carries 2 or 3 accents from visual.accent_kinds at distinct t values; total density stays inside visual.density.',
];

export async function buildBrief(
  id: 'C01' | 'C01F',
  opts?: { angle?: Angle; lane?: Lane; question?: string; hook_seed?: string }
): Promise<WriterBrief> {
  const data = cumulative as typeof cumulative;

  const ranked = [...data.series].sort((a, b) => b.total - a.total);
  const rankOf = new Map(ranked.map((s, i) => [s.id, i + 1]));

  const entities: BriefEntity[] = await Promise.all(
    data.series.map(async (s) => {
      let awards: { name: string; season: string }[] = [];
      try {
        const bio = await api.athleteBio(s.id);
        awards = (bio?.awards ?? []).flatMap((a: { name: string; seasons: string[] }) =>
          (a.seasons ?? []).map((season) => ({ name: a.name, season }))
        );
      } catch { awards = []; }

      return {
        id: s.id, name: s.name, first: s.first, last: s.last,
        pick: s.pick, total: s.total, rank: rankOf.get(s.id)!, seasons_played: s.points.length,
        series: s.points.map((p) => ({ step: p.season, value: p.value })),
        awards,
      };
    })
  );

  const seasonLabels = [...new Set(entities.flatMap((e) => e.series.map((p) => p.step)))]
    .sort((a, b) => seasonKey(a) - seasonKey(b));

  const markers = detectMarkers(entities, seasonLabels);
  const allowed_numbers = allowedNumbers(entities, seasonLabels);

  const shape: DataShape = {
    entities: data.series.length,
    entityKind: 'player',
    measures: [{ name: 'points', type: 'count' }],
    dims: [{ name: 'season', type: 'time', steps: data.seasons.length }],
    cumulative: true,
    imageKey: 'headshot',
  };
  const choice = route(shape);

  const exampleEntity = entities[0];
  const exampleStep = exampleEntity.series.at(-1)?.step;

  return {
    version: 1,
    generated: new Date().toISOString(),
    topic: {
      id: '2019-draft-total-points',
      question: opts?.question ?? 'Which 2019 draft pick has scored the most points?',
      angle: opts?.angle ?? 'cohort-fate',
      lane: opts?.lane ?? 'evergreen',
      hook_seed: opts?.hook_seed ?? 'The number one pick is not the one who scored the most.',
    },
    visual: {
      chart: choice.chart,
      alternates: choice.alternates,
      camera: choice.camera,
      accent_kinds: ACCENT_KINDS,
      anchor_steps: seasonLabels,
      density: { floor: DENSITY_FLOOR, ceiling: DENSITY_CEILING, target: 0.30 },
    },
    facts: {
      unit: 'points',
      as_of: data.seasons.at(-1) ?? '',
      entities,
      markers,
      allowed_numbers,
    },
    style: {
      voice: 'present tense, third person, documentary; B2 vocabulary; no hype slang',
      rules: STYLE_RULES,
      duration_s: [40, 95],
      beats: [8, 12],
      ending_variants: ['thesis', 'hard-cut', 'open-question'],
      forbidden: [
        'any number not in facts.allowed_numbers',
        'any entityId not in facts.entities[].id',
        'any accent kind not in visual.accent_kinds',
        'any Anchor.step not in visual.anchor_steps',
        'pixel coordinates of any kind',
        'more than 3 accents in one beat',
        'a chart not in visual.alternates',
      ],
    },
    output: {
      format: 'json',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'beats'],
        properties: {
          title: { type: 'string' },
          beats: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'entityId'],
              properties: {
                text: { type: 'string' },
                entityId: { type: 'string' },
                accents: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['t', 'kind'],
                    properties: {
                      t: { type: 'number', minimum: 0, maximum: 1 },
                      kind: { type: 'string', enum: ACCENT_KINDS },
                      at: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          entityId: { type: 'string' },
                          step: { type: 'string' },
                        },
                        required: ['entityId'],
                      },
                      text: { type: 'string' },
                    },
                  },
                },
                ending: { type: 'string', enum: ['thesis', 'hard-cut', 'open-question'] },
              },
            },
          },
        },
      },
      example: {
        title: 'Which 2019 draft pick has scored the most points?',
        beats: [
          {
            text: `${exampleEntity.first} ${exampleEntity.last} leads the 2019 class, but the number one pick is not even second.`,
            entityId: exampleEntity.id,
            accents: [
              { t: 0.3, kind: 'spotlight', at: { entityId: exampleEntity.id, step: exampleStep } },
              { t: 0.7, kind: 'callout', at: { entityId: exampleEntity.id }, text: String(exampleEntity.total) },
            ],
          },
        ],
      },
    },
  };
}
