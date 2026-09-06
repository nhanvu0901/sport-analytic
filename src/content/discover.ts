/**
 * Topic discovery: one you.com Research call per lane, filtered by our own
 * hard dedup (isBurned) rather than trusting you.com's own labels — ported
 * decision from youcom_scout.py: "its domain whitelist is hard... its labels
 * and dedup are NOT trusted... the authoritative filters stay on our side."
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pool } from '../espn';
import { gateDataAvailable, probeCoverage } from './gates';
import { contentRoot, digestLines, isBurned, slugify } from './ledger';
import { listSessions } from './sessions';
import { research } from './youcom';
import type { Angle, Candidate, Gates, GateVerdict, Lane, Session } from './types';

type Angles = { evergreen: string[]; newsy: string[] };
type Sources = { discover: { domains: string[]; purpose: string }; evidence: { domains: string[]; purpose: string } };

const readAngles = (): Angles => JSON.parse(readFileSync(join(contentRoot(), 'angles.json'), 'utf8'));
const readSources = (): Sources => JSON.parse(readFileSync(join(contentRoot(), 'sources.json'), 'utf8'));

// Evergreen-only rotating seeds: a draft class and a stat, so five straight
// evergreen runs don't all land on "points" for the same few classes.
const DRAFT_CLASS_SPAN = 21; // 2003..2023
const STATS = ['points', 'rebounds', 'assists', 'blocks', 'three-pointers', 'salary'];

/** How many existing sessions already used this lane — the rotation pointer.
 *  Counting sessions on disk (ported from workflow.py's `_mode_session_count`)
 *  instead of a separate counter file means the pointer can't drift out of
 *  sync with what's actually durable. */
export function laneSessionCount(lane: Lane): number {
  return listSessions().filter((s) => s.lanes.includes(lane)).length;
}

/** Deterministic angle rotation, ported from workflow.py's `_angle` — indexed
 *  by the count of sessions on disk, never a counter file. */
export function nextAngle(lane: Lane): string {
  const angles = readAngles()[lane] ?? [];
  if (angles.length === 0) return '';
  return angles[laneSessionCount(lane) % angles.length];
}

const RULES =
  'Only questions real people are asking — cite the thread or article. No hypotheticals. ' +
  'Settleable by ONE number or ONE comparison of real recorded stats. Mark each evergreen or ' +
  'this-week. 5 candidates, each a different argument.';

function buildPrompt(lane: Lane, angle: string, idx: number, opts: { intent?: string; feedback?: string[] }): string {
  const parts: string[] = [`Angle: ${angle}`];
  if (lane === 'evergreen') {
    const year = 2003 + (idx % DRAFT_CLASS_SPAN);
    const stat = STATS[idx % STATS.length];
    parts.push(`Seed (use only if it fits the angle): the ${year} NBA draft class, measured by ${stat}.`);
  }
  parts.push(RULES);
  if (opts.intent) parts.push(`Producer intent: ${opts.intent}`);
  for (const f of opts.feedback ?? []) parts.push(`Feedback to address: ${f}`);
  const digest = digestLines();
  if (digest.length) {
    const block = ['ALREADY DONE — NEVER PROPOSE THESE OR RE-SKINS:', ...digest.map((l) => `- ${l}`)].join('\n');
    parts.push(block.slice(0, 9000));
  }
  return parts.join('\n\n');
}

const CANDIDATE_PROPS = {
  question: { type: 'string' },
  why_fans_argue: { type: 'string' },
  measurable_as: { type: 'string' },
  freshness: { type: 'string' },
  angle: { type: 'string' },
  entities: { type: 'array', items: { type: 'string' } },
  evidence_urls: { type: 'array', items: { type: 'string' } },
};

/** You.com-strict schema: additionalProperties:false everywhere, every
 *  property required, no minItems/maxItems (ported convention from
 *  youcom_scout.py's `_schema`). */
function schemaFor(itemProps: Record<string, unknown>) {
  const rootProps = {
    candidates: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, properties: itemProps, required: Object.keys(itemProps) },
    },
    notes: { type: 'string' },
  };
  return { type: 'object', additionalProperties: false, properties: rootProps, required: Object.keys(rootProps) };
}

const KNOWN_ANGLES: Angle[] = ['verdict-revisited', 'chase', 'cohort-fate', 'rank-inversion', 'hidden-cost', 'newsy'];

