/**
 * Phase 1 API: topic discovery + the ledger. Also the job/SSE skeleton phase
 * 2 reuses as-is for TTS/render — see server/jobs.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { briefFromCandidate } from '../src/candidateBrief';
import { runDiscovery, nextAngle, laneSessionCount } from '../src/content/discover';
import { appendLedger, contentRoot, latestById, readLedger } from '../src/content/ledger';
import { createSession, listSessions, loadSession, readCandidates, saveSession, writeCandidates } from '../src/content/sessions';
import type { LedgerStatus } from '../src/content/types';
import { readKey } from '../src/content/youcom';
import { parseDraftText, verifyDraft } from '../src/verify';
import { writeDraft } from '../src/writer';
import { getJob, onJobDone, onJobLog, startJob } from './jobs';

const outDir = () => join(process.cwd(), 'out');
const briefJsonPath = (sessionId: string) => join(outDir(), `brief-${sessionId}.json`);
const briefMdPath = (sessionId: string) => join(outDir(), `brief-${sessionId}.md`);

// Overridable so a second instance can run alongside the one already in use
// on 4310 (e.g. for isolated testing) without either one being killed.
const PORT = Number(process.env.PORT) || 4310;
const app = express();
app.use(cors());
app.use(express.json());

// One line per request — cheap and enough to follow along in dev.
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});

const asyncRoute =
  (fn: (req: Request, res: Response) => void | Promise<void>) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    keys: {
      youcom: !!readKey('YDC_API_KEY'),
      gemini: !!readKey('GEMINI_API_KEY'),
      tavily: !!readKey('TAVILY_API_KEY'),
    },
  });
});

app.get('/api/angles', (_req, res) => {
  const angles = JSON.parse(readFileSync(join(contentRoot(), 'angles.json'), 'utf8'));
  // The rotation pointer (`laneSessionCount % angles.length`) lives in
  // discover.ts because it reads sessions off disk — the browser has no way
  // to compute this itself, so the route hands over both the raw count and
  // the resolved index rather than making the UI re-derive it.
  const evergreenCount = laneSessionCount('evergreen');
  const newsyCount = laneSessionCount('newsy');
  res.json({
    ...angles,
    next: { evergreen: nextAngle('evergreen'), newsy: nextAngle('newsy') },
    sessionCount: { evergreen: evergreenCount, newsy: newsyCount },
    nextIndex: {
      evergreen: angles.evergreen?.length ? evergreenCount % angles.evergreen.length : 0,
      newsy: angles.newsy?.length ? newsyCount % angles.newsy.length : 0,
    },
  });
});

app.get('/api/sessions', (_req, res) => {
  res.json(listSessions());
});

app.post(
  '/api/sessions',
  asyncRoute(async (req, res) => {
    const { lanes, intent } = req.body ?? {};
    if (!Array.isArray(lanes) || lanes.length === 0) {
      res.status(400).json({ error: 'lanes must be a non-empty array' });
      return;
    }
    const session = createSession({ lanes, intent });
    const job = startJob('discover', async (log) => {
      log(`discovering: ${lanes.join(', ')}${intent ? ` — "${intent}"` : ''}`);
      const result = await runDiscovery({ lanes, intent, log });
      writeCandidates(session.id, session.revision, result.candidates);
      session.angle_used = result.angle_used;
      session.state = 'review';
      saveSession(session);
      for (const flag of result.flags) log(`WARN ${flag}`);
      log(`done: ${result.candidates.length} candidate(s)`);
      return result;
    });
    res.json({ session, jobId: job.id });
  })
);

app.post(
  '/api/sessions/:id/rerun',
  asyncRoute(async (req, res) => {
    const { feedback } = req.body ?? {};
    if (typeof feedback !== 'string' || !feedback.trim()) {
      res.status(400).json({ error: 'feedback is required' });
      return;
    }
    let session;
    try {
      session = loadSession(req.params.id);
    } catch {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    session.feedback_log.push({ state: session.state, text: feedback, at: new Date().toISOString() });
    session.revision += 1;
    session.state = 'draft';
    saveSession(session);
    const feedbackTexts = session.feedback_log.map((f) => f.text);

    const job = startJob('discover', async (log) => {
      log(`rerunning: ${session.lanes.join(', ')} (rev ${session.revision})`);
      const result = await runDiscovery({ lanes: session.lanes, intent: session.intent, feedback: feedbackTexts, log });
      writeCandidates(session.id, session.revision, result.candidates);
      session.angle_used = result.angle_used;
      session.state = 'review';
      saveSession(session);
      for (const flag of result.flags) log(`WARN ${flag}`);
      log(`done: ${result.candidates.length} candidate(s)`);
      return result;
    });
    res.json({ jobId: job.id });
  })
);

app.get('/api/sessions/:id', (req, res) => {
  try {
    const session = loadSession(req.params.id);
    const candidates = readCandidates(session.id, session.revision);
    res.json({ session, candidates });
  } catch {
    res.status(404).json({ error: 'session not found' });
  }
});

app.post('/api/sessions/:id/decide', (req, res) => {
  const { candidateId, decision, note } = req.body ?? {};
  if (decision !== 'accept' && decision !== 'reject') {
    res.status(400).json({ error: "decision must be 'accept' or 'reject'" });
    return;
  }
  // Reject without a note just deletes the signal — the LESSON is the point.
  if (decision === 'reject' && (typeof note !== 'string' || !note.trim())) {
    res.status(400).json({ error: 'note is required to reject' });
    return;
  }
  let session;
  try {
    session = loadSession(req.params.id);
  } catch {
    res.status(404).json({ error: 'session not found' });
    return;
  }
  const candidate = readCandidates(session.id, session.revision).find((c) => c.id === candidateId);
  if (!candidate) {
    res.status(404).json({ error: 'candidate not found in the latest revision' });
    return;
  }

  const status: LedgerStatus = decision === 'accept' ? 'accepted' : 'rejected';
  appendLedger({
    id: candidate.id,
    question: candidate.question,
    status,
    lane: candidate.lane,
    angle: candidate.angle,
    entities: candidate.entities,
    evidence: candidate.evidence_urls,
    gates: candidate.gates,
    session: session.id,
    at: new Date().toISOString(),
    note: note ?? '',
    recheck_after: null,
  });

  if (decision === 'accept') {
    session.state = 'accepted';
    session.accepted_candidate_id = candidate.id;
  }
  saveSession(session);
  res.json({ session });
});

app.get('/api/ledger', (req, res) => {
  const { status, lane, q } = req.query;
  // One row per topic, not one per status transition — latestById collapses
  // the append-only log down to each id's newest line.
  let records = latestById(readLedger());
  if (typeof status === 'string' && status) records = records.filter((r) => r.status === status);
  if (typeof lane === 'string' && lane) records = records.filter((r) => r.lane === lane);
  if (typeof q === 'string' && q) {
    const needle = q.toLowerCase();
    records = records.filter((r) => r.question.toLowerCase().includes(needle));
  }
  records.sort((a, b) => b.at.localeCompare(a.at));
  res.json(records);
});

app.post(
  '/api/sessions/:id/brief',
  asyncRoute(async (req, res) => {
    let session;
    try {
      session = loadSession(req.params.id);
    } catch {
      res.status(404).json({ error: 'session not found' });
      return;
    }
    if (session.state !== 'accepted' || !session.accepted_candidate_id) {
      res.status(400).json({ error: `session is '${session.state}', not accepted` });
      return;
    }
    const candidate = readCandidates(session.id, session.revision).find((c) => c.id === session.accepted_candidate_id);
    if (!candidate) {
      res.status(400).json({ error: 'accepted candidate not found in the latest revision' });
      return;
    }

    const job = startJob('brief', async (log) => {
      const result = await briefFromCandidate(candidate, { log });
      if (!result.ok) {
        // A candidate our data cannot answer is a normal outcome, not a job
        // failure — nothing is written to out/, and the UI reads `ok:false`
        // off the job's own result, same shape as a resolved success.
        return { ok: false, reason: result.reason, resolved: result.resolved };
      }
      mkdirSync(outDir(), { recursive: true });
      writeFileSync(briefJsonPath(session.id), JSON.stringify(result.brief, null, 2));
      writeFileSync(briefMdPath(session.id), result.md);
      return {
        ok: true,
        md: result.md,
        warnings: result.warnings,
        resolved: result.resolved,
        chart: result.brief.visual.chart,
        entities: result.brief.facts.entities.length,
      };
    });
    res.json({ jobId: job.id });
  })
);

app.get('/api/sessions/:id/brief', (req, res) => {
  const jsonPath = briefJsonPath(req.params.id);
  const mdPath = briefMdPath(req.params.id);
  if (!existsSync(jsonPath) || !existsSync(mdPath)) {
    res.status(404).json({ error: 'no brief for this session yet' });
    return;
  }
  // warnings/resolved are the JOB's own transient output (a "here is what I
  // found" narration), never persisted alongside the brief files — a page
  // reload gets the brief back, but not the original run's side notes.
  const brief = JSON.parse(readFileSync(jsonPath, 'utf8'));
  const md = readFileSync(mdPath, 'utf8');
  res.json({ ok: true, md, chart: brief.visual.chart, entities: brief.facts.entities.length });
});

app.post(
  '/api/sessions/:id/write',
  asyncRoute(async (req, res) => {
    const jsonPath = briefJsonPath(req.params.id);
    const mdPath = briefMdPath(req.params.id);
    if (!existsSync(jsonPath) || !existsSync(mdPath)) {
      res.status(400).json({ error: 'no brief for this session yet — build one first' });
      return;
    }
    const force = !!req.body?.force;
    // writeDraft never throws for the three expected failure classes
    // (auth/refused/rules) — it returns `{ ok: false, kind, ... }`, same as
    // the /brief route's "our data cannot answer this" outcome, so the job
    // stays `status: 'done'` and the UI reads the failure kind off the
    // result instead of every failure collapsing into the job's own `error`.
    const job = startJob('write', async (log) => {
      const result = await writeDraft(req.params.id, { force, onLog: log });
      // Narration written AND verified clean (verifyDraft found 0 violations)
      // — not a rejected draft (rules/refused/auth). Carry the topic's
      // question/lane/angle/entities/gates forward from its latest ledger
      // line rather than writing a stub; if the session has no ledger record
      // at all (shouldn't happen — accept always writes one first) there is
      // nothing to extend, so skip silently.
      if (result.ok) {
        const prior = latestById(readLedger()).find((r) => r.session === req.params.id);
        if (prior) appendLedger({ ...prior, status: 'narrated', at: new Date().toISOString() });
      }
      return result;
    });
    res.json({ jobId: job.id });
  })
);

app.post('/api/sessions/:id/draft', (req, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }
  const briefPath = briefJsonPath(req.params.id);
  if (!existsSync(briefPath)) {
    res.status(400).json({ error: 'no brief for this session yet — build one first' });
    return;
  }
  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));

  const parsed = parseDraftText(text);
  if (!parsed.ok) {
    // No separate "parse error" shape in the contract — a parse failure is
    // reported through the same violations list a verify failure uses.
    res.json({ ok: false, violations: [{ beat: null, rule: 'parse', detail: parsed.error }] });
    return;
  }
  const violations = verifyDraft(parsed.draft, brief);
  if (violations.length > 0) {
    res.json({ ok: false, violations });
    return;
  }

  const WORDS_PER_SECOND = 2.9; // matches verifyDraft's own default
  const totalWords = parsed.draft.beats.reduce((n, b) => n + b.text.split(/\s+/).filter(Boolean).length, 0);
  const totalAccents = parsed.draft.beats.reduce((n, b) => n + (b.accents?.length ?? 0), 0);
  const seconds = totalWords / WORDS_PER_SECOND;
  const events = parsed.draft.beats.length + totalAccents;
  const perSecond = seconds > 0 ? events / seconds : 0;

  // Never write a draft that failed verification — only reachable here once
  // violations.length === 0 above.
  mkdirSync(outDir(), { recursive: true });
  writeFileSync(join(outDir(), `draft-${req.params.id}.json`), JSON.stringify(parsed.draft, null, 2));

  res.json({
    ok: true,
    summary: {
      beats: parsed.draft.beats.length,
      words: totalWords,
      durationS: Number(seconds.toFixed(1)),
      events,
      perSecond: Number(perSecond.toFixed(3)),
      band: [brief.visual.density.floor, brief.visual.density.ceiling],
    },
  });
});

app.get('/api/skill', (_req, res) => {
  res.type('text/plain').send(readFileSync(join(process.cwd(), 'prompts', 'WRITER_SKILL.md'), 'utf8'));
});

app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  for (const line of job.log) res.write(`data: ${line}\n\n`);
  if (job.status !== 'running') {
    res.write(`event: done\ndata: ${JSON.stringify({ status: job.status, result: job.result, error: job.error })}\n\n`);
    res.end();
    return;
  }

  const offLog = onJobLog(job.id, (line) => res.write(`data: ${line}\n\n`));
  const offDone = onJobDone(job.id, (finished) => {
    res.write(`event: done\ndata: ${JSON.stringify({ status: finished.status, result: finished.result, error: finished.error })}\n\n`);
    res.end();
  });
  req.on('close', () => {
    offLog();
    offDone();
  });
});

app.use((req, res) => {
  res.status(404).json({ error: `no route: ${req.method} ${req.path}` });
});

// Last resort: nothing above should reach here except a route's own throw.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
});

app.listen(PORT, () => {
  console.log(`sport-analytic api on http://localhost:${PORT}`);
});
