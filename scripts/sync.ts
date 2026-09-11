/**
 * Snap an accepted draft onto the audio that was actually recorded.
 *
 *   npx tsx scripts/sync.ts 371e3032
 *   npx tsx scripts/sync.ts 371e3032 out/sync-371e3032.json
 *
 * WHICH FILE IS WHICH — the one convention this step adds:
 *
 *   out/draft-<id>.json       AUTHORED. Written by scripts/write.ts from what
 *                             Gemini wrote and verifyDraft accepted. Every
 *                             accent `t` in it is a guess, because the draft
 *                             exists before the audio does. Never overwritten
 *                             here, which is what makes the snap re-runnable.
 *   src/data/draft-<id>.json  DERIVED. This file. Same title, same beats, same
 *                             text — but every accent `t` recomputed from the
 *                             measured words, plus a per-beat `arriveMs`. It
 *                             carries a `_derived` stamp saying so, and it is
 *                             the one the renderer reads (src/videos.ts globs
 *                             src/data/ at bundle time).
 *
 * It must run AFTER scripts/tts.ts and BEFORE the render, because the only
 * source of truth for "when is this word spoken" is the WAV that tts.ts
 * produced and the word-level out/voice-<id>.srt it wrote beside it.
 * scripts/render-videos.ts calls `syncDraftFiles` itself, so the pipeline —
 * and the server's render route, which spawns that script — cannot render a
 * stale placement by forgetting this step.
 *
 * All the arithmetic is in src/sync.ts and is pure; this file only reads four
 * files, writes one, and prints the measurement.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { asDraft, narratesDraft } from '../src/drafts';
import { asTimeline } from '../src/timeline';
import { driftStats, parseSrt, snapDraft, type SyncFacts, type SyncReport } from '../src/sync';
import { PAYROLL_KEY } from '../src/videoData';
import type { Draft } from '../src/verify';

const at = (...parts: string[]) => join(process.cwd(), ...parts);

/** The derived draft, with the provenance stamp that tells a reader — and the
 *  next session — that this file was not hand-written. */
type DerivedDraft = Draft & {
  _derived?: {
    what: string;
    from: string;
    against: string;
    by: string;
    at: string;
    landMs: number;
    accentsSnapped: number;
    accentsKept: number;
    beatsWithArrival: number;
  };
};

export type SyncOutcome =
  | { ok: true; id: string; report: SyncReport; wrote: string }
  | { ok: false; id: string; reason: string };

/**
 * Read authored draft + measured timeline + word-level SRT, snap, write the
 * derived draft. Returns `ok: false` with a reason rather than throwing when
 * one of the inputs does not exist — the eleven C01…C11 demo compositions have
 * no brief, no draft or no narration, and a render must not fail over that.
 */
export function syncDraftFiles(
  id: string,
  opts: { log?: (line: string) => void; reportPath?: string } = {}
): SyncOutcome {
  const log = opts.log ?? (() => {});
  const authoredPath = at('out', `draft-${id}.json`);
  const timelinePath = at('src/data', `timeline-${id}.json`);
  const srtPath = at('out', `voice-${id}.srt`);
  const derivedPath = at('src/data', `draft-${id}.json`);

  if (!existsSync(authoredPath)) return { ok: false, id, reason: `no authored draft at out/draft-${id}.json` };
  if (!existsSync(timelinePath)) return { ok: false, id, reason: `not narrated yet — no src/data/timeline-${id}.json` };
  if (!existsSync(srtPath)) return { ok: false, id, reason: `no word timings — out/voice-${id}.srt is missing` };

  const draft = asDraft(JSON.parse(readFileSync(authoredPath, 'utf8')));
  if (!draft) return { ok: false, id, reason: `out/draft-${id}.json has no beats` };
  const timeline = asTimeline(JSON.parse(readFileSync(timelinePath, 'utf8')));
  if (!timeline) return { ok: false, id, reason: `src/data/timeline-${id}.json has no beats` };

  // Snapping against audio that narrates a DIFFERENT script would place every
  // accent on the wrong word with total confidence. stageFor already refuses
  // to use such a draft's accents at all; refuse to derive one.
  if (timeline.chunks?.length && !narratesDraft(timeline, draft)) {
    return {
      ok: false, id,
      reason: `public/${timeline.audio ?? 'the audio'} does not narrate out/draft-${id}.json — `
        + `re-run: npx tsx scripts/tts.ts ${id} out/draft-${id}.json`,
    };
  }
  if (timeline.beats.length !== draft.beats.length) {
    return { ok: false, id, reason: `timeline has ${timeline.beats.length} beats, draft has ${draft.beats.length}` };
  }

  // The brief is where surnames and each entity's series live, and the series
  // is what turns a beat's anchored STEP into the number the voice says for
  // it. Absent (a hand-made fixture, a demo id) the digit-bearing accents
  // still snap — they carry their own number in `text`.
  const briefPath = at('out', `brief-${id}.json`);
  let facts: SyncFacts = {};
  if (existsSync(briefPath)) {
    const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
    // A budget brief's reference lines, keyed as `Anchor.threshold` names
    // them, plus the payroll's own top — which is `facts.budget.total`, the
    // same derived sum the chart adds up. Without it a span from the stack to
    // the tax line has nothing to subtract and cannot find its spoken number.
    const budget = brief?.facts?.budget;
    const thresholds = budget
      ? {
          [PAYROLL_KEY]: budget.total,
          ...Object.fromEntries((budget.lines ?? []).map((l: { key: string; value: number }) => [l.key, l.value])),
        }
      : undefined;
    facts = { entities: brief?.facts?.entities, record: brief?.facts?.record, thresholds };
  } else {
    log(`  (no out/brief-${id}.json — matching on the accents' own numbers only)`);
  }

  const words = parseSrt(readFileSync(srtPath, 'utf8'));
  const { draft: snapped, report } = snapDraft(draft, timeline.beats, words, facts);

  const derived: DerivedDraft = {
    ...snapped,
    _derived: {
      what: 'DERIVED, not authored: accent t values and beat arriveMs are measured off the audio.',
      from: `out/draft-${id}.json`,
      against: `out/voice-${id}.srt + src/data/timeline-${id}.json`,
      by: 'scripts/sync.ts',
      at: new Date().toISOString(),
      landMs: report.landMs,
      accentsSnapped: report.matched,
      accentsKept: report.unmatched,
      beatsWithArrival: report.arrivals.filter((a) => a.arriveMs !== null).length,
    },
  };
  writeFileSync(derivedPath, JSON.stringify(derived, null, 1));

  if (opts.reportPath) {
    writeFileSync(opts.reportPath, JSON.stringify({ id, ...summarise(report), ...report }, null, 1));
    log(`  -> ${opts.reportPath}`);
  }
  log(`  ${id}: ${report.matched}/${report.accents.length} accents snapped to measured words, `
    + `${report.unmatched} left on the authored t`
    + (report.spacedBeats.length ? `, spacing re-applied in beat(s) ${report.spacedBeats.join(', ')}` : '')
    + `; line arrival measured for ${derived._derived!.beatsWithArrival}/${report.arrivals.length} beats`);
  log(`  -> src/data/draft-${id}.json (derived)`);
  return { ok: true, id, report, wrote: derivedPath };
}

