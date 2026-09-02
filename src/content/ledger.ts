/**
 * Append-only ledger + burn-check, ported from comic-book-pipeline's
 * stages/youcom_scout.py (`is_burned`, `_tokens`, ~lines 94-205). The Python
 * version diffed a QUESTION against a multi-section markdown digest string;
 * here the digest is already reduced to a flat list of plain question/LESSON
 * lines (see `digestLines`), so `isBurned` skips the "- " line-prefix parsing
 * the original needed.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { LedgerRecord, LedgerStatus } from './types';

/** Root of content/ — overridable so tests never touch the real ledger/sessions. */
export const contentRoot = () => process.env.CONTENT_ROOT || join(process.cwd(), 'content');
const ledgerPath = () => join(contentRoot(), 'ledger.jsonl');

// Ported from _STOP (generic question scaffolding) + _FORMAT (listicle
// scaffolding: "things", "times", "absolute"…) in youcom_scout.py, merged
// into one set — the port only needs the combined "is this a real subject
// word" question, never _FORMAT's original standalone role — plus basketball
// filler words the comic domain never had.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'to', 'who', 'has', 'have', 'had', 'what', 'which', 'why', 'how',
  'his', 'her', 'their', 'and', 'or', 'for', 'with', 'actually', 'can', 'did', 'does', 'do', 'that',
  'this', 'these', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'not', 'no', 'cannot',
  'things', 'times', 'ways', 'regular', 'classic', 'absolute', 'modern', 'comics', 'comic',
  'unbreakable', 'famous', 'new', 'old', 'three',
  'nba', 'player', 'players', 'team', 'teams', 'ever', 'really', 'most', 'best', 'worst',
]);

/** No apostrophes/hyphens in the token class: "spider-man's" yields {spider, man}. */
export function tokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
}

/**
 * The digest line this question collides with, or null. Loose token overlap
 * so re-skins match too, not just exact repeats.
 *
 * ponytail (ported): >=60% token containment against the SHORTER side, and
 * >=2 shared tokens. KNOWN MISS, by choice: pure synonym re-skins ("beat" vs
 * "defeated") slip through when that's the ONLY overlap — chasing synonyms
 * would also bury legitimate siblings ("who lifted Mjolnir" vs the produced
 * "who shattered Mjolnir"). This filter only has to stop the obvious repeats;
 * the human accept/reject step is the catch for subtler ones.
 */
export function isBurned(question: string, digestLines: string[]): string | null {
  const qt = tokens(question);
  if (qt.size === 0) return null;
  for (const line of digestLines) {
    const lt = tokens(line);
    if (lt.size === 0) continue;
    let shared = 0;
    for (const w of qt) if (lt.has(w)) shared++;
    // Containment against the SHORTER side: a long re-skin of a short
    // produced question would otherwise dilute the ratio against itself
    // (ported bug fix, 2026-08-05: a long "Which Spider-Man villains or
    // symbiotes have bypassed or been immune to Spider-Man's spider-sense?"
    // slid past the short produced "What has gotten past Spider-Man's
    // spider-sense?" until containment was measured against min(|qt|,|lt|)).
    if (shared / Math.min(qt.size, lt.size) >= 0.6 && shared >= 2) return line;
  }
  return null;
}

export function readLedger(): LedgerRecord[] {
  const p = ledgerPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LedgerRecord);
}

export function appendLedger(rec: LedgerRecord): void {
  const p = ledgerPath();
  mkdirSync(dirname(p), { recursive: true });
  appendFileSync(p, JSON.stringify(rec) + '\n');
}

/**
 * Everything a new discovery prompt must never re-propose: the question text
 * of every settled record, plus any "LESSON:" line from a rejection note —
 * the note IS the point of a reject, so its lesson has to survive into the
 * next prompt, not just the question that triggered it.
 */
const BURNED_STATUSES: LedgerStatus[] = ['accepted', 'produced', 'rejected', 'blocked'];

export function digestLines(): string[] {
  const out: string[] = [];
  for (const rec of readLedger()) {
    if (!BURNED_STATUSES.includes(rec.status)) continue;
    if (rec.question) out.push(rec.question);
    for (const line of (rec.note || '').split('\n')) {
      const t = line.trim();
      if (t.startsWith('LESSON:')) out.push(t);
    }
  }
  return out;
}

/** ids for candidates/ledger rows: lowercase, non-alnum -> '-', capped at 60. */
export function slugify(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}
