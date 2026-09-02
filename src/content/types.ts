/**
 * Shapes ported from comic-book-pipeline's Stage 1 research scout
 * (stages/research_scout/models.py, stages/youcom_scout.py), adapted for one
 * lane pair (evergreen / newsy) instead of QA/MICRO modes, and for the
 * ledger's own status vocabulary instead of a session state machine.
 */

export type Lane = 'evergreen' | 'newsy';
export type Angle = 'verdict-revisited' | 'chase' | 'cohort-fate' | 'rank-inversion' | 'hidden-cost' | 'newsy';
export type LedgerStatus = 'candidate' | 'rejected' | 'blocked' | 'accepted' | 'produced' | 'stale';
export type GateVerdict = 'pass' | 'fail' | 'pending';

export type Gates = {
  g0_burned: GateVerdict;
  g1_real_question: GateVerdict;
  g3_data_available: GateVerdict;
  g4_chart_fit: GateVerdict;
};

/**
 * g2 demoted from a gate to a note (2026-09): it was ported straight from
 * comic-book-pipeline, where a competitor already covering a question is a
 * real reason to skip — that market is small, and making the same video means
 * competing head-on for the same query. Basketball is the opposite: thousands
 * of channels cover the same topics, the source channel itself made "Salary
 * Cap Breakdown" forty times, and audiences happily watch the same subject
 * from several creators. Worse, this project exists to reproduce a format
 * that already works — a competitor having made it is EVIDENCE the topic
 * lands, not a reason to avoid it. The only overlap worth blocking is with
 * OUR OWN back catalogue, and that is g0 (`isBurned` against our ledger),
 * which is free, pure and reliable. So the YouTube coverage probe stays —
 * it's still useful context — but it never blocks Accept and never dims a
 * card; it's a line, not a verdict.
 */
export type Coverage = { checked: number; topTitle?: string; topUrl?: string; score?: number; note: string };

export type Candidate = {
  id: string;
  question: string;
  angle: Angle;
  lane: Lane;
  why_fans_argue: string;
  measurable_as: string;
  entities: string[];
  evidence_urls: string[];
  freshness: 'evergreen' | 'this-week';
  gates: Gates;
  burned_by?: string | null;
  flags: string[];
  /** Human-readable reason for each non-trivial gate verdict, for the UI's tooltip/fail line. */
  gate_notes?: Partial<Record<keyof Gates, string>>;
  /** A gate's matched URL, when it has one — kept separate from gate_notes
   *  (plain strings) so the UI can still link to it. */
  gate_links?: Partial<Record<keyof Gates, string>>;
  /** Informational-only YouTube coverage probe. Never a verdict, never blocks. */
  coverage?: Coverage;
};

export type SessionState = 'draft' | 'review' | 'accepted' | 'archived';

export type FeedbackNote = { state: SessionState; text: string; at: string };

export type Session = {
  id: string;
  created: string;
  state: SessionState;
  lanes: Lane[];
  intent: string;
  revision: number;
  angle_used: { evergreen?: string; newsy?: string };
  feedback_log: FeedbackNote[];
  accepted_candidate_id?: string | null;
};

export type LedgerRecord = {
  id: string;
  question: string;
  status: LedgerStatus;
  lane: Lane;
  angle: Angle;
  entities: string[];
  evidence: string[];
  gates: Gates;
  session: string;
  at: string;
  note: string;
  recheck_after: string | null;
  video?: string | null;
  views_7d?: number | null;
};
