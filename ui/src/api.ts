import type { Candidate, LedgerRecord, Session } from './types';

async function toJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const post = (path: string, body: unknown) =>
  fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  health: () => fetch('/api/health').then((r) => toJson<{ ok: boolean; keys: { youcom: boolean; gemini: boolean; tavily: boolean } }>(r)),
  angles: () => fetch('/api/angles').then((r) => toJson<{ evergreen: string[]; newsy: string[]; next: { evergreen: string; newsy: string } }>(r)),
  sessions: () => fetch('/api/sessions').then((r) => toJson<Session[]>(r)),
  session: (id: string) => fetch(`/api/sessions/${id}`).then((r) => toJson<{ session: Session; candidates: Candidate[] }>(r)),
  createSession: (lanes: string[], intent?: string) => post('/api/sessions', { lanes, intent }).then((r) => toJson<{ session: Session; jobId: string }>(r)),
  rerun: (id: string, feedback: string) => post(`/api/sessions/${id}/rerun`, { feedback }).then((r) => toJson<{ jobId: string }>(r)),
  decide: (id: string, candidateId: string, decision: 'accept' | 'reject', note?: string) =>
    post(`/api/sessions/${id}/decide`, { candidateId, decision, note }).then((r) => toJson<{ session: Session }>(r)),
  ledger: (params: { status?: string; lane?: string; q?: string }) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    return fetch(`/api/ledger?${qs}`).then((r) => toJson<LedgerRecord[]>(r));
  },
};

export type JobDone = { status: 'done' | 'failed'; result?: unknown; error?: string };

/** SSE subscription: one onLog call per log line, one onDone call at the end. */
export function subscribeJob(id: string, onLog: (line: string) => void, onDone: (payload: JobDone) => void): () => void {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.onmessage = (ev) => onLog(ev.data);
  es.addEventListener('done', (ev) => {
    onDone(JSON.parse((ev as MessageEvent).data));
    es.close();
  });
  es.onerror = () => es.close();
  return () => es.close();
}
