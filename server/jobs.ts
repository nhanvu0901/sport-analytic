/**
 * In-memory job registry + SSE fan-out. Phase 1 only needs it for discovery
 * calls, but the shape (kind/status/log/result) is generic on purpose —
 * phase 2 reuses this exact module for TTS and render jobs.
 */
import { randomBytes } from 'node:crypto';

export type JobStatus = 'running' | 'done' | 'failed';

export type Job = {
  id: string;
  kind: string;
  status: JobStatus;
  log: string[];
  result?: unknown;
  error?: string;
};

const jobs = new Map<string, Job>();
const logListeners = new Map<string, Set<(line: string) => void>>();
const doneListeners = new Map<string, Set<(job: Job) => void>>();

export function startJob(kind: string, fn: (log: (line: string) => void) => Promise<unknown>): Job {
  const id = randomBytes(4).toString('hex');
  const job: Job = { id, kind, status: 'running', log: [] };
  jobs.set(id, job);

  const log = (line: string) => {
    job.log.push(line);
    for (const listener of logListeners.get(id) ?? []) listener(line);
  };

  fn(log)
    .then((result) => {
      job.status = 'done';
      job.result = result;
    })
    .catch((err) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
    })
    .finally(() => {
      for (const listener of doneListeners.get(id) ?? []) listener(job);
      logListeners.delete(id);
      doneListeners.delete(id);
    });

  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** Returns an unsubscribe function. */
export function onJobLog(id: string, listener: (line: string) => void): () => void {
  if (!logListeners.has(id)) logListeners.set(id, new Set());
  logListeners.get(id)!.add(listener);
  return () => logListeners.get(id)?.delete(listener);
}

/** Returns an unsubscribe function. */
export function onJobDone(id: string, listener: (job: Job) => void): () => void {
  if (!doneListeners.has(id)) doneListeners.set(id, new Set());
  doneListeners.get(id)!.add(listener);
  return () => doneListeners.get(id)?.delete(listener);
}
