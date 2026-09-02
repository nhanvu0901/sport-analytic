/**
 * Phase 1 API: topic discovery + the ledger. Also the job/SSE skeleton phase
 * 2 reuses as-is for TTS/render — see server/jobs.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { runDiscovery, nextAngle } from '../src/content/discover';
import { appendLedger, contentRoot, readLedger } from '../src/content/ledger';
import { createSession, listSessions, loadSession, readCandidates, saveSession, writeCandidates } from '../src/content/sessions';
import type { LedgerStatus } from '../src/content/types';
import { readKey } from '../src/content/youcom';
import { getJob, onJobDone, onJobLog, startJob } from './jobs';

const PORT = 4310;
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
  res.json({ ...angles, next: { evergreen: nextAngle('evergreen'), newsy: nextAngle('newsy') } });
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
  let records = readLedger();
  if (typeof status === 'string' && status) records = records.filter((r) => r.status === status);
  if (typeof lane === 'string' && lane) records = records.filter((r) => r.lane === lane);
  if (typeof q === 'string' && q) {
    const needle = q.toLowerCase();
    records = records.filter((r) => r.question.toLowerCase().includes(needle));
  }
  records.sort((a, b) => b.at.localeCompare(a.at));
  res.json(records);
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