/** median / worst / count-over-0.5s, before and after, for both fixes. */
export function summarise(r: SyncReport) {
  const matched = r.accents.filter((a) => a.rule !== 'none');
  const arrived = r.arrivals.filter((a) => a.arriveMs !== null);
  return {
    summary: {
      accents: {
        total: r.accents.length, matched: matched.length, unmatched: r.unmatched,
        before: driftStats(matched.map((a) => a.authoredDriftMs)),
        after: driftStats(matched.map((a) => a.snappedDriftMs)),
        beforeLanded: driftStats(matched.map((a) => a.authoredLandedDriftMs)),
        afterLanded: driftStats(matched.map((a) => a.snappedLandedDriftMs)),
        spacedBeats: r.spacedBeats,
      },
      reveal: {
        beats: r.arrivals.length, measured: arrived.length,
        before: driftStats(arrived.map((a) => a.rampDriftMs)),
        after: driftStats(arrived.map((a) => a.arriveDriftMs)),
      },
    },
  };
}

const s = (ms: number | null) => (ms === null ? '     —' : `${(ms / 1000).toFixed(2)}s`.padStart(7));
const pad = (x: string | number, n: number) => String(x).padEnd(n).slice(0, n);

/** The measurement, as the table the bug report used. */
export function reportLines(r: SyncReport): string[] {
  const out: string[] = [];
  out.push('  beat  kind       label              rule    word            fires   spoken    drift -> fires   drift');
  for (const a of r.accents) {
    out.push(`   ${pad(a.beat, 4)} ${pad(a.kind, 10)} ${pad(a.label, 18)} ${pad(a.rule, 7)} ${pad(a.word ?? '—', 14)}`
      + ` ${s(a.authoredFireMs)} ${s(a.wordStartMs)} ${s(a.authoredDriftMs)} ${s(a.snappedFireMs)} ${s(a.snappedDriftMs)}`
      + (a.spaced ? '  (spaced)' : ''));
  }
  const { summary } = summarise(r);
  const st = (x: { n: number; median: number; worst: number; over500: number }) =>
    `n=${x.n} median ${(x.median / 1000).toFixed(2)}s worst ${(x.worst / 1000).toFixed(2)}s over-0.5s ${x.over500}`;
  out.push(`  accents fire : before ${st(summary.accents.before)} | after ${st(summary.accents.after)}`);
  out.push(`  accents land : before ${st(summary.accents.beforeLanded)} | after ${st(summary.accents.afterLanded)}`);
  out.push('');
  out.push('  beat  number     spoken   arrives(0.68)  drift ->  arrives   drift');
  for (const a of r.arrivals) {
    out.push(`   ${pad(a.beat, 4)} ${pad(a.value ?? '—', 10)} ${s(a.spokenMs)} ${s(a.rampArriveMs)} ${s(a.rampDriftMs)}`
      + ` ${s(a.arriveMs ?? a.rampArriveMs)} ${s(a.arriveDriftMs)}`
      + (a.travels ? '' : '  (line does not travel in this beat)'));
  }
  out.push(`  line arrival : before ${st(summary.reveal.before)} | after ${st(summary.reveal.after)}`);
  return out;
}

// CLI only when run directly, so scripts/render-videos.ts can import
// `syncDraftFiles` without this block firing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const id = process.argv[2];
  if (!id) {
    console.error('usage: npx tsx scripts/sync.ts <id> [reportPath]');
    process.exit(1);
  }
  const res = syncDraftFiles(id, { log: (l) => console.log(l), reportPath: process.argv[3] });
  if (!res.ok) {
    console.error(`${id}: ${res.reason}`);
    process.exit(1);
  }
  for (const line of reportLines(res.report)) console.log(line);
}
