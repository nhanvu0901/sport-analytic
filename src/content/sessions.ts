/**
 * On-disk session + candidate storage. Ported shape from comic-book-pipeline's
 * SessionStore (stages/research_scout/storage.py): one directory per session,
 * one JSON file per revision of candidates, so a rerun never destroys the
 * round the Master (here: the user) was actually looking at.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { contentRoot } from './ledger';
import type { Session, Lane, Candidate } from './types';

const sessionsRoot = () => join(contentRoot(), 'sessions');
const sessionDir = (id: string) => join(sessionsRoot(), id);
const sessionFile = (id: string) => join(sessionDir(id), 'session.json');
const candidatesFile = (id: string, rev: number) => join(sessionDir(id), `candidates.rev${rev}.json`);

export function createSession(opts: { lanes: Lane[]; intent?: string }): Session {
  const id = randomBytes(4).toString('hex'); // 8 hex chars
  const session: Session = {
    id,
    created: new Date().toISOString(),
    state: 'draft',
    lanes: opts.lanes,
    intent: opts.intent ?? '',
    revision: 1,
    angle_used: {},
    feedback_log: [],
    accepted_candidate_id: null,
  };
  saveSession(session);
  return session;
}

export function loadSession(id: string): Session {
  return JSON.parse(readFileSync(sessionFile(id), 'utf8'));
}

export function saveSession(session: Session): void {
  mkdirSync(sessionDir(session.id), { recursive: true });
  writeFileSync(sessionFile(session.id), JSON.stringify(session, null, 2));
}

/** Newest first — the discover screen's history strip reads top to bottom. */
export function listSessions(): Session[] {
  const root = sessionsRoot();
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, 'session.json')))
    .map((name) => loadSession(name))
    .sort((a, b) => b.created.localeCompare(a.created));
}

export function writeCandidates(sessionId: string, rev: number, candidates: Candidate[]): void {
  mkdirSync(sessionDir(sessionId), { recursive: true });
  writeFileSync(candidatesFile(sessionId, rev), JSON.stringify(candidates, null, 2));
}

export function readCandidates(sessionId: string, rev: number): Candidate[] {
  const p = candidatesFile(sessionId, rev);
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, 'utf8'));
}