function normalizeAngle(raw: string, lane: Lane): Angle {
  const s = (raw || '').toLowerCase();
  return KNOWN_ANGLES.find((a) => s.includes(a)) ?? (lane === 'newsy' ? 'newsy' : 'cohort-fate');
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function toCandidate(raw: any, lane: Lane, discoverDomains: string[]): Candidate {
  const question = String(raw?.question ?? '').trim();
  const evidence_urls: string[] = Array.isArray(raw?.evidence_urls) ? raw.evidence_urls.map(String) : [];
  const burned_by = isBurned(question, digestLines());
  const onWhitelist = evidence_urls.some((u) => {
    const host = hostOf(u);
    return !!host && discoverDomains.some((d) => host === d || host.endsWith(`.${d}`));
  });
  const g0: GateVerdict = burned_by ? 'fail' : 'pass';
  const g1: GateVerdict = evidence_urls.length >= 1 && onWhitelist ? 'pass' : 'fail';
  const gate_notes: Partial<Record<keyof Gates, string>> = {};
  if (burned_by) gate_notes.g0_burned = `collides with: ${burned_by}`;
  return {
    id: slugify(question),
    question,
    angle: normalizeAngle(String(raw?.angle ?? ''), lane),
    lane,
    why_fans_argue: String(raw?.why_fans_argue ?? ''),
    measurable_as: String(raw?.measurable_as ?? ''),
    entities: Array.isArray(raw?.entities) ? raw.entities.map(String) : [],
    evidence_urls,
    freshness: raw?.freshness === 'this-week' ? 'this-week' : 'evergreen',
    gates: { g0_burned: g0, g1_real_question: g1, g3_data_available: 'pending', g4_chart_fit: 'pending' },
    burned_by,
    flags: [],
    gate_notes,
  };
}

/**
 * The YouTube coverage probe and g3, concurrently (Promise.all) but capped
 * at 3 candidates in flight at once — Tavily and ESPN both dislike a burst
 * of 5+. A burned candidate (g0 failed) is already dead: skip both entirely
 * rather than spend a search/ESPN call on it, and leave g3 'pending'.
 * Coverage is informational only — it is logged and stored, never gated.
 */
async function runQualityGates(candidates: Candidate[], log: (line: string) => void): Promise<void> {
  await pool(candidates, 3, async (c) => {
    if (c.gates.g0_burned === 'fail') {
      log(`  gates ${c.id}: skipped (already burned)`);
      return c;
    }
    const [coverage, g3] = await Promise.all([
      probeCoverage(c.question),
      gateDataAvailable({ entities: c.entities, measurable_as: c.measurable_as }),
    ]);
    c.coverage = coverage;
    c.gates.g3_data_available = g3.verdict;
    c.gate_notes = { ...c.gate_notes, g3_data_available: g3.note };
    log(`  gates ${c.id}: coverage=${coverage.note} g3=${g3.verdict}${g3.verdict !== 'pass' ? ` (${g3.note})` : ''}`);
    return c;
  });
}

export type DiscoveryResult = {
  candidates: Candidate[];
  angle_used: Session['angle_used'];
  flags: string[];
};

export async function runDiscovery(opts: {
  lanes: Lane[];
  intent?: string;
  feedback?: string[];
  log?: (line: string) => void;
}): Promise<DiscoveryResult> {
  const log = opts.log ?? (() => {});
  const sources = readSources();
  const angleUsed: Session['angle_used'] = {};

  const settled = await Promise.allSettled(
    opts.lanes.map(async (lane) => {
      const idx = laneSessionCount(lane);
      const angle = nextAngle(lane);
      angleUsed[lane] = angle;
      const prompt = buildPrompt(lane, angle, idx, opts);
      const output = await research({
        input: prompt,
        schema: schemaFor(CANDIDATE_PROPS),
        domains: sources.discover.domains,
        effort: 'standard',
      });
      const raw = Array.isArray(output?.candidates) ? output.candidates : [];
      return raw.map((c: any) => toCandidate(c, lane, sources.discover.domains));
    })
  );

  const candidates: Candidate[] = [];
  const flags: string[] = [];
  settled.forEach((r, i) => {
    const lane = opts.lanes[i];
    if (r.status === 'fulfilled') candidates.push(...r.value);
    else flags.push(`${lane} lane failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  });

  await runQualityGates(candidates, log);

  return { candidates, angle_used: angleUsed, flags };
}
